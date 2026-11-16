// =============================================================================
// ARCADE — Bateria no ar e Corredor (3 pistas), com a mesma câmera
//   • Bateria: 7 peças em arco; "bater" = a mão entra na peça descendo rápido.
//     Modo livre com batida de fundo opcional, e modo Desafio (peças acendem no ritmo).
//   • Corredor: mão esquerda/centro/direita = pista; mão erguida = pulo; mão baixa = agachar.
//     Moedas, poderes (escudo, ímã, x2) e obstáculos (barreira: pule; viga: abaixe; muro: mude de pista).
// =============================================================================
export function install(api) {
  const { sfx, tone, noise, banner, show, hide, setText, PLAYER_COLORS, rand, randInt, clamp, lerp, pick, fmtTime, emit } = api;
  const $ = (id) => document.getElementById(id);
  function label(ctx, text, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `900 ${Math.round(size)}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function bg(ctx, a, b) { const g = ctx.createLinearGradient(0, 0, 0, api.H); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, api.W, api.H); }

  // Velocidade dos cursores (px/s), calculada aqui a partir das posições
  // Histórico curto de posições por cursor → velocidade média dos últimos ~200 ms
  // (robusto à detecção a 30 fps e à suavização do cursor)
  const vel = new Map();
  function updateVel(dt, now) {
    const seen = new Set();
    for (const c of api.cursors) {
      seen.add(c.id); let p = vel.get(c.id); if (!p) { p = { hist: [], vx: 0, vy: 0 }; vel.set(c.id, p); }
      p.hist.push({ t: now, x: api.cx(c), y: c.y }); while (p.hist.length > 2 && now - p.hist[0].t > 200) p.hist.shift();
      const a = p.hist[0], b = p.hist[p.hist.length - 1], span = Math.max(16, b.t - a.t) / 1000;
      p.vx = (b.x - a.x) / span; p.vy = (b.y - a.y) / span; p.dy = b.y - a.y;
    }
    for (const id of vel.keys()) if (!seen.has(id)) vel.delete(id);
  }

  // ===========================================================================
  // 1. BATERIA
  // ===========================================================================
  const drumSounds = {
    kick:  () => { tone(150, 0.25, 'sine', 0.5, 0, 45); noise(0.05, 0.2); },
    snare: () => { tone(200, 0.12, 'triangle', 0.25); noise(0.18, 0.5); },
    hihat: () => hat(0.06),
    openhat: () => hat(0.3),
    tom1:  () => tone(220, 0.3, 'sine', 0.4, 0, 120),
    tom2:  () => tone(160, 0.35, 'sine', 0.4, 0, 80),
    crash: () => { noise(1.0, 0.35); tone(900, 0.6, 'square', 0.03); },
  };
  function hat(dur) { // ruído com filtro passa-alta
    if (!window.__actx) { /* usa o noise comum se não houver contexto exposto */ }
    noise(dur, 0.25);
  }
  const drums = {
    name: 'Bateria no Ar', DURATION: 60,
    PADS: [
      { id: 'crash', label: 'CRASH', color: '#fbbf24', pos: [0.12, 0.3], r: 0.11 },
      { id: 'tom1', label: 'TOM', color: '#f87171', pos: [0.3, 0.26], r: 0.1 },
      { id: 'hihat', label: 'CHIMBAL', color: '#facc15', pos: [0.5, 0.22], r: 0.1 },
      { id: 'tom2', label: 'SURDO', color: '#fb923c', pos: [0.7, 0.26], r: 0.1 },
      { id: 'openhat', label: 'PRATO', color: '#fde68a', pos: [0.88, 0.3], r: 0.11 },
      { id: 'snare', label: 'CAIXA', color: '#e5e7eb', pos: [0.3, 0.62], r: 0.13 },
      { id: 'kick', label: 'BUMBO', color: '#60a5fa', pos: [0.7, 0.62], r: 0.15 },
    ],
    start() {
      this.t = 0; this.hits = 0; this.score = 0; this.flash = {}; this.inside = new Map(); this.challenge = false; this.seq = []; this.seqT = 0; this.combo = 0; this.beat = true;
      this.pattern = ['kick', 'hihat', 'snare', 'hihat', 'kick', 'kick', 'snare', 'openhat'];
      show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'BATIDAS'); setText('hudLevel', '0'); setText('hudTime', 'LIVRE'); hide('hudCombo'); hide('hudP');
      banner('Toque livre! Bata nas peças');
      this.modeTimer = 20; // depois de 20 s de toque livre entra o desafio
    },
    padAt(x, y) { const MIN = api.MIN; for (const p of this.PADS) if (Math.hypot(p.pos[0] * api.W - x, p.pos[1] * api.H - y) < p.r * MIN * 1.1) return p; return null; },
    hit(pad, by) {
      drumSounds[pad.id](); this.flash[pad.id] = 1; this.hits++;
      emit(pad.pos[0] * api.W, pad.pos[1] * api.H, 10, 'dust');
      if (this.challenge) {
        const due = this.seq.find((n) => !n.done && Math.abs(n.at - this.t) < 0.25 && n.id === pad.id);
        if (due) { due.done = true; this.combo++; const pts = Math.round((Math.abs(due.at - this.t) < 0.1 ? 200 : 100) * (1 + Math.min(this.combo, 10) * 0.1)); this.score += pts; this.fx = { text: `+${pts}`, x: pad.pos[0] * api.W, y: pad.pos[1] * api.H - pad.r * api.MIN, life: 1 }; }
        else { this.combo = 0; }
      }
      setText('hudLevel', String(this.hits)); setText('hudScore', this.score.toLocaleString('pt-BR'));
    },
    update(dt) {
      const MIN = api.MIN; this.t += dt; updateVel(dt, performance.now());
      for (const k in this.flash) this.flash[k] = Math.max(0, this.flash[k] - dt * 4);
      // Detecta "batida": entrar na peça com velocidade vertical > limiar (para baixo)
      for (const c of api.cursors) {
        const v = vel.get(c.id); const pad = this.padAt(api.cx(c), c.y); const was = this.inside.get(c.id);
        if (pad && pad.id !== was && v && (v.vy > MIN * 0.35 || v.dy > pad.r * MIN * 0.5)) this.hit(pad, c.player);
        this.inside.set(c.id, pad ? pad.id : null);
      }
      if (this.fx) { this.fx.life -= dt; this.fx.y -= MIN * 0.1 * dt; if (this.fx.life <= 0) this.fx = null; }
      // Modo desafio: gera sequência no ritmo
      if (!this.challenge) { this.modeTimer -= dt; if (this.modeTimer <= 0) { this.challenge = true; this.seqStart = this.t + 2; banner('🎯 DESAFIO: siga o ritmo'); sfx.level(); setText('hudTime', fmtTime(this.DURATION)); } }
      else {
        const beat = 60 / 96, elapsed = this.t - this.seqStart;
        if (elapsed >= this.DURATION) return this.finish();
        setText('hudTime', fmtTime(this.DURATION - Math.max(0, elapsed)));
        while (this.seq.length < Math.floor((elapsed + 2.5) / beat) + 1) { const i = this.seq.length; this.seq.push({ id: this.pattern[i % this.pattern.length], at: this.seqStart + i * beat, done: false }); }
        for (const n of this.seq) if (!n.done && !n.missed && this.t - n.at > 0.25) { n.missed = true; this.combo = 0; }
        this.seq = this.seq.filter((n) => this.t - n.at < 1);
        if (Math.floor(elapsed / beat) !== Math.floor((elapsed - dt) / beat) && elapsed >= 0) tone(Math.floor(elapsed / beat) % 4 === 0 ? 1200 : 900, 0.03, 'square', 0.03); // metrônomo
      }
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN;
      bg(ctx, '#1f2937', '#030712');
      // Palco
      ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.beginPath(); ctx.ellipse(W / 2, H * 0.55, W * 0.48, H * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      for (const p of this.PADS) {
        const x = p.pos[0] * W, y = p.pos[1] * H, r = p.r * MIN, f = this.flash[p.id] || 0;
        const due = this.challenge && this.seq.find((n) => !n.done && n.id === p.id && n.at - this.t < 0.6 && n.at - this.t > -0.25);
        // Sombra, aro, pele
        ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.15, r * 1.05, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.color; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(x, y, r * (1 + f * 0.1), r * 0.55 * (1 + f * 0.1), 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = f > 0 ? '#fff' : 'rgba(0,0,0,.35)'; ctx.lineWidth = Math.max(3, r * 0.08 + f * r * 0.1); ctx.stroke();
        if (due) { const k = 1 - clamp((due.at - this.t) / 0.6, 0, 1); ctx.strokeStyle = '#4ade80'; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.ellipse(x, y, r * (1.8 - 0.8 * k), r * 0.55 * (1.8 - 0.8 * k), 0, 0, Math.PI * 2); ctx.stroke(); }
        label(ctx, p.label, x, y, r * 0.3, 'rgba(0,0,0,.75)');
      }
      if (this.fx) { ctx.globalAlpha = clamp(this.fx.life, 0, 1); label(ctx, this.fx.text, this.fx.x, this.fx.y, MIN * 0.06, '#fde047'); ctx.globalAlpha = 1; }
      if (this.challenge && this.combo >= 3) label(ctx, `🔥 x${this.combo}`, W / 2, H * 0.9, MIN * 0.06, '#fbbf24');
      if (!this.challenge) label(ctx, `Toque livre · desafio em ${Math.ceil(this.modeTimer)} s — bata DESCENDO a mão`, W / 2, H * 0.92, MIN * 0.035, '#fde68a');
    },
    finish() { api.endMini({ title: 'FIM DO SOLO!', score: this.score, bestKey: 'bestBateria', stats: `${this.hits} batidas · combo máx. ${this.combo}` }); },
  };

  // ===========================================================================
  // 2. CORREDOR
  // ===========================================================================
  const runner = {
    name: 'Corredor', LANES: 3,
    start() {
      this.t = 0; this.score = 0; this.coins = 0; this.lives = 3; this.speed = 0.55; this.dist = 0; this.objs = []; this.spawnZ = 0;
      this.lane = 1, this.laneX = 1; this.jump = 0; this.duck = 0; this.pose = 'run'; this.power = { shield: 0, magnet: 0, x2: 0 }; this.inv = 0; this.fx = [];
      show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'VIDAS'); setText('hudLevel', '❤❤❤'); setText('hudTime', '0 m'); hide('hudCombo'); hide('hudP');
    },
    spawn() {
      // Padrões: obstáculos por pista; sempre deixa saída
      const r = Math.random(), lanes = [0, 1, 2];
      const add = (kind, lane, z = 1.0) => this.objs.push({ kind, lane, z, got: false });
      if (r < 0.3) add('wall', randInt(0, 2));                                   // mude de pista
      else if (r < 0.5) { const l = randInt(0, 2); add('barrier', l); }             // pule
      else if (r < 0.65) { add('beam', 0); add('beam', 1); add('beam', 2); }        // abaixe (viga em toda a largura)
      else if (r < 0.8) { const open = randInt(0, 2); for (const l of lanes) if (l !== open) add('wall', l); } // só uma pista livre
      else { const l = randInt(0, 2); for (let i = 0; i < 5; i++) add('coin', l, 1.0 + i * 0.07); }
      if (Math.random() < 0.12) add(pick(['shield', 'magnet', 'x2']), randInt(0, 2), 1.3);
      if (Math.random() < 0.5) { const l = randInt(0, 2); for (let i = 0; i < 3; i++) add('coin', l, 1.5 + i * 0.07); }
    },
    update(dt, now) {
      const W = api.W, H = api.H, MIN = api.MIN; this.t += dt;
      // ---- Controle pela mão (primeira mão vista)
      const c = api.cursors[0];
      if (c) {
        const nx = api.cx(c) / W; this.lane = nx < 0.38 ? 0 : nx > 0.62 ? 2 : 1;
        const ny = c.y / H;
        if (ny < 0.32 && this.jump <= 0 && this.pose !== 'jump') { this.jump = 0.75; this.pose = 'jump'; sfx.click(); }
        this.wantDuck = ny > 0.78;
      }
      if (this.jump > 0) { this.jump -= dt; if (this.jump <= 0) this.pose = 'run'; }
      else this.pose = this.wantDuck ? 'duck' : 'run';
      this.laneX = lerp(this.laneX, this.lane, 1 - Math.pow(0.001, dt));
      // ---- Mundo
      this.speed = Math.min(1.4, 0.55 + this.t * 0.012); this.dist += this.speed * 12 * dt;
      for (const k in this.power) this.power[k] = Math.max(0, this.power[k] - dt);
      this.inv = Math.max(0, this.inv - dt);
      this.spawnZ -= this.speed * dt;
      if (this.spawnZ <= 0) { this.spawn(); this.spawnZ = rand(0.55, 0.85); }
      const py = this.jump > 0 ? Math.sin((0.75 - this.jump) / 0.75 * Math.PI) : 0; // altura do pulo 0..1
      for (let i = this.objs.length - 1; i >= 0; i--) {
        const o = this.objs[i]; o.z -= this.speed * dt;
        if (o.kind === 'coin' && this.power.magnet > 0 && o.z < 0.5) o.lane = lerp(o.lane, this.laneX, 1 - Math.pow(0.01, dt));
        if (o.z < -0.1) { this.objs.splice(i, 1); continue; }
        const near = o.z < 0.08 && o.z > -0.06, sameLane = Math.abs(o.lane - this.laneX) < 0.5;
        if (!near || !sameLane || o.got) continue;
        if (o.kind === 'coin') { o.got = true; const v = this.power.x2 > 0 ? 20 : 10; this.coins++; this.score += v; tone(1200 + this.coins % 5 * 100, 0.08, 'square', 0.05); this.fx.push({ text: `+${v}`, life: 0.6 }); continue; }
        if (['shield', 'magnet', 'x2'].includes(o.kind)) { o.got = true; this.power[o.kind] = 8; sfx.level(); banner({ shield: '🛡 ESCUDO', magnet: '🧲 ÍMÃ', x2: '✖2 PONTOS' }[o.kind]); continue; }
        // Obstáculos
        const dodged = (o.kind === 'barrier' && py > 0.35) || (o.kind === 'beam' && this.pose === 'duck');
        if (dodged) { if (!o.counted) { o.counted = true; this.score += this.power.x2 > 0 ? 50 : 25; } continue; }
        if (this.inv > 0) continue;
        o.got = true;
        if (this.power.shield > 0) { this.power.shield = 0; banner('🛡 escudo salvou!'); sfx.boom(); this.inv = 1; continue; }
        this.lives--; this.inv = 1.2; api.state.shake = 1.2; sfx.boom(); banner(o.kind === 'beam' ? 'ABAIXE! 🙇' : o.kind === 'barrier' ? 'PULE! 🦘' : 'DESVIE! ↔');
        setText('hudLevel', '❤'.repeat(Math.max(0, this.lives)) || '💀');
        if (this.lives <= 0) return this.finish();
      }
      this.score += dt * 2;
      for (const f of this.fx) f.life -= dt; this.fx = this.fx.filter((f) => f.life > 0);
      setText('hudScore', Math.floor(this.score).toLocaleString('pt-BR')); setText('hudTime', `${Math.floor(this.dist)} m`);
    },
    // Projeção: z=1 longe (horizonte), z=0 na linha do jogador
    proj(lane, z) { const W = api.W, H = api.H, hy = H * 0.3, py = H * 0.86, k = 1 - z; const s = lerp(0.08, 1, k * k); const y = lerp(hy, py, k * k); const x = W / 2 + (lane - 1) * W * 0.22 * s; return { x, y, s }; },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN;
      bg(ctx, '#7dd3fc', '#e0f2fe'); // céu
      ctx.fillStyle = '#4ade80'; ctx.fillRect(0, H * 0.3, W, H); // grama
      // Estrada em perspectiva
      ctx.fillStyle = '#475569'; ctx.beginPath(); ctx.moveTo(W / 2 - W * 0.03, H * 0.3); ctx.lineTo(W / 2 + W * 0.03, H * 0.3); ctx.lineTo(W / 2 + W * 0.4, H); ctx.lineTo(W / 2 - W * 0.4, H); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.setLineDash([MIN * 0.03, MIN * 0.03]); ctx.lineDashOffset = -this.dist * MIN * 0.02;
      for (const l of [0.5, 1.5]) { const a = this.proj(l, 1), b = this.proj(l, 0); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y + H * 0.2); ctx.stroke(); }
      ctx.setLineDash([]);
      // Objetos (longe → perto)
      const objs = [...this.objs].sort((a, b) => b.z - a.z);
      for (const o of objs) {
        if (o.got) continue; const p = this.proj(o.lane, o.z), s = p.s * MIN * 0.2;
        if (o.kind === 'coin') { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.ellipse(p.x, p.y - s * 0.6, s * 0.35 * Math.abs(Math.cos(t * 4 + o.z * 10)) + 1, s * 0.35, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#a16207'; ctx.lineWidth = 2; ctx.stroke(); }
        else if (o.kind === 'wall') { ctx.fillStyle = '#b91c1c'; ctx.fillRect(p.x - s * 0.5, p.y - s * 1.1, s, s * 1.1); ctx.fillStyle = '#fff'; ctx.fillRect(p.x - s * 0.5, p.y - s * 0.7, s, s * 0.15); }
        else if (o.kind === 'barrier') { ctx.fillStyle = '#f59e0b'; ctx.fillRect(p.x - s * 0.5, p.y - s * 0.45, s, s * 0.2); ctx.fillStyle = '#1f2937'; ctx.fillRect(p.x - s * 0.45, p.y - s * 0.25, s * 0.1, s * 0.25); ctx.fillRect(p.x + s * 0.35, p.y - s * 0.25, s * 0.1, s * 0.25); label(ctx, '🦘', p.x, p.y - s * 0.8, s * 0.5); }
        else if (o.kind === 'beam') { ctx.fillStyle = '#7c3aed'; ctx.fillRect(p.x - s * 0.55, p.y - s * 1.5, s * 1.1, s * 0.25); if (o.lane === 1) label(ctx, '🙇', p.x, p.y - s * 1.9, s * 0.5); }
        else { label(ctx, { shield: '🛡', magnet: '🧲', x2: '✖2' }[o.kind], p.x, p.y - s * 0.6, s * 0.8); }
      }
      // Jogador
      const pp = this.proj(this.laneX, 0), s = MIN * 0.2; const py = this.jump > 0 ? Math.sin((0.75 - this.jump) / 0.75 * Math.PI) : 0;
      const y = pp.y - py * s * 1.6, h = this.pose === 'duck' ? s * 0.55 : s * 1.1;
      ctx.globalAlpha = this.inv > 0 && Math.floor(t * 12) % 2 ? 0.3 : 1;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(pp.x, pp.y + s * 0.05, s * 0.4, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = this.power.shield > 0 ? '#38bdf8' : '#2563eb'; ctx.beginPath(); ctx.roundRect(pp.x - s * 0.28, y - h, s * 0.56, h, s * 0.15); ctx.fill();
      ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(pp.x, y - h - s * 0.18, s * 0.2, 0, Math.PI * 2); ctx.fill();
      const leg = Math.sin(t * 16) * s * 0.15; ctx.strokeStyle = '#1e3a8a'; ctx.lineWidth = s * 0.12; ctx.lineCap = 'round';
      if (this.pose !== 'duck') { ctx.beginPath(); ctx.moveTo(pp.x - s * 0.12, y - s * 0.1); ctx.lineTo(pp.x - s * 0.15 + leg, y + s * 0.02); ctx.moveTo(pp.x + s * 0.12, y - s * 0.1); ctx.lineTo(pp.x + s * 0.15 - leg, y + s * 0.02); ctx.stroke(); }
      if (this.power.shield > 0) { ctx.strokeStyle = 'rgba(56,189,248,.8)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(pp.x, y - h / 2, s * 0.75, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // Poderes ativos
      const act = Object.entries(this.power).filter(([, v]) => v > 0).map(([k, v]) => `${{ shield: '🛡', magnet: '🧲', x2: '✖2' }[k]} ${Math.ceil(v)}s`).join('   ');
      if (act) label(ctx, act, W / 2, H * 0.2, MIN * 0.045, '#fff');
      // Guia de controle (zonas)
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, H * 0.32); ctx.lineTo(W, H * 0.32); ctx.moveTo(0, H * 0.78); ctx.lineTo(W, H * 0.78); ctx.moveTo(W * 0.38, H * 0.32); ctx.lineTo(W * 0.38, H * 0.78); ctx.moveTo(W * 0.62, H * 0.32); ctx.lineTo(W * 0.62, H * 0.78); ctx.stroke(); ctx.setLineDash([]);
      if (this.t < 6) { label(ctx, '☝ mão no alto = PULAR', W / 2, H * 0.26, MIN * 0.04, '#1e3a8a'); label(ctx, '👇 mão embaixo = ABAIXAR', W / 2, H * 0.84, MIN * 0.04, '#1e3a8a'); label(ctx, '◀', W * 0.2, H * 0.55, MIN * 0.08, 'rgba(255,255,255,.7)'); label(ctx, '▶', W * 0.8, H * 0.55, MIN * 0.08, 'rgba(255,255,255,.7)'); }
      for (const f of this.fx) label(ctx, f.text, pp.x, y - h - s * 0.6 - (0.6 - f.life) * s, MIN * 0.05, '#facc15');
    },
    finish() { api.endMini({ title: 'FIM DA CORRIDA!', score: Math.floor(this.score), bestKey: 'bestCorredor', stats: `${Math.floor(this.dist)} m · ${this.coins} moedas · ${fmtTime(this.t)}` }); },
  };

  $('btnBateria').addEventListener('click', () => api.startMini(drums));
  $('btnCorredor').addEventListener('click', () => api.startMini(runner));
  return { drums, runner };
}
