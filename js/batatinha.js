// =============================================================================
// BATATINHA FRITA 1, 2, 3 — com o Robô Vigia
// -----------------------------------------------------------------------------
// Regras:
//   • Cada jogador joga com as DUAS mãos (2 jogadores = 4 mãos; o detector passa a
//     procurar 4 mãos só neste jogo). Em 2 jogadores: metade esquerda = J1, direita = J2.
//   • Robô de costas cantando: o jogador "corre" subindo e descendo os braços. Cada
//     PASSO só conta com os braços ALTERNADOS (como numa corrida) e o movimento COMPLETO (da cintura até o alto, ou
//     o contrário) — a amplitude é medida na calibração do tutorial. Meio movimento
//     não anda e aparece "movimento incompleto".
//   • Robô virou: pare com as MÃOS PARA CIMA e fique imóvel. Mão abaixada ou qualquer
//     movimento depois do tempo de reação = ZAP (cartunesco) e o jogador volta para
//     a LINHA DE PARTIDA.
// Justiça da detecção:
//   • Altura das mãos é comparada com o "alto" e a "cintura" que o próprio jogador
//     mostrou no tutorial (vale perto ou longe da câmera).
//   • Imobilidade é medida em "palmas" e o limite é calibrado pela trepidação real.
//   • Mão que a câmera perde não é punida (só se anda com o robô de costas, então
//     esconder a mão não dá vantagem).
// =============================================================================
import { texture, vignette, groundShadow, sky } from './art.js';
import { t as tr } from './i18n.js';
import { track } from './stats.js';

