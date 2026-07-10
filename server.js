const express = require("express");
const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const selfsigned = require("selfsigned");
const { Server } = require("socket.io");

const app = express();

// ==========================================================
// РЕЖИМ ЗАПУСКА: локальная вечеринка (свой Wi-Fi, самоподписанный
// HTTPS) или облако (Render и подобные — они сами дают настоящий
// HTTPS через прокси, нашему серверу отдельный сертификат не нужен).
// Render автоматически выставляет переменную окружения RENDER=true.
// ==========================================================
const IS_CLOUD = !!process.env.RENDER || process.env.CLOUD === "true";
const PORT = process.env.PORT || 3000;

// Если задан PUBLIC_BASE_URL (например, https://voicebattle.onrender.com,
// без слэша на конце) — QR-код и ссылки для игроков строятся по нему.
// Если не задан — используется локальный IP в сети Wi-Fi (для вечеринок).
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

// ==========================================================
// АВТОРИЗАЦИЯ
// ==========================================================

// Логин/пароль администратора задаются переменными окружения.
// На Render это настраивается в разделе Environment проекта.
// Локально, если переменные не заданы, используются значения по
// умолчанию — обязательно смени их перед реальным использованием.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    console.log("⚠️  ADMIN_USERNAME / ADMIN_PASSWORD не заданы в переменных окружения.");
    console.log(`⚠️  Используются значения по умолчанию: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} — смени их перед реальным использованием (особенно на Render).`);
}

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
    console.log("⚠️  SESSION_SECRET не задан — сгенерирован случайный на этот запуск (все войдут заново после перезапуска сервера). Для Render рекомендуется задать свой в Environment.");
}

// ---- хранение аккаунтов ведущих в JSON-файле ----
const DATA_DIR = path.join(__dirname, "data");
const HOSTS_FILE = path.join(DATA_DIR, "hosts.json");

function loadHosts() {
    try {
        if (!fs.existsSync(HOSTS_FILE)) return {};
        return JSON.parse(fs.readFileSync(HOSTS_FILE, "utf8"));
    } catch (e) {
        console.error("Не удалось прочитать data/hosts.json:", e.message);
        return {};
    }
}

function saveHosts(hosts) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(HOSTS_FILE, JSON.stringify(hosts, null, 2), "utf8");
}

// ВАЖНО про Render: бесплатный/обычный веб-сервис Render использует
// временную файловую систему — при каждом новом деплое (не при обычном
// перезапуске/сне) она сбрасывается, и файл data/hosts.json обнулится,
// то есть все созданные ведущие удалятся. Для вечеринки это не страшно
// (создал ведущих заново перед событием), но если нужно, чтобы аккаунты
// переживали каждый деплой — на Render подключается "Persistent Disk"
// (платно) с точкой монтирования на папку data, либо аккаунты хранятся
// во внешней базе данных. Для начала этого файла достаточно.

function timingSafeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    name: "voicebattle.sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 12 // 12 часов
    }
});

app.set("trust proxy", 1);
app.use(express.json());
app.use(sessionMiddleware);

function requireAdmin(req, res, next) {
    if (req.session && req.session.role === "admin") return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not_authenticated" });
    return res.redirect("/admin-login.html");
}

function requireHost(req, res, next) {
    if (req.session && (req.session.role === "host" || req.session.role === "admin")) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not_authenticated" });
    return res.redirect("/host-login.html");
}

// ---- страницы, защищённые логином (перехватываем ДО express.static) ----
app.get("/admin.html", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});
app.get("/host.html", requireHost, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "host.html"));
});

