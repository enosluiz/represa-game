// =============================================================================
// BATATINHA FRITA 1, 2, 3 — com o Robô Vigia
// -----------------------------------------------------------------------------
// Enquanto o robô está de costas cantando "Batatinha frita 1, 2, 3", o jogador
// mexe os braços como quem corre e o boneco avança. Quando ele se vira, vale
// ESTÁTUA: quem se mexer leva um ZAP do laser (cartunesco: congela, perde uma vida
// e volta um pouco). Chegou na linha, venceu. 1 ou 2 jogadores (lado esquerdo/direito).
//
// Medição de movimento (independe da distância da câmera):
//   • Por mão, o centro de 7 pontos da mão (corrigido pela proporção da câmera) é
//     suavizado e medido em "palmas" (pulso → base do dedo médio).
//   • Correr = soma dos deslocamentos (com zona morta para o tremor da detecção).
//   • Estátua = afastamento da pose em que a mão estava quando o robô terminou de virar
//     (com 0,45 s de tempo de reação). O limite é calibrado no tutorial pela trepidação
//     real daquela câmera. Mão que some e volta recomeça a referência (sem punição por
//     falha da detecção) — esconder a mão não dá vantagem, porque só se anda no verde.
// =============================================================================
import { texture, vignette, groundShadow, sky } from './art.js';

