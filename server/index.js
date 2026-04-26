'use strict';
const express   = require('express');
const http      = require('http');
const { Server} = require('socket.io');
const cors      = require('cors');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);

// ── CORS: allow GitHub Pages & localhost ──────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  /^https:\/\/.*\.github\.io$/,
  /^https:\/\/.*\.vercel\.app$/,
  /^https:\/\/.*\.netlify\.app$/,
  '*'
];

app.use(cors({ origin: '*' }));
app.options('*', cors());
app.get('/', (_, res) => res.json({ status: 'UNO x Ryzen Server Online 🎮' }));
app.get('/health', (_, res) => res.json({ ok: true, rooms: Object.keys(rooms).length }));

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingTimeout: 15000,
  pingInterval: 8000
});

// ── DATA ─────────────────────────────────────────────────────────────────────
const rooms      = {};  // code -> room
const playerRoom = {};  // socketId -> roomCode
const globalChat = [];

// ── DECK ─────────────────────────────────────────────────────────────────────
const COLORS  = ['red','green','blue','yellow'];
const ACTIONS = ['skip','reverse','draw2'];

function makeDeck() {
  const deck = [];
  let id = 0;
  for (const c of COLORS) {
    deck.push({ id: id++, color: c, value: '0', type: 'number' });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: id++, color: c, value: String(n), type: 'number' });
      deck.push({ id: id++, color: c, value: String(n), type: 'number' });
    }
    for (const a of ACTIONS) {
      deck.push({ id: id++, color: c, value: a, type: 'action' });
      deck.push({ id: id++, color: c, value: a, type: 'action' });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: id++, color: 'wild', value: 'wild',  type: 'wild'  });
    deck.push({ id: id++, color: 'wild', value: 'wild4', type: 'wild4' });
  }
  return deck;
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function deal(room, pid, n) {
  const p = room.players.find(x => x.id === pid);
  if (!p) return;
  for (let i = 0; i < n; i++) {
    if (!room.deck.length) reshuffle(room);
    if (room.deck.length)  p.hand.push(room.deck.pop());
  }
}

function reshuffle(room) {
  if (room.discardPile.length <= 1) return;
  const top  = room.discardPile.pop();
  room.deck  = shuffle(room.discardPile.map(c => ({ ...c, chosenColor: undefined })));
  room.discardPile = [top];
  broadcast(room, 'gameLog', { msg: '🔄 Deck dikocok ulang!' });
}

// ── ROOM CODE ─────────────────────────────────────────────────────────────────
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms[code]);
  return code;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const current  = r => r.players[r.currentTurn];
const topCard  = r => r.discardPile[r.discardPile.length - 1];

function nextIdx(room, skip = 1) {
  const n = room.players.length;
  let idx = room.currentTurn;
  for (let i = 0; i < skip; i++) idx = ((idx + room.direction) % n + n) % n;
  return idx;
}
function advance(room, skip = 1) { room.currentTurn = nextIdx(room, skip); }

function validPlay(card, top) {
  if (!top) return true;
  if (card.type === 'wild' || card.type === 'wild4') return true;
  const eff = top.chosenColor || top.color;
  return card.color === eff || card.value === top.value;
}

function broadcast(room, evt, data) { io.to(room.code).emit(evt, data); }

function pushState(room) {
  for (const p of room.players) {
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) continue;
    sock.emit('gameState', buildState(room, p));
  }
  for (const sid of room.spectators) {
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit('gameState', buildState(room, null));
  }
}

function buildState(room, me) {
  return {
    myHand      : me ? me.hand : [],
    isSpectator : !me,
    players     : room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar,
      handCount: p.hand.length, isHost: p.isHost,
      afk: p.afk, unoCall: p.unoCall, connected: p.connected, score: p.score
    })),
    currentTurn       : room.currentTurn,
    currentPlayerId   : current(room)?.id,
    direction         : room.direction,
    topCard           : topCard(room),
    deckCount         : room.deck.length,
    discardCount      : room.discardPile.length,
    drawStack         : room.drawStack,
    phase             : room.phase,
    rules             : room.rules,
    lastAction        : room.lastAction,
    winner            : room.winner,
    challengePending  : room.challengePending,
    challengeTargetId : room.challengeTargetId
  };
}

