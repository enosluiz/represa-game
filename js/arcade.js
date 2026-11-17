// =============================================================================
// ARCADE — Corredor (3 pistas), com a mesma câmera
//   • Corredor: mão esquerda/centro/direita = pista; mão erguida = pulo; mão baixa = agachar.
//     Moedas, poderes (escudo, ímã, x2) e obstáculos (barreira: pule; viga: abaixe; muro: mude de pista).
// =============================================================================
import { texture, vignette, spotlight, sphere, groundShadow, sky } from './art.js';
export function install(api) {
  const { sfx, tone, noise, banner, show, hide, setText, PLAYER_COLORS, rand, randInt, clamp, lerp, pick, fmtTime, emit } = api;
  const $ = (id) => document.getElementById(id);
  function label(ctx, text, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `900 ${Math.round(size)}px Fredoka, system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function bg(ctx, a, b) { const g = ctx.createLinearGradient(0, 0, 0, api.H); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, api.W, api.H); }

  // ===========================================================================
  // CORREDOR
  // ===========================================================================
  const runner = {
    name: 'Corredor', LANES: 3,
    start() {
      this.t = 0; this.score = 0; this.coins = 0; this.lives = 3; this.speed = 0.55; this.dist = 0; this.objs = []; this.spawnZ = 0;
      this.lane = 1, this.laneX = 1; this.jump = 0; this.duck = 0; this.pose = 'run'; this.power = { shield: 0, magnet: 0, x2: 0 }; this.inv = 0; this.fx = [];
      // Tutorial interativo: cada passo só avança quando a câmera vê o movimento
      this.tut = { step: 0, hold: 0, done: false, flash: 0 };
      this.TUT = [
        { text: 'Mostre a mão para a câmera', test: (c) => !!c },
        { text: 'Mão para a ESQUERDA ◀', test: (c, nx) => c && nx < 0.38 },
        { text: 'Mão para a DIREITA ▶', test: (c, nx) => c && nx > 0.62 },
        { text: 'Mão no CENTRO', test: (c, nx) => c && nx >= 0.38 && nx <= 0.62 },
        { text: 'LEVANTE a mão para PULAR ☝', test: (c, nx, ny) => c && ny < 0.32 },
        { text: 'ABAIXE a mão para AGACHAR 👇', test: (c, nx, ny) => c && ny > 0.78 },
        { text: 'Mão no meio da tela para começar', test: (c, nx, ny) => c && ny >= 0.32 && ny <= 0.78 },
      ];
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
      let c = api.cursors.find((k) => k.id === this.ctrlId);
      if (!c && api.cursors.length) { const lx = this.ctrlX ?? W / 2, ly = this.ctrlY ?? H / 2;
        c = api.cursors.reduce((b, k) => Math.hypot(api.cx(k) - lx, k.y - ly) < Math.hypot(api.cx(b) - lx, b.y - ly) ? k : b); this.ctrlId = c.id; }
      if (c) {
        this.ctrlX = api.cx(c); this.ctrlY = c.y;
        const nx = api.cx(c) / W; this.lane = nx < 0.38 ? 0 : nx > 0.62 ? 2 : 1;
        const ny = c.y / H;
        if (ny < 0.32 && this.jump <= 0 && this.pose !== 'jump') { this.jump = 0.75; this.pose = 'jump'; sfx.click(); }
        this.wantDuck = ny > 0.78;
      }
      if (this.jump > 0) { this.jump -= dt; if (this.jump <= 0) this.pose = 'run'; }
      else this.pose = this.wantDuck ? 'duck' : 'run';
      this.laneX = lerp(this.laneX, this.lane, 1 - Math.pow(0.001, dt));
      // ---- Tutorial: sem obstáculos até concluir
      if (!this.tut.done) {
        const st = this.TUT[this.tut.step], nx = c ? api.cx(c) / W : -1, ny = c ? c.y / H : -1;
        this.tut.flash = Math.max(0, this.tut.flash - dt * 2);
        if (st.test(c, nx, ny)) { this.tut.hold += dt; if (this.tut.hold >= 0.5) { this.tut.hold = 0; this.tut.step++; this.tut.flash = 1; sfx.patch(this.tut.step); if (this.tut.step >= this.TUT.length) { this.tut.done = true; banner('VAI! 🏃'); sfx.level(); } } }
        else this.tut.hold = Math.max(0, this.tut.hold - dt);
        this.t = 0; return;
      }
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
      sky(ctx, W, H, { top: '#2563eb', bottom: '#bfdbfe', sunX: 0.8, sunY: 0.12 });
      // Montanhas distantes
      ctx.fillStyle = 'rgba(30,64,175,.35)'; ctx.beginPath(); ctx.moveTo(0, H * 0.3); for (let i = 0; i <= 10; i++) ctx.lineTo(W * i / 10, H * (0.2 + 0.08 * Math.abs(Math.sin(i * 2.1)))); ctx.lineTo(W, H * 0.3); ctx.fill();
      // Grama texturizada + árvores laterais em perspectiva
      ctx.fillStyle = texture(ctx, 'grass', 256, 6); ctx.fillRect(0, H * 0.3, W, H);
      for (let i = 0; i < 6; i++) { const z = ((i * 0.17 + this.dist * 0.02) % 1); const p = this.proj(0, z), q = this.proj(2, z), s = p.s * MIN * 0.35; for (const px of [p.x - s * 1.6, q.x + s * 1.6]) { ctx.fillStyle = '#92400e'; ctx.fillRect(px - s * 0.08, p.y - s, s * 0.16, s); ctx.fillStyle = '#15803d'; ctx.beginPath(); ctx.arc(px, p.y - s * 1.2, s * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(px - s * 0.2, p.y - s * 1.4, s * 0.25, 0, Math.PI * 2); ctx.fill(); } }
      // Estrada em perspectiva (asfalto) + acostamento
      ctx.fillStyle = texture(ctx, 'asphalt', 256, 8); ctx.beginPath(); ctx.moveTo(W / 2 - W * 0.03, H * 0.3); ctx.lineTo(W / 2 + W * 0.03, H * 0.3); ctx.lineTo(W / 2 + W * 0.4, H); ctx.lineTo(W / 2 - W * 0.4, H); ctx.closePath(); ctx.fill();
      const rg = ctx.createLinearGradient(0, H * 0.3, 0, H); rg.addColorStop(0, 'rgba(0,0,0,.5)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.setLineDash([MIN * 0.03, MIN * 0.03]); ctx.lineDashOffset = -this.dist * MIN * 0.02;
      for (const l of [0.5, 1.5]) { const a = this.proj(l, 1), b = this.proj(l, 0); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y + H * 0.2); ctx.stroke(); }
      ctx.setLineDash([]);
      // Objetos (longe → perto)
      const objs = [...this.objs].sort((a, b) => b.z - a.z);
      for (const o of objs) {
        if (o.got) continue; const p = this.proj(o.lane, o.z), s = p.s * MIN * 0.2;
        if (o.kind === 'coin') { groundShadow(ctx, p.x, p.y, s * 0.35, s * 0.12, 0.3); const cw = Math.abs(Math.cos(t * 4 + o.z * 10)); const cg = ctx.createLinearGradient(p.x - s * 0.35, 0, p.x + s * 0.35, 0); cg.addColorStop(0, '#fde68a'); cg.addColorStop(0.5, '#facc15'); cg.addColorStop(1, '#a16207'); ctx.fillStyle = cg; ctx.beginPath(); ctx.ellipse(p.x, p.y - s * 0.6, s * 0.35 * cw + 1, s * 0.35, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#78350f'; ctx.lineWidth = 2; ctx.stroke(); }
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
      // Rótulos permanentes das zonas de controle (discretos durante a corrida, fortes no tutorial)
      const strong = !this.tut.done, zc = strong ? '#fff' : 'rgba(255,255,255,.55)', zs = MIN * (strong ? 0.045 : 0.03);
      label(ctx, '☝ PULAR', W / 2, H * 0.27, zs, zc); label(ctx, '👇 AGACHAR', W / 2, H * 0.83, zs, zc);
      label(ctx, '◀ ESQUERDA', W * 0.19, H * 0.5, zs, zc); label(ctx, 'DIREITA ▶', W * 0.81, H * 0.5, zs, zc);
      if (!this.tut.done) {
        const st = this.TUT[this.tut.step];
        ctx.fillStyle = 'rgba(2,6,23,.75)'; ctx.beginPath(); ctx.roundRect(W * 0.15, H * 0.36, W * 0.7, H * 0.26, MIN * 0.03); ctx.fill();
        label(ctx, `TUTORIAL ${this.tut.step + 1}/${this.TUT.length}`, W / 2, H * 0.42, MIN * 0.035, '#93c5fd');
        label(ctx, st.text, W / 2, H * 0.5, MIN * 0.06, this.tut.flash > 0 ? '#4ade80' : '#fde047');
        ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(W * 0.3, H * 0.57, W * 0.4, MIN * 0.02); ctx.fillStyle = '#4ade80'; ctx.fillRect(W * 0.3, H * 0.57, W * 0.4 * clamp(this.tut.hold / 0.5, 0, 1), MIN * 0.02);
        // Destaque da zona pedida
        ctx.fillStyle = 'rgba(253,224,71,.18)';
        if (this.tut.step === 1) ctx.fillRect(0, H * 0.32, W * 0.38, H * 0.46); if (this.tut.step === 2) ctx.fillRect(W * 0.62, H * 0.32, W * 0.38, H * 0.46);
        if (this.tut.step === 3 || this.tut.step === 6) ctx.fillRect(W * 0.38, H * 0.32, W * 0.24, H * 0.46);
        if (this.tut.step === 4) ctx.fillRect(0, 0, W, H * 0.32); if (this.tut.step === 5) ctx.fillRect(0, H * 0.78, W, H * 0.22);
      }
      for (const f of this.fx) label(ctx, f.text, pp.x, y - h - s * 0.6 - (0.6 - f.life) * s, MIN * 0.05, '#facc15');
    },
    finish() { api.endMini({ title: 'FIM DA CORRIDA!', score: Math.floor(this.score), bestKey: 'bestCorredor', stats: `${Math.floor(this.dist)} m · ${this.coins} moedas · ${fmtTime(this.t)}` }); },
  };

  $('btnCorredor').addEventListener('click', () => api.startMini(runner));
  return { runner };
}
