/* ═══════════════════════════════════════════════════════════
   UNO x RYZEN — GAME.JS v2
   Handles: game render, card play, timer, sound, dev panel
═══════════════════════════════════════════════════════════ */
'use strict';

const Game = (() => {
  /* ── STATE ── */
  let _sock      = null;
  let _name      = '';
  let _avatar    = '';
  let _state     = null;
  let _wild      = null;    // pending wild card
  let _timerIv   = null;
  let _chalIv    = null;
  let _devOpen   = false;
  let _debugOpen = false;

  const DEV_PW   = 'ryzenshiky';
  const EMOJIS   = ['😂','❤️','🔥','👍','💀','🎉','🤣','😎','🤔','😱'];

  /* ── AUDIO ── */
  let _actx = null;
  function _ac() { if (!_actx) _actx = new (window.AudioContext||window.webkitAudioContext)(); return _actx; }
  function _t(f, d, tp='sine', v=0.14) {
    try {
      const c=_ac(), o=c.createOscillator(), g=c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type=tp; o.frequency.value=f;
      g.gain.setValueAtTime(v, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime+d);
      o.start(); o.stop(c.currentTime+d);
    } catch(_){}
  }
  const SFX = {
    play:    ()=>{ _t(520,.12,'triangle',.2); setTimeout(()=>_t(660,.1,'triangle',.15),100); },
    draw:    ()=>_t(330,.15,'sine',.12),
    invalid: ()=>{ _t(200,.1,'sawtooth',.12); setTimeout(()=>_t(160,.15,'sawtooth',.09),80); },
    skip:    ()=>_t(440,.2,'square',.1),
    reverse: ()=>{ _t(400,.1); setTimeout(()=>_t(300,.1),100); setTimeout(()=>_t(400,.1),200); },
    wild:    ()=>[400,500,620,780].forEach((f,i)=>setTimeout(()=>_t(f,.13,'triangle',.16),i*60)),
    draw2:   ()=>{ _t(330,.1); setTimeout(()=>_t(280,.12),100); },
    uno:     ()=>{ _t(800,.15,'square',.2); setTimeout(()=>_t(1000,.22,'square',.25),120); },
    win:     ()=>[523,659,784,1047].forEach((f,i)=>setTimeout(()=>_t(f,.26,'triangle',.2),i*120)),
    lose:    ()=>[400,350,300,250].forEach((f,i)=>setTimeout(()=>_t(f,.2,'sine',.15),i*100)),
    timer:   ()=>_t(880,.08,'square',.08),
  };

  /* ── INIT (called by lobby on gameStarted) ── */
  function init(sock, name, avatar) {
    _sock   = sock;
    _name   = name;
    _avatar = avatar;

    _buildGameEmojis();
    _bindKeys();
    _bindEvents();
    _buildGameEmojis();
  }

  function _bindKeys() {
    document.addEventListener('keydown', e => {
      const gs = document.getElementById('s-game');
      if (!gs || gs.style.display === 'none') return;
      if (e.key === 'F2') { e.preventDefault(); toggleDev(); }
      if (e.key === 'F3') { e.preventDefault(); toggleDebug(); }
      if (e.key === 'Escape') _closePickers();
      if (e.key === 'u' || e.key === 'U') callUno();
    });
  }

  function _bindEvents() {
    if (!_sock) return;
    // Remove old listeners
    ['gameState','cardPlayed','gameLog','gameOver','unoCall','unoCaught',
     'unoPenalty','turnTimer','challengeWindow','challengeResult',
     'emojiReaction','roomChat','devReveal','devAck'].forEach(ev => _sock.off(ev));

    _sock.on('gameState', s => {
      _state = s;
      _render(s);
      if (_debugOpen) _updateDebug(s);
    });

    _sock.on('cardPlayed', ({ playerName, card }) => {
      const m = { skip:'skip', reverse:'reverse', draw2:'draw2', wild4:'wild', wild:'wild' };
      SFX[m[card.value] || 'play']?.();
      _animDiscard();
      _addLog(`${playerName} main: ${_label(card.value)}`);
    });

    _sock.on('gameLog', ({ msg }) => _addLog(msg));

    _sock.on('gameOver', ({ winner }) => {
      _clearTimer();
      const win = winner.name === _name;
      win ? SFX.win() : SFX.lose();
      if (win) {
        const s = App.stats; s.won++;
        App.save(); App.updateStats();
      }
      _shout(win ? '🏆 MENANG!' : '😢 KALAH');
      const gi = document.getElementById('goIcon');
      const gt = document.getElementById('goTitle');
      const gw = document.getElementById('goWinner');
      if (gi) gi.textContent = win ? '🏆' : '😢';
      if (gt) gt.textContent = win ? 'KAMU MENANG! 🎉' : 'Permainan Selesai!';
      if (gw) gw.textContent = winner.name + ' memenangkan game!';
      document.getElementById('m-gameover').style.display = 'flex';
    });

    _sock.on('unoCall', ({ playerName }) => {
      SFX.uno();
      _shout(playerName + ': UNO!');
      _addLog(`🃏 ${playerName} bilang UNO!`);
    });

    _sock.on('unoCaught',  ({ targetName  }) => App.toast(`🚨 ${targetName} ketahuan lupa UNO! +2!`,'err'));
    _sock.on('unoPenalty', ({ playerName  }) => App.toast(`🚨 ${playerName} +2 (lupa UNO!)`,'err'));

    _sock.on('turnTimer', ({ duration, playerId }) => {
      _startTimer(duration, playerId === _sock.id);
    });

    _sock.on('challengeWindow', ({ duration }) => {
      if (_state?.currentPlayerId === _sock.id) _startChalTimer(duration);
    });

    _sock.on('challengeResult', ({ success, challengedName, challengerName }) => {
      _hideChal();
      success
        ? App.toast(`✅ Challenge berhasil! ${challengedName} +4!`,'ok')
        : App.toast(`❌ Challenge gagal! ${challengerName} +6!`,'err');
    });

    _sock.on('emojiReaction', ({ emoji }) => _floatEmoji(emoji));

    _sock.on('roomChat', msg => _appendGameChat(msg));

    _sock.on('devReveal', hands => {
      const dl = document.getElementById('devLog');
      if (dl) dl.textContent = hands.map(h => `${h.name}: ${h.hand.map(c=>c.color[0]+c.value).join(' ')}`).join('\n');
    });
    _sock.on('devAck', msg => {
      const dl = document.getElementById('devLog');
      if (dl) dl.textContent = '[ACK] '+msg+'\n'+dl.textContent;
    });
  }

  /* ── RENDER ── */
  function _render(s) {
    _renderOpps(s);
    _renderDiscard(s);
    _renderHand(s);
    _renderMyInfo(s);
    _renderMeta(s);
    _renderStack(s);
    _renderChal(s);
    _renderUnoBtn(s);
  }

  function _renderOpps(s) {
    const row  = document.getElementById('oppRow');
    if (!row) return;
    const opps = s.players.filter(p => p.id !== _sock.id);
    row.innerHTML = '';
    opps.forEach(p => {
      const active = p.id === s.currentPlayerId;
      const div = document.createElement('div');
      div.className = 'opp'
        + (active                       ? ' active'      : '')
        + (p.unoCall && p.handCount===1 ? ' uno-glow'    : '')
        + (p.afk                        ? ' afk'         : '')
        + (!p.connected                 ? ' disconnected' : '');
      const minis = Array.from({length:Math.min(p.handCount,10)},()=>'<div class="opp-mini"></div>').join('');
      div.innerHTML = `
        <div class="opp-av">${p.avatar}</div>
        <div class="opp-name">${_esc(p.name)}${p.isHost?' 👑':''}</div>
        <div class="opp-hand">${minis}</div>
        <div class="opp-cnt">${p.handCount} kartu</div>
        ${p.unoCall && p.handCount===1 ? '<div class="opp-uno-tag">UNO</div>' : ''}
      `;
      div.title = 'Klik untuk catch UNO!';
      div.onclick = () => { if (p.handCount===1 && !p.unoCall) _sock.emit('catchUno', p.id); };
      row.appendChild(div);
    });
  }

  function _renderDiscard(s) {
    const el = document.getElementById('discardEl');
    if (!el) return;
    el.innerHTML = '';
    if (!s.topCard) return;
    el.style.background = _cardBg(s.topCard);
    const c = _buildCard(s.topCard, 'discard');
    el.appendChild(c);
  }

  function _renderHand(s) {
    const hand    = document.getElementById('myHand');
    if (!hand) return;
    const top     = s.topCard;
    const myTurn  = s.currentPlayerId === _sock.id;
    const hasStk  = s.drawStack > 0;
    hand.innerHTML = '';

    (s.myHand || []).forEach(card => {
      let valid = false;
      if (myTurn) {
        if (hasStk && s.rules?.stackDraw) {
          valid = card.value==='draw2' || card.value==='wild4';
          if (top?.value==='wild4' && card.value==='draw2') valid = false;
        } else if (hasStk) {
          valid = false;
        } else {
          valid = _isValid(card, top);
        }
      }
      const el = _buildCard(card, 'hand', myTurn && !valid);
      if (valid) { el.classList.add('valid'); el.onclick = () => _clickCard(card); }
      else el.style.cursor = 'default';
      hand.appendChild(el);
    });
  }

  function _renderMyInfo(s) {
    const el     = document.getElementById('myInfo');
    if (!el) return;
    const myTurn = s.currentPlayerId === _sock.id;
    el.innerHTML = `
      <div class="mi-av">${_avatar}</div>
      <div style="font-weight:800">${_esc(_name)}</div>
      ${myTurn ? '<div class="mi-badge">GILIRAN MU!</div>' : ''}
      <div class="mi-cnt">${s.myHand?.length||0} kartu</div>
    `;
  }

  function _renderMeta(s) {
    const dc = document.getElementById('deckCnt');
    const dd = document.getElementById('discardCnt');
    const di = document.getElementById('dirInd');
    if (dc) dc.textContent = (s.deckCount||0)+' kartu';
    if (dd) dd.textContent = (s.discardCount||0)+' buang';
    if (di) di.textContent = s.direction===1 ? '↻' : '↺';
  }

  function _renderStack(s) {
    const b  = document.getElementById('stackBadge');
    const n  = document.getElementById('stackNum');
    if (!b) return;
    b.style.display = s.drawStack>0 ? '' : 'none';
    if (n) n.textContent = '+'+s.drawStack;
  }

  function _renderChal(s) {
    const p = document.getElementById('chalPanel');
    if (!p) return;
    p.style.display = (s.challengePending && s.currentPlayerId===_sock.id && !s.isSpectator) ? '' : 'none';
  }

  function _renderUnoBtn(s) {
    const b = document.getElementById('unoBtn');
    if (!b) return;
    s.myHand?.length===2 ? b.classList.add('pulse') : b.classList.remove('pulse');
  }

  /* ── CARD BUILDER ── */
  function _buildCard(card, ctx, dimmed=false) {
    const el = document.createElement('div');
    const cl = card.chosenColor || card.color;
    el.className = 'gcard ' + cl;
    if (ctx==='hand')   el.classList.add('hcard');
    if (dimmed)         el.classList.add('dim');

    const inner = document.createElement('div');
    inner.className = 'gcard-inner';

    const oval = document.createElement('div');
    oval.className = 'gcard-oval';
    inner.appendChild(oval);

    if (card.type==='wild' || card.type==='wild4') {
      const q = document.createElement('div');
      q.className = 'wild-q';
      q.innerHTML = '<div class="wq-r"></div><div class="wq-b"></div><div class="wq-g"></div><div class="wq-y"></div>';
      inner.appendChild(q);
      const v = document.createElement('div');
      v.className = 'gcard-val'; v.style.fontSize='11px';
      v.textContent = card.value==='wild4' ? '+4' : '🌈';
      inner.appendChild(v);
    } else {
      const v = document.createElement('div');
      v.className = 'gcard-val';
      v.textContent = _label(card.value);
      inner.appendChild(v);
    }

    ['gcard-tl','gcard-br'].forEach((cls,i) => {
      const c = document.createElement('div');
      c.className = cls;
      c.textContent = _label(card.value);
      inner.appendChild(c);
    });

    el.appendChild(inner);
    return el;
  }

  function _label(v) {
    return {skip:'⊘',reverse:'⇄',draw2:'+2',wild:'🌈',wild4:'+4'}[v] || v;
  }

  function _cardBg(card) {
    return {
      red  :'linear-gradient(135deg,#e63946,#c1121f)',
      blue :'linear-gradient(135deg,#1d84b5,#0077b6)',
      green:'linear-gradient(135deg,#2a9d3f,#1a7a2e)',
      yellow:'linear-gradient(135deg,#f4a623,#e08c00)',
      wild :'linear-gradient(135deg,#9b5de5,#7b2fd0)',
      wild4:'linear-gradient(135deg,#9b5de5,#7b2fd0)',
    }[card.chosenColor||card.color] || 'var(--bg4)';
  }

  function _isValid(card, top) {
    if (!top) return true;
    if (card.type==='wild'||card.type==='wild4') return true;
    const eff = top.chosenColor||top.color;
    return card.color===eff || card.value===top.value;
  }

  /* ── ACTIONS ── */
  function _clickCard(card) {
    if (!_sock || !_state || _state.currentPlayerId!==_sock.id) return;
    if (card.type==='wild'||card.type==='wild4') {
      _wild = card;
      window.innerWidth < 600
        ? document.getElementById('m-wild').style.display='flex'
        : document.getElementById('colorPicker').style.display='';
    } else {
      _sock.emit('playCard', { cardId:card.id, chosenColor:null });
    }
  }

  function pickColor(color) {
    if (!_wild || !_sock) return;
    _sock.emit('playCard', { cardId:_wild.id, chosenColor:color });
    _wild = null;
    _closePickers();
  }

  function pickColorModal(color) {
    document.getElementById('m-wild').style.display='none';
    pickColor(color);
  }

  function draw() {
    if (!_sock||!_state||_state.currentPlayerId!==_sock.id||_state.challengePending) return;
    _sock.emit('drawCard');
    SFX.draw();
  }

  function callUno() { _sock?.emit('callUno'); }

  function challenge()   { _sock?.emit('challengeWild4'); _hideChal(); }
  function acceptDraw()  { _sock?.emit('acceptWild4');   _hideChal(); }

  function _hideChal() {
    const p = document.getElementById('chalPanel');
    if (p) p.style.display='none';
    clearInterval(_chalIv);
  }

  function _closePickers() {
    const cp = document.getElementById('colorPicker');
    const wm = document.getElementById('m-wild');
    if (cp) cp.style.display='none';
    if (wm) wm.style.display='none';
  }

  /* ── TIMERS ── */
  function _startTimer(dur, isMe) {
    _clearTimer();
    let t      = dur;
    const ring = document.getElementById('timerRing');
    const num  = document.getElementById('timerNum');
    const circ = 2 * Math.PI * 15.9;

    if (ring) { ring.style.strokeDasharray=circ; ring.style.strokeDashoffset=0; ring.classList.remove('urgent'); }
    if (num)  num.textContent = t;

    _timerIv = setInterval(() => {
      t--;
      const pct = t/dur;
      if (ring) ring.style.strokeDashoffset = circ*(1-pct);
      if (num)  num.textContent = Math.max(0,t);
      if (t<=10) { if(ring) ring.classList.add('urgent'); if(isMe) SFX.timer(); }
      if (t<=0)  _clearTimer();
    }, 1000);
  }

  function _clearTimer() {
    clearInterval(_timerIv);
    const ring = document.getElementById('timerRing');
    const num  = document.getElementById('timerNum');
    if (ring) { ring.style.strokeDashoffset=0; ring.classList.remove('urgent'); }
    if (num)  num.textContent = '--';
  }

  function _startChalTimer(dur) {
    const p = document.getElementById('chalPanel');
    const n = document.getElementById('chalNum');
    if (!p||!n) return;
    p.style.display=''; n.textContent=dur;
    let t=dur;
    clearInterval(_chalIv);
    _chalIv=setInterval(()=>{
      t--; n.textContent=Math.max(0,t);
      if (t<=0) { clearInterval(_chalIv); _hideChal(); }
    },1000);
  }

  /* ── ANIMATION ── */
  function _animDiscard() {
    const d = document.getElementById('discardEl');
    if (!d) return;
    d.style.transition='transform .15s';
    d.style.transform='scale(1.12)';
    setTimeout(()=>d.style.transform='scale(1)',220);
  }

  /* ── CHAT ── */
  function _buildGameEmojis() {
    const bar = document.getElementById('gameEmojis');
    if (!bar) return;
    bar.innerHTML='';
    EMOJIS.forEach(e=>{
      const b=document.createElement('button');
      b.className='sp-emoji-btn'; b.textContent=e;
      b.onclick=()=>_sock?.emit('roomChat',{emoji:e});
      bar.appendChild(b);
    });
  }

  function _appendGameChat(msg) {
    const c=document.getElementById('gameChatMsgs');
    if (!c) return;
    const d=document.createElement('div');
    d.className='sc-msg chat-msg'+(msg.name===_name?' mine':'');
    d.innerHTML=`<div class="msg-av">${msg.avatar||'👤'}</div>
      <div class="msg-body"><div class="msg-name">${_esc(msg.name)}</div>
      <div class="msg-text">${_esc(msg.msg)}</div></div>`;
    c.appendChild(d); c.scrollTop=c.scrollHeight;
  }

  function sendChat() {
    const inp=document.getElementById('gameChatInp');
    const msg=(inp?.value||'').trim();
    if (!msg||!_sock) return;
    _sock.emit('roomChat',{msg}); inp.value='';
  }

  function _floatEmoji(emoji) {
    const area=document.getElementById('emojiFloat');
    if (!area) return;
    const el=document.createElement('div');
    el.className='float-emoji'; el.textContent=emoji;
    el.style.left=(15+Math.random()*70)+'vw';
    el.style.bottom='15vh';
    area.appendChild(el);
    setTimeout(()=>{ if(area.contains(el)) area.removeChild(el); },2200);
  }

  /* ── LOG ── */
  function _addLog(msg) {
    const c=document.getElementById('logMsgs');
    if (!c) return;
    const d=document.createElement('div');
    d.className='log-entry'; d.textContent=msg;
    c.appendChild(d); c.scrollTop=c.scrollHeight;
  }

  /* ── PANELS ── */
  function toggleChat() {
    document.getElementById('sideChat')?.classList.toggle('open');
    document.getElementById('sideLog')?.classList.remove('open');
  }
  function toggleLog() {
    document.getElementById('sideLog')?.classList.toggle('open');
    document.getElementById('sideChat')?.classList.remove('open');
  }
  function toggleDev() {
    _devOpen=!_devOpen;
    const p=document.getElementById('devPanel');
    if (p) p.style.display=_devOpen?'':'none';
  }
  function toggleDebug() {
    _debugOpen=!_debugOpen;
    const p=document.getElementById('debugPanel');
    if (p) p.style.display=_debugOpen?'':'none';
    if (_debugOpen&&_state) _updateDebug(_state);
  }
  function _updateDebug(s) {
    const el=document.getElementById('debugOut');
    if (!el) return;
    el.textContent=JSON.stringify({
      phase:s.phase, dir:s.direction, stack:s.drawStack,
      deck:s.deckCount, top:s.topCard?`${s.topCard.color} ${s.topCard.value}`:null,
      myCards:s.myHand?.length, chal:s.challengePending,
      players:s.players?.map(p=>`${p.name}(${p.handCount})`)
    },null,2);
  }

  /* ── DEV COMMANDS ── */
  function dev(cmd, payload={}) {
    _sock?.emit('devCmd',{cmd,payload,password:DEV_PW});
  }
  function devLag() {
    const ms=parseInt(prompt('Lag delay (ms)?','2000'))||2000;
    dev('simulateLag',{ms});
  }
  function devColor() {
    const c=prompt('Warna (red/blue/green/yellow)?','red');
    if (c) dev('setColor',{color:c.toLowerCase()});
  }
  function devSpawn() {
    const color=document.getElementById('devColor')?.value||'red';
    const value=document.getElementById('devVal')?.value||'5';
    const t={wild:'wild',wild4:'wild4',skip:'action',reverse:'action',draw2:'action'};
    dev('spawnCard',{card:{color,value,type:t[value]||'number'}});
  }

  /* ── GAME CONTROLS ── */
  function restart() {
    _sock?.emit('restartGame');
    document.getElementById('m-gameover').style.display='none';
  }

  function leave() {
    _sock?.emit('leaveRoom');
    _clearTimer();
    _state=null;
    document.getElementById('m-gameover').style.display='none';
    App.room=null;
    App.go('s-lobby');
  }

  /* ── UNO SHOUT ── */
  function _shout(txt='UNO!') {
    const el=document.getElementById('unoShout');
    if (!el) return;
    el.textContent=txt;
    el.style.display='';
    el.style.animation='none';
    void el.offsetWidth; // reflow
    el.style.animation='';
    clearTimeout(el._t);
    el._t=setTimeout(()=>el.style.display='none',1300);
  }

  /* ── UTIL ── */
  function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  /* ── PUBLIC API ── */
  return {
    init,
    pickColor, pickColorModal,
    draw, callUno, challenge, acceptDraw,
    toggleChat, toggleLog, toggleDev, toggleDebug,
    dev, devLag, devColor, devSpawn,
    sendChat, restart, leave
  };
})();
