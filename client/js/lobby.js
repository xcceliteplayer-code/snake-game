/* ═══════════════════════════════════════════════════════════
   UNO x RYZEN — LOBBY.JS v2
   Handles: loading, name, lobby, room lobby, global chat
═══════════════════════════════════════════════════════════ */
'use strict';

/* ── CONSTANTS ───────────────────────────── */
const AVATARS = [
  '🐯','🦊','🐼','🐧','🦁','🐸','🦋','🐙',
  '🦄','🐲','🐺','🦝','🦅','🐬','🎃','👾',
  '🤖','💀','🎮','🃏','🌟','🔥','⚡','🎯'
];
const EMOJIS_LOBBY = ['😂','❤️','🔥','👍','💀','🎉','🤣','😎','🤔','😱'];

/* ── APP STATE ───────────────────────────── */
const App = (() => {
  let _sock   = null;
  let _name   = '';
  let _avatar = '🐯';
  let _room   = null;
  let _stats  = { played:0, won:0, cards:0 };

  /* ── SESSION ── */
  function _load() {
    try {
      const s = JSON.parse(localStorage.getItem('unoRyzen') || '{}');
      if (s.name)  { _name = s.name; _avatar = s.avatar || '🐯'; }
      if (s.stats)   _stats = s.stats;
    } catch(_) {}
  }
  function _save() {
    try { localStorage.setItem('unoRyzen', JSON.stringify({ name:_name, avatar:_avatar, stats:_stats })); } catch(_) {}
  }

  /* ── SCREEN ── */
  function go(id) {
    ['s-loading','s-name','s-lobby','s-room','s-game'].forEach(s => {
      const el = document.getElementById(s);
      if (!el) return;
      if (s === 's-loading') {
        el.style.display = (s === id) ? 'flex' : 'none';
      } else {
        el.style.display = (s === id) ? '' : 'none';
      }
    });
  }

  /* ── TOAST ── */
  let _toastTimer = null;
  function toast(msg, type='') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className   = 'toast' + (type ? ' '+type : '');
    t.style.display = '';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3200);
  }

  /* ── COPY CODE ── */
  function copyCode() {
    if (!_room) return;
    navigator.clipboard.writeText(_room).then(() => toast('Kode disalin! 📋','ok'));
  }

  /* ── CLOSE MODAL ── */
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  /* ── CONFIRM NAME ── */
  function confirmName() {
    const val = (document.getElementById('nameInp')?.value || '').trim();
    if (val.length < 2) { toast('Nama minimal 2 karakter!','err'); return; }
    _name   = val.slice(0,16);
    _avatar = document.querySelector('.av-item.picked')?.dataset.av || _avatar;
    _save();
    _updateBadge();
    _updateStats();
    go('s-lobby');
  }

  /* ── GO NAME ── */
  function goName() {
    const inp = document.getElementById('nameInp');
    if (inp) inp.value = _name;
    Lobby._buildAvatarGrid();
    go('s-name');
  }

  /* ── BADGE / STATS ── */
  function _updateBadge() {
    const av = document.getElementById('ptAv');
    const nm = document.getElementById('ptName');
    if (av) av.textContent = _avatar;
    if (nm) nm.textContent = _name;
  }
  function _updateStats() {
    const sp = document.getElementById('stPlayed');
    const sw = document.getElementById('stWon');
    const sc = document.getElementById('stCards');
    if (sp) sp.textContent = _stats.played;
    if (sw) sw.textContent = _stats.won;
    if (sc) sc.textContent = _stats.cards;
  }

  /* ── PUBLIC ── */
  return { go, toast, copyCode, closeModal, confirmName, goName,
    get sock()   { return _sock; },
    set sock(v)  { _sock = v; },
    get name()   { return _name; },
    get avatar() { return _avatar; },
    get room()   { return _room; },
    set room(v)  { _room = v; },
    get stats()  { return _stats; },
    save:   _save,
    updateBadge:  _updateBadge,
    updateStats:  _updateStats
  };
})();