// ---- API логина администратора ----
app.post("/api/admin/login", (req, res) => {
    const { username, password } = req.body || {};
    const okUser = typeof username === "string" && timingSafeEqual(username, ADMIN_USERNAME);
    const okPass = typeof password === "string" && timingSafeEqual(password, ADMIN_PASSWORD);
    if (!okUser || !okPass) {
        return res.status(401).json({ error: "Неверный логин или пароль" });
    }
    req.session.role = "admin";
    req.session.username = ADMIN_USERNAME;
    res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// ---- API управления ведущими (только под администратором) ----
app.get("/api/admin/hosts", requireAdmin, (req, res) => {
    const hosts = loadHosts();
    const list = Object.entries(hosts).map(([username, h]) => ({
        username,
        displayName: h.displayName,
        createdAt: h.createdAt
    }));
    res.json({ hosts: list });
});

app.post("/api/admin/hosts", requireAdmin, (req, res) => {
    const { username, password, displayName } = req.body || {};

    const cleanUsername = (username || "").toString().trim().toLowerCase();
    const cleanDisplayName = (displayName || "").toString().trim().slice(0, 30);

    if (!/^[a-z0-9_.-]{3,20}$/.test(cleanUsername)) {
        return res.status(400).json({ error: "Логин: 3-20 символов, латиница/цифры/._-" });
    }
    if (!password || String(password).length < 4) {
        return res.status(400).json({ error: "Пароль должен быть не короче 4 символов" });
    }
    if (!cleanDisplayName) {
        return res.status(400).json({ error: "Укажи имя ведущего для афиши" });
    }

    const hosts = loadHosts();
    if (hosts[cleanUsername]) {
        return res.status(409).json({ error: "Такой логин уже существует" });
    }

    hosts[cleanUsername] = {
        passwordHash: bcrypt.hashSync(String(password), 10),
        displayName: cleanDisplayName,
        createdAt: new Date().toISOString()
    };
    saveHosts(hosts);

    console.log(`👑 Админ создал аккаунт ведущего: ${cleanUsername}`);
    res.json({ ok: true, username: cleanUsername });
});

app.delete("/api/admin/hosts/:username", requireAdmin, (req, res) => {
    const hosts = loadHosts();
    const username = (req.params.username || "").toLowerCase();
    if (!hosts[username]) return res.status(404).json({ error: "Не найдено" });
    delete hosts[username];
    saveHosts(hosts);
    console.log(`🗑 Админ удалил аккаунт ведущего: ${username}`);
    res.json({ ok: true });
});

// ---- API логина ведущего ----
app.post("/api/host/login", (req, res) => {
    const { username, password } = req.body || {};
    const cleanUsername = (username || "").toString().trim().toLowerCase();

    const hosts = loadHosts();
    const account = hosts[cleanUsername];

    if (!account || !bcrypt.compareSync(String(password || ""), account.passwordHash)) {
        return res.status(401).json({ error: "Неверный логин или пароль" });
    }

    req.session.role = "host";
    req.session.username = cleanUsername;
    req.session.displayName = account.displayName;
    res.json({ ok: true, displayName: account.displayName });
});

app.post("/api/host/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
    if (!req.session || !req.session.role) return res.json({ role: null });
    res.json({
        role: req.session.role,
        username: req.session.username,
        displayName: req.session.displayName || req.session.username
    });
});

// ---- остальная статика (после защищённых маршрутов) ----
app.use(express.static("public"));

// ==========================================================
// HTTPS ТОЛЬКО ДЛЯ ЛОКАЛЬНОГО РЕЖИМА: браузеры на телефонах блокируют
// доступ к микрофону на обычном http, кроме localhost. В облаке (Render
// и т.п.) настоящий HTTPS уже даёт сама платформа — свой сертификат
// там не нужен и мешал бы.
// ==========================================================

function getLocalIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "localhost";
}

const LOCAL_IP = getLocalIp();
let server;

if (IS_CLOUD) {

    server = http.createServer(app);

} else {

    const pems = selfsigned.generate(
        [{ name: "commonName", value: LOCAL_IP }],
        {
            days: 365,
            keySize: 2048,
            extensions: [
                {
                    name: "subjectAltName",
                    altNames: [
                        { type: 2, value: "localhost" },
                        { type: 7, ip: "127.0.0.1" },
                        { type: 7, ip: LOCAL_IP }
                    ]
                }
            ]
        }
    );

    server = https.createServer({ key: pems.private, cert: pems.cert }, app);

}