function pushLobby(room) {
  io.to(room.code).emit('lobbyState', {
    code      : room.code,
    isPublic  : room.isPublic,
    maxPlayers: room.maxPlayers,
    phase     : room.phase,
    rules     : room.rules,
    players   : room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar,
      isHost: p.isHost, connected: p.connected
    }))
  });
}

function startTimer(room) {
  clearTimer(room);
  const dur = room.rules.turnTimer || 30;
  room.timerStart = Date.now();
  broadcast(room, 'turnTimer', { duration: dur, playerId: current(room)?.id });
  room.timerRef = setTimeout(() => autoPlay(room), dur * 1000);
}

function clearTimer(room) {
  if (room.timerRef) { clearTimeout(room.timerRef); room.timerRef = null; }
}

function autoPlay(room) {
  const p = current(room);
  if (!p || room.phase !== 'playing') return;
  p.afk = true;
  broadcast(room, 'gameLog', { msg: `⏰ ${p.name} AFK – auto draw!` });
  deal(room, p.id, 1);
  room.lastAction = { type: 'draw', playerId: p.id, playerName: p.name };
  advance(room);
  pushState(room);
  startTimer(room);
}

function checkUno(room, player) {
  if (player.hand.length === 1 && !player.unoCall) {
    setTimeout(() => {
      if (player.hand.length === 1 && !player.unoCall && room.phase === 'playing') {
        deal(room, player.id, 2);
        broadcast(room, 'gameLog',    { msg: `🚨 ${player.name} lupa UNO! +2!` });
        broadcast(room, 'unoPenalty', { playerId: player.id, playerName: player.name });
        pushState(room);
      }
    }, 3000);
  }
}

// ── GAME START ────────────────────────────────────────────────────────────────
function startGame(room) {
  room.phase       = 'playing';
  room.deck        = shuffle(makeDeck());
  room.discardPile = [];
  room.direction   = 1;
  room.currentTurn = 0;
  room.drawStack   = 0;
  room.winner      = null;
  room.lastAction  = null;
  room.challengePending  = false;
  room.challengeTargetId = null;
  room.prevWild4Hand     = null;

  for (const p of room.players) {
    p.hand    = [];
    p.unoCall = false;
    p.afk     = false;
    deal(room, p.id, 7);
  }

  // First card must be number
  let first;
  do {
    first = room.deck.pop();
    if (first.type !== 'number') room.deck.unshift(first);
  } while (first.type !== 'number');
  room.discardPile.push(first);

  broadcast(room, 'gameStarted', { firstCard: first });
  broadcast(room, 'gameLog',     { msg: '🎮 Game dimulai! Good luck semua!' });
  pushState(room);
  startTimer(room);
}

