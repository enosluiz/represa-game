// =============================================================================
// CIRCO — Pratinhos, Malabares e Goleiro (mesma câmera, 1–2 jogadores)
//   • Pratinhos: pratos giram em varas; movimento circular da mão perto do prato repõe o giro.
//   • Malabares: bolas com gravidade; a mão é a "raquete": bate por baixo e lança de volta.
//   • Goleiro: bolas chutadas contra a tela com curva; defenda com as mãos no ponto de chegada.
// Cada jogo: { start(), update(dt, now), render(ctx, t, now) }.
// =============================================================================
import { texture, vignette, spotlight, sphere, groundShadow, sky, crowd } from './art.js';
export function install(api) {
  const { sfx, tone, noise, banner, show, hide, setText, PLAYER_COLORS, rand, randInt, clamp, lerp, pick, fmtTime, emit } = api;
  const $ = (id) => document.getElementById(id);
  function label(ctx, text, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `900 ${Math.round(size)}px Fredoka, system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function bg(ctx, a, b) { const g = ctx.createLinearGradient(0, 0, 0, api.H); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, api.W, api.H); }
  // Histórico de posição por cursor (velocidade e ângulo)
  const hist = new Map();
  function track(now) {
    const seen = new Set();
    for (const c of api.cursors) {
      seen.add(c.id); let h = hist.get(c.id); if (!h) { h = { pts: [], vx: 0, vy: 0 }; hist.set(c.id, h); }
      h.pts.push({ t: now, x: api.cx(c), y: c.y }); while (h.pts.length > 2 && now - h.pts[0].t > 160) h.pts.shift();
      const a = h.pts[0], b = h.pts[h.pts.length - 1], span = Math.max(16, b.t - a.t) / 1000; h.vx = (b.x - a.x) / span; h.vy = (b.y - a.y) / span;
    }
    for (const id of hist.keys()) if (!seen.has(id)) hist.delete(id);
  }
  const twoP = (now) => api.activePlayers(now) === 2;
  function hudPlayers(now, p) { const two = twoP(now); $('hudP').classList.toggle('hidden', !two); if (two) { setText('hudP1', String(Math.floor(p[1]))); setText('hudP2', String(Math.floor(p[2]))); } }

  // ===========================================================================
  // 1. PRATINHOS
  // ===========================================================================
  const pratinhos = {
    name: 'Equilibrista de Pratinhos', DURATION: 75,
    start() {
      this.t = 0; this.score = 0; this.p = { 1: 0, 2: 0 }; this.lives = 3; this.broken = 0; this.shards = []; this.plates = [];
      this.nPlates = 2; this.addTimer = 12; this.angleMem = new Map();
      for (let i = 0; i < this.nPlates; i++) this.addPlate();
      show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'VIDAS'); setText('hudLevel', '❤❤❤'); setText('hudTime', fmtTime(this.DURATION)); hide('hudCombo'); hide('hudP');
      banner('Gire a mão em volta dos pratos!');
    },
    layout() { const n = this.plates.length; this.plates.forEach((p, i) => { p.tx = api.W * (0.5 + (i - (n - 1) / 2) * (0.8 / Math.max(n, 2))); }); },
    addPlate() { this.plates.push({ spin: 1, tx: api.W / 2, x: api.W / 2, wob: 0, phase: rand(0, 6), alive: true, fallT: 0 }); this.layout(); },
    update(dt, now) {
      const W = api.W, H = api.H, MIN = api.MIN; this.t += dt; track(now);
      if (this.t >= this.DURATION) return this.finish(true);
      this.addTimer -= dt; if (this.addTimer <= 0 && this.plates.length < 5) { this.addPlate(); this.addTimer = 14; banner('+1 PRATO!'); sfx.spawn('x'); }
      const decay = 0.07 + this.t * 0.0025 + this.plates.length * 0.01; // giro perdido por segundo
      const topY = H * 0.42;
      for (let pi = 0; pi < this.plates.length; pi++) { const p = this.plates[pi];
        p.x = lerp(p.x, p.tx, 1 - Math.pow(0.01, dt)); p.phase += dt * (2 + p.spin * 10);
        if (!p.alive) { p.fallT += dt; if (this.t >= p.reviveAt) { p.alive = true; p.spin = 0.9; } continue; }
        p.spin -= decay * dt;
        // Movimento circular da mão perto do prato: velocidade angular em torno do centro (só em amostras novas)
        for (const c of api.cursors) {
          const dx = api.cx(c) - p.x, dy = c.y - topY, d = Math.hypot(dx, dy), key = `${pi}|${c.id}`;
          if (d > MIN * 0.26 || d < MIN * 0.06) { this.angleMem.delete(key); continue; } // perto demais do centro = ruído angular
          if (c.lastSeen !== now) continue;
          const ang = Math.atan2(dy, dx), prev = this.angleMem.get(key);
          if (prev) { let da = ang - prev.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
            const span = Math.max(0.016, (now - prev.t) / 1000), w = Math.abs(da) / span;
            if (w > 1.5) { p.spin += Math.min(w, 14) * 0.12 * span; p.boost = 0.3; } }
          this.angleMem.set(key, { ang, t: now });
        }
        p.spin = clamp(p.spin, -0.2, 1.25); p.boost = Math.max(0, (p.boost || 0) - dt);
        p.wob = p.spin < 0.3 ? (0.3 - p.spin) / 0.3 : 0;
        this.score += (0.6 + p.spin) * dt * 4;
        if (p.spin <= 0) { p.alive = false; p.fallT = 0; this.lives--; this.broken++; sfx.boom(); api.state.shake = 0.8; banner('💥 QUEBROU!'); setText('hudLevel', '❤'.repeat(Math.max(0, this.lives)) || '💀'); if (this.lives <= 0) return this.finish(false); p.reviveAt = this.t + 2.5; }
      }
      for (const k of this.angleMem.keys()) if (!api.cursors.some((c) => k.endsWith('|' + c.id))) this.angleMem.delete(k);
      for (let i = this.shards.length - 1; i >= 0; i--) { const s = this.shards[i]; s.vy += MIN * 2 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; if (s.life <= 0) this.shards.splice(i, 1); }
      setText('hudScore', Math.floor(this.score).toLocaleString('pt-BR')); setText('hudTime', fmtTime(this.DURATION - this.t));
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN;
      ctx.fillStyle = texture(ctx, 'velvet', 256, 12); ctx.fillRect(0, 0, W, H);
      // Cortinas com dobras (listras com sombra) e lambrequim
      for (let x = 0; x < W; x += MIN * 0.1) { const g = ctx.createLinearGradient(x, 0, x + MIN * 0.1, 0); g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(0.5, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); ctx.fillStyle = g; ctx.fillRect(x, 0, MIN * 0.1, H); }
      ctx.fillStyle = '#facc15'; for (let x = 0; x < W; x += MIN * 0.08) { ctx.beginPath(); ctx.moveTo(x, H * 0.12); ctx.lineTo(x + MIN * 0.04, H * 0.17); ctx.lineTo(x + MIN * 0.08, H * 0.12); ctx.fill(); } ctx.fillRect(0, H * 0.1, W, H * 0.025);
      ctx.fillStyle = texture(ctx, 'wood', 256, 9); ctx.fillRect(0, H * 0.86, W, H); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, H * 0.86, W, H);
      spotlight(ctx, W * 0.5, H * 0.1, H * 1.1, 'rgba(255,240,200,.28)'); vignette(ctx, W, H, 0.5);
      const topY = H * 0.42;
      for (const p of this.plates) {
        // Vara
        ctx.strokeStyle = '#d6b27a'; ctx.lineWidth = MIN * 0.012; ctx.beginPath(); ctx.moveTo(p.x, H * 0.86); ctx.lineTo(p.x, topY); ctx.stroke();
        if (!p.alive) { // prato caindo
          const fy = topY + p.fallT * p.fallT * MIN * 1.5; if (fy < H * 0.9) { ctx.save(); ctx.translate(p.x, fy); ctx.rotate(p.fallT * 6); ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.ellipse(0, 0, MIN * 0.09, MIN * 0.03, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
          else label(ctx, '💔', p.x, H * 0.8, MIN * 0.08);
          continue;
        }
        // Prato: inclinação pelo wobble, brilho pelo giro
        const tilt = Math.sin(p.phase * 2) * p.wob * 0.5, rx = MIN * 0.11, ry = MIN * 0.035 + Math.abs(tilt) * MIN * 0.03;
        ctx.save(); ctx.translate(p.x, topY - MIN * 0.02); ctx.rotate(tilt);
        ctx.fillStyle = p.spin < 0.3 ? '#fecaca' : '#f3f4f6'; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = 'rgba(59,130,246,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
        // marcador de rotação
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(Math.cos(p.phase) * rx * 0.8, Math.sin(p.phase) * ry * 0.8, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Medidor de giro
        const mw = MIN * 0.16, mx = p.x - mw / 2, my = topY - MIN * 0.14;
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(mx, my, mw, MIN * 0.022);
        ctx.fillStyle = p.spin < 0.3 ? '#ef4444' : p.spin < 0.6 ? '#facc15' : '#4ade80'; ctx.fillRect(mx, my, mw * clamp(p.spin, 0, 1), MIN * 0.022);
        if (p.boost > 0) { ctx.strokeStyle = `rgba(74,222,128,${p.boost * 2})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, topY, MIN * 0.2, 0, Math.PI * 2); ctx.stroke(); }
        if (p.spin < 0.3) label(ctx, '↻ GIRE!', p.x, topY - MIN * 0.2, MIN * 0.04, '#fca5a5');
      }
      if (this.t < 5) label(ctx, 'Faça círculos com a mão ao redor do prato para manter o giro', W / 2, H * 0.3, MIN * 0.035, '#fde68a');
    },
    finish(timeUp) { api.endMini({ title: timeUp ? 'SHOW ENCERRADO!' : 'TODOS OS PRATOS QUEBRARAM', score: Math.floor(this.score), bestKey: 'bestPratinhos', stats: `${this.plates.length} pratos · ${this.broken} quebrados · ${fmtTime(this.t)}` }); },
  };

  // ===========================================================================
  // 2. MALABARES
  // ===========================================================================
  const malabares = {
    name: 'Malabares', DURATION: 75,
    start() {
      this.t = 0; this.score = 0; this.p = { 1: 0, 2: 0 }; this.lives = 3; this.balls = []; this.bounces = 0; this.combo = 0; this.addTimer = 1; this.fx = [];
      show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'VIDAS'); setText('hudLevel', '❤❤❤'); setText('hudTime', fmtTime(this.DURATION)); hide('hudCombo'); hide('hudP');
      banner('Rebata as bolas por baixo!');
    },
    addBall() { const MIN = api.MIN; this.balls.push({ x: rand(api.W * 0.3, api.W * 0.7), y: -MIN * 0.1, vx: rand(-0.05, 0.05) * MIN, vy: 0, r: MIN * 0.045, color: pick(['#f472b6', '#38bdf8', '#facc15', '#4ade80', '#fb923c']), spin: 0, cool: 0 }); },
    update(dt, now) {
      const W = api.W, H = api.H, MIN = api.MIN; this.t += dt; track(now);
      if (this.t >= this.DURATION) return this.finish(true);
      this.addTimer -= dt; const target = Math.min(5, 1 + Math.floor(this.t / 15));
      if (this.addTimer <= 0 && this.balls.length < target) { this.addBall(); this.addTimer = 3; if (this.balls.length > 1) banner(`${this.balls.length} BOLAS!`); }
      const g = MIN * 1.4, pr = api.contactRadius() * 1.6;
      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i]; b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.cool = Math.max(0, b.cool - dt); b.spin += b.vx * dt * 0.02;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.8; } if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.8; }
        // Rebate: mão encosta na bola que está descendo
        if (b.vy > 0 && b.cool <= 0) for (const c of api.cursors) {
          const dx = b.x - api.cx(c), dy = b.y - c.y, d = Math.hypot(dx, dy);
          if (d > b.r + pr) continue;
          const h = hist.get(c.id) || { vx: 0, vy: 0 };
          // Impulso: altura-alvo fixa (sempre chega ao topo), direção pela posição relativa + arrasto da mão
          const launch = Math.sqrt(2 * g * Math.max(MIN * 0.15, b.y - H * 0.12));
          b.vy = -launch * rand(0.95, 1.05); b.vx = clamp(dx / (b.r + pr) * MIN * 0.25 + h.vx * 0.35, -MIN * 0.45, MIN * 0.45); b.cool = 0.25;
          this.bounces++; this.combo++; const pts = 10 * Math.min(this.combo, 20) * this.balls.length; this.score += pts; this.p[c.player] += pts;
          emit(b.x, b.y + b.r, 8, 'dust'); tone(300 + this.balls.indexOf(b) * 80, 0.08, 'triangle', 0.1); this.fx.push({ x: b.x, y: b.y, text: `+${pts}`, life: 0.7, color: PLAYER_COLORS[c.player] });
          break;
        }
        if (b.y - b.r > H) { this.balls.splice(i, 1); this.lives--; this.combo = 0; sfx.spawn('decoy'); api.state.shake = 0.5; banner('CAIU!'); setText('hudLevel', '❤'.repeat(Math.max(0, this.lives)) || '💀'); if (this.lives <= 0) return this.finish(false); this.addTimer = 1.5; }
      }
      for (const f of this.fx) { f.life -= dt; f.y -= MIN * 0.15 * dt; } this.fx = this.fx.filter((f) => f.life > 0);
      setText('hudScore', Math.floor(this.score).toLocaleString('pt-BR')); setText('hudTime', fmtTime(this.DURATION - this.t)); hudPlayers(now, this.p);
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN; bg(ctx, '#312e81', '#0f0a2e');
      // Holofotes
      for (const sx of [0.25, 0.75]) { const gr = ctx.createRadialGradient(W * sx, 0, 0, W * sx, 0, H * 0.9); gr.addColorStop(0, 'rgba(253,224,71,.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(W * sx, 0); ctx.lineTo(W * sx - W * 0.25, H); ctx.lineTo(W * sx + W * 0.25, H); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = texture(ctx, 'wood', 256, 9); ctx.globalAlpha = 0.9; ctx.fillRect(0, H * 0.92, W, H); ctx.globalAlpha = 1;
      // Névoa volumétrica
      for (const sx of [0.25, 0.75]) spotlight(ctx, W * sx, H * 0.1, H * 0.7, 'rgba(255,255,255,.07)');
      vignette(ctx, W, H, 0.45);
      for (const b of this.balls) {
        // Sombra no chão
        const sh = clamp(1 - (H * 0.92 - b.y) / H, 0.2, 1); ctx.fillStyle = `rgba(0,0,0,${0.35 * sh})`; ctx.beginPath(); ctx.ellipse(b.x, H * 0.92, b.r * sh, b.r * 0.35 * sh, 0, 0, Math.PI * 2); ctx.fill();
        // Rastro
        ctx.strokeStyle = b.color + '55'; ctx.lineWidth = b.r; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(b.x - b.vx * 0.04, b.y - b.vy * 0.04); ctx.lineTo(b.x, b.y); ctx.stroke();
        sphere(ctx, b.x, b.y, b.r, b.color);
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.6, b.spin, b.spin + 2); ctx.stroke();
      }
      for (const f of this.fx) { ctx.globalAlpha = clamp(f.life, 0, 1); label(ctx, f.text, f.x, f.y, MIN * 0.045, f.color); } ctx.globalAlpha = 1;
      if (this.combo >= 5) label(ctx, `🔥 combo ${this.combo}`, W / 2, H * 0.12, MIN * 0.05, '#fbbf24');
      if (this.t < 5) label(ctx, 'Coloque a mão embaixo da bola que está caindo', W / 2, H * 0.3, MIN * 0.035, '#fde68a');
    },
    finish(timeUp) { api.endMini({ title: timeUp ? 'GRANDE FINAL!' : 'AS BOLAS CAÍRAM', score: Math.floor(this.score), bestKey: 'bestMalabares', stats: `${this.bounces} rebatidas · até ${Math.min(5, 1 + Math.floor(this.t / 15))} bolas · ${fmtTime(this.t)}` }); },
  };

  // ===========================================================================
  // 3. GOLEIRO
  // ===========================================================================
  const goleiro = {
    name: 'Goleiro', MAX_GOALS: 3,
    start() {
      this.t = 0; this.score = 0; this.p = { 1: 0, 2: 0 }; this.saves = 0; this.goals = 0; this.shot = null; this.wait = 1.5; this.shotN = 0; this.flash = 0; this.net = 0; this.endAt = null;
      show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'GOLS SOFRIDOS'); setText('hudLevel', '0/3'); setText('hudTime', 'DEFESAS 0'); hide('hudCombo'); hide('hudP');
      banner('Defenda com as mãos!');
    },
    goal() { const W = api.W, H = api.H; return { x1: W * 0.12, x2: W * 0.88, y1: H * 0.2, y2: H * 0.86 }; },
    newShot() {
      const g = this.goal(), MIN = api.MIN, n = this.shotN++;
      const dur = Math.max(0.75, 1.9 - n * 0.06);
      // Alvo longe das mãos (não dá defesa de graça), curva lateral e às vezes finta
      let tx, ty, tries = 0; do { tx = rand(g.x1 + MIN * 0.1, g.x2 - MIN * 0.1); ty = rand(g.y1 + MIN * 0.08, g.y2 - MIN * 0.06); tries++; } while (tries < 20 && api.cursors.some((c) => Math.hypot(api.cx(c) - tx, c.y - ty) < MIN * 0.25));
      this.shot = { tx, ty, sx: api.W / 2 + rand(-api.W * 0.2, api.W * 0.2), sy: api.H * 0.5, t: 0, dur, curve: rand(-1, 1) * MIN * 0.25 * (n > 3 ? 1 : 0.4), feint: n > 5 && Math.random() < 0.3, feintDone: false, result: null };
      tone(90, 0.15, 'sine', 0.2, 0, 60); // chute
    },
    update(dt, now) {
      const W = api.W, H = api.H, MIN = api.MIN; this.t += dt; this.flash = Math.max(0, this.flash - dt * 3); this.net = Math.max(0, this.net - dt * 2);
      if (this.endAt != null && this.t >= this.endAt) return this.finish();
      if (!this.shot) { this.wait -= dt; if (this.wait <= 0) this.newShot(); return; }
      const s = this.shot; s.t += dt;
      if (s.feint && !s.feintDone && s.t > s.dur * 0.5) { s.feintDone = true; s.tx = clamp(s.tx + (s.tx < W / 2 ? 1 : -1) * MIN * 0.45, this.goal().x1 + MIN * 0.1, this.goal().x2 - MIN * 0.1); banner('FINTA!'); }
      const LAG = api.settings.tvMode ? 0.18 : 0.08; // janela extra após a chegada (latência câmera/TV)
      if (s.t >= s.dur && !s.result) {
        const reach = api.contactRadius() + MIN * 0.11, c = api.cursors.find((c) => Math.hypot(api.cx(c) - s.tx, c.y - s.ty) <= reach);
        if (!c && s.t < s.dur + LAG) { /* ainda dentro da janela: espera */ }
        else if (c) { s.result = 'save'; this.saves++; const pts = 100 + Math.floor(this.shotN * 15) + (s.feint ? 50 : 0); this.score += pts; this.p[c.player] += pts; banner(pick(['DEFESAÇA!', 'QUE DEFESA!', 'MURALHA!'])); sfx.level(); emit(s.tx, s.ty, 25, 'dust'); api.state.shake = 0.6; }
        else { s.result = 'goal'; this.goals++; banner('GOOOL... 😬'); sfx.over(); this.net = 1; api.state.shake = 1; setText('hudLevel', `${this.goals}/${this.MAX_GOALS}`); }
        if (s.result) { setText('hudScore', this.score.toLocaleString('pt-BR')); setText('hudTime', `DEFESAS ${this.saves}`); hudPlayers(now, this.p); }
        if (this.goals >= this.MAX_GOALS) { this.endAt = this.t + 1.2; this.shot.done = true; }
      }
      if (s.result && s.t > s.dur + 1.0 && !s.done) { this.shot = null; this.wait = rand(0.8, 1.6); }
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN, g = this.goal();
      sky(ctx, W, H, { top: '#0c1a4a', bottom: '#1e3a8a', sun: false, cloudAlpha: 0.08 }); // noite de jogo
      // Arquibancada com torcida e refletores
      ctx.fillStyle = '#1f2937'; ctx.fillRect(0, H * 0.1, W, H * 0.22); crowd(ctx, W, H * 0.11, H * 0.31, 5);
      for (const sx of [0.08, 0.92]) { ctx.fillStyle = '#9ca3af'; ctx.fillRect(W * sx - 3, 0, 6, H * 0.2); ctx.fillStyle = '#e5e7eb'; ctx.fillRect(W * sx - MIN * 0.05, 0, MIN * 0.1, MIN * 0.03); spotlight(ctx, W * sx, MIN * 0.02, H * 0.9, 'rgba(255,255,255,.14)'); }
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, H * 0.31, W, H * 0.015); // mureta
      // Gramado texturizado com faixas de corte
      ctx.fillStyle = texture(ctx, 'grass', 256, 6); ctx.fillRect(0, H * 0.32, W, H);
      for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.06)'; ctx.fillRect(0, H * (0.32 + i * 0.085), W, H * 0.085); }
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.strokeRect(W * 0.02, H * 0.9, W * 0.96, H * 0.3); // linha da pequena área
      vignette(ctx, W, H, 0.4);
      // Rede e traves
      ctx.strokeStyle = this.net > 0 ? `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 30)})` : 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
      for (let x = g.x1; x <= g.x2; x += MIN * 0.04) { ctx.beginPath(); ctx.moveTo(x, g.y1); ctx.lineTo(x, g.y2); ctx.stroke(); }
      for (let y = g.y1; y <= g.y2; y += MIN * 0.04) { ctx.beginPath(); ctx.moveTo(g.x1, y); ctx.lineTo(g.x2, y); ctx.stroke(); }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = MIN * 0.02; ctx.strokeRect(g.x1, g.y1, g.x2 - g.x1, g.y2 - g.y1);
      const s = this.shot;
      if (s) {
        const k = clamp(s.t / s.dur, 0, 1), e = k * k; // acelera ao se aproximar
        const x = lerp(s.sx, s.tx, e) + Math.sin(k * Math.PI) * s.curve, y = lerp(s.sy, s.ty, e) - Math.sin(k * Math.PI) * MIN * 0.15;
        const r = lerp(MIN * 0.015, MIN * 0.11, e);
        // Mira (onde a bola vai chegar) — aparece a partir de 30% do voo
        if (k > 0.3 && !s.result) { const a = clamp((k - 0.3) / 0.5, 0, 1); ctx.strokeStyle = `rgba(250,204,21,${a})`; ctx.lineWidth = 4; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(s.tx, s.ty, MIN * 0.11 + Math.sin(t * 12) * 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        if (s.result === 'goal') { label(ctx, '⚽', s.tx, s.ty, MIN * 0.2); }
        else if (s.result === 'save') { label(ctx, '🧤', s.tx, s.ty, MIN * 0.2); }
        else {
          groundShadow(ctx, x, y + r * 1.2, r * 1.2, r * 0.45, 0.35);
          sphere(ctx, x, y, r, '#f8fafc');
          ctx.fillStyle = '#111'; for (let i = 0; i < 5; i++) { const a = t * 6 + i * 1.26; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.2, 0, Math.PI * 2); ctx.fill(); }
          ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        }
      } else label(ctx, 'Prepare-se…', W / 2, H * 0.12, MIN * 0.045, '#fde68a');
      // Luvas nas mãos
      for (const c of api.cursors) label(ctx, '🧤', api.cx(c), c.y, api.contactRadius() * 2.2);
      if (this.t < 5) label(ctx, 'Coloque a mão no alvo amarelo antes da bola chegar', W / 2, H * 0.94, MIN * 0.035, '#fde68a');
    },
    finish() { api.endMini({ title: 'FIM DE JOGO', score: this.score, bestKey: 'bestGoleiro', stats: `${this.saves} defesas · ${this.goals} gols sofridos · ${this.shotN} chutes` }); },
  };

  $('btnPratinhos').addEventListener('click', () => api.startMini(pratinhos));
  $('btnMalabares').addEventListener('click', () => api.startMini(malabares));
  $('btnGoleiro').addEventListener('click', () => api.startMini(goleiro));
  return { pratinhos, malabares, goleiro };
}