const io = new Server(server);

// расшариваем express-сессию с socket.io (Socket.IO 4.6+),
// чтобы в обработчиках сокетов знать, кто подключился — гость, ведущий или админ
io.engine.use(sessionMiddleware);

app.get("/api/local-ip", (req, res) => {
    if (PUBLIC_BASE_URL) {
        return res.json({ baseUrl: PUBLIC_BASE_URL });
    }
    res.json({ ip: LOCAL_IP, port: PORT });
});

// ==========================================================
// ИГРОВАЯ ЛОГИКА (без изменений по сути)
// ==========================================================

// COUNTDOWN_SECONDS ниже — это только отсчёт "приготовьтесь" перед стартом,
// сама гонка больше не ограничена по времени: побеждает тот, кто первым доедет до финиша
const COUNTDOWN_SECONDS = 3;

// Перевод громкости микрофона в "очки" от 0 до 100.
// Это не физический дБ SPL, а условная шкала, откалиброванная так, чтобы:
// - тишина/фоновый шум/обычный разговор -> низ шкалы (0-40%)
// - реально громкий, истошный крик в упор в микрофон -> верх шкалы (90-100%)
// Если на практике шкала всё ещё слишком/недостаточно чувствительная под конкретные
// телефоны — подвинь RMS_DB_FLOOR (тише = более отрицательное число) и
// RMS_DB_CEIL (нужная громкость для 100%, ближе к 0 = нужнее кричать громче).
const RMS_DB_FLOOR = -50;
const RMS_DB_CEIL = -5;

function volumeToScore(rms) {
    const safeRms = Math.max(rms, 0.000001);
    const db = 20 * Math.log10(safeRms);
    let pct = ((db - RMS_DB_FLOOR) / (RMS_DB_CEIL - RMS_DB_FLOOR)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    return Math.round(pct * 10) / 10;
}

const CAR_COLORS = ["#ff2e63", "#08d9d6", "#ffd23f", "#4fd675", "#7b8cff", "#ff8c42", "#e879f9", "#ff5c5c"];
const VEHICLE_TYPES = ["tractor", "coupe", "classic", "suv"];

// сколько км "проезжает" игрок за секунду при максимальной громкости
const DISTANCE_KM_PER_SECOND_AT_MAX = 3;
// дистанция до финиша: если орать почти на максимум большую часть раунда,
// при стабильно громком крике игрок доезжает до финиша примерно за 20-25 секунд
const FINISH_DISTANCE_KM = 60;

const rooms = {};

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do {
        code = "";
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms[code]);
    return code;
}

function findRoomByHost(socketId) {
    for (const code in rooms) {
        if (rooms[code].hostId === socketId) {
            return { code, room: rooms[code] };
        }
    }
    return null;
}