export function install(api) {
  const { sfx, tone, noise, banner, show, hide, setText, PLAYER_COLORS, rand, clamp, lerp, fmtTime, emit } = api;
  const $ = (id) => document.getElementById(id);
  function label(ctx, text, x, y, size, color = '#fff', align = 'center') {
    ctx.font = `900 ${Math.round(size)}px Fredoka, system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  const M = {
    PTS: [0, 5, 9, 13, 17, 8, 12],  // pontos da mão usados no centro
    TAU: 0.07,                       // suavização da posição (s)
    STEPS: 26,                       // passos completos para cruzar a pista
    STEP_GAP: 0.16,                  // intervalo mínimo entre passos do mesmo jogador (s)
    FULL: 0.6,                       // fração da amplitude calibrada que conta como movimento completo
    ALT: 0.35,                       // braços alternados: o outro braço precisa estar ≥35% da amplitude do lado oposto
    HYS: 0.035,                      // histerese para reconhecer a virada do braço (altura da imagem)
    UP_FRAC: 0.4,                    // "mão no alto" = acima de alto + 40% da amplitude
    THR_DEFAULT: 0.45,               // limite de imobilidade (palmas) se não calibrar
    GRACE: 0.9,                      // tempo para levantar as mãos depois que o robô vira (s)
    REACQ_MS: 400,                   // mão sumida por mais que isso: referência recomeça
    LOST_HAND_GRACE: 0.3,
    CARD: 4.6,                       // duração de cada cartão do explicativo (s)
  };
  const CHANT = ['BA', 'TA', 'TI', 'NHA', 'FRI', 'TA', '1', '2', '3!'];
  const CHANT_HZ = [392, 440, 494, 523, 587, 659, 523, 659, 784];
  const CAL_KEY = 'represa.batatinhaCal';
  const loadCal = () => { try { const v = JSON.parse(localStorage.getItem(CAL_KEY) || 'null'); return v && v.low - v.up >= 0.15 ? v : null; } catch { return null; } };
  const saveCal = (v) => { try { localStorage.setItem(CAL_KEY, JSON.stringify(v)); } catch { /* sem storage */ } };
  const aspect = () => { const v = $('video'); return v && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3; };

  const game = {
    name: 'Batatinha 1, 2, 3', DURATION: 90, numHands: 4,
    // Cursores aparecem só no explicativo/tutorial (para achar o botão "Pular"); na corrida
    // ficam ocultos para o tremor do cursor não parecer "movimento" na estátua.
    get hideCursors() { return this.phase !== 'intro' && this.phase !== 'tut'; },
    start() {
      this.t = 0; this.level = 0; this.tracks = []; this.mLast = null; this.thr = M.THR_DEFAULT; this.fx = []; this.seen3 = -1e9; this.c3 = 0; this.lastDet = null;
      this.P = { 1: this.newPlayer(), 2: this.newPlayer() };
      this.phase = 'intro'; this.introT = 0; this.ph = 0; this.phDur = 0; this.turnK = 0; this.chantI = -1; this.fast = false;
      this.tut = { step: 0, hold: 0, flash: 0, maxDrift: 0, msg: '', msgT: 0 };
      this.m = { vis: { 1: 0, 2: 0 }, up: { 1: 0, 2: 0 }, drift: { 1: 0, 2: 0 }, arms: { 1: [], 2: [] } };
      show('hud'); setText('hudScore', '0%'); setText('hudLevelLabel', 'ZAPS'); setText('hudLevel', '0'); setText('hudTime', fmtTime(this.DURATION)); hide('hudCombo'); hide('hudP');
      $('btnSkipTut').classList.remove('hidden');
    },
    newPlayer() { return { prog: 0, target: 0, steps: 0, zaps: 0, frozen: 0, zap: 0, done: 0, walk: 0, lastStep: 0, zappedThisRed: false, cal: { up: 0.3, low: 0.7, ok: false }, tc: { sum: 0, n: 0, hold: 0, strokes: 0 }, warn: '', warnT: 0 }; },

    // ---- Quantos jogadores: "2" nas opções, ou (auto) 3+ mãos vistas nos últimos 4 s.
    // Duas mãos de uma pessoa abrem para os dois lados da tela: isso NÃO conta como 2 jogadores.
    ids(now) {
      const pl = api.settings.players;
      return pl === '2' || (pl !== '1' && now - this.seen3 < 4000) ? [1, 2] : [1];
    },
    span(n) { const c = this.P[n].cal; return Math.max(0.12, c.low - c.up); },
    upLine(n) { const c = this.P[n].cal; return c.up + M.UP_FRAC * this.span(n); },

    // ---- Medição por mão -----------------------------------------------------
    measure(now, dt) {
      // Rastreio PRÓPRIO das mãos (não usa a identidade dos cursores): braço balançando
      // rápido salta mais que o raio de pareamento dos cursores, sobretudo no celular em pé,
      // e isso zeraria o movimento a cada salto. Aqui o pareamento é pelo vizinho mais
      // próximo na imagem, com raio largo, e só quando chega uma detecção nova.
      const cur = api.state.lastLandmarks || [];
      if (cur === this.lastDet && this.mLast) return { ...this.mLast, strokes: { 1: 0, 2: 0 }, partial: { 1: 0, 2: 0 }, together: null, noPair: null };
      this.lastDet = cur;
      this.c3 = cur.length >= 3 ? Math.min(30, this.c3 + 1) : Math.max(0, this.c3 - 0.25); if (this.c3 >= 6) this.seen3 = now;
      const asp = aspect(), ids = this.ids(now), two = ids.length > 1;
      const m = { vis: { 1: 0, 2: 0 }, up: { 1: 0, 2: 0 }, drift: { 1: 0, 2: 0 }, strokes: { 1: 0, 2: 0 }, partial: { 1: 0, 2: 0 }, arms: { 1: [], 2: [] }, ys: { 1: [], 2: [] }, still: { 1: true, 2: true } };
      const obs = cur.map((lm) => {
        let x = 0, y = 0; for (const i of M.PTS) { x += lm[i].x * asp; y += lm[i].y; } x /= M.PTS.length; y /= M.PTS.length;
        return { x, y, palm: Math.hypot((lm[0].x - lm[9].x) * asp, lm[0].y - lm[9].y) || 1e-3, sx: api.toScreen({ x: x / asp, y }).x };
      });
      // Pareamento guloso por distância (raio largo: 0,35 da altura da imagem)
      const pairs = []; obs.forEach((o, i) => this.tracks.forEach((h) => pairs.push({ i, h, d: Math.hypot(o.x - h.rx, o.y - h.ry) })));
      pairs.sort((a, b) => a.d - b.d);
      const usedO = new Set(), usedH = new Set();
      for (const { i, h, d } of pairs) {
        if (d > 0.35 || usedO.has(i) || usedH.has(h)) continue;
        usedO.add(i); usedH.add(h); this.updTrack(h, obs[i], now);
      }
      obs.forEach((o, i) => { if (usedO.has(i)) return; const h = { rx: o.x, ry: o.y, x: o.x, y: o.y, palm: o.palm, lastFresh: now, ref: null, refAt: now + M.LOST_HAND_GRACE * 1000, drift: 0, dir: 0, from: o.y, ext: o.y, vy: 0, sx: o.sx }; this.tracks.push(h); usedH.add(h); });
      this.tracks = this.tracks.filter((h) => now - h.lastFresh <= M.REACQ_MS);
      const mine = { 1: [], 2: [] };
      for (const h of this.tracks) {
        if (!usedH.has(h)) continue;                       // só mãos presentes NESTA detecção
        const pl = two && h.sx >= api.W / 2 ? 2 : 1;       // em 2 jogadores: metade esquerda = J1
        mine[pl].push(h);
        m.vis[pl]++; m.ys[pl].push(h.y); m.drift[pl] = Math.max(m.drift[pl], h.drift || 0);
        if (h.vy > 0.12) m.still[pl] = false;
        if (h.y <= this.upLine(pl)) m.up[pl]++;
        m.arms[pl].push({ sx: h.sx, a: clamp((this.P[pl].cal.low - h.y) / this.span(pl), 0, 1.15) });
      }
      // Passo = braço completa o movimento E o outro braço está do lado OPOSTO (corrida:
      // um no alto, outro embaixo). Braços subindo e descendo juntos não andam.
      for (const pl of [1, 2]) for (const h of mine[pl]) {
        if (!h.stroke) continue;
        const travel = h.stroke, span = this.span(pl); h.stroke = 0;
        if (travel < M.FULL * span) { if (travel >= 0.3 * span) m.partial[pl]++; continue; }
        const other = mine[pl].filter((o) => o !== h).sort((a, b) => Math.abs(a.sx - h.sx) - Math.abs(b.sx - h.sx)).pop();
        if (!other) { m.noPair = m.noPair || {}; m.noPair[pl] = 1; continue; }
        // h.sdir < 0: terminou SUBINDO (está no alto) → o outro precisa estar mais baixo; e vice-versa
        const gap = (other.y - h.stroke_ext) * -h.sdir;    // ponto extremo que este braço alcançou
        if (gap >= M.ALT * span) m.strokes[pl]++; else { m.together = m.together || {}; m.together[pl] = 1; }
      }
      for (const n of [1, 2]) m.arms[n].sort((a, b) => a.sx - b.sx);
      this.mLast = m; return m;
    },
    updTrack(h, o, now) {
      const dts = Math.max(0.005, (now - h.lastFresh) / 1000), a = 1 - Math.exp(-dts / M.TAU), py = h.y;
      h.rx = o.x; h.ry = o.y; h.sx = o.sx; h.lastFresh = now;
      h.x += (o.x - h.x) * a; h.y += (o.y - h.y) * a; h.palm += (o.palm - h.palm) * 0.15;
      h.vy = lerp(h.vy, Math.abs(h.y - py) / dts, 0.3);
      if (h.ref) h.drift = Math.hypot(h.x - h.ref.x, h.y - h.ref.y) / h.palm;
      else if (now >= h.refAt) { h.ref = { x: h.x, y: h.y }; h.drift = 0; }
      h.stroke = this.stroke(h);
    },
    /** Virada do braço: devolve o percurso vertical do movimento que acabou (0 se ainda não virou). */
    stroke(h) {
      if (h.dir === 0) { if (Math.abs(h.y - h.from) > M.HYS) { h.dir = Math.sign(h.y - h.from); h.ext = h.y; } return 0; }
      if ((h.y - h.ext) * h.dir > 0) { h.ext = h.y; return 0; }           // continua na mesma direção
      if (Math.abs(h.y - h.ext) <= M.HYS) return 0;
      const travel = Math.abs(h.ext - h.from); h.sdir = Math.sign(h.ext - h.from); h.stroke_ext = h.ext; h.from = h.ext; h.ext = h.y; h.dir = -h.dir; return travel;
    },
    resetRefs(now, delay) { for (const h of this.tracks) { h.ref = null; h.drift = 0; h.refAt = now + delay * 1000; } },
    warn(n, text) { const P = this.P[n]; if (P.warnT <= 0 || P.warn !== text) { P.warn = text; P.warnT = 1.1; } },

    // ---- Ciclo do robô ------------------------------------------------------
    /** Pular explicativo + tutorial: usa o último ajuste salvo neste aparelho (ou o padrão). */
    skip() {
      if (this.phase !== 'intro' && this.phase !== 'tut') return;
      track('batatinha/pulou-tutorial');
      const sv = loadCal();
      for (const n of [1, 2]) Object.assign(this.P[n].cal, sv ? { up: sv.up, low: sv.low, ok: true } : { up: 0.3, low: 0.7, ok: false });
      this.thr = sv ? sv.thr : M.THR_DEFAULT;
      $('btnSkipTut').classList.add('hidden'); this.tut.step = 5;
      banner(sv ? 'VALENDO!' : 'VALENDO! (ajuste padrão)'); sfx.level();
      this.t = 0; this.turnK = 1; this.setPhase('back', performance.now());
    },
    isRed() { return this.phase === 'red' || this.phase === 'turn' || (this.phase === 'tut' && this.tut.step === 4); },
    setPhase(p, now) {
      this.phase = p; this.ph = 0;
      if (p === 'green') {
        const k = Math.max(0.6, 1 - this.level * 0.05);
        this.fast = this.level > 0 && Math.random() < 0.25;
        this.phDur = this.fast ? rand(1.4, 1.9) : rand(2.6, 4.4) * k; this.chantI = -1;
      } else if (p === 'turn' || p === 'back') { this.phDur = 0.32; tone(p === 'turn' ? 220 : 330, 0.25, 'sawtooth', 0.06, 0, p === 'turn' ? 520 : 160); }
      else if (p === 'red') {
        this.phDur = rand(2.6, 4.0) + M.GRACE * 0.5; this.resetRefs(now, M.GRACE);
        for (const n of [1, 2]) this.P[n].zappedThisRed = false;
        tone(880, 0.12, 'square', 0.06); tone(660, 0.18, 'square', 0.06, 0.12);
      }
    },
    zap(n, now, why) {
      const P = this.P[n]; if (P.zappedThisRed || P.done) return;
      P.zappedThisRed = true; P.zap = 0.7; P.frozen = 1.6; P.zaps++;
      tone(1500, 0.4, 'sawtooth', 0.08, 0, 180); noise(0.25, 0.15); api.state.shake = 0.8;
      const a = this.avatarPos(n); emit(a.x, a.y - a.size * 0.6, 26, 'fire');
      this.fx.push({ text: 'ZAP!', n, life: 1.1 });
      P.backTo = true;   // volta para a largada depois do congelamento (o laser aparece onde ele estava)
      P.warn = `${why} · volta pra largada`; P.warnT = 2.4;   // aviso no próprio boneco (o banner central cobre a tela no celular)
    },

    update(dt, now) {
      const m = this.measure(now, dt), ids = this.ids(now); this.m = m;
      for (const n of [1, 2]) {
        const P = this.P[n]; P.frozen = Math.max(0, P.frozen - dt); P.zap = Math.max(0, P.zap - dt); P.warnT = Math.max(0, P.warnT - dt);
        if (P.backTo && P.frozen < 0.9) { P.backTo = false; P.target = 0; P.steps = 0; }
        P.prog = lerp(P.prog, P.target, 1 - Math.pow(P.target < P.prog - 0.05 ? 0.02 : 0.001, dt));  // volta rápido; anda suave
        P.walk = Math.max(0, P.walk - dt);
      }
      for (const f of this.fx) f.life -= dt; this.fx = this.fx.filter((f) => f.life > 0);

      // ---- Tutorial: ensina e calibra (altura do alto/cintura e trepidação) --
      if (this.phase === 'intro') {             // explicativo animado (3 cartões), depois o tutorial
        this.introT += dt; const card = Math.floor(this.introT / M.CARD);
        if (card !== this.introCard) { this.introCard = card; if (card < 3) sfx.tick(); }
        if (this.introT >= M.CARD * 3) { this.phase = 'tut'; banner('Agora você: tutorial'); }
        return;
      }
      if (this.phase === 'tut') return this.tutorial(dt, now, m, ids);

      this.t += dt; this.ph += dt;
      setText('hudTime', fmtTime(Math.max(0, this.DURATION - this.t)));
      if (this.phase === 'green') {
        this.turnK = 0;
        const i = Math.min(CHANT.length - 1, Math.floor(this.ph / this.phDur * CHANT.length));
        if (i !== this.chantI) { this.chantI = i; tone(CHANT_HZ[i], this.fast ? 0.09 : 0.14, 'triangle', 0.09); }
        for (const n of ids) {
          const P = this.P[n]; if (P.done || P.frozen > 0) continue;
          if (m.vis[n] < 2) this.warn(n, 'mostre as DUAS mãos');
          if (m.partial[n]) this.warn(n, 'movimento incompleto!');
          if (m.together?.[n]) this.warn(n, 'alterne os braços!');
          for (let k = 0; k < m.strokes[n]; k++) {
            if (this.t - P.lastStep < M.STEP_GAP) continue;
            P.lastStep = this.t; P.steps++; P.target = Math.min(1, P.steps / M.STEPS); P.walk = 0.35;
            tone(500 + (P.steps % 4) * 60, 0.05, 'square', 0.04);
            if (P.target >= 1 && !P.done) { P.done = this.t; banner(ids.length > 1 ? `J${n} CHEGOU!` : 'CHEGOU!'); sfx.level(); const a = this.avatarPos(n); emit(a.x, a.y - a.size, 40, 'dust'); }
          }
        }
        if (this.ph >= this.phDur) this.setPhase('turn', now);
      } else if (this.phase === 'turn') { this.turnK = Math.min(1, this.ph / this.phDur); if (this.ph >= this.phDur) this.setPhase('red', now); }
      else if (this.phase === 'red') {
        this.turnK = 1;
        if (this.ph >= M.GRACE) for (const n of ids) {
          const P = this.P[n]; if (P.done || P.zappedThisRed) continue;
          if (m.vis[n] > m.up[n]) this.zap(n, now, 'mão abaixada');
          else if (m.drift[n] > this.thr) this.zap(n, now, 'se mexeu');
        }
        if (this.ph >= this.phDur) { this.level++; this.setPhase('back', now); }
      } else if (this.phase === 'back') { this.turnK = 1 - Math.min(1, this.ph / this.phDur); if (this.ph >= this.phDur) this.setPhase('green', now); }

      // ---- HUD e fim
      const P1 = this.P[1]; setText('hudScore', `${Math.floor(P1.target * 100)}%`); setText('hudLevel', String(P1.zaps));
      $('hudP').classList.toggle('hidden', ids.length < 2);
      if (ids.length > 1) { setText('hudP1', `${Math.floor(this.P[1].target * 100)}%`); setText('hudP2', `${Math.floor(this.P[2].target * 100)}%`); }
      if (ids.every((n) => this.P[n].done) || this.t >= this.DURATION) this.finish(ids);
    },

    tutorial(dt, now, m, ids) {
      const T = this.tut; T.flash = Math.max(0, T.flash - dt * 2); T.msgT = Math.max(0, T.msgT - dt);
      const next = () => { T.step++; T.hold = 0; T.flash = 1; sfx.patch(T.step); for (const n of [1, 2]) Object.assign(this.P[n].tc, { sum: 0, n: 0, hold: 0, strokes: 0 }); };
      const all = (fn) => ids.every(fn);
      if (T.step === 0) {                       // as duas mãos de cada jogador
        if (all((n) => m.vis[n] >= 2)) { T.hold += dt; if (T.hold > 0.8) next(); } else T.hold = Math.max(0, T.hold - dt);
      } else if (T.step === 1 || T.step === 2) { // grava o ALTO (1) e a CINTURA (2) de cada jogador
        for (const n of ids) {
          const tc = this.P[n].tc;
          if (m.vis[n] >= 2 && m.still[n]) { tc.hold += dt; for (const y of m.ys[n]) { tc.sum += y; tc.n++; } }
          else { tc.hold = 0; tc.sum = 0; tc.n = 0; }
        }
        T.hold = Math.min(...ids.map((n) => this.P[n].tc.hold));
        if (T.hold >= 1) {
          for (const n of ids) { const c = this.P[n].cal, v = this.P[n].tc.sum / Math.max(1, this.P[n].tc.n); if (T.step === 1) c.up = v; else c.low = v; }
          if (T.step === 2 && ids.some((n) => this.P[n].cal.low - this.P[n].cal.up < 0.15)) {
            T.msg = 'Movimento pequeno: suba MAIS e desça MAIS'; T.msgT = 2.5; T.step = 1; T.hold = 0; for (const n of ids) Object.assign(this.P[n].tc, { sum: 0, n: 0, hold: 0 }); sfx.tick();
          } else { if (T.step === 2) for (const n of ids) this.P[n].cal.ok = true; next(); }
        }
      } else if (T.step === 3) {                // 4 passos completos
        for (const n of ids) { this.P[n].tc.strokes += m.strokes[n]; if (m.strokes[n]) this.P[n].walk = 0.35; if (m.partial[n]) this.warn(n, 'movimento incompleto!'); if (m.together?.[n]) this.warn(n, 'alterne os braços!'); if (m.noPair?.[n]) this.warn(n, 'mostre as DUAS mãos'); }
        T.hold = Math.min(...ids.map((n) => this.P[n].tc.strokes));
        if (T.hold >= 4) { next(); this.turnK = 0; this.resetRefs(now, M.GRACE); T.maxDrift = 0; T.t = 0; tone(220, 0.25, 'sawtooth', 0.06, 0, 520); }
      } else if (T.step === 4) {                // robô virou: mãos no alto e imóvel
        this.turnK = Math.min(1, this.turnK + dt / 0.32); T.t += dt;
        const upOk = all((n) => m.vis[n] >= 1 && m.up[n] >= m.vis[n]), d = Math.max(...ids.map((n) => m.drift[n]));
        if (T.t < M.GRACE) return;
        if (!upOk) { T.hold = 0; T.maxDrift = 0; this.resetRefs(now, 0.4); T.msg = 'Mãos PARA CIMA!'; T.msgT = 0.6; }
        else if (d > 0.8) { T.hold = 0; T.maxDrift = 0; this.resetRefs(now, 0.4); T.msg = 'Fique PARADO!'; T.msgT = 0.6; }
        else { T.maxDrift = Math.max(T.maxDrift, d); T.hold += dt; }
        if (T.hold >= 1.6) {
          this.thr = clamp(T.maxDrift * 2.2 + 0.15, 0.35, 0.8); T.step = 5;
          saveCal({ up: this.P[1].cal.up, low: this.P[1].cal.low, thr: this.thr });
          $('btnSkipTut').classList.add('hidden');
          banner('VALENDO!'); sfx.level(); this.t = 0; this.setPhase('back', now); this.turnK = 1;
        }
      }
    },

    // ---- Desenho ------------------------------------------------------------
    geo() { const W = api.W, H = api.H; return { hy: H * 0.3, base: H * 0.94 - H * 0.3, W, H }; },
    proj(prog, lane) { const { hy, base, W } = this.geo(), s = 1 / (1 + prog * 1.8); return { x: W / 2 + lane * W * 0.26 * s, y: hy + base * s, s }; },
    avatarPos(n) { const two = this.ids(performance.now()).length > 1, lane = two ? (n === 1 ? -1 : 1) : 0, p = this.proj(this.P[n].prog, lane); return { x: p.x, y: p.y, size: api.MIN * 0.24 * p.s }; },

    render(ctx, t, now) {
      const W = api.W, H = api.H, MIN = api.MIN, { hy } = this.geo();
      const red = this.isRed();
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
      const ids = this.ids(now);
      const order = [...ids].sort((a, b) => this.P[b].prog - this.P[a].prog);
      for (const n of order) this.drawAvatar(ctx, t, n, R);
      vignette(ctx, W, H, red ? 0.7 : 0.45);
      if (this.phase === 'intro') return this.drawIntro(ctx, t);
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
      const P = this.P[n], a = this.avatarPos(n), s = a.size, col = PLAYER_COLORS[n], MIN = api.MIN;
      const step = P.walk > 0 ? Math.sin(t * 18) : 0;
      groundShadow(ctx, a.x, a.y, s * 0.32, s * 0.08, 0.35);
      const bodyTop = a.y - s * 0.9;
      ctx.lineCap = 'round';
      // Pernas (dão o passo quando um passo completo é contado)
      ctx.strokeStyle = '#1e293b'; ctx.lineWidth = s * 0.11;
      ctx.beginPath(); ctx.moveTo(a.x - s * 0.08, a.y - s * 0.35); ctx.lineTo(a.x - s * 0.1 + step * s * 0.12, a.y - s * 0.02); ctx.moveTo(a.x + s * 0.08, a.y - s * 0.35); ctx.lineTo(a.x + s * 0.1 - step * s * 0.12, a.y - s * 0.02); ctx.stroke();
      // Braços espelham a altura REAL das mãos do jogador (0 = cintura, 1 = alto)
      const arms = this.m.arms[n] || [], len = s * 0.34;
      const armA = [arms.length > 1 ? arms[0].a : arms.length ? arms[0].a : 0, arms.length > 1 ? arms[1].a : arms.length ? arms[0].a : 0];
      ctx.strokeStyle = col; ctx.lineWidth = s * 0.1;
      [-1, 1].forEach((sg, i) => {
        const th = lerp(0.12, 0.97, clamp(armA[i], 0, 1)) * Math.PI, sx = a.x + sg * s * 0.18, sy = bodyTop + s * 0.18;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + sg * Math.sin(th) * len, sy + Math.cos(th) * len); ctx.stroke();
        if (arms.length < 2 && i === (arms.length ? 1 : 0) && this.phase !== 'tut') { ctx.fillStyle = '#fca5a5'; ctx.beginPath(); ctx.arc(sx + sg * len * 0.6, sy - len * 0.2, s * 0.05, 0, Math.PI * 2); ctx.fill(); }
      });
      // Corpo + cabeça
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(a.x - s * 0.2, bodyTop + s * 0.1, s * 0.4, s * 0.48, s * 0.14); ctx.fill();
      ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(a.x, bodyTop - s * 0.05, s * 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f172a'; for (const ex of [-0.06, 0.06]) { ctx.beginPath(); ctx.arc(a.x + ex * s, bodyTop - s * 0.07, s * 0.022, 0, Math.PI * 2); ctx.fill(); }
      // Congelado pelo ZAP (efeito de gelo, nada gráfico)
      if (P.frozen > 0) {
        ctx.fillStyle = `rgba(125,211,252,${0.35 + 0.25 * Math.sin(t * 20)})`; ctx.beginPath(); ctx.roundRect(a.x - s * 0.42, bodyTop - s * 0.5, s * 0.84, s * 1.42, s * 0.12); ctx.fill();
        ctx.strokeStyle = 'rgba(224,242,254,.9)'; ctx.lineWidth = Math.max(1, s * 0.02); ctx.stroke();
      }
      // Laser do olho do robô até o jogador
      if (P.zap > 0) {
        const k = P.zap / 0.7; ctx.save(); ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.strokeStyle = '#fecaca'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = MIN * 0.04; ctx.lineWidth = MIN * 0.012 * (0.5 + k);
        ctx.beginPath(); ctx.moveTo(R.eye.x, R.eye.y); ctx.lineTo(a.x, bodyTop + s * 0.3); ctx.stroke();
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = MIN * 0.024 * k; ctx.globalAlpha = 0.4 * k; ctx.stroke(); ctx.restore();
      }
      // Rótulo, avisos e efeitos
      const two = this.ids(performance.now()).length > 1;
      const tag = P.done ? 'CHEGOU!' : `${two ? `J${n} · ` : ''}${P.steps}/${M.STEPS} passos`;
      label(ctx, tag, a.x, bodyTop - s * 0.62, Math.max(MIN * 0.028, s * 0.14), P.done ? '#4ade80' : col);
      if (P.warnT > 0 && !P.done) label(ctx, P.warn, a.x, bodyTop - s * 0.62 - MIN * 0.045, MIN * 0.034, '#fca5a5');
      for (const f of this.fx) if (f.n === n) label(ctx, f.text, a.x, bodyTop - s * 0.9 - (1.1 - f.life) * s * 0.4, MIN * 0.07, '#fde047');
      // Na estátua: mãos no alto (✓ por mão) + medidor de imobilidade
      if (this.isRed() && !P.done && this.phase !== 'turn') {
        const vis = this.m.vis[n], up = this.m.up[n], ok = vis >= 1 && up >= vis;
        label(ctx, vis ? `mãos no alto ${up}/${vis}` : 'mostre as mãos', a.x, a.y + MIN * 0.035, MIN * 0.03, ok ? '#86efac' : '#fca5a5');
        const k = clamp(this.m.drift[n] / this.thr, 0, 1), bw = Math.max(MIN * 0.14, s * 0.7), bx = a.x - bw / 2, by = a.y + MIN * 0.06;
        ctx.fillStyle = 'rgba(2,6,23,.6)'; ctx.fillRect(bx, by, bw, MIN * 0.016);
        ctx.fillStyle = k < 0.5 ? '#4ade80' : k < 0.8 ? '#facc15' : '#ef4444'; ctx.fillRect(bx, by, bw * k, MIN * 0.016);
      }
    },

    // ---- Explicativo: bonequinho "treinador" que demonstra cada movimento ------------
    /** pose: 'show' | 'up' | 'low' | 'run' | 'statue' | 'zap' */
    coach(ctx, t, x, y, s, pose, col = '#a78bfa') {
      const bodyTop = y - s * 0.9, run = Math.sin(t * 5.5);
      let aL, aR;                                          // 0 = braço na cintura, 1 = no alto
      if (pose === 'up' || pose === 'statue') aL = aR = 1;
      else if (pose === 'low' || pose === 'zap') aL = aR = 0.05;
      else if (pose === 'show') aL = aR = 0.62 + 0.06 * Math.sin(t * 8);
      else { aL = 0.5 + 0.5 * run; aR = 0.5 - 0.5 * run; }
      groundShadow(ctx, x, y, s * 0.32, s * 0.08, 0.35); ctx.lineCap = 'round';
      const leg = pose === 'run' ? run : 0;
      ctx.strokeStyle = '#1e293b'; ctx.lineWidth = s * 0.11;
      ctx.beginPath(); ctx.moveTo(x - s * 0.08, y - s * 0.35); ctx.lineTo(x - s * 0.1 + leg * s * 0.12, y - s * 0.02); ctx.moveTo(x + s * 0.08, y - s * 0.35); ctx.lineTo(x + s * 0.1 - leg * s * 0.12, y - s * 0.02); ctx.stroke();
      const len = s * 0.34, ends = [];
      ctx.strokeStyle = col; ctx.lineWidth = s * 0.1;
      [[-1, aL], [1, aR]].forEach(([sg, a]) => {
        const th = lerp(0.12, 0.97, a) * Math.PI, sx = x + sg * s * 0.18, sy = bodyTop + s * 0.18, ex = sx + sg * Math.sin(th) * len, ey = sy + Math.cos(th) * len;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ends.push({ x: ex, y: ey, sg, a });
      });
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x - s * 0.2, bodyTop + s * 0.1, s * 0.4, s * 0.48, s * 0.14); ctx.fill();
      ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(x, bodyTop - s * 0.05, s * 0.17, 0, Math.PI * 2); ctx.fill();
      for (const e of ends) { ctx.beginPath(); ctx.arc(e.x, e.y, s * 0.07, 0, Math.PI * 2); ctx.fill(); }   // mãos
      ctx.fillStyle = '#0f172a'; for (const ex of [-0.06, 0.06]) { ctx.beginPath(); ctx.arc(x + ex * s, bodyTop - s * 0.07, s * 0.022, 0, Math.PI * 2); ctx.fill(); }
      // Setas: no "run", uma sobe e a outra desce (alternado); no "statue", ✓ parado
      const arrow = (ax, ay, dir, c) => { const h = s * 0.16; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = s * 0.035;
        ctx.beginPath(); ctx.moveTo(ax, ay + h * dir); ctx.lineTo(ax, ay - h * dir); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax, ay - h * dir - s * 0.05 * dir); ctx.lineTo(ax - s * 0.05, ay - h * dir + s * 0.02 * dir); ctx.lineTo(ax + s * 0.05, ay - h * dir + s * 0.02 * dir); ctx.closePath(); ctx.fill(); };
      if (pose === 'run') { const goingUpL = Math.cos(t * 5.5) > 0; arrow(x - s * 0.62, bodyTop + s * 0.15, goingUpL ? 1 : -1, '#4ade80'); arrow(x + s * 0.62, bodyTop + s * 0.15, goingUpL ? -1 : 1, '#4ade80'); }
      if (pose === 'up') { arrow(x - s * 0.62, bodyTop, 1, '#4ade80'); arrow(x + s * 0.62, bodyTop, 1, '#4ade80'); }
      if (pose === 'low') { arrow(x - s * 0.62, bodyTop + s * 0.3, -1, '#4ade80'); arrow(x + s * 0.62, bodyTop + s * 0.3, -1, '#4ade80'); }
      if (pose === 'zap') { ctx.fillStyle = `rgba(125,211,252,${0.4 + 0.2 * Math.sin(t * 20)})`; ctx.beginPath(); ctx.roundRect(x - s * 0.42, bodyTop - s * 0.3, s * 0.84, s * 1.25, s * 0.12); ctx.fill(); }
    },

    /** Cartões "Como jogar" antes do tutorial. */
    drawIntro(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN, card = Math.min(2, Math.floor(this.introT / M.CARD)), k = (this.introT % M.CARD) / M.CARD;
      ctx.fillStyle = 'rgba(2,6,23,.82)'; ctx.fillRect(0, 0, W, H);
      const portrait = H > W * 1.1, pw = Math.min(W * 0.92, MIN * 1.5), ph = portrait ? H * 0.6 : H * 0.66, px = (W - pw) / 2, py = portrait ? H * 0.16 : H * 0.13;
      ctx.fillStyle = card === 0 ? '#0c4a6e' : '#7f1d1d'; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, MIN * 0.04); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 3; ctx.stroke();
      const fit = (txt, base) => Math.min(base, pw * 0.9 / (tr(txt).length * 0.56));
      label(ctx, `COMO JOGAR ${card + 1}/3`, W / 2, py + ph * 0.08, MIN * 0.035, '#93c5fd');
      const T = [
        ['O robô fica DE COSTAS cantando', 'CORRA no lugar: braços ALTERNADOS,', 'um sobe e o outro desce, POR INTEIRO'],
        ['Quando ele VIRA:', 'MÃOS PARA CIMA e vire ESTÁTUA', 'até ele virar de costas de novo'],
        ['Mão abaixada ou se mexeu?', 'ZAP! Volta para a LARGADA', 'Chegue primeiro na linha de CHEGADA'],
      ][card];
      label(ctx, T[0], W / 2, py + ph * 0.17, fit(T[0], MIN * 0.05), '#fff');
      // Cena: robô à esquerda, treinador à direita
      const sy = py + ph * 0.72, rs = Math.min(ph * 0.42, pw * 0.3), saveK = this.turnK, savePh = this.phase;
      this.turnK = card === 0 ? 0 : 1; this.phase = card === 0 ? 'green' : 'turn';
      const R = this.robot(ctx, t, px + pw * 0.26, sy, rs);
      this.turnK = saveK; this.phase = savePh;
      const cx = px + pw * 0.72, cs = Math.min(ph * 0.42, pw * 0.36);
      this.coach(ctx, t, cx, sy, cs, ['run', 'statue', 'zap'][card]);
      if (card === 0) { const notes = ['BA', 'TA', 'TI', 'NHA', '1, 2, 3!']; label(ctx, notes[Math.floor(t * 2.2) % notes.length], px + pw * 0.26, sy - rs * 1.15, MIN * 0.04, '#fde047'); }
      if (card === 2 && Math.sin(t * 6) > -0.2) { ctx.save(); ctx.strokeStyle = '#fecaca'; ctx.shadowColor = '#ef4444'; ctx.shadowBlur = MIN * 0.03; ctx.lineWidth = MIN * 0.01;
        ctx.beginPath(); ctx.moveTo(R.eye.x, R.eye.y); ctx.lineTo(cx, sy - cs * 0.6); ctx.stroke(); ctx.restore(); label(ctx, 'ZAP!', cx, sy - cs * 1.25, MIN * 0.05, '#fde047'); }
      if (card === 1) label(ctx, 'mãos no alto ✓  parado ✓', cx, sy + MIN * 0.04, MIN * 0.03, '#86efac');
      label(ctx, T[1], W / 2, py + ph * 0.84, fit(T[1], MIN * 0.045), '#fde047');
      label(ctx, T[2], W / 2, py + ph * 0.93, fit(T[2], MIN * 0.04), '#e2e8f0');
      // Bolinhas de progresso dos cartões
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < card ? '#4ade80' : i === card ? '#fde047' : 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(W / 2 + (i - 1) * MIN * 0.04, py + ph + MIN * 0.04, MIN * 0.012 * (i === card ? 1.3 : 1), 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(px, py + ph - MIN * 0.012, pw, MIN * 0.012); ctx.fillStyle = '#fde047'; ctx.fillRect(px, py + ph - MIN * 0.012, pw * k, MIN * 0.012);
      const hint = loadCal() ? 'Já sabe jogar? Segure a mão em PULAR TUTORIAL' : 'Segure a mão em PULAR TUTORIAL para ir direto';
      label(ctx, hint, W / 2, py + ph + MIN * 0.09, fit(hint, MIN * 0.03), 'rgba(226,232,240,.85)');
    },

    /** Quadro "FAÇA ASSIM" do tutorial: o treinador repete o gesto do passo atual. */
    drawDemo(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN, st = Math.min(this.tut.step, 4);
      const bw = H > W ? W * 0.36 : Math.min(W * 0.3, MIN * 0.42), bh = bw * 1.25, bx = W - bw - MIN * 0.025, by = H * 0.3;
      ctx.fillStyle = 'rgba(2,6,23,.72)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, MIN * 0.025); ctx.fill();
      ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; ctx.stroke();
      label(ctx, 'FAÇA ASSIM', bx + bw / 2, by + bh * 0.08, Math.min(MIN * 0.032, bw * 0.11), '#fde047');
      this.coach(ctx, t, bx + bw / 2, by + bh * 0.9, bh * 0.62, ['show', 'up', 'low', 'run', 'statue'][st]);
    },

    drawUI(ctx, t, now, ids, red) {
      const W = api.W, H = api.H, MIN = api.MIN;
      const fit = (txt, base) => Math.min(base, W * 0.92 / (tr(txt).length * 0.56));
      if (this.phase === 'tut') {
        const T = this.tut, two = ids.length > 1;
        const steps = [two ? 'Cada jogador: mostre as DUAS mãos' : 'Mostre as DUAS mãos para a câmera', 'Levante as DUAS mãos bem ALTO e segure', 'Agora abaixe as mãos até a CINTURA e segure',
          'Corra: braços ALTERNADOS, um sobe e o outro desce', 'O robô virou! MÃOS PARA CIMA e fique PARADO'];
        const st = Math.min(T.step, 4), goal = [0.8, 1, 1, 4, 1.6][st];
        label(ctx, `TUTORIAL ${st + 1}/5`, W / 2, H * 0.12, MIN * 0.034, '#93c5fd');
        label(ctx, steps[st], W / 2, H * 0.165, fit(steps[st], MIN * 0.05), T.flash > 0 ? '#4ade80' : '#fde047');
        const bw = W * 0.4; ctx.fillStyle = 'rgba(2,6,23,.55)'; ctx.fillRect(W / 2 - bw / 2, H * 0.2, bw, MIN * 0.018);
        ctx.fillStyle = '#4ade80'; ctx.fillRect(W / 2 - bw / 2, H * 0.2, bw * clamp(T.hold / goal, 0, 1), MIN * 0.018);
        if (T.msgT > 0) label(ctx, T.msg, W / 2, H * 0.25, MIN * 0.04, '#fca5a5');
        this.drawDemo(ctx, t);
      } else if (this.phase === 'green' || this.phase === 'back') {
        const n = this.phase === 'green' ? this.chantI : -1, size = MIN * 0.06, words = ['BATATINHA', 'FRITA', '1, 2, 3!'].map((w) => tr(w));
        const lit = n < 0 ? 0 : n < 4 ? 1 : n < 6 ? 2 : 3;
        const total = words.map((w) => w.length).reduce((a, b) => a + b, 0), cw = size * 0.62; let x = W / 2 - (total * cw + size) / 2;
        words.forEach((w, i) => { const wx = x + (w.length * cw) / 2; label(ctx, w, wx, H * 0.15, size, i < lit ? '#fde047' : 'rgba(255,255,255,.45)'); x += w.length * cw + size * 0.5; });
        const sub = 'CORRA COM OS BRAÇOS ALTERNADOS, POR INTEIRO';
        label(ctx, sub, W / 2, H * 0.215, fit(sub, MIN * 0.038), '#bbf7d0');
      } else {
        const blink = Math.floor(t * 4) % 2 === 0;
        label(ctx, 'MÃOS PARA CIMA!', W / 2, H * 0.15, fit('MÃOS PARA CIMA!', MIN * 0.075), blink ? '#fecaca' : '#ef4444');
        const sub = 'e ESTÁTUA até o robô virar de costas';
        label(ctx, sub, W / 2, H * 0.215, fit(sub, MIN * 0.035), '#fff');
      }
    },

    finish(ids) {
      if (api.state.phase !== 'mini') return;
      $('btnSkipTut').classList.add('hidden');
      const sc = (n) => { const P = this.P[n]; return P.done ? 1000 + Math.round(Math.max(0, this.DURATION - P.done) * 15) + (P.zaps ? 0 : 400) : Math.round(P.target * 700); };
      const desc = (n) => { const P = this.P[n]; return `${P.done ? `chegou em ${fmtTime(P.done)}` : `${Math.floor(P.target * 100)}% do caminho`} · ${P.zaps} zap(s)`; };
      if (ids.length > 1) {
        const s1 = sc(1), s2 = sc(2), w = s1 === s2 ? 0 : s1 > s2 ? 1 : 2;
        api.endMini({ title: w ? `JOGADOR ${w} VENCEU!` : 'EMPATE!', score: Math.max(s1, s2), bestKey: 'bestBatatinha', stats: `J1 ${desc(1)} · J2 ${desc(2)}` });
      } else {
        const P = this.P[1];
        api.endMini({ title: P.done ? (P.zaps === 0 ? 'CHEGOU SEM NENHUM ZAP!' : 'VOCÊ CHEGOU!') : 'O TEMPO ACABOU!', score: sc(1), bestKey: 'bestBatatinha', stats: `${desc(1)} · ${this.level} rodadas do robô` });
      }
    },
  };

  $('btnBatatinha').addEventListener('click', () => api.startMini(game));
  $('btnSkipTut').addEventListener('click', () => { if (window.__mini === game) game.skip(); });
  return { batatinha: game };
}
