// =============================================================================
// MINIJOGOS — usam o mesmo rastreamento de mãos e o classificador de gestos do app.js
//   1. Insetos  — esmague os insetos com a mão; abelhas picam.
//   2. Ritmo    — notas descem em 4 pistas; acerte com ✋ (aberta) ou ✊ (fechada) na pista certa.
//   3. Jokenpô  — pedra, papel e tesoura contra o computador ou entre 2 jogadores.
// Cada minijogo implementa { start(), update(dt, now), render(ctx, t, now) }.
// =============================================================================
export function install(api) {
  const { state, sfx, tone, banner, show, hide, setText, PLAYER_COLORS, rand, randInt, clamp, pick, fmtTime, emit } = api;
  const $ = (id) => document.getElementById(id);
  const GESTURE_ICON = { fist: '✊', open: '✋', scissors: '✌', other: '🤚', none: '' };
  const HUD = (label3, v3, v4) => { setText('hudLevelLabel', label3); setText('hudLevel', v3); setText('hudTime', v4); };

  function drawSky(ctx, top, bottom) {
    const g = ctx.createLinearGradient(0, 0, 0, api.H); g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, api.W, api.H);
  }
  function label(ctx, text, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `900 ${Math.round(size)}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  const covering = (x, y, r) => api.cursors.filter((c) => Math.hypot(api.cx(c) - x, c.y - y) <= r + api.contactRadius());

  // ===========================================================================
  // 1. INSETOS
  // ===========================================================================
  const insetos = {
    name: 'Caça aos Insetos', DURATION: 60,
    start() {
      this.t = 0; this.score = 0; this.p = { 1: 0, 2: 0 }; this.lives = 3; this.bugs = []; this.spawn = 0.5; this.squashed = 0; this.splats = [];
      show('hud'); setText('hudScore', '0'); HUD('VIDAS', '❤❤❤', fmtTime(this.DURATION)); hide('hudCombo'); hide('hudP');
    },
    spawnBug() {
      const W = api.W, H = api.H, MIN = api.MIN, side = randInt(0, 3);
      const kind = Math.random() < 0.18 ? 'bee' : pick(['roach', 'ant', 'fly']);
      const speed = MIN * (kind === 'fly' ? 0.28 : kind === 'ant' ? 0.12 : 0.2) * (1 + this.t / 60);
      const b = { kind, r: MIN * (kind === 'ant' ? 0.03 : 0.04), speed, wob: rand(0, 10), t: 0,
        x: side === 0 ? -MIN * 0.05 : side === 1 ? W + MIN * 0.05 : rand(0, W), y: side === 2 ? -MIN * 0.05 : side === 3 ? H + MIN * 0.05 : rand(H * 0.2, H) };
      const a = Math.atan2(H / 2 - b.y, W / 2 - b.x) + rand(-0.6, 0.6); b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed;
      this.bugs.push(b);
    },
    update(dt, now) {
      const W = api.W, H = api.H, MIN = api.MIN; this.t += dt;
      if (this.t >= this.DURATION) return this.finish(true);
      this.spawn -= dt; if (this.spawn <= 0) { this.spawnBug(); this.spawn = Math.max(0.35, 1.3 - this.t / 60); }
      for (let i = this.bugs.length - 1; i >= 0; i--) {
        const b = this.bugs[i]; b.t += dt;
        // Foge da mão mais próxima
        let near = null, nd = Infinity;
        for (const c of api.cursors) { const d = Math.hypot(api.cx(c) - b.x, c.y - b.y); if (d < nd) { nd = d; near = c; } }
        if (near && nd < MIN * 0.22 && b.kind !== 'bee') { const a = Math.atan2(b.y - near.y, b.x - api.cx(near)); b.vx += Math.cos(a) * b.speed * 6 * dt; b.vy += Math.sin(a) * b.speed * 6 * dt; }
        if (b.kind === 'bee' && near) { const a = Math.atan2(near.y - b.y, api.cx(near) - b.x); b.vx += Math.cos(a) * b.speed * 1.5 * dt; b.vy += Math.sin(a) * b.speed * 1.5 * dt; }
        const sp = Math.hypot(b.vx, b.vy) || 1, cap = b.speed * 1.6; if (sp > cap) { b.vx *= cap / sp; b.vy *= cap / sp; }
        b.vx += Math.cos(b.t * 5 + b.wob) * b.speed * 0.8 * dt; b.vy += Math.sin(b.t * 4 + b.wob) * b.speed * 0.8 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        // Escapou pelo outro lado = perde vida
        if (b.t > 2 && (b.x < -MIN * 0.1 || b.x > W + MIN * 0.1 || b.y < -MIN * 0.1 || b.y > H + MIN * 0.1)) {
          this.bugs.splice(i, 1); if (b.kind !== 'bee') { this.lives--; sfx.spawn('decoy'); banner('ESCAPOU!'); if (this.lives <= 0) return this.finish(false); }
          continue;
        }
        const cov = covering(b.x, b.y, b.r * 1.2);
        if (cov.length) {
          const by = cov[0].player;
          if (b.kind === 'bee') { this.lives--; this.bugs.splice(i, 1); api.state.shake = 1; sfx.boom(); banner('🐝 PICADA!'); emit(b.x, b.y, 20, 'fire'); if (this.lives <= 0) return this.finish(false); continue; }
          const pts = b.kind === 'fly' ? 150 : b.kind === 'roach' ? 100 : 60;
          this.score += pts; this.p[by] += pts; this.squashed++; this.bugs.splice(i, 1);
          this.splats.push({ x: b.x, y: b.y, r: b.r * 2, life: 1.5, color: b.kind === 'roach' ? '#78350f' : '#365314', text: `+${pts}`, by });
          emit(b.x, b.y, 12, 'dust'); sfx.patch(1);
        }
      }
      for (const s of this.splats) s.life -= dt * 0.5; this.splats = this.splats.filter((s) => s.life > 0);
      setText('hudScore', this.score.toLocaleString('pt-BR')); HUD('VIDAS', '❤'.repeat(Math.max(0, this.lives)) || '💀', fmtTime(this.DURATION - this.t));
      const two = api.activePlayers(now) === 2; $('hudP').classList.toggle('hidden', !two); if (two) { setText('hudP1', String(this.p[1])); setText('hudP2', String(this.p[2])); }
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN;
      drawSky(ctx, '#365314', '#1a2e05');
      // Chão de cozinha: ladrilhos
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2; const s = MIN * 0.14;
      for (let x = 0; x < W; x += s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      for (const sp of this.splats) { ctx.globalAlpha = clamp(sp.life, 0, 1); ctx.fillStyle = sp.color; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(sp.x + Math.cos(i * 1.3) * sp.r * 0.5, sp.y + Math.sin(i * 1.3) * sp.r * 0.5, sp.r * (0.35 + 0.1 * i), 0, Math.PI * 2); ctx.fill(); } label(ctx, sp.text, sp.x, sp.y - sp.r - (1.5 - sp.life) * MIN * 0.08, MIN * 0.05, PLAYER_COLORS[sp.by]); }
      ctx.globalAlpha = 1;
      for (const b of this.bugs) {
        const a = Math.atan2(b.vy, b.vx); ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
        const r = b.r, leg = Math.sin(b.t * 30) * r * 0.3;
        ctx.strokeStyle = b.kind === 'bee' ? '#111' : '#1c1917'; ctx.lineWidth = Math.max(2, r * 0.12);
        for (const sgn of [-1, 1]) for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * r * 0.4, 0); ctx.lineTo(i * r * 0.4 + leg * sgn * i, sgn * r * 1.1); ctx.stroke(); }
        ctx.fillStyle = b.kind === 'bee' ? '#facc15' : b.kind === 'roach' ? '#92400e' : b.kind === 'ant' ? '#dc2626' : '#374151';
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
        if (b.kind === 'bee') { ctx.fillStyle = '#111'; for (const dx of [-0.4, 0, 0.4]) ctx.fillRect(dx * r - r * 0.08, -r * 0.6, r * 0.16, r * 1.2); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(-r * 0.2, -r * 0.7, r * 0.5, r * 0.3, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-r * 0.2, r * 0.7, r * 0.5, r * 0.3, 0.4, 0, Math.PI * 2); ctx.fill(); }
        if (b.kind === 'fly') { ctx.fillStyle = 'rgba(200,220,255,.5)'; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.5, r * 0.7, r * 0.3, -0.5 + Math.sin(b.t * 60) * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-r * 0.3, r * 0.5, r * 0.7, r * 0.3, 0.5 - Math.sin(b.t * 60) * 0.2, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(r * 0.8, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (b.kind === 'bee') label(ctx, '⚠', b.x, b.y - b.r * 1.8, b.r, '#fde047');
      }
      if (this.t < 3) label(ctx, '🐝 Abelhas picam: desvie!', W / 2, H * 0.3, MIN * 0.06, '#fde047');
    },
    finish(timeUp) {
      const two = api.activePlayers() === 2;
      api.endMini({ title: timeUp ? 'TEMPO ESGOTADO!' : 'INFESTAÇÃO!', score: this.score, bestKey: 'bestInsetos',
        stats: `${this.squashed} insetos esmagados · ${fmtTime(this.t)}` + (two ? ` · P1 ${this.p[1]} × P2 ${this.p[2]}` : '') });
    },
  };

  // ===========================================================================
  // 2. RITMO — notas descem; na linha de acerto, faça o gesto pedido na pista certa
  // ===========================================================================
  const ritmo = {
    name: 'Ritmo das Mãos', LANES: 4, BPM: 100, DURATION: 60,
    start() {
      this.t = 0; this.score = 0; this.p = { 1: 0, 2: 0 }; this.notes = []; this.combo = 0; this.maxCombo = 0; this.hits = { perfect: 0, good: 0, miss: 0 };
      this.nextBeat = 2; this.beat = 0; this.fx = []; this.lastLaneHit = {};
      show('hud'); setText('hudScore', '0'); HUD('COMBO', '0', fmtTime(this.DURATION)); hide('hudCombo'); hide('hudP');
    },
    laneX(l) { const left = api.W * 0.1, w = api.W * 0.8 / this.LANES; return left + w * (l + 0.5); },
    get hitY() { return api.H * 0.78; },
    get fallTime() { return Math.max(1.4, 2.6 - this.t / 60); },
    update(dt, now) {
      const MIN = api.MIN; this.t += dt;
      if (this.t >= this.DURATION) return this.finish();
      // Gera notas no compasso (mais densas com o tempo)
      const beatLen = 60 / this.BPM;
      while (this.nextBeat <= this.t + this.fallTime) {
        this.beat++;
        const density = this.t < 15 ? 2 : this.t < 35 ? 1 : (this.beat % 2 ? 1 : 2);
        if (this.beat % density === 0) {
          const lane = randInt(0, this.LANES - 1), g = Math.random() < 0.5 ? 'open' : 'fist';
          this.notes.push({ lane, g, hitAt: this.nextBeat, state: 'fall' });
        }
        this.nextBeat += beatLen;
      }
      for (const n of this.notes) {
        if (n.state !== 'fall') continue;
        const dtHit = this.t - n.hitAt;
        if (dtHit > 0.18) { n.state = 'miss'; this.combo = 0; this.hits.miss++; sfx.spawn('decoy'); this.fx.push({ x: this.laneX(n.lane), y: this.hitY, text: 'ERROU', color: '#ef4444', life: 1 }); continue; }
        if (dtHit < -0.2) continue;
        // Mão na pista com o gesto certo?
        const laneW = api.W * 0.8 / this.LANES;
        const c = api.cursors.find((c) => Math.abs(api.cx(c) - this.laneX(n.lane)) < laneW * 0.55 && c.gesture === n.g);
        if (c) {
          const perfect = Math.abs(dtHit) < 0.08; const pts = (perfect ? 300 : 150) * (1 + Math.min(this.combo, 20) * 0.1);
          n.state = 'hit'; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); this.hits[perfect ? 'perfect' : 'good']++;
          this.score += Math.round(pts); this.p[c.player] += Math.round(pts);
          this.fx.push({ x: this.laneX(n.lane), y: this.hitY, text: perfect ? 'PERFEITO!' : 'BOM', color: perfect ? '#fde047' : PLAYER_COLORS[c.player], life: 1 });
          tone([262, 330, 392, 523][n.lane] * (perfect ? 2 : 1), 0.18, 'triangle', 0.12); emit(this.laneX(n.lane), this.hitY, 12, 'dust');
        }
      }
      this.notes = this.notes.filter((n) => n.state === 'fall' || this.t - n.hitAt < 0.6);
      for (const f of this.fx) { f.life -= dt; f.y -= MIN * 0.1 * dt; } this.fx = this.fx.filter((f) => f.life > 0);
      // Batida de fundo
      if (Math.floor(this.t / beatLen) !== Math.floor((this.t - dt) / beatLen)) tone(Math.floor(this.t / beatLen) % 4 === 0 ? 110 : 82, 0.1, 'sine', 0.08);
      setText('hudScore', this.score.toLocaleString('pt-BR')); HUD('COMBO', String(this.combo), fmtTime(this.DURATION - this.t));
      const two = api.activePlayers(now) === 2; $('hudP').classList.toggle('hidden', !two); if (two) { setText('hudP1', String(this.p[1])); setText('hudP2', String(this.p[2])); }
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN, laneW = W * 0.8 / this.LANES;
      drawSky(ctx, '#1e1b4b', '#0f0a2e');
      for (let l = 0; l < this.LANES; l++) {
        const x = this.laneX(l) - laneW / 2; ctx.fillStyle = l % 2 ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.08)'; ctx.fillRect(x, 0, laneW, H);
        // destaque quando há mão na pista
        const c = api.cursors.find((c) => Math.abs(api.cx(c) - this.laneX(l)) < laneW * 0.55);
        if (c) { ctx.fillStyle = PLAYER_COLORS[c.player] + '22'; ctx.fillRect(x, 0, laneW, H); label(ctx, GESTURE_ICON[c.gesture], this.laneX(l), H * 0.9, MIN * 0.09); }
      }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = MIN * 0.008; ctx.setLineDash([MIN * 0.03, MIN * 0.02]); ctx.beginPath(); ctx.moveTo(W * 0.1, this.hitY); ctx.lineTo(W * 0.9, this.hitY); ctx.stroke(); ctx.setLineDash([]);
      for (const n of this.notes) {
        const y = this.hitY - (n.hitAt - this.t) / this.fallTime * (this.hitY + MIN * 0.1), x = this.laneX(n.lane), r = laneW * 0.32;
        if (n.state === 'miss') continue;
        ctx.globalAlpha = n.state === 'hit' ? clamp(1 - (this.t - n.hitAt) * 2, 0, 1) : 1;
        ctx.fillStyle = n.g === 'open' ? '#38bdf8' : '#f472b6'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.12; ctx.stroke();
        label(ctx, GESTURE_ICON[n.g], x, y, r * 1.2);
        ctx.globalAlpha = 1;
      }
      for (const f of this.fx) { ctx.globalAlpha = clamp(f.life, 0, 1); label(ctx, f.text, f.x, f.y - MIN * 0.1, MIN * 0.05, f.color); } ctx.globalAlpha = 1;
      if (this.t < 4) label(ctx, '✋ aberta · ✊ fechada — na pista da nota, na linha', W / 2, H * 0.25, MIN * 0.05, '#fde047');
    },
    finish() {
      const two = api.activePlayers() === 2, total = this.hits.perfect + this.hits.good + this.hits.miss || 1;
      api.endMini({ title: 'FIM DA MÚSICA!', score: this.score, bestKey: 'bestRitmo',
        stats: `${Math.round((this.hits.perfect + this.hits.good) / total * 100)}% de acerto · ${this.hits.perfect} perfeitos · combo máx. ${this.maxCombo}` + (two ? ` · P1 ${this.p[1]} × P2 ${this.p[2]}` : '') });
    },
  };

  // ===========================================================================
  // 3. JOKENPÔ — melhor de 5, contra o computador (1 jogador) ou entre P1 e P2
  // ===========================================================================
  const jokenpo = {
    name: 'Jokenpô', ROUNDS: 5, NAMES: { fist: 'PEDRA', open: 'PAPEL', scissors: 'TESOURA' },
    start() {
      this.round = 0; this.wins = { 1: 0, 2: 0 }; this.two = api.activePlayers() === 2; this.phase = 'ready'; this.timer = 1.5; this.result = null; this.cpu = null; this.hands = {};
      show('hud'); setText('hudScore', '0'); HUD('RODADA', '1', '—'); hide('hudCombo'); hide('hudP');
    },
    beats(a, b) { return (a === 'fist' && b === 'scissors') || (a === 'scissors' && b === 'open') || (a === 'open' && b === 'fist'); },
    playerGesture(p) {
      // Em 2P usa o lado; em 1P qualquer mão. Só vale gesto estável há 150 ms.
      const cs = api.cursors.filter((c) => (this.two ? c.player === p : true) && ['fist', 'open', 'scissors'].includes(c.gesture));
      return cs.length ? cs[0] : null;
    },
    update(dt, now) {
      this.timer -= dt;
      if (this.phase === 'ready' && this.timer <= 0) { this.phase = 'call'; this.timer = 0; this.step = 0; this.round++; HUD('RODADA', String(this.round), `${this.wins[1]} × ${this.wins[2]}`); }
      if (this.phase === 'call') {
        // "PEDRA… PAPEL… TESOURA… JÁ!" a cada 0,7 s
        this.timer -= 0; const words = ['PEDRA', 'PAPEL', 'TESOURA', 'JÁ!'];
        if (this.step < 4 && this.timer <= 0) { banner(words[this.step]); sfx.tick(); this.step++; this.timer = this.step === 4 ? 1.0 : 0.7; }
        else if (this.step === 4 && this.timer <= 0) {
          // Captura
          const g1 = this.playerGesture(1), g2 = this.two ? this.playerGesture(2) : null;
          const a = g1?.gesture || null, b = this.two ? (g2?.gesture || null) : pick(['fist', 'open', 'scissors']);
          this.cpu = b; this.hands = { 1: a, 2: b };
          if (!a || (this.two && !b)) { this.result = 'nenhum'; banner('✋ Gesto não lido'); }
          else if (a === b) { this.result = 'empate'; banner('EMPATE'); sfx.click(); }
          else if (this.beats(a, b)) { this.result = 1; this.wins[1]++; banner(this.two ? 'P1 VENCEU!' : 'VOCÊ VENCEU!'); sfx.level(); }
          else { this.result = 2; this.wins[2]++; banner(this.two ? 'P2 VENCEU!' : 'CPU VENCEU'); sfx.spawn('decoy'); }
          this.phase = 'show'; this.timer = 2.2;
          setText('hudScore', String(this.wins[1] * 100)); HUD('RODADA', String(this.round), `${this.wins[1]} × ${this.wins[2]}`);
        }
      }
      if (this.phase === 'show' && this.timer <= 0) {
        const need = Math.ceil(this.ROUNDS / 2);
        if (this.wins[1] >= need || this.wins[2] >= need || this.round >= this.ROUNDS + 2) return this.finish();
        this.phase = 'ready'; this.timer = 0.8;
      }
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN;
      drawSky(ctx, '#7c2d12', '#1c0a04');
      // Dois lados
      ctx.fillStyle = 'rgba(56,189,248,.08)'; ctx.fillRect(0, 0, W / 2, H); ctx.fillStyle = 'rgba(251,146,60,.08)'; ctx.fillRect(W / 2, 0, W / 2, H);
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W / 2, H * 0.2); ctx.lineTo(W / 2, H * 0.95); ctx.stroke();
      label(ctx, this.two ? 'P1' : 'VOCÊ', W * 0.25, H * 0.26, MIN * 0.07, PLAYER_COLORS[1]);
      label(ctx, this.two ? 'P2' : 'CPU', W * 0.75, H * 0.26, MIN * 0.07, PLAYER_COLORS[2]);
      label(ctx, '★'.repeat(this.wins[1]), W * 0.25, H * 0.35, MIN * 0.06, '#fde047');
      label(ctx, '★'.repeat(this.wins[2]), W * 0.75, H * 0.35, MIN * 0.06, '#fde047');
      // Gesto ao vivo de cada lado
      const live = (p) => { const c = this.playerGesture(p); return c ? GESTURE_ICON[c.gesture] : '❔'; };
      if (this.phase === 'show') {
        const big = MIN * 0.28;
        label(ctx, GESTURE_ICON[this.hands[1]] || '❔', W * 0.25, H * 0.6, big); label(ctx, GESTURE_ICON[this.hands[2]] || '❔', W * 0.75, H * 0.6, big);
        label(ctx, this.NAMES[this.hands[1]] || '—', W * 0.25, H * 0.82, MIN * 0.06); label(ctx, this.NAMES[this.hands[2]] || '—', W * 0.75, H * 0.82, MIN * 0.06);
      } else {
        const shake = this.phase === 'call' ? Math.sin(t * 25) * MIN * 0.03 : 0;
        label(ctx, live(1), W * 0.25, H * 0.6 + shake, MIN * 0.22);
        label(ctx, this.two ? live(2) : '🤖', W * 0.75, H * 0.6 + shake, MIN * 0.22);
        if (this.phase === 'ready') label(ctx, 'Prepare a mão…', W / 2, H * 0.12, MIN * 0.05, '#fde047');
      }
      if (this.round <= 1 && this.phase !== 'show') label(ctx, '✊ pedra · ✋ papel · ✌ tesoura — mostre no "JÁ!"', W / 2, H * 0.95, MIN * 0.04, '#fde68a');
    },
    finish() {
      const w = this.wins[1] > this.wins[2] ? 1 : this.wins[2] > this.wins[1] ? 2 : 0;
      api.endMini({ title: w === 0 ? 'EMPATE!' : this.two ? `P${w} VENCEU A SÉRIE!` : w === 1 ? 'VOCÊ VENCEU A SÉRIE!' : 'A CPU VENCEU', score: this.wins[1] * 100, bestKey: 'bestJokenpo',
        stats: `${this.wins[1]} × ${this.wins[2]} em ${this.round} rodadas` });
    },
  };

  $('btnInsetos').addEventListener('click', () => api.startMini(insetos));
  $('btnRitmo').addEventListener('click', () => api.startMini(ritmo));
  $('btnJokenpo').addEventListener('click', () => api.startMini(jokenpo));
  return { insetos, ritmo, jokenpo };
}