io.on("connection", (socket) => {

    console.log("🟢 Подключился:", socket.id);

    // ==========================
    // СОЗДАНИЕ КОМНАТЫ (только авторизованный ведущий/админ)
    // ==========================

    socket.on("createRoom", ({ maxPlayers }) => {

        const sess = socket.request.session;

        if (!sess || (sess.role !== "host" && sess.role !== "admin")) {
            socket.emit("joinError", "Нужно войти как ведущий");
            return;
        }

        const roomCode = generateRoomCode();
        const hostName = sess.displayName || sess.username || "Ведущий";

        rooms[roomCode] = {

            hostId: socket.id,
            hostName,
            maxPlayers: maxPlayers,
            players: [],
            status: "lobby", // lobby | battling | finished
            battleTimer: null

        };

        socket.emit("roomCreated", {
            roomCode,
            maxPlayers,
            hostName
        });

        console.log(`🎮 Комната ${roomCode} создана (ведущий: ${hostName})`);

    });

    // ==========================
    // ПОДКЛЮЧЕНИЕ ИГРОКА
    // ==========================

    socket.on("joinRoom", ({ roomCode, playerName }) => {

        const room = rooms[roomCode];

        if (!room) {
            socket.emit("joinError", "Комната не найдена");
            return;
        }

        if (room.status !== "lobby") {
            socket.emit("joinError", "Баттл уже идёт");
            return;
        }

        if (room.players.length >= room.maxPlayers) {
            socket.emit("joinError", "Комната уже заполнена");
            return;
        }

        const player = {
            id: socket.id,
            name: playerName,
            carColor: CAR_COLORS[room.players.length % CAR_COLORS.length],
            vehicleType: VEHICLE_TYPES[room.players.length % VEHICLE_TYPES.length],
            currentScore: 0,
            peakScore: -999,
            totalDistanceKm: 0,
            finished: false,
            finishedAt: null,
            lastTickAt: null
        };

        room.players.push(player);
        socket.data.roomCode = roomCode;

        socket.emit("joinSuccess", { roomCode, playerName, carColor: player.carColor, vehicleType: player.vehicleType });
        io.to(room.hostId).emit("playersUpdated", room.players);

        console.log(`👤 ${playerName} подключился к ${roomCode}`);

    });

    // ==========================
    // СТАРТ БАТТЛА
    // ==========================

    socket.on("startBattle", () => {

        const found = findRoomByHost(socket.id);
        if (!found) return;

        const { code: roomCode, room } = found;

        if (room.players.length === 0) return;
        if (room.status === "battling") return;

        room.players.forEach(player => {
            player.currentScore = 0;
            player.peakScore = -999;
            player.totalDistanceKm = 0;
            player.finished = false;
            player.finishedAt = null;
            player.lastTickAt = null;
        });

        io.to(room.hostId).emit("countdown", COUNTDOWN_SECONDS);
        room.players.forEach(player => {
            io.to(player.id).emit("countdown", COUNTDOWN_SECONDS);
        });

        setTimeout(() => {

            room.status = "battling";

            const startedAt = Date.now();
            room.players.forEach(player => { player.lastTickAt = startedAt; });

            const payload = {};
            io.to(room.hostId).emit("battleStarted", payload);
            room.players.forEach(player => {
                io.to(player.id).emit("battleStarted", payload);
            });

            console.log(`📣 Баттл начался в комнате ${roomCode}`);

        }, COUNTDOWN_SECONDS * 1000);

    });

    function endBattle(roomCode) {

        const room = rooms[roomCode];
        if (!room || room.status !== "battling") return;

        room.status = "finished";
        if (room.battleTimer) clearTimeout(room.battleTimer);

        const results = room.players
            .map(p => ({
                id: p.id, name: p.name, carColor: p.carColor, vehicleType: p.vehicleType,
                peakScore: Math.round(p.peakScore * 10) / 10,
                totalDistanceKm: Math.round(p.totalDistanceKm * 100) / 100,
                finished: p.finished, finishedAt: p.finishedAt || Infinity,
                progressPct: Math.min(100, (p.totalDistanceKm / FINISH_DISTANCE_KM) * 100)
            }))
            .sort((a, b) => {
                if (a.finished !== b.finished) return a.finished ? -1 : 1;
                if (a.finished && b.finished) return a.finishedAt - b.finishedAt;
                return b.progressPct - a.progressPct;
            })
            .map((p, idx) => ({ ...p, place: idx + 1 }));

        io.to(room.hostId).emit("battleOver", results);
        room.players.forEach(p => {
            io.to(p.id).emit("battleOver", results);
        });

        console.log(`🏆 Баттл в комнате ${roomCode} завершён`);

    }

    // ==========================
    // ЖИВАЯ ГРОМКОСТЬ ВО ВРЕМЯ БАТТЛА
    // ==========================

    socket.on("volume", (rms) => {

        const roomCode = socket.data.roomCode;
        const room = rooms[roomCode];
        if (!room || room.status !== "battling") return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const score = volumeToScore(Number(rms) || 0);
        player.currentScore = score;
        if (score > player.peakScore) player.peakScore = score;

        const now = Date.now();
        const dtSeconds = player.lastTickAt ? Math.min(0.5, (now - player.lastTickAt) / 1000) : 0;
        player.lastTickAt = now;

        const speedFraction = Math.max(0, Math.min(1, score / 100));
        player.totalDistanceKm += speedFraction * DISTANCE_KM_PER_SECOND_AT_MAX * dtSeconds;

        if (!player.finished && player.totalDistanceKm >= FINISH_DISTANCE_KM) {
            player.finished = true;
            player.finishedAt = now;
            endBattle(roomCode);
            return;
        }

        io.to(room.hostId).emit("liveScores", room.players.map(p => ({
            id: p.id,
            name: p.name,
            carColor: p.carColor,
            vehicleType: p.vehicleType,
            currentScore: p.currentScore,
            peakScore: Math.round(p.peakScore * 10) / 10,
            totalDistanceKm: Math.round(p.totalDistanceKm * 100) / 100,
            progressPct: Math.min(100, (p.totalDistanceKm / FINISH_DISTANCE_KM) * 100),
            finished: p.finished
        })));

    });

    // ==========================
    // НОВЫЙ РАУНД (та же комната, те же игроки)
    // ==========================

    socket.on("resetBattle", () => {

        const found = findRoomByHost(socket.id);
        if (!found) return;

        const { room } = found;
        if (room.battleTimer) clearTimeout(room.battleTimer);

        room.status = "lobby";
        room.players.forEach(p => {
            p.currentScore = 0;
            p.peakScore = -999;
            p.totalDistanceKm = 0;
            p.lastTickAt = null;
        });

        io.to(room.hostId).emit("playersUpdated", room.players);
        io.to(room.hostId).emit("backToLobby");
        room.players.forEach(p => {
            io.to(p.id).emit("backToLobby");
        });

    });

    // ==========================
    // ОТКЛЮЧЕНИЕ
    // ==========================

    socket.on("disconnect", () => {

        console.log("🔴 Отключился:", socket.id);

        for (const roomCode in rooms) {

            const room = rooms[roomCode];

            if (room.hostId === socket.id) {
                if (room.battleTimer) clearTimeout(room.battleTimer);
                room.players.forEach(player => {
                    io.to(player.id).emit("joinError", "Ведущий завершил игру");
                });
                delete rooms[roomCode];
                console.log(`🗑 Комната ${roomCode} удалена`);
                continue;
            }

            const index = room.players.findIndex(player => player.id === socket.id);
            if (index !== -1) {
                console.log(`👋 Игрок вышел из комнаты ${roomCode}`);
                room.players.splice(index, 1);
                io.to(room.hostId).emit("playersUpdated", room.players);
            }

        }

    });

});

server.listen(PORT, () => {

    if (IS_CLOUD) {
        console.log(`🚀 Сервер запущен на порту ${PORT} (облачный режим, HTTPS от платформы)`);
        console.log(`👑 Админка: /admin-login.html`);
        console.log(`🎤 Вход для ведущих: /host-login.html`);
    } else {
        console.log(`🚀 Сервер запущен: https://localhost:${PORT}`);
        console.log(`👑 Админка: https://localhost:${PORT}/admin-login.html`);
        console.log(`🎤 Вход для ведущих: https://localhost:${PORT}/host-login.html`);
        console.log(`📱 Для игроков (в этом же Wi-Fi): https://${LOCAL_IP}:${PORT}/join.html`);
        console.log(`⚠️  Браузер покажет предупреждение "соединение не защищено" — это нормально, нажмите "Дополнительно" → "Перейти на сайт".`);
    }

});