/* ── LOBBY MODULE ────────────────────────── */
const Lobby = (() => {
  /* avatar grid */
  function _buildAvatarGrid() {
    const grid = document.getElementById('avGrid');
    if (!grid) return;
    grid.innerHTML = '';
    AVATARS.forEach(av => {
      const d = document.createElement('div');
      d.className      = 'av-item' + (av === App.avatar ? ' picked' : '');
      d.textContent    = av;
      d.dataset.av     = av;
      d.onclick = () => {
        grid.querySelectorAll('.av-item').forEach(x => x.classList.remove('picked'));
        d.classList.add('picked');
      };
      grid.appendChild(d);
    });
  }

  /* build global emoji bar */
  function _buildGlobalEmoji() {
    const bar = document.getElementById('gEmojis');
    if (!bar) return;
    bar.innerHTML = '';
    EMOJIS_LOBBY.forEach(e => {
      const btn = document.createElement('button');
      btn.className   = 'emj-btn';
      btn.textContent = e;
      btn.onclick = () => {
        const inp = document.getElementById('gChatInp');
        if (inp) { inp.value = (inp.value + e).slice(0,200); inp.focus(); }
      };
      bar.appendChild(btn);
    });
  }

  /* append global chat msg */
  function _appendGlobal(msg) {
    const c = document.getElementById('gMsgs');
    if (!c) return;
    const d = document.createElement('div');
    d.className = 'chat-msg' + (msg.name === App.name ? ' mine' : '');
    d.innerHTML = `<div class="msg-av">${msg.avatar||'👤'}</div>
      <div class="msg-body"><div class="msg-name">${_esc(msg.name)}</div>
      <div class="msg-text">${_esc(msg.msg)}</div></div>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  }

  function sendGlobal() {
    const inp = document.getElementById('gChatInp');
    const msg = (inp?.value || '').trim();
    if (!msg || !App.sock) return;
    App.sock.emit('globalChat', { name: App.name, avatar: App.avatar, msg });
    inp.value = '';
  }

  /* public rooms */
  function refreshPublic() {
    App.sock?.emit('getPublicRooms');
  }

  function _renderPublic(rooms) {
    const list = document.getElementById('pubList');
    if (!list) return;
    if (!rooms.length) { list.innerHTML = '<div class="empty-msg">Tidak ada room publik</div>'; return; }
    list.innerHTML = '';
    rooms.forEach(r => {
      const d = document.createElement('div');
      d.className = 'pub-item';
      d.innerHTML = `<div><div class="pub-code">${r.code}</div>
        <div class="pub-info">Host: ${_esc(r.hostName)} · ${r.playerCount}/${r.maxPlayers}</div></div>
        <div class="pub-join">Gabung →</div>`;
      d.onclick = () => {
        const inp = document.getElementById('joinInp');
        if (inp) inp.value = r.code;
        joinRoom();
      };
      list.appendChild(d);
    });
  }

  /* create room modal */
  function showCreate() {
    document.getElementById('m-create').style.display = 'flex';
  }

  function createRoom() {
    if (!App.sock || !App.name) return;
    const rules = {
      maxPlayers: parseInt(document.getElementById('cfMax')?.value || 4),
      gameMode  : document.getElementById('cfMode')?.value || 'classic',
      turnTimer : Math.min(60, Math.max(10, parseInt(document.getElementById('cfTimer')?.value || 30))),
      stackDraw : document.getElementById('cfStack')?.checked ?? true,
      jumpIn    : document.getElementById('cfJump')?.checked  ?? false,
      sevenZero : document.getElementById('cf70')?.checked    ?? false,
    };
    App.sock.emit('createRoom', {
      name: App.name, avatar: App.avatar,
      isPublic  : document.getElementById('cfPub')?.checked ?? true,
      maxPlayers: rules.maxPlayers,
      rules
    });
    App.closeModal('m-create');
  }

  function joinRoom() {
    if (!App.sock) return;
    if (!App.name) { App.toast('Masukkan nama dulu!','err'); return; }
    const code = (document.getElementById('joinInp')?.value || '').trim().toUpperCase();
    if (code.length !== 6) { App.toast('Kode room harus 6 karakter!','err'); return; }
    App.sock.emit('joinRoom', { code, name: App.name, avatar: App.avatar });
  }

  /* room lobby render */
  function _renderRoomLobby(state) {
    const me   = state.players.find(p => p.name === App.name);
    const isH  = !!(me?.isHost);

    /* badges */
    const bd = document.getElementById('roomBadges');
    if (bd) {
      const badge = (t, on) => `<span class="rbadge${on?' on':''}">${t}</span>`;
      bd.innerHTML =
        badge('Mode: '+state.rules.gameMode, true) +
        badge('Max: '+state.maxPlayers+'P', true) +
        badge('Timer: '+state.rules.turnTimer+'s', true) +
        badge('Stack +2/+4', state.rules.stackDraw) +
        badge('Jump-In', state.rules.jumpIn) +
        badge('7-0 Swap', state.rules.sevenZero);
    }

    /* players */
    const pp = document.getElementById('roomPlayers');
    if (pp) {
      pp.innerHTML = `<div class="rp-title">PEMAIN (${state.players.length}/${state.maxPlayers})</div>`;
      state.players.forEach(p => {
        const isMe = p.name === App.name;
        const slot = document.createElement('div');
        slot.className = 'pslot';
        slot.innerHTML = `
          <div class="pslot-av">${p.avatar}</div>
          <div class="pslot-info">
            <div class="pslot-name">${_esc(p.name)} ${p.isHost?'<span class="pslot-host">👑 HOST</span>':''}</div>
            <div class="pslot-role">${isMe?'← Kamu':'Pemain'}${!p.connected?' 📡 (disconnect)':''}</div>
          </div>
          ${isH && !isMe && !p.isHost?`<button class="pslot-kick" onclick="Lobby.kick('${p.id}')">Kick</button>`:''}
        `;
        pp.appendChild(slot);
      });
      for (let i = state.players.length; i < state.maxPlayers; i++) {
        const slot = document.createElement('div');
        slot.className = 'pslot pslot-empty';
        slot.textContent = 'Menunggu pemain...';
        pp.appendChild(slot);
      }
    }

    /* host controls */
    const ha = document.getElementById('hostActions');
    if (ha) ha.style.display = isH ? '' : 'none';
  }

  /* room chat */
  function _appendRoomChat(msg) {
    const c = document.getElementById('rMsgs');
    if (!c) return;
    const d = document.createElement('div');
    if (msg.sys) {
      d.style.cssText = 'color:var(--muted);font-size:11px;text-align:center;padding:3px';
      d.textContent = msg.msg;
    } else {
      d.className = 'chat-msg' + (msg.name === App.name ? ' mine' : '');
      d.innerHTML = `<div class="msg-av">${msg.avatar||'👤'}</div>
        <div class="msg-body"><div class="msg-name">${_esc(msg.name)}</div>
        <div class="msg-text">${_esc(msg.msg)}</div></div>`;
    }
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
  }

  function sendRoomChat() {
    const inp = document.getElementById('rChatInp');
    const msg = (inp?.value || '').trim();
    if (!msg || !App.sock) return;
    App.sock.emit('roomChat', { msg });
    inp.value = '';
  }

  function startGame() { App.sock?.emit('startGame'); }

  function kick(id) { App.sock?.emit('kickPlayer', id); }

  function leaveRoom() {
    App.sock?.emit('leaveRoom');
    App.room = null;
    App.go('s-lobby');
    refreshPublic();
  }

  /* ── SOCKET INIT ── */
  function initSocket() {
    const url  = UNO_CONFIG.getServerUrl();
    const sock = io(url, {
      transports: ['websocket','polling'],
      reconnectionAttempts: 10
    });
    App.sock = sock;

    sock.on('connect', () => {
      sock.emit('getGlobalChat');
      refreshPublic();
    });

    sock.on('connect_error', () => App.toast('Tidak bisa konek ke server!','err'));

    sock.on('globalChatHistory', msgs => {
      const c = document.getElementById('gMsgs');
      if (c) c.innerHTML = '';
      msgs.forEach(_appendGlobal);
    });
    sock.on('globalChat', _appendGlobal);

    sock.on('publicRooms', _renderPublic);

    sock.on('roomCreated', ({ code }) => {
      App.room = code;
      sock.emit('joinRoom', { code, name: App.name, avatar: App.avatar });
    });

    sock.on('roomJoined', ({ code }) => {
      App.room = code;
      const rc = document.getElementById('roomCode');
      if (rc) rc.textContent = code;
      App.go('s-room');
    });

    sock.on('lobbyState', _renderRoomLobby);

    sock.on('roomChat', _appendRoomChat);
    sock.on('gameLog',  ({ msg }) => _appendRoomChat({ msg, sys:true }));

    sock.on('gameStarted', () => {
      App.stats.played++;
      App.save();
      App.updateStats();
      const gr = document.getElementById('gbarRoom');
      if (gr) gr.textContent = App.room || '';
      App.go('s-game');
      Game.init(sock, App.name, App.avatar);
    });

    sock.on('gameLobbyReset', () => App.go('s-room'));

    sock.on('joinError', msg => App.toast(msg,'err'));
    sock.on('error',     msg => App.toast(msg,'err'));
    sock.on('kicked', () => {
      App.toast('Kamu di-kick dari room!','err');
      App.room = null;
      App.go('s-lobby');
    });
    sock.on('reconnected', ({ code }) => {
      App.room = code;
      const gr = document.getElementById('gbarRoom');
      if (gr) gr.textContent = code;
      App.go('s-game');
      Game.init(sock, App.name, App.avatar);
    });
  }

  /* ── BOOT ── */
  function boot() {
    // Load session
    try {
      const s = JSON.parse(localStorage.getItem('unoRyzen') || '{}');
      if (s.name)  { App._name_internal = s.name; }
    } catch(_) {}

    _runLoading(() => {
      initSocket();
      _buildGlobalEmoji();
      if (App.name) {
        App.updateBadge();
        App.updateStats();
        App.go('s-lobby');
      } else {
        _buildAvatarGrid();
        App.go('s-name');
      }
    });
  }

  function _runLoading(cb) {
    const msgs = ['Mengacak kartu...','Memuat animasi...','Menyambungkan server...','Hampir siap...','Siap!'];
    const bar  = document.getElementById('loadBar');
    const txt  = document.getElementById('loadMsg');
    let pct = 0, mi = 0;
    const iv = setInterval(() => {
      pct += Math.random() * 24 + 8;
      if (pct >= 100) pct = 100;
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = msgs[Math.min(mi++, msgs.length-1)];
      if (pct >= 100) {
        clearInterval(iv);
        setTimeout(() => {
          const ls = document.getElementById('s-loading');
          if (ls) { ls.style.transition = 'opacity .55s'; ls.style.opacity = '0'; }
          setTimeout(() => {
            if (ls) ls.style.display = 'none';
            cb();
          }, 580);
        }, 300);
      }
    }, 260);
  }

  return {
    boot, showCreate, createRoom, joinRoom, sendGlobal, refreshPublic,
    sendRoomChat, startGame, kick, leaveRoom, _buildAvatarGrid
  };
})();

/* ── UTIL ── */
function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── BOOT ── */
window.addEventListener('DOMContentLoaded', () => Lobby.boot());
