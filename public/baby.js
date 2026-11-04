(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const { baby, toy } = NurseryArt;
  document.querySelectorAll('[data-baby]').forEach(el => { el.innerHTML = baby(el.dataset.baby); });
  document.querySelectorAll('[data-toy]').forEach(el => { el.innerHTML = toy(el.dataset.toy, el.dataset.pink === 'true'); });
  const socket = io();
  let roomCode = null, players = [];
  const CELEBRATION_MS = 7000;
  let countdownTimer = null, raceTimer = null, celebrationTimer = null, noticeTimer = null;
  let startedAt = 0, phase = 'lobby';

  function stopTimers() {
    clearInterval(countdownTimer); clearInterval(raceTimer); clearTimeout(celebrationTimer);
    countdownTimer = raceTimer = celebrationTimer = null;
  }
  function show(screen) {
    ['setup', 'lobby', 'stage'].forEach(id => { $(id).hidden = id !== screen; });
  }
  function notify(message) {
    $('notice').textContent = message; $('notice').hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
  }
  fetch('/api/session').then(r => r.json()).then(session => {
    if (!session.role) { location.replace('/host-login.html'); return; }
    $('hostName').textContent = session.displayName || session.username;
  }).catch(() => notify('Не удалось проверить вход. Обновите страницу.'));

  $('createRoom').onclick = () => {
    if (!socket.connected) { notify('Нет соединения с сервером. Подождите подключения.'); return; }
    $('createRoom').disabled = true;
    socket.emit('createRoom', { maxPlayers: 2, gameMode: 'baby' });
  };
  socket.on('roomCreated', async room => {
    roomCode = room.roomCode;
    $('roomCode').textContent = roomCode;
    show('lobby');
    let base = location.origin;
    const tunnel = new URLSearchParams(location.search).get('tunnel');
    try {
      if (tunnel && /^https:\/\//.test(tunnel)) base = new URL(tunnel).origin;
      else if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
        const response = await fetch('/api/local-ip');
        const info = await response.json();
        base = info.baseUrl || `https://${info.ip}:${info.port}`;
      }
      const url = `${base.replace(/\/$/, '')}/join.html?room=${encodeURIComponent(roomCode)}&game=baby`;
      $('joinLink').href = url; $('joinLink').textContent = url;
      $('qrcode').replaceChildren();
      new QRCode($('qrcode'), { text: url, width: 188, height: 188, colorDark: '#655044', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } catch { $('qrError').textContent = 'Не удалось построить QR. Откройте страницу участника и введите код комнаты.'; }
  });

  socket.on('playersUpdated', list => {
    players = list;
    for (const side of ['boy', 'girl']) {
      const player = list.find(p => p.babyType === side);
      $('name-' + side).textContent = player ? 'Команда готова' : 'Телефон не подключён';
      $('laneName-' + side).textContent = '';
      $('status-' + side).textContent = player ? '✓ Телефон команды подключён' : 'Ожидаем телефон команды';
      $('card-' + side).classList.toggle('connected', !!player);
    }
    $('startBattle').disabled = list.length !== 2 || !socket.connected;
    $('lobbyHint').textContent = list.length === 2 ? 'Обе команды готовы. Можно начинать!' : `Подключено ${list.length} из 2 команд`;
  });
  $('startBattle').onclick = () => {
    if (players.length !== 2) return;
    $('startBattle').disabled = true;
    socket.emit('startBattle');
  };

  function resetStage() {
    stopTimers();
    phase = 'lobby';
    $('celebration').hidden = true;
    $('stageFireworks').replaceChildren(); $('stageConfetti').replaceChildren();
    $('timer').hidden = false;
    $('results').hidden = true; $('countdown').hidden = true; $('timer').textContent = '0:00';
    for (const side of ['boy', 'girl']) {
      $('crawler-' + side).innerHTML = baby(side);
      $('crawler-' + side).classList.remove('is-crawling');
      $('crawler-' + side).style.left = '0%';
      $('crawler-' + side).dataset.progress = '0';
      $('lane-' + side).classList.remove('winner', 'loser');
      $('volume-' + side).style.width = '0%';
      $('progress-' + side).textContent = 'НА СТАРТЕ';
    }
  }
  socket.on('countdown', seconds => {
    resetStage(); show('stage');
    phase = 'countdown';
    $('countdown').hidden = false;
    let remaining = seconds;
    $('countdownNumber').textContent = remaining;
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) { clearInterval(countdownTimer); $('countdownNumber').textContent = 'Вперёд!'; }
      else $('countdownNumber').textContent = remaining;
    }, 1000);
  });
  socket.on('battleStarted', () => {
    phase = 'playing';
    clearInterval(countdownTimer); $('countdown').hidden = true;
    startedAt = Date.now();
    raceTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      $('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }, 250);
  });
  function paintPlayer(player, ended = false) {
    const side = player.babyType;
    if (side !== 'boy' && side !== 'girl') return;
    const pct = Math.max(0, Math.min(100, player.progressPct || 0));
    // The sprite's full width stays inside the path at the finish, on any screen.
    const path = $('crawler-' + side).parentElement;
    const travel = Math.max(0, path.clientWidth - $('crawler-' + side).offsetWidth);
    $('crawler-' + side).style.left = (travel * pct / 100) + 'px';
    $('crawler-' + side).dataset.progress = pct;
    $('crawler-' + side).classList.toggle('is-crawling', !ended && player.currentScore > 5);
    $('volume-' + side).style.width = Math.max(0, Math.min(100, (player.currentScore || 0) / 2)) + '%';
    $('progress-' + side).textContent = ended && player.finished ? 'УРА! ДОПОЛЗЛИ!' : `${Math.round(pct)}% ПУТИ`;
  }
  socket.on('liveScores', list => { if (phase === 'playing') list.forEach(player => paintPlayer(player)); });
  window.addEventListener('resize', () => {
    for (const side of ['boy', 'girl']) {
      const el = $('crawler-' + side), path = el.parentElement;
      el.style.left = Math.max(0, path.clientWidth - el.offsetWidth) * Number(el.dataset.progress || 0) / 100 + 'px';
    }
  });
  socket.on('battleOver', results => {
    stopTimers(); results.forEach(player => paintPlayer(player, true));
    const winner = results[0]; if (!winner) return;
    phase = 'celebrating';
    const side = winner.babyType === 'girl' ? 'girl' : 'boy';
    const otherSide = side === 'girl' ? 'boy' : 'girl';
    $('crawler-' + side).innerHTML = baby(side, 'cheer');
    $('lane-' + side).classList.add('winner');
    $('crawler-' + otherSide).innerHTML = baby(otherSide, 'cry');
    $('lane-' + otherSide).classList.add('loser');
    $('progress-' + otherSide).textContent = 'ЧУТЬ-ЧУТЬ НЕ ХВАТИЛО';
    $('timer').hidden = true;
    $('celebrationTitle').textContent = side === 'girl' ? 'Победила команда девочки!' : 'Победила команда мальчика!';
    $('celebrationName').textContent = 'Вот это поддержка гостей!';
    $('winnerBaby').innerHTML = baby(side, 'cheer');
    $('winnerTitle').textContent = side === 'girl' ? 'Команда «Девочка»!' : 'Команда «Мальчик»!';
    $('winnerTitle').classList.toggle('girl', side === 'girl');
    $('winnerName').textContent = side === 'girl' ? 'Гости за девочку оказались громче!' : 'Гости за мальчика оказались громче!';
    const colors = ['#65b2bb','#df8da6','#eaca7b','#95ba92','#fff5d2'];
    const confetti = Array.from({length:55}, (_, i) => `<i style="left:${(i * 47) % 100}%;background:${colors[i % colors.length]};animation-delay:${-(i % 10) / 3}s;animation-duration:${2.3 + (i % 6) / 3}s"></i>`).join('');
    $('stageConfetti').innerHTML = confetti;
    $('confetti').innerHTML = confetti;
    $('stageFireworks').innerHTML = Array.from({length:7}, (_, i) => {
      const sparks = Array.from({length:16}, (_, s) => {
        const angle = s * Math.PI / 8;
        return `<i style="--spark-x:${Math.cos(angle) * 110}px;--spark-y:${Math.sin(angle) * 110}px;--spark-color:${colors[(i+s)%colors.length]}"></i>`;
      }).join('');
      return `<div class="nursery-firework" style="left:${13 + i * 12}%;top:${i % 2 === 0 ? 20 : 65}%;--burst-delay:${i * -.43}s">${sparks}</div>`;
    }).join('');
    $('celebration').hidden = false;
    $('results').hidden = true;
    celebrationTimer = setTimeout(() => {
      if (phase !== 'celebrating') return;
      phase = 'results';
      $('celebration').hidden = true;
      $('results').hidden = false;
    }, CELEBRATION_MS);
  });
  $('again').onclick = () => { socket.emit('resetBattle'); };
  socket.on('backToLobby', () => {
    resetStage(); show('lobby');
  });
  socket.on('joinError', message => {
    $('createRoom').disabled = false;
    if (message === 'Нужно войти как ведущий') { location.replace('/host-login.html'); return; }
    notify(message);
  });
  socket.on('disconnect', () => {
    resetStage();
    $('startBattle').disabled = true; $('createRoom').disabled = true;
    notify('Соединение прервано. После подключения создайте новую комнату.');
  });
  socket.on('connect', () => {
    $('createRoom').disabled = false;
    if (roomCode) {
      resetStage(); roomCode = null; players = [];
      $('name-boy').textContent = $('name-girl').textContent = 'Телефон не подключён';
      $('card-boy').classList.remove('connected'); $('card-girl').classList.remove('connected');
      show('setup'); notify('Соединение восстановлено. Создайте новую комнату и пригласите участников.');
    }
  });
  $('fullscreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('Полноэкранный режим недоступен в этом браузере.'); }
  };
})();
