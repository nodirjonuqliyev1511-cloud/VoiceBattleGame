const express = require("express");
const https = require("https");
const os = require("os");
const selfsigned = require("selfsigned");
const { Server } = require("socket.io");

const app = express();

const PORT = process.env.PORT || 3000;

const BATTLE_DURATION_MS = 30000; // сколько все орут одновременно (мс)
const COUNTDOWN_SECONDS = 3;

// Перевод громкости микрофона в "очки" от 0 до 100.
// Это не физический дБ SPL, а условная шкала, откалиброванная так, чтобы:
// - тишина/фоновый шум/обычный разговор -> низ шкалы (0-40%)
// - реально громкий, истошный крик в упор в микрофон -> верх шкалы (90-100%)
// Если на практике шкала всё ещё слишком/недостаточно чувствительная под конкретные
// телефоны — подвинь RMS_DB_FLOOR (тише = более отрицательное число) и
// RMS_DB_CEIL (нужная громкость для 100%, ближе к 0 = нужнее кричать громче).
const RMS_DB_FLOOR = -55;
const RMS_DB_CEIL = -8;

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
// машина должна доехать примерно за отведённые 30 секунд
const FINISH_DISTANCE_KM = 60;

app.use(express.static("public"));

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

// ==========================
// HTTPS ОБЯЗАТЕЛЕН: браузеры на телефонах блокируют доступ
// к микрофону на обычном http, кроме localhost.
// Сертификат "самодельный" — при первом заходе телефон
// покажет предупреждение, это нормально для локальной игры.
// ==========================

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

const server = https.createServer(
    { key: pems.private, cert: pems.cert },
    app
);

const io = new Server(server);

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

app.get("/api/local-ip", (req, res) => {

    res.json({ ip: LOCAL_IP, port: PORT });

});

io.on("connection", (socket) => {

    console.log("🟢 Подключился:", socket.id);

    // ==========================
    // СОЗДАНИЕ КОМНАТЫ
    // ==========================

    socket.on("createRoom", ({ maxPlayers, hostName }) => {

        const roomCode = generateRoomCode();

        rooms[roomCode] = {

            hostId: socket.id,

            hostName: (hostName || "Ведущий").toString().trim().slice(0, 30) || "Ведущий",

            maxPlayers: maxPlayers,

            players: [],

            status: "lobby", // lobby | battling | finished

            battleTimer: null

        };

        socket.emit("roomCreated", {

            roomCode,
            maxPlayers,
            hostName: rooms[roomCode].hostName

        });

        console.log(`🎮 Комната ${roomCode} создана (ведущий: ${rooms[roomCode].hostName})`);

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

            const payload = { durationMs: BATTLE_DURATION_MS };

            io.to(room.hostId).emit("battleStarted", payload);

            room.players.forEach(player => {

                io.to(player.id).emit("battleStarted", payload);

            });

            console.log(`📣 Баттл начался в комнате ${roomCode}`);

            room.battleTimer = setTimeout(() => {

                endBattle(roomCode);

            }, BATTLE_DURATION_MS);

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
                // финишировавшие впереди, среди них — кто раньше пересёк финиш
                if (a.finished !== b.finished) return a.finished ? -1 : 1;
                if (a.finished && b.finished) return a.finishedAt - b.finishedAt;
                // никто не финишировал — сортируем по тому, кто дальше проехал
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

            // Если отключился ведущий

            if (room.hostId === socket.id) {

                if (room.battleTimer) clearTimeout(room.battleTimer);

                room.players.forEach(player => {

                    io.to(player.id).emit(
                        "joinError",
                        "Ведущий завершил игру"
                    );

                });

                delete rooms[roomCode];

                console.log(`🗑 Комната ${roomCode} удалена`);

                continue;

            }

            // Если отключился игрок

            const index = room.players.findIndex(player => player.id === socket.id);

            if (index !== -1) {

                console.log(`👋 Игрок вышел из комнаты ${roomCode}`);

                room.players.splice(index, 1);

                io.to(room.hostId).emit(
                    "playersUpdated",
                    room.players
                );

            }

        }

    });

});

server.listen(PORT, "0.0.0.0", () => {

    console.log(`🚀 VoiceBattle Server started`);
    console.log(`🌍 Listening on port ${PORT}`);

});