// ── SOCKET ────────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  // Global chat
  socket.on('getGlobalChat', () => socket.emit('globalChatHistory', globalChat.slice(-60)));
  socket.on('globalChat', ({ name, avatar, msg }) => {
    if (!msg?.trim()) return;
    const entry = { name, avatar, msg: String(msg).trim().slice(0, 200), ts: Date.now() };
    globalChat.push(entry);
    if (globalChat.length > 120) globalChat.shift();
    io.emit('globalChat', entry);
  });

  // Public rooms
  socket.on('getPublicRooms', () => {
    const list = Object.values(rooms)
      .filter(r => r.isPublic && r.phase === 'lobby' && r.players.length < r.maxPlayers)
      .map(r => ({
        code: r.code, playerCount: r.players.length,
        maxPlayers: r.maxPlayers,
        hostName: r.players.find(p => p.isHost)?.name || '?'
      }));
    socket.emit('publicRooms', list);
  });

  // Create room
  socket.on('createRoom', ({ name, avatar, isPublic, maxPlayers, rules }) => {
    if (!name?.trim()) return;
    const code = genCode();
    const player = { id: socket.id, name: String(name).trim().slice(0,16), avatar: avatar || '🐯',
      hand: [], isHost: true, connected: true, unoCall: false, afk: false, score: 0 };
    rooms[code] = {
      code, isPublic: !!isPublic,
      maxPlayers: Math.min(10, Math.max(2, parseInt(maxPlayers) || 4)),
      players: [player], spectators: [],
      phase: 'lobby', deck: [], discardPile: [],
      direction: 1, currentTurn: 0, drawStack: 0,
      winner: null, lastAction: null,
      challengePending: false, challengeTargetId: null, prevWild4Hand: null,
      rules: {
        stackDraw: rules?.stackDraw !== false,
        jumpIn   : !!rules?.jumpIn,
        sevenZero: !!rules?.sevenZero,
        gameMode : rules?.gameMode || 'classic',
        turnTimer: Math.min(60, Math.max(10, parseInt(rules?.turnTimer) || 30))
      },
      timerRef: null, chat: []
    };
    playerRoom[socket.id] = code;
    socket.join(code);
    socket.emit('roomCreated', { code });
    pushLobby(rooms[code]);
  });

  // Join room
  socket.on('joinRoom', ({ code, name, avatar, asSpectator }) => {
    if (!code) { socket.emit('joinError', 'Kode room tidak valid!'); return; }
    const uCode = String(code).toUpperCase().trim();
    const room  = rooms[uCode];
    if (!room) { socket.emit('joinError', 'Room tidak ditemukan! Cek kode lagi.'); return; }

    if (asSpectator) {
      room.spectators.push(socket.id);
      playerRoom[socket.id] = uCode;
      socket.join(uCode);
      socket.emit('joinedAsSpectator', { code: uCode });
      pushState(room);
      return;
    }

    if (room.phase !== 'lobby') {
      // Try reconnect by name
      const ex = room.players.find(p => p.name === String(name).trim() && !p.connected);
      if (ex) {
        ex.id = socket.id; ex.connected = true;
        playerRoom[socket.id] = uCode;
        socket.join(uCode);
        socket.emit('reconnected', { code: uCode });
        broadcast(room, 'gameLog', { msg: `🔄 ${ex.name} reconnected!` });
        pushState(room);
        return;
      }
      socket.emit('joinError', 'Game sudah berjalan!');
      return;
    }

    if (room.players.length >= room.maxPlayers) { socket.emit('joinError', 'Room penuh!'); return; }
    if (room.players.find(p => p.name === String(name).trim())) {
      socket.emit('joinError', 'Nama sudah dipakai di room ini!'); return;
    }

    const player = { id: socket.id, name: String(name).trim().slice(0,16), avatar: avatar || '🐯',
      hand: [], isHost: false, connected: true, unoCall: false, afk: false, score: 0 };
    room.players.push(player);
    playerRoom[socket.id] = uCode;
    socket.join(uCode);
    socket.emit('roomJoined', { code: uCode });
    broadcast(room, 'gameLog', { msg: `👤 ${player.name} bergabung!` });
    pushLobby(room);
  });

  // Start game
  socket.on('startGame', () => {
    const room = rooms[playerRoom[socket.id]];
    if (!room) return;
    const p = room.players.find(x => x.id === socket.id);
    if (!p?.isHost)            { socket.emit('error', 'Hanya host!'); return; }
    if (room.players.length < 2){ socket.emit('error', 'Minimal 2 pemain!'); return; }
    if (room.phase !== 'lobby') { socket.emit('error', 'Game sudah jalan!'); return; }
    startGame(room);
  });

  // Kick
  socket.on('kickPlayer', targetId => {
    const room = rooms[playerRoom[socket.id]];
    if (!room) return;
    const host = room.players.find(p => p.id === socket.id);
    if (!host?.isHost) return;
    room.players = room.players.filter(p => p.id !== targetId);
    const ts = io.sockets.sockets.get(targetId);
    if (ts) { ts.emit('kicked'); ts.leave(room.code); }
    delete playerRoom[targetId];
    broadcast(room, 'gameLog', { msg: '🦵 Seorang pemain di-kick!' });
    pushLobby(room);
  });

  // Play card
  socket.on('playCard', ({ cardId, chosenColor }) => {
    const room = rooms[playerRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    const cur = current(room);
    if (!cur || cur.id !== socket.id) { socket.emit('error', 'Bukan giliran kamu!'); return; }

    const idx  = cur.hand.findIndex(c => c.id === cardId);
    if (idx === -1) { socket.emit('error', 'Kartu tidak valid!'); return; }
    const card = cur.hand[idx];
    const top  = topCard(room);

    // Stack check
    if (room.drawStack > 0) {
      if (room.rules.stackDraw) {
        const ok = card.value === 'draw2' || card.value === 'wild4';
        if (!ok) { socket.emit('error', 'Harus stack dengan +2 atau +4!'); return; }
        if (top?.value === 'wild4' && card.value === 'draw2') { socket.emit('error', 'Tidak bisa stack +2 di atas +4!'); return; }
      } else {
        socket.emit('error', 'Stack dinonaktifkan – ambil kartu dulu!'); return;
      }
    }

    if (!validPlay(card, top)) { socket.emit('error', 'Kartu tidak cocok!'); return; }

    // Save wild4 hand for challenge
    if (card.value === 'wild4') {
      room.prevWild4Hand = cur.hand.filter(c => c.id !== cardId).map(c => c.color);
    }

    cur.hand.splice(idx, 1);
    cur.unoCall = false;
    cur.afk     = false;

    if (card.type === 'wild' || card.type === 'wild4') card.chosenColor = chosenColor || 'red';
    room.discardPile.push(card);
    clearTimer(room);

    room.lastAction = { type:'play', playerId: socket.id, playerName: cur.name, card, chosenColor };
    broadcast(room, 'cardPlayed', { playerId: socket.id, playerName: cur.name, card, chosenColor });

    // WIN CHECK
    if (!cur.hand.length) {
      room.phase  = 'ended';
      room.winner = { id: cur.id, name: cur.name };
      cur.score++;
      broadcast(room, 'gameLog', { msg: `🏆 ${cur.name} MENANG!` });
      pushState(room);
      broadcast(room, 'gameOver', { winner: room.winner });
      return;
    }

    checkUno(room, cur);

    // Card effects
    let skip = 1;
    if (card.value === 'skip') {
      skip = 2;
      broadcast(room, 'gameLog', { msg: `⏭ ${cur.name} skip!` });
    } else if (card.value === 'reverse') {
      room.direction *= -1;
      if (room.players.length === 2) skip = 2;
      broadcast(room, 'gameLog', { msg: `🔄 ${cur.name} reverse! Arah balik.` });
    } else if (card.value === 'draw2') {
      room.drawStack += 2;
      broadcast(room, 'gameLog', { msg: `+2 Stack! Total: +${room.drawStack}` });
    } else if (card.value === 'wild4') {
      room.drawStack += 4;
      room.challengePending  = true;
      room.challengeTargetId = socket.id;
      broadcast(room, 'gameLog', { msg: `🌈 Wild +4! Stack: +${room.drawStack}` });
    } else if (card.value === 'wild') {
      broadcast(room, 'gameLog', { msg: `🌈 Wild! Warna: ${chosenColor}` });
    }

    // 7-0 rule
    if (room.rules.sevenZero) {
      if (card.value === '0') {
        const hands = room.players.map(p => p.hand);
        const rot   = room.direction === 1
          ? [hands[hands.length-1], ...hands.slice(0,-1)]
          : [...hands.slice(1), hands[0]];
        room.players.forEach((p,i) => p.hand = rot[i]);
        broadcast(room, 'gameLog', { msg: '0️⃣ Semua tangan dirotasi!' });
      } else if (card.value === '7') {
        const ni = nextIdx(room, 1);
        const np = room.players[ni];
        [cur.hand, np.hand] = [np.hand, cur.hand];
        broadcast(room, 'gameLog', { msg: `7️⃣ ${cur.name} tukar tangan dengan ${np.name}!` });
      }
    }

    // Wild+4 challenge window
    if (card.value === 'wild4') {
      advance(room, skip);
      pushState(room);
      broadcast(room, 'challengeWindow', { targetId: room.challengeTargetId, duration: 7 });
      room.chalRef = setTimeout(() => {
        if (room.challengePending) {
          room.challengePending = false;
          const np = current(room);
          if (np) {
            deal(room, np.id, room.drawStack);
            broadcast(room, 'gameLog', { msg: `${np.name} ambil ${room.drawStack} kartu!` });
            room.drawStack = 0;
            advance(room);
            pushState(room);
          }
        }
        startTimer(room);
      }, 7500);
      return;
    }

    advance(room, skip);
    pushState(room);
    startTimer(room);
  });

  // Draw card
  socket.on('drawCard', () => {
    const room = rooms[playerRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    const cur = current(room);
    if (!cur || cur.id !== socket.id) return;
    clearTimer(room);
    cur.afk = false;

    if (room.drawStack > 0) {
      deal(room, socket.id, room.drawStack);
      broadcast(room, 'gameLog', { msg: `${cur.name} ambil ${room.drawStack} kartu!` });
      room.drawStack = 0;
      room.challengePending = false;
      advance(room);
    } else {
      deal(room, socket.id, 1);
      room.lastAction = { type:'draw', playerId: socket.id, playerName: cur.name };
      const drawn = cur.hand[cur.hand.length - 1];
      const top2  = topCard(room);
      if (!validPlay(drawn, top2)) advance(room);
    }
    pushState(room);
    startTimer(room);
  });

  // Challenge Wild+4
  socket.on('challengeWild4', () => {
    const room = rooms[playerRoom[socket.id]];
    if (!room || !room.challengePending) return;
    if (current(room)?.id !== socket.id) return;

    const challenger = room.players.find(p => p.id === socket.id);
    const challenged = room.players.find(p => p.id === room.challengeTargetId);
    if (!challenger || !challenged) return;

    room.challengePending = false;
    if (room.chalRef) { clearTimeout(room.chalRef); room.chalRef = null; }

    const prev2    = room.discardPile[room.discardPile.length - 2];
    const effColor = prev2?.chosenColor || prev2?.color;
    const couldPlay = room.prevWild4Hand?.includes(effColor);

    if (couldPlay) {
      deal(room, challenged.id, 4);
      room.drawStack = 0;
      broadcast(room, 'gameLog',       { msg: `✅ Challenge berhasil! ${challenged.name} +4!` });
      broadcast(room, 'challengeResult',{ success: true, challengedName: challenged.name });
    } else {
      deal(room, socket.id, room.drawStack + 2);
      room.drawStack = 0;
      broadcast(room, 'gameLog',       { msg: `❌ Challenge gagal! ${challenger.name} +${room.drawStack+2}!` });
      broadcast(room, 'challengeResult',{ success: false, challengerName: challenger.name });
      advance(room);
    }
    pushState(room);
    startTimer(room);
  });

  // Accept Wild+4
  socket.on('acceptWild4', () => {
    const room = rooms[playerRoom[socket.id]];
    if (!room || !room.challengePending) return;
    if (current(room)?.id !== socket.id) return;
    room.challengePending = false;
    if (room.chalRef) { clearTimeout(room.chalRef); room.chalRef = null; }
    deal(room, socket.id, room.drawStack);
    broadcast(room, 'gameLog', { msg: `${current(room)?.name} ambil ${room.drawStack} kartu.` });
    room.drawStack = 0;
    advance(room);
    pushState(room);
    startTimer(room);
  });

  // UNO call
  socket.on('callUno', () => {
    const room = rooms[playerRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    const p = room.players.find(x => x.id === socket.id);
    if (!p || p.hand.length > 2) return;
    p.unoCall = true;
    broadcast(room, 'gameLog', { msg: `🃏 ${p.name} bilang UNO!` });
    broadcast(room, 'unoCall', { playerId: socket.id, playerName: p.name });
  });

  // Catch UNO
  socket.on('catchUno', targetId => {
    const room = rooms[playerRoom[socket.id]];
    if (!room) return;
    const target = room.players.find(p => p.id === targetId);
    if (!target || target.hand.length !== 1 || target.unoCall) return;
    deal(room, targetId, 2);
    broadcast(room, 'gameLog',  { msg: `🚨 ${target.name} ketahuan lupa UNO! +2!` });
    broadcast(room, 'unoCaught',{ targetId, targetName: target.name });
    pushState(room);
  });

  // Room chat
  socket.on('roomChat', ({ msg, emoji }) => {
    const room = rooms[playerRoom[socket.id]];
    if (!room) return;
    const p    = room.players.find(x => x.id === socket.id);
    const name = p?.name || 'Spectator';
    const av   = p?.avatar || '🎮';
    if (emoji) {
      broadcast(room, 'emojiReaction', { name, avatar: av, emoji });
    } else if (msg?.trim()) {
      const entry = { name, avatar: av, msg: String(msg).trim().slice(0,200), ts: Date.now() };
      room.chat.push(entry);
      if (room.chat.length > 100) room.chat.shift();
      broadcast(room, 'roomChat', entry);
    }
  });

  // Restart
  socket.on('restartGame', () => {
    const room = rooms[playerRoom[socket.id]];
    if (!room) return;
    const p = room.players.find(x => x.id === socket.id);
    if (!p?.isHost) return;
    clearTimer(room);
    room.phase = 'lobby';
    broadcast(room, 'gameLog', { msg: '🔃 Game di-reset!' });
    pushLobby(room);
    broadcast(room, 'gameLobbyReset', {});
  });

  // ── DEV PANEL (ryzenshiky) ───────────────────────────────────────────────
  socket.on('devCmd', ({ cmd, payload, password }) => {
    if (password !== 'ryzenshiky') { socket.emit('devError', 'Wrong password!'); return; }
    const room = rooms[playerRoom[socket.id]];
    if (!room || room.phase !== 'playing') return;
    switch (cmd) {
      case 'forceWin': {
        const p = room.players.find(x => x.id === socket.id);
        if (p) { p.hand = []; room.phase = 'ended'; room.winner = { id: p.id, name: p.name };
          broadcast(room, 'gameOver', { winner: room.winner }); pushState(room); }
        break;
      }
      case 'revealAll':
        socket.emit('devReveal', room.players.map(p => ({ name: p.name, hand: p.hand })));
        break;
      case 'spawnCard': {
        const p = room.players.find(x => x.id === socket.id);
        if (p && payload?.card) { p.hand.push({ id: Date.now(), ...payload.card }); pushState(room); }
        break;
      }
      case 'skipAll':
        advance(room, room.players.length);
        pushState(room); startTimer(room);
        break;
      case 'setColor': {
        const tc = topCard(room);
        if (tc && payload?.color) { tc.chosenColor = payload.color; pushState(room); }
        break;
      }
      case 'freezeGame':
        clearTimer(room);
        socket.emit('devAck', 'Game frozen ❄️');
        break;
      case 'simulateLag':
        setTimeout(() => { pushState(room); socket.emit('devAck', `Lag ${payload?.ms||2000}ms done`); }, payload?.ms || 2000);
        break;
    }
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  function handleLeave() {
    const code = playerRoom[socket.id];
    if (!code) return;
    const room = rooms[code];
    if (!room) { delete playerRoom[socket.id]; return; }

    room.spectators = room.spectators.filter(id => id !== socket.id);
    const pi = room.players.findIndex(p => p.id === socket.id);
    if (pi === -1) { delete playerRoom[socket.id]; return; }

    const p = room.players[pi];
    if (room.phase === 'lobby') {
      room.players.splice(pi, 1);
      if (p.isHost && room.players.length) room.players[0].isHost = true;
      if (!room.players.length) { delete rooms[code]; }
      else { broadcast(room, 'gameLog', { msg: `👋 ${p.name} keluar!` }); pushLobby(room); }
    } else {
      p.connected = false;
      broadcast(room, 'gameLog', { msg: `📡 ${p.name} disconnect…` });
      pushState(room);
      if (current(room)?.id === socket.id) {
        setTimeout(() => { if (!p.connected && room.phase === 'playing') autoPlay(room); }, 5000);
      }
      setTimeout(() => {
        if (!p.connected) {
          room.players.splice(room.players.indexOf(p), 1);
          if (room.players.filter(x=>x.connected).length < 1 && room.phase === 'playing') {
            const last = room.players[0];
            if (last) { room.phase='ended'; room.winner={id:last.id,name:last.name}; broadcast(room,'gameOver',{winner:room.winner}); }
          }
          if (!room.players.length) delete rooms[code];
          else pushState(room);
        }
      }, 60000);
    }
    delete playerRoom[socket.id];
  }

  socket.on('leaveRoom',   handleLeave);
  socket.on('disconnect',  handleLeave);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 UNO x Ryzen Server v2 running on port ${PORT}`);
  console.log(`🌐 CORS: open for all origins (GitHub Pages compatible)`);
});