export function install(api) {
  const { sfx, tone, noise, banner, show, hide, setText, PLAYER_COLORS, rand, clamp, lerp, fmtTime, emit } = api;
  const $ = (id) => document.getElementById(id);
  function label(ctx, text, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `900 ${Math.round(size)}px Fredoka, system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  const M = {
    PTS: [0, 5, 9, 13, 17, 8, 12],  // pontos da mão usados no centro
    TAU: 0.09,                       // suavização da posição (s)
    DEAD: 0.012,                     // zona morta por quadro (palmas) contra tremor
    RUN_K: 0.02,                     // progresso por palma de movimento
    RUN_CAP: 0.085,                  // progresso máximo por segundo (≈12 s de verde no máximo)
    THR_DEFAULT: 0.4,                // limite de estátua (palmas) se não calibrar
    GRACE: 0.45,                     // tempo de reação depois que o robô vira (s)
    REACQ_MS: 400,                   // mão sumida por mais que isso: referência recomeça
    LOST_HAND_GRACE: 0.3,
    BACK: 0.12,                      // quanto volta ao levar ZAP
  };
  const CHANT = ['BA', 'TA', 'TI', 'NHA', 'FRI', 'TA', '1', '2', '3!'];
  const CHANT_HZ = [392, 440, 494, 523, 587, 659, 523, 659, 784];
  const aspect = () => { const v = $('video'); return v && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3; };

  const game = {
    name: 'Batatinha 1, 2, 3', DURATION: 90, hideCursors: true,
    start() {
      this.t = 0; this.level = 0; this.vis = { 1: false, 2: false }; this.hands = new Map(); this.thr = M.THR_DEFAULT; this.fx = [];
      this.P = { 1: this.newPlayer(), 2: this.newPlayer() };
      this.phase = 'tut'; this.ph = 0; this.phDur = 0; this.turnK = 0; this.chantI = -1; this.fast = false;
      this.tut = { step: 0, hold: 0, run: 0, maxDrift: 0, flash: 0 };
      show('hud'); setText('hudScore', '0%'); setText('hudLevelLabel', 'VIDAS'); setText('hudLevel', '❤❤❤'); setText('hudTime', fmtTime(this.DURATION)); hide('hudCombo'); hide('hudP');
      banner('Batatinha frita 1, 2, 3!');
    },
    newPlayer() { return { prog: 0, lives: 3, frozen: 0, zap: 0, done: 0, out: false, anim: 0, moving: 0, zappedThisRed: false, drift: 0 }; },
    twoP(now) { return api.activePlayers(now) === 2; },
    activeIds(now) { return this.twoP(now) ? [1, 2] : [1]; },

    // ---- Medição de movimento por mão --------------------------------------
    measure(now) {
      const asp = aspect(), two = this.twoP(now), seen = new Set(), step = { 1: 0, 2: 0 }, drift = { 1: 0, 2: 0 }, vis = { 1: false, 2: false };
      for (const c of api.cursors) {
        if (!c.lm) continue;
        seen.add(c.id); const pl = two && c.player === 2 ? 2 : 1; let h = this.hands.get(c.id);  // 1 jogador: qualquer mão é do J1
        const fresh = !h || h.lmRef !== c.lm;
        if (!fresh) { if (now - h.lastFresh < M.REACQ_MS) { vis[pl] = true; drift[pl] = Math.max(drift[pl], h.drift || 0); } continue; }
        const lm = c.lm; let x = 0, y = 0; for (const i of M.PTS) { x += lm[i].x * asp; y += lm[i].y; } x /= M.PTS.length; y /= M.PTS.length;
        const palmNow = Math.hypot((lm[0].x - lm[9].x) * asp, lm[0].y - lm[9].y) || 1e-3;
        if (!h || now - h.lastFresh > M.REACQ_MS) {
          h = { lmRef: lm, lastFresh: now, x, y, px: x, py: y, palm: palmNow, ref: null, refAt: now + M.LOST_HAND_GRACE * 1000, drift: 0 };
          this.hands.set(c.id, h); vis[pl] = true; continue;
        }
        const dts = Math.max(0.005, (now - h.lastFresh) / 1000), a = 1 - Math.exp(-dts / M.TAU);
        h.lmRef = lm; h.lastFresh = now; h.x += (x - h.x) * a; h.y += (y - h.y) * a; h.palm += (palmNow - h.palm) * 0.2;
        const d = Math.hypot(h.x - h.px, h.y - h.py) / h.palm; h.px = h.x; h.py = h.y;
        step[pl] += Math.max(0, d - M.DEAD);
        if (h.ref) h.drift = Math.hypot(h.x - h.ref.x, h.y - h.ref.y) / h.palm;
        else if (now >= h.refAt) { h.ref = { x: h.x, y: h.y }; h.drift = 0; }
        vis[pl] = true; drift[pl] = Math.max(drift[pl], h.drift);
      }
      for (const id of [...this.hands.keys()]) if (!seen.has(id) && now - this.hands.get(id).lastFresh > M.REACQ_MS) this.hands.delete(id);
      return { step, drift, vis };
    },
    /** Nova pose de referência para todas as mãos (depois do tempo de reação). */
    resetRefs(now, delay) { for (const h of this.hands.values()) { h.ref = null; h.drift = 0; h.refAt = now + delay * 1000; } },

    // ---- Ciclo do robô ------------------------------------------------------
    setPhase(p, now) {
      this.phase = p; this.ph = 0;
      if (p === 'green') {
        const k = Math.max(0.6, 1 - this.level * 0.05);
        this.fast = this.level > 0 && Math.random() < 0.25;
        this.phDur = this.fast ? rand(1.3, 1.8) : rand(2.4, 4.2) * k; this.chantI = -1;
      } else if (p === 'turn' || p === 'back') { this.phDur = 0.32; tone(p === 'turn' ? 220 : 330, 0.25, 'sawtooth', 0.06, 0, p === 'turn' ? 520 : 160); }
      else if (p === 'red') {
        this.phDur = rand(2.3, 3.8); this.resetRefs(now, M.GRACE);
        for (const n of [1, 2]) this.P[n].zappedThisRed = false;
        tone(880, 0.12, 'square', 0.06); tone(660, 0.18, 'square', 0.06, 0.12);
      }
    },
    zap(n, now) {
      const P = this.P[n]; if (P.zappedThisRed || P.done || P.out) return;
      P.zappedThisRed = true; P.zap = 0.7; P.frozen = 1.6; P.lives--; P.prog = Math.max(0, P.prog - M.BACK);
      tone(1500, 0.4, 'sawtooth', 0.08, 0, 180); noise(0.25, 0.15); api.state.shake = 0.8;
      const a = this.avatarPos(n); emit(a.x, a.y - a.size * 0.6, 26, 'fire');
      this.fx.push({ text: 'ZAP!', n, life: 1.1 });
      if (P.lives <= 0) { P.out = true; banner(this.activeIds(now).length > 1 ? `J${n} foi zapeado!` : 'ZAPEADO!'); }
      else banner(this.activeIds(now).length > 1 ? `ZAP! J${n} se mexeu` : 'ZAP! Você se mexeu');
    },

    update(dt, now) {
      const m = this.measure(now), ids = this.activeIds(now); this.vis = m.vis;
      for (const n of [1, 2]) { const P = this.P[n]; P.frozen = Math.max(0, P.frozen - dt); P.zap = Math.max(0, P.zap - dt); P.drift = m.drift[n]; P.moving = lerp(P.moving, clamp(m.step[n] / dt / 3, 0, 1), 1 - Math.pow(0.02, dt)); }
      for (const f of this.fx) f.life -= dt; this.fx = this.fx.filter((f) => f.life > 0);

      // ---- Tutorial: ensina e calibra o limite da estátua -----------------
      if (this.phase === 'tut') {
        const T = this.tut, any = m.vis[1] || m.vis[2]; T.flash = Math.max(0, T.flash - dt * 2);
        const next = () => { T.step++; T.hold = 0; T.flash = 1; sfx.patch(T.step); };
        if (T.step === 0) { if (any) { T.hold += dt; if (T.hold > 0.6) next(); } else T.hold = 0; }
        else if (T.step === 1) { T.run += m.step[1] + m.step[2]; this.animRun(dt, m); if (T.run > 4) { next(); this.turnK = 0; this.resetRefs(now, 0.6); T.maxDrift = 0; tone(220, 0.25, 'sawtooth', 0.06, 0, 520); } }
        else if (T.step === 2) {
          this.turnK = Math.min(1, this.turnK + dt / 0.32);
          const d = Math.max(m.drift[1], m.drift[2]);
          if (!any) T.hold = Math.max(0, T.hold - dt);
          else if (d > 0.75) { T.hold = 0; T.maxDrift = 0; this.resetRefs(now, 0.4); }   // mexeu muito: recomeça a contagem
          else { T.maxDrift = Math.max(T.maxDrift, d); T.hold += dt; }
          if (T.hold >= 1.6) {
            this.thr = clamp(T.maxDrift * 2.2 + 0.12, 0.3, 0.7); T.step = 3;
            banner('VALENDO!'); sfx.level(); this.t = 0; this.setPhase('back', now); this.turnK = 1;
          }
        }
        return;
      }

      this.t += dt; this.ph += dt;
      setText('hudTime', fmtTime(Math.max(0, this.DURATION - this.t)));
      // ---- Fases do robô
      if (this.phase === 'green') {
        this.turnK = 0;
        const i = Math.min(CHANT.length - 1, Math.floor(this.ph / this.phDur * CHANT.length));
        if (i !== this.chantI) { this.chantI = i; tone(CHANT_HZ[i], this.fast ? 0.09 : 0.14, 'triangle', 0.09); }
        this.animRun(dt, m);
        for (const n of ids) { const P = this.P[n]; if (P.done || P.out || P.frozen > 0) continue;
          // A detecção chega em ritmo menor que o desenho: o movimento entra num "banco" e é
          // gasto com teto por segundo (não por quadro), senão o teto cortaria quase tudo.
          P.bank = Math.min(0.06, (P.bank || 0) + m.step[n] * M.RUN_K); const take = Math.min(P.bank, M.RUN_CAP * dt);
          P.bank -= take; P.prog = Math.min(1, P.prog + take);
          if (P.prog >= 1) { P.done = this.t; banner(ids.length > 1 ? `J${n} CHEGOU!` : 'CHEGOU!'); sfx.level(); const a = this.avatarPos(n); emit(a.x, a.y - a.size, 40, 'dust'); }
        }
        if (this.ph >= this.phDur) { for (const n of [1, 2]) this.P[n].bank = 0; this.setPhase('turn', now); }
      } else if (this.phase === 'turn') { this.turnK = Math.min(1, this.ph / this.phDur); if (this.ph >= this.phDur) this.setPhase('red', now); }
      else if (this.phase === 'red') {
        this.turnK = 1;
        for (const n of ids) { const P = this.P[n]; if (P.done || P.out) continue; if (m.drift[n] > this.thr) this.zap(n, now); }
        if (this.ph >= this.phDur) { this.level++; this.setPhase('back', now); }
      } else if (this.phase === 'back') { this.turnK = 1 - Math.min(1, this.ph / this.phDur); if (this.ph >= this.phDur) this.setPhase('green', now); }

      // ---- HUD e fim
      const P1 = this.P[1]; setText('hudScore', `${Math.floor(P1.prog * 100)}%`); setText('hudLevel', '❤'.repeat(Math.max(0, P1.lives)) || '—');
      $('hudP').classList.toggle('hidden', ids.length < 2);
      if (ids.length > 1) { setText('hudP1', `${Math.floor(this.P[1].prog * 100)}%`); setText('hudP2', `${Math.floor(this.P[2].prog * 100)}%`); }
      const over = ids.every((n) => this.P[n].done || this.P[n].out);
      if (over || this.t >= this.DURATION) this.finish(ids);
    },
    animRun(dt, m) { for (const n of [1, 2]) this.P[n].anim += Math.min(m.step[n] * 6, dt * 14); },

    // ---- Desenho ------------------------------------------------------------
    geo() { const W = api.W, H = api.H; return { hy: H * 0.3, base: H * 0.94 - H * 0.3, W, H }; },
    proj(prog, lane) { const { hy, base, W } = this.geo(), s = 1 / (1 + prog * 1.8); return { x: W / 2 + lane * W * 0.26 * s, y: hy + base * s, s }; },
    avatarPos(n) { const two = this.activeIds(performance.now()).length > 1, lane = two ? (n === 1 ? -1 : 1) : 0, p = this.proj(this.P[n].prog, lane); return { x: p.x, y: p.y, size: api.MIN * 0.24 * p.s }; },

    render(ctx, t, now) {
      const W = api.W, H = api.H, MIN = api.MIN, { hy } = this.geo();
      const red = this.phase === 'red' || (this.phase === 'tut' && this.tut.step === 2);
      sky(ctx, W, H, { top: red ? '#7f1d1d' : '#0ea5e9', bottom: red ? '#fca5a5' : '#e0f2fe', sunX: 0.15, sunY: 0.1 });
      // Morros
      ctx.fillStyle = red ? 'rgba(127,29,29,.45)' : 'rgba(21,128,61,.55)'; ctx.beginPath(); ctx.moveTo(0, hy);
      for (let i = 0; i <= 12; i++) ctx.lineTo(W * i / 12, hy - H * (0.03 + 0.05 * Math.abs(Math.sin(i * 1.7)))); ctx.lineTo(W, hy); ctx.fill();
      // Campo
      ctx.fillStyle = texture(ctx, 'grass', 256, 3); ctx.fillRect(0, hy, W, H - hy);
      const g0 = this.proj(0, 0), g1 = this.proj(1.25, 0);
      // Pista de terra em perspectiva
      const half = (s) => W * 0.42 * s;
      ctx.fillStyle = texture(ctx, 'concrete', 256, 5); ctx.beginPath();
      ctx.moveTo(W / 2 - half(g1.s), g1.y); ctx.lineTo(W / 2 + half(g1.s), g1.y); ctx.lineTo(W / 2 + half(1.25), H); ctx.lineTo(W / 2 - half(1.25), H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(161,98,7,.5)'; ctx.fill();
      // Marcas de distância
      for (const q of [0.25, 0.5, 0.75]) { const p = this.proj(q, 0); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(1, 4 * p.s); ctx.beginPath(); ctx.moveTo(W / 2 - half(p.s), p.y); ctx.lineTo(W / 2 + half(p.s), p.y); ctx.stroke(); label(ctx, `${q * 100}%`, W / 2 - half(p.s) - MIN * 0.04, p.y, MIN * 0.03 * Math.max(0.6, p.s * 1.5), 'rgba(255,255,255,.75)'); }
      // Ipê amarelo e Robô Vigia atrás da linha
      this.drawTree(ctx, W * 0.2, g1.y + MIN * 0.01, MIN * 0.42);
      const R = this.robot(ctx, t, W / 2, g1.y, Math.max(MIN * 0.3, H * 0.2));
      // Linha de chegada quadriculada + bandeirinhas
      const f = this.proj(1, 0), fw = half(f.s), cells = 16, ch = MIN * 0.022;
      for (let r = 0; r < 2; r++) for (let i = 0; i < cells; i++) { ctx.fillStyle = (i + r) % 2 ? '#111827' : '#f8fafc'; ctx.fillRect(W / 2 - fw + (2 * fw / cells) * i, f.y - ch + r * ch, 2 * fw / cells + 0.5, ch); }
      for (const sgn of [-1, 1]) {
        const px = W / 2 + sgn * (fw + MIN * 0.02), top = f.y - MIN * 0.17, wave = Math.sin(t * 5 + sgn) * MIN * 0.006;
        ctx.strokeStyle = '#334155'; ctx.lineWidth = MIN * 0.007; ctx.beginPath(); ctx.moveTo(px, f.y + ch); ctx.lineTo(px, top); ctx.stroke();
        for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) { ctx.fillStyle = (i + r) % 2 ? '#111827' : '#f8fafc'; ctx.fillRect(px + sgn * (i * MIN * 0.018) - (sgn < 0 ? MIN * 0.018 : 0), top + r * MIN * 0.016 + wave * (i / 4), MIN * 0.018, MIN * 0.016); }
      }
      label(ctx, 'CHEGADA', W / 2, f.y + MIN * 0.035, MIN * 0.032, '#fde047');
      // Jogadores (o mais longe primeiro)
      const ids = this.phase === 'tut' ? [1] : this.activeIds(now);
      const order = [...ids].sort((a, b) => this.P[b].prog - this.P[a].prog);
      for (const n of order) this.drawAvatar(ctx, t, n, R);
      vignette(ctx, W, H, red ? 0.7 : 0.45);
      this.drawUI(ctx, t, now, ids, red);
    },

    drawTree(ctx, x, y, s) {
      ctx.fillStyle = '#78350f'; ctx.beginPath(); ctx.moveTo(x - s * 0.04, y); ctx.lineTo(x - s * 0.02, y - s * 0.55); ctx.lineTo(x + s * 0.02, y - s * 0.55); ctx.lineTo(x + s * 0.04, y); ctx.fill();
      for (const [dx, dy, r, c] of [[-0.18, -0.6, 0.2, '#ca8a04'], [0.16, -0.62, 0.2, '#eab308'], [0, -0.78, 0.24, '#facc15'], [-0.08, -0.62, 0.18, '#fde047'], [0.08, -0.9, 0.14, '#fef08a']]) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
      }
    },

    /** Robô Vigia (personagem original): de costas = painel e antena verde; de frente = visor com olho vermelho. */
    robot(ctx, t, x, feetY, h) {
      const k = this.turnK, facing = k > 0.5, sx = Math.max(0.06, Math.abs(Math.cos(k * Math.PI)));
      const bob = Math.sin(t * 3) * h * 0.008, y = feetY + bob;
      groundShadow(ctx, x, feetY, h * 0.32, h * 0.06, 0.35);
      ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
      const body = ctx.createLinearGradient(-h * 0.25, 0, h * 0.25, 0); body.addColorStop(0, '#94a3b8'); body.addColorStop(0.45, '#f8fafc'); body.addColorStop(1, '#64748b');
      // Pernas e pés
      ctx.fillStyle = '#475569'; ctx.beginPath(); ctx.roundRect(-h * 0.14, -h * 0.2, h * 0.09, h * 0.2, h * 0.03); ctx.roundRect(h * 0.05, -h * 0.2, h * 0.09, h * 0.2, h * 0.03); ctx.fill();
      ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.roundRect(-h * 0.17, -h * 0.04, h * 0.14, h * 0.05, h * 0.02); ctx.roundRect(h * 0.03, -h * 0.04, h * 0.14, h * 0.05, h * 0.02); ctx.fill();
      // Braços
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = h * 0.06; ctx.lineCap = 'round';
      const sw = this.phase === 'green' ? Math.sin(t * 6) * 0.1 : 0;
      ctx.beginPath(); ctx.moveTo(-h * 0.24, -h * 0.5); ctx.lineTo(-h * (0.3 + sw), -h * 0.28); ctx.moveTo(h * 0.24, -h * 0.5); ctx.lineTo(h * (0.3 - sw), -h * 0.28); ctx.stroke();
      // Tronco
      ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(-h * 0.24, -h * 0.58, h * 0.48, h * 0.4, h * 0.08); ctx.fill();
      ctx.strokeStyle = 'rgba(15,23,42,.35)'; ctx.lineWidth = h * 0.008; ctx.stroke();
      if (facing) { // peito: luzes
        for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#f87171', '#fbbf24', '#ef4444'][i]; ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(t * 5 + i)); ctx.beginPath(); ctx.arc(-h * 0.08 + i * h * 0.08, -h * 0.42, h * 0.025, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      } else { // costas: grade de alto-falante (é ele que canta)
        ctx.strokeStyle = 'rgba(15,23,42,.45)'; ctx.lineWidth = h * 0.012;
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-h * 0.12, -h * 0.5 + i * h * 0.05); ctx.lineTo(h * 0.12, -h * 0.5 + i * h * 0.05); ctx.stroke(); }
      }
      // Pescoço e cabeça
      ctx.fillStyle = '#475569'; ctx.fillRect(-h * 0.05, -h * 0.64, h * 0.1, h * 0.07);
      ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(-h * 0.21, -h * 0.9, h * 0.42, h * 0.28, h * 0.1); ctx.fill(); ctx.strokeStyle = 'rgba(15,23,42,.35)'; ctx.lineWidth = h * 0.008; ctx.stroke();
      // Antena
      ctx.strokeStyle = '#334155'; ctx.lineWidth = h * 0.015; ctx.beginPath(); ctx.moveTo(0, -h * 0.9); ctx.lineTo(0, -h * 0.99); ctx.stroke();
      const lamp = facing ? '#ef4444' : '#22c55e';
      ctx.shadowColor = lamp; ctx.shadowBlur = h * 0.08; ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(0, -h * 1.01, h * 0.03, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      let eye = null;
      if (facing) {
        ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.roundRect(-h * 0.17, -h * 0.84, h * 0.34, h * 0.14, h * 0.06); ctx.fill();
        const scan = this.phase === 'red' ? Math.sin(t * 4) * h * 0.08 : 0;
        ctx.shadowColor = '#ef4444'; ctx.shadowBlur = h * 0.1; ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.ellipse(scan, -h * 0.77, h * 0.05, h * 0.035, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(scan - h * 0.015, -h * 0.785, h * 0.012, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        eye = { x: x + scan * sx, y: y - h * 0.77 };
      } else {
        ctx.fillStyle = 'rgba(15,23,42,.25)'; ctx.beginPath(); ctx.roundRect(-h * 0.12, -h * 0.82, h * 0.24, h * 0.1, h * 0.04); ctx.fill();
      }
      ctx.restore();
      // Feixe de varredura (só olhando)
      if (eye && this.phase === 'red') {
        const g = ctx.createRadialGradient(eye.x, eye.y, 0, eye.x, eye.y, api.H * 0.8);
        g.addColorStop(0, 'rgba(248,113,113,.28)'); g.addColorStop(1, 'rgba(248,113,113,0)');
        const sweep = Math.sin(t * 1.6) * api.W * 0.35;
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(eye.x, eye.y); ctx.lineTo(api.W / 2 + sweep - api.W * 0.18, api.H); ctx.lineTo(api.W / 2 + sweep + api.W * 0.18, api.H); ctx.closePath(); ctx.fill();
      }
      return { eye: eye || { x, y: y - h * 0.77 } };
    },

    drawAvatar(ctx, t, n, R) {
      const P = this.P[n], a = this.avatarPos(n), s = a.size, col = P.out ? '#94a3b8' : PLAYER_COLORS[n];
      const runPh = P.anim, sw = Math.sin(runPh) * (P.frozen > 0 || this.phase === 'red' ? 0.1 : 1);
      groundShadow(ctx, a.x, a.y, s * 0.32, s * 0.08, 0.35);
      const bodyTop = a.y - s * 0.9;
      ctx.lineCap = 'round';
      // Pernas
      ctx.strokeStyle = '#1e293b'; ctx.lineWidth = s * 0.11;
      ctx.beginPath(); ctx.moveTo(a.x - s * 0.08, a.y - s * 0.35); ctx.lineTo(a.x - s * 0.1 + sw * s * 0.1, a.y - s * 0.02); ctx.moveTo(a.x + s * 0.08, a.y - s * 0.35); ctx.lineTo(a.x + s * 0.1 - sw * s * 0.1, a.y - s * 0.02); ctx.stroke();
      // Braços (balançam com o movimento real)
      ctx.strokeStyle = col; ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.moveTo(a.x - s * 0.18, bodyTop + s * 0.18); ctx.lineTo(a.x - s * 0.32, bodyTop + s * 0.3 - sw * s * 0.2); ctx.moveTo(a.x + s * 0.18, bodyTop + s * 0.18); ctx.lineTo(a.x + s * 0.32, bodyTop + s * 0.3 + sw * s * 0.2); ctx.stroke();
      // Corpo + cabeça
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(a.x - s * 0.2, bodyTop + s * 0.1, s * 0.4, s * 0.48, s * 0.14); ctx.fill();
      ctx.fillStyle = P.out ? '#cbd5e1' : '#fcd9b6'; ctx.beginPath(); ctx.arc(a.x, bodyTop - s * 0.05, s * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f172a'; for (const ex of [-0.06, 0.06]) { ctx.beginPath(); ctx.arc(a.x + ex * s, bodyTop - s * 0.07, s * 0.022, 0, Math.PI * 2); ctx.fill(); }
      // Congelado pelo ZAP (efeito de gelo, sem nada gráfico)
      if (P.frozen > 0) {
        ctx.fillStyle = `rgba(125,211,252,${0.35 + 0.25 * Math.sin(t * 20)})`; ctx.beginPath(); ctx.roundRect(a.x - s * 0.38, bodyTop - s * 0.26, s * 0.76, s * 1.18, s * 0.12); ctx.fill();
        ctx.strokeStyle = 'rgba(224,242,254,.9)'; ctx.lineWidth = Math.max(1, s * 0.02); ctx.stroke();
      }
      // Laser do olho do robô até o jogador
      if (P.zap > 0) {
        const k = P.zap / 0.7; ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.strokeStyle = '#fecaca'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = api.MIN * 0.04; ctx.lineWidth = api.MIN * 0.012 * (0.5 + k);
        ctx.beginPath(); ctx.moveTo(R.eye.x, R.eye.y); ctx.lineTo(a.x, bodyTop + s * 0.3); ctx.stroke();
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = api.MIN * 0.024 * k; ctx.globalAlpha = 0.4 * k; ctx.stroke(); ctx.restore();
      }
      // Rótulo do jogador e vidas
      const two = this.activeIds(performance.now()).length > 1;
      const tag = P.done ? 'CHEGOU!' : P.out ? 'FORA' : `${two ? `J${n} ` : ''}${'❤'.repeat(P.lives)}`;
      label(ctx, tag, a.x, bodyTop - s * 0.42, Math.max(api.MIN * 0.03, s * 0.16), P.done ? '#4ade80' : col);
      for (const f of this.fx) if (f.n === n) label(ctx, f.text, a.x, bodyTop - s * 0.75 - (1.1 - f.life) * s * 0.4, api.MIN * 0.07, '#fde047');
      // Medidor de estátua (só no vermelho): quão perto do limite
      if ((this.phase === 'red' || (this.phase === 'tut' && this.tut.step === 2)) && !P.done && !P.out) {
        const k = clamp(P.drift / this.thr, 0, 1), bw = Math.max(api.MIN * 0.12, s * 0.7), bx = a.x - bw / 2, by = a.y + api.MIN * 0.02;
        ctx.fillStyle = 'rgba(2,6,23,.6)'; ctx.fillRect(bx, by, bw, api.MIN * 0.018);
        ctx.fillStyle = k < 0.5 ? '#4ade80' : k < 0.8 ? '#facc15' : '#ef4444'; ctx.fillRect(bx, by, bw * k, api.MIN * 0.018);
      }
    },

    drawUI(ctx, t, now, ids, red) {
      const W = api.W, H = api.H, MIN = api.MIN;
      ids.forEach((n, i) => { const ok = this.vis[n], txt = ok ? `${ids.length > 1 ? `J${n}: ` : ''}mão vista` : `${ids.length > 1 ? `J${n}: ` : ''}mostre a mão`;
        label(ctx, txt, i === 0 ? MIN * 0.03 : W - MIN * 0.03, H * 0.9, MIN * 0.032, ok ? '#86efac' : '#fca5a5', i === 0 ? 'left' : 'right'); });
      if (this.phase === 'tut') {
        const T = this.tut, steps = ['Mostre as mãos para a câmera', 'Mexa os braços como se estivesse CORRENDO', 'O robô virou! Fique PARADO como estátua'];
        const st = Math.min(T.step, 2);
        // Texto no alto (como o canto), para não esconder o robô nem o boneco
        label(ctx, `TUTORIAL ${st + 1}/3`, W / 2, H * 0.12, MIN * 0.034, '#93c5fd');
        label(ctx, steps[st], W / 2, H * 0.16, Math.min(MIN * 0.05, W * 0.92 / (steps[st].length * 0.56)), T.flash > 0 ? '#4ade80' : '#fde047');
        const prog = st === 0 ? T.hold / 0.6 : st === 1 ? T.run / 4 : T.hold / 1.6, bw = W * 0.4;
        ctx.fillStyle = 'rgba(2,6,23,.55)'; ctx.fillRect(W / 2 - bw / 2, H * 0.2, bw, MIN * 0.018); ctx.fillStyle = '#4ade80'; ctx.fillRect(W / 2 - bw / 2, H * 0.2, bw * clamp(prog, 0, 1), MIN * 0.018);
        return;
      }
      if (this.phase === 'green' || this.phase === 'back') {
        // Canto do robô: sílabas acendem
        const n = this.phase === 'green' ? this.chantI : -1, size = MIN * 0.06, words = ['BATATINHA', 'FRITA', '1, 2, 3!'];
        const lit = n < 0 ? 0 : n < 4 ? 1 : n < 6 ? 2 : 3;
        const total = words.map((w) => w.length).reduce((a, b) => a + b, 0), cw = size * 0.62; let x = W / 2 - (total * cw + size) / 2;
        words.forEach((w, i) => { const wx = x + (w.length * cw) / 2; label(ctx, w, wx, H * 0.15, size, i < lit ? '#fde047' : 'rgba(255,255,255,.45)'); x += w.length * cw + size * 0.5; });
        label(ctx, 'MEXA OS BRAÇOS PARA CORRER!', W / 2, H * 0.215, MIN * 0.04, '#bbf7d0');
      } else {
        const blink = Math.floor(t * 4) % 2 === 0;
        label(ctx, 'ESTÁTUA!', W / 2, H * 0.15, MIN * 0.08, blink ? '#fecaca' : '#ef4444');
        label(ctx, 'Não se mexa até o robô virar de costas', W / 2, H * 0.215, MIN * 0.035, '#fff');
      }
    },

    finish(ids) {
      if (api.state.phase !== 'mini') return;
      const sc = (n) => { const P = this.P[n]; return P.done ? 1000 + Math.round(Math.max(0, this.DURATION - P.done) * 15) + P.lives * 150 : Math.round(P.prog * 700); };
      const desc = (n) => { const P = this.P[n]; return P.done ? `chegou em ${fmtTime(P.done)}` : P.out ? `zapeado em ${Math.floor(P.prog * 100)}%` : `${Math.floor(P.prog * 100)}% do caminho`; };
      if (ids.length > 1) {
        const s1 = sc(1), s2 = sc(2), w = s1 === s2 ? 0 : s1 > s2 ? 1 : 2;
        api.endMini({ title: w ? `JOGADOR ${w} VENCEU!` : 'EMPATE!', score: Math.max(s1, s2), bestKey: 'bestBatatinha', stats: `J1 ${desc(1)} · J2 ${desc(2)}` });
      } else {
        const P = this.P[1];
        api.endMini({ title: P.done ? (P.lives === 3 ? 'CHEGOU SEM NENHUM ZAP!' : 'VOCÊ CHEGOU!') : P.out ? 'ZAPEADO!' : 'O TEMPO ACABOU!', score: sc(1), bestKey: 'bestBatatinha', stats: `${desc(1)} · ${P.lives} vida(s) · ${this.level} rodadas do robô` });
      }
    },
  };

  $('btnBatatinha').addEventListener('click', () => api.startMini(game));
  return { batatinha: game };
}
