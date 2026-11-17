// =============================================================================
// ARCADE — Bateria no ar e Corredor (3 pistas), com a mesma câmera
//   • Bateria: 7 peças em arco; "bater" = a mão entra na peça descendo rápido.
//     Modo livre com batida de fundo opcional, e modo Desafio (peças acendem no ritmo).
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
  // 1. BATERIA — tocada com os DEDOS (até 10 baquetas: 5 dedos × 2 mãos)
  // ---------------------------------------------------------------------------
  // Cada ponta de dedo é uma baqueta. O toque é o gesto de "batucar na mesa":
  // o dedo dobra rápido. Medimos a extensão de cada dedo em proporção ao tamanho da
  // palma (vale perto ou longe da câmera) e disparamos quando ela cai depressa.
  // A peça tocada é a que está sob a ponta daquele dedo. O golpe com a mão inteira
  // (descer a mão rápido) também vale, pelas pontas do indicador e do médio.
  // ===========================================================================
  const FINGERS = [
    { name: 'Polegar', short: 'P', tip: 4, color: '#f87171' },
    { name: 'Indicador', short: 'I', tip: 8, color: '#fb923c' },
    { name: 'Médio', short: 'M', tip: 12, color: '#facc15' },
    { name: 'Anelar', short: 'A', tip: 16, color: '#4ade80' },
    { name: 'Mínimo', short: 'm', tip: 20, color: '#60a5fa' },
  ];
  // DROP = queda mínima de extensão (em palmas) para contar como toque. NOISE_K = quantas vezes o
  // tremor medido daquele dedo a queda precisa superar (limiar adaptativo à qualidade da câmera).
  const TAP = { DROP: 0.16, DROP_THUMB: 0.13, NOISE_K: 6, SMOOTH: 0.75, WINDOW_MS: 260, REARM: 0.07, MIN_GAP_MS: 110, PAD_GAP_MS: 70 };
  const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

  /** Extensão de cada dedo normalizada pela palma (0 = dobrado, ~1.6+ = esticado). */
  function fingerExt(lm) {
    // Landmarks vêm normalizados por largura e altura da imagem separadamente: corrigimos
    // pela proporção real da câmera (ex.: 4:3) para medir distâncias de verdade.
    const v = document.getElementById('video'), asp = v && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
    const d = (a, b) => Math.hypot((lm[a].x - lm[b].x) * asp, lm[a].y - lm[b].y);
    const palm = d(0, 9) || 1e-6;
    return [d(4, 9) / palm, d(8, 0) / palm, d(12, 0) / palm, d(16, 0) / palm, d(20, 0) / palm];
  }

  // ---- Síntese de bateria (Web Audio): sem arquivos, sem atraso perceptível ----
  let noiseBuf = null;
  function getNoise(ac) {
    if (noiseBuf && noiseBuf.sampleRate === ac.sampleRate) return noiseBuf;
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf;
  }
  function env(ac, node, t, peak, dur) { node.gain.setValueAtTime(peak, t); node.gain.exponentialRampToValueAtTime(0.0008, t + dur); }
  function noiseHit(ac, out, t, { type = 'highpass', freq = 6000, q = 0.7, peak = 0.6, dur = 0.08 }) {
    const s = ac.createBufferSource(); s.buffer = getNoise(ac); const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); env(ac, g, t, peak, dur); s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function toneHit(ac, out, t, { wave = 'sine', f0 = 150, f1 = 50, sweep = 0.12, peak = 0.9, dur = 0.4 }) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = wave; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    env(ac, g, t, peak, dur); o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  function playDrum(id, vol = 1) {
    const ac = api.actx; if (!ac) return;
    const t = ac.currentTime, out = ac.createGain(); out.gain.value = 0.5 + 0.5 * vol; out.connect(ac.destination);
    if (id === 'kick') { toneHit(ac, out, t, { f0: 165, f1: 42, sweep: 0.11, peak: 1, dur: 0.45 }); noiseHit(ac, out, t, { type: 'lowpass', freq: 2500, peak: 0.35, dur: 0.012 }); }
    else if (id === 'snare') { noiseHit(ac, out, t, { type: 'highpass', freq: 1300, peak: 0.75, dur: 0.2 }); toneHit(ac, out, t, { wave: 'triangle', f0: 200, f1: 165, sweep: 0.05, peak: 0.5, dur: 0.12 }); }
    else if (id === 'hihat') noiseHit(ac, out, t, { type: 'highpass', freq: 7500, peak: 0.45, dur: 0.055 });
    else if (id === 'openhat') noiseHit(ac, out, t, { type: 'highpass', freq: 6500, peak: 0.42, dur: 0.38 });
    else if (id === 'tom1') { toneHit(ac, out, t, { f0: 240, f1: 160, sweep: 0.18, peak: 0.85, dur: 0.38 }); noiseHit(ac, out, t, { type: 'bandpass', freq: 900, peak: 0.12, dur: 0.05 }); }
    else if (id === 'tom2') { toneHit(ac, out, t, { f0: 150, f1: 92, sweep: 0.22, peak: 0.95, dur: 0.5 }); noiseHit(ac, out, t, { type: 'bandpass', freq: 600, peak: 0.12, dur: 0.06 }); }
    else if (id === 'crash') { noiseHit(ac, out, t, { type: 'highpass', freq: 4200, peak: 0.55, dur: 1.5 }); noiseHit(ac, out, t, { type: 'bandpass', freq: 9000, q: 1.5, peak: 0.25, dur: 0.9 }); }
  }

  const drums = {
    name: 'Bateria no Ar', DURATION: 60, hideCursors: true,
    // Duas fileiras na faixa onde as mãos descansam; peças grandes para os dedos de
    // uma mão alcançarem 2 a 3 peças sem mover o braço. ry = altura relativa da elipse.
    PADS: [
      { id: 'crash', label: 'CRASH', color: '#fbbf24', pos: [0.12, 0.36], r: 0.125 },
      { id: 'hihat', label: 'CHIMBAL', color: '#fde047', pos: [0.31, 0.33], r: 0.12 },
      { id: 'tom1', label: 'TOM', color: '#f87171', pos: [0.5, 0.31], r: 0.115 },
      { id: 'tom2', label: 'SURDO', color: '#fb923c', pos: [0.69, 0.33], r: 0.12 },
      { id: 'openhat', label: 'PRATO', color: '#fde68a', pos: [0.88, 0.36], r: 0.125 },
      { id: 'snare', label: 'CAIXA', color: '#e5e7eb', pos: [0.37, 0.67], r: 0.155 },
      { id: 'kick', label: 'BUMBO', color: '#60a5fa', pos: [0.63, 0.67], r: 0.17 },
    ],
    PAD_RY: 0.78,
    start() {
      this.t = 0; this.hits = 0; this.score = 0; this.maxCombo = 0; this.combo = 0; this.flash = {}; this.padLast = {};
      this.challenge = false; this.seq = []; this.modeTimer = 20; this.fx = null;
      this.fing = new Map();   // por mão (cursor id): estado de cada dedo
      this.tips = [];          // pontas visíveis neste quadro (para desenhar)
      this.panel = { 1: [0, 0, 0, 0, 0], 2: [0, 0, 0, 0, 0] }; // brilho das luzes por dedo
      this.fingerHits = [0, 0, 0, 0, 0];
      this.pattern = ['kick', 'hihat', 'snare', 'hihat', 'kick', 'kick', 'snare', 'openhat'];
      show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'BATIDAS'); setText('hudLevel', '0'); setText('hudTime', 'LIVRE'); hide('hudCombo'); hide('hudP');
      banner('Batuque com os dedos!');
    },
    /** Peça sob o ponto (elipse igual à desenhada, com 15% de folga). */
    padAt(x, y) {
      const MIN = api.MIN; let best = null, bd = Infinity;
      for (const p of this.PADS) {
        const dx = (x - p.pos[0] * api.W) / (p.r * MIN * 1.15), dy = (y - p.pos[1] * api.H) / (p.r * MIN * this.PAD_RY * 1.15), d = dx * dx + dy * dy;
        if (d <= 1 && d < bd) { bd = d; best = p; }
      }
      return best;
    },
    hit(pad, by, vol, finger, now) {
      if (now - (this.padLast[pad.id] || 0) < TAP.PAD_GAP_MS) return false; // mesmo golpe lido 2× (dedo + mão)
      this.padLast[pad.id] = now;
      playDrum(pad.id, vol); this.flash[pad.id] = 1; this.hits++;
      if (finger != null) this.fingerHits[finger]++;
      emit(pad.pos[0] * api.W, pad.pos[1] * api.H, 6 + Math.round(vol * 8), 'dust');
      if (this.challenge) {
        const tReal = this.t - (api.settings.tvMode ? 0.15 : 0.05);
        const due = this.seq.find((n) => !n.done && Math.abs(n.at - tReal) < 0.25 && n.id === pad.id);
        if (due) { due.done = true; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); const pts = Math.round((Math.abs(due.at - tReal) < 0.1 ? 200 : 100) * (1 + Math.min(this.combo, 10) * 0.1)); this.score += pts; this.fx = { text: `+${pts}`, x: pad.pos[0] * api.W, y: pad.pos[1] * api.H - pad.r * api.MIN, life: 1 }; }
        else this.combo = 0;
      }
      setText('hudLevel', String(this.hits)); setText('hudScore', this.score.toLocaleString('pt-BR'));
      return true;
    },
    /** Lê os dedos de cada mão e dispara toques. */
    readFingers(now) {
      const MIN = api.MIN; this.tips = [];
      const seen = new Set();
      for (const c of api.cursors) {
        if (!c.lm) continue; seen.add(c.id);
        let F = this.fing.get(c.id);
        if (!F) { F = { lmRef: null, fingers: FINGERS.map(() => ({ hist: [], armed: true, trough: 0, last: 0, sx: null, sy: null, flash: 0, es: null, noise: 0.015 })), wrist: [] }; this.fing.set(c.id, F); }
        const fresh = F.lmRef !== c.lm; F.lmRef = c.lm;
        const lm = c.lm, ext = fresh ? fingerExt(lm) : null;
        // Golpe com a mão inteira: velocidade do punho na tela
        const w = api.toScreen(lm[0]);
        if (fresh) { F.wrist.push({ t: now, y: w.y }); while (F.wrist.length > 2 && now - F.wrist[0].t > 180) F.wrist.shift(); }
        const wa = F.wrist[0], wb = F.wrist[F.wrist.length - 1], handVy = wa && wb && wb.t > wa.t ? (wb.y - wa.y) / ((wb.t - wa.t) / 1000) : 0;
        const handStrike = handVy > MIN * 1.6;
        FINGERS.forEach((fg, i) => {
          const st = F.fingers[i], p = api.toScreen(lm[fg.tip]);
          // suaviza levemente a ponta na tela (o ponto treme alguns px)
          st.sx = st.sx == null ? p.x : st.sx + (p.x - st.sx) * 0.6; st.sy = st.sy == null ? p.y : st.sy + (p.y - st.sy) * 0.6;
          st.flash = Math.max(0, st.flash - 0.06);
          const pad = this.padAt(st.sx, st.sy);
          if (fresh) {
            // Suaviza a extensão e mede o tremor do dedo (média do |Δ| entre quadros, só quando não há queda grande)
            const raw = ext[i], prevE = st.es; st.es = prevE == null ? raw : prevE + (raw - prevE) * TAP.SMOOTH;
            const e = st.es, step = prevE == null ? 0 : Math.abs(e - prevE);
            // só conta como tremor o que parece repouso (rejeita os próprios toques e retornos)
            if (step < st.noise * 3 + 0.012 && now - st.last > 350) st.noise = clamp(st.noise + (step - st.noise) * 0.05, 0.008, 0.05);
            st.hist.push({ t: now, e }); while (st.hist.length > 2 && now - st.hist[0].t > TAP.WINDOW_MS) st.hist.shift();
            const peak = Math.max(...st.hist.map((h) => h.e)), drop = peak - e;
            const need = Math.max(i === 0 ? TAP.DROP_THUMB : TAP.DROP, st.noise * TAP.NOISE_K);
            if (!st.armed && e > st.trough + TAP.REARM) st.armed = true;
            if (!st.armed) st.trough = Math.min(st.trough, e);
            // 1) toque de dedo: flexão rápida
            if (st.armed && drop > need && now - st.last > TAP.MIN_GAP_MS) {
              st.armed = false; st.trough = e; st.last = now; st.flash = 1; this.panel[c.player][i] = 1;
              if (pad) this.hit(pad, c.player, clamp((drop - need) / 0.3 + 0.35, 0.35, 1), i, now);
            }
            // 2) golpe da mão inteira: vale pelas pontas do indicador e do médio
            else if (handStrike && (i === 1 || i === 2) && pad && now - st.last > TAP.MIN_GAP_MS) {
              st.last = now; st.flash = 1; this.panel[c.player][i] = 1;
              this.hit(pad, c.player, clamp(handVy / (MIN * 3), 0.4, 1), i, now);
            }
          }
          this.tips.push({ x: st.sx, y: st.sy, color: fg.color, flash: st.flash, over: !!pad, player: c.player });
        });
      }
      for (const id of this.fing.keys()) if (!seen.has(id)) this.fing.delete(id);
    },
    update(dt) {
      const MIN = api.MIN, now = performance.now(); this.t += dt;
      for (const k in this.flash) this.flash[k] = Math.max(0, this.flash[k] - dt * 4);
      for (const p of [1, 2]) this.panel[p] = this.panel[p].map((v) => Math.max(0, v - dt * 2.5));
      this.readFingers(now);
      if (this.fx) { this.fx.life -= dt; this.fx.y -= MIN * 0.1 * dt; if (this.fx.life <= 0) this.fx = null; }
      if (!this.challenge) { this.modeTimer -= dt; if (this.modeTimer <= 0) { this.challenge = true; this.seqStart = this.t + 2; banner('DESAFIO: siga o ritmo'); sfx.level(); setText('hudTime', fmtTime(this.DURATION)); } }
      else {
        const beat = 60 / 96, elapsed = this.t - this.seqStart;
        if (elapsed >= this.DURATION) return this.finish();
        setText('hudTime', fmtTime(this.DURATION - Math.max(0, elapsed)));
        while (this.seq.length < Math.floor((elapsed + 2.5) / beat) + 1) { const i = this.seq.length; this.seq.push({ id: this.pattern[i % this.pattern.length], at: this.seqStart + i * beat, done: false }); }
        for (const n of this.seq) if (!n.done && !n.missed && this.t - n.at > 0.25) { n.missed = true; this.combo = 0; }
        this.seq = this.seq.filter((n) => this.t - n.at < 1);
        if (Math.floor(elapsed / beat) !== Math.floor((elapsed - dt) / beat) && elapsed >= 0) tone(Math.floor(elapsed / beat) % 4 === 0 ? 1200 : 900, 0.03, 'square', 0.03);
      }
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN;
      bg(ctx, '#111827', '#030712');
      ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = texture(ctx, 'wood', 256, 9); ctx.fillRect(0, H * 0.15, W, H); ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, H * 0.15, W, H);
      spotlight(ctx, W * 0.3, 0, H * 1.1, 'rgba(244,63,94,.18)'); spotlight(ctx, W * 0.7, 0, H * 1.1, 'rgba(59,130,246,.18)'); spotlight(ctx, W * 0.5, H * 0.1, H * 0.9, 'rgba(255,255,255,.12)');
      vignette(ctx, W, H, 0.5);
      // Peças
      for (const p of this.PADS) {
        const x = p.pos[0] * W, y = p.pos[1] * H, r = p.r * MIN, ry = this.PAD_RY, f = this.flash[p.id] || 0, s = 1 + f * 0.08;
        const due = this.challenge && this.seq.find((n) => !n.done && n.id === p.id && n.at - this.t < 0.6 && n.at - this.t > -0.25);
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.18, r * 1.04, r * ry, 0, 0, Math.PI * 2); ctx.fill();
        const cymbal = ['crash', 'hihat', 'openhat'].includes(p.id);
        const pg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.05, x, y, r);
        pg.addColorStop(0, '#ffffff'); pg.addColorStop(cymbal ? 0.15 : 0.3, p.color); pg.addColorStop(1, cymbal ? 'rgba(120,80,0,.85)' : 'rgba(0,0,0,.65)');
        ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, y, r * s, r * ry * s, 0, 0, Math.PI * 2); ctx.fill();
        if (cymbal) { ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5; for (let k = 0.3; k < 1; k += 0.14) { ctx.beginPath(); ctx.ellipse(x, y, r * k * s, r * ry * k * s, 0, 0, Math.PI * 2); ctx.stroke(); } }
        else { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(x, y, r * 0.78 * s, r * ry * 0.78 * s, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = f > 0 ? `rgba(255,255,255,${0.5 + f * 0.5})` : 'rgba(0,0,0,.4)'; ctx.lineWidth = Math.max(3, r * 0.07 + f * r * 0.12);
        ctx.beginPath(); ctx.ellipse(x, y, r * s, r * ry * s, 0, 0, Math.PI * 2); ctx.stroke();
        if (due) { const k = 1 - clamp((due.at - this.t) / 0.6, 0, 1); ctx.strokeStyle = '#4ade80'; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.ellipse(x, y, r * (1.7 - 0.7 * k), r * ry * (1.7 - 0.7 * k), 0, 0, Math.PI * 2); ctx.stroke(); }
        label(ctx, p.label, x, y + r * 0.02, r * 0.26, 'rgba(0,0,0,.78)');
      }
      // Mãos: esqueleto discreto + 10 baquetas coloridas
      for (const c of api.cursors) {
        if (!c.lm) continue; const pts = c.lm.map((p) => api.toScreen(p));
        ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = Math.max(2, MIN * 0.005); ctx.lineCap = 'round';
        ctx.beginPath(); for (const [a, b] of HAND_LINKS) { ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); } ctx.stroke();
      }
      for (const tp of this.tips) {
        const r = MIN * (0.022 + tp.flash * 0.02);
        if (tp.flash > 0) { ctx.fillStyle = tp.color + '55'; ctx.beginPath(); ctx.arc(tp.x, tp.y, r * 2.2, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = tp.color; ctx.beginPath(); ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = tp.over ? '#fff' : 'rgba(0,0,0,.6)'; ctx.lineWidth = tp.over ? 3 : 2; ctx.stroke();
      }
      // Painel dos dedos: acende quando cada dedo é reconhecido batendo
      const two = api.activePlayers() === 2;
      for (const pl of two ? [1, 2] : [1]) {
        const cx0 = two ? (pl === 1 ? W * 0.25 : W * 0.75) : W / 2, y0 = H * 0.9, gap = MIN * 0.075;
        if (two) label(ctx, `P${pl}`, cx0 - gap * 3.1, y0, MIN * 0.03, PLAYER_COLORS[pl]);
        FINGERS.forEach((fg, i) => {
          const x = cx0 + (i - 2) * gap, v = this.panel[pl][i];
          ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(x, y0, MIN * 0.03, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = fg.color; ctx.globalAlpha = 0.25 + v * 0.75; ctx.beginPath(); ctx.arc(x, y0, MIN * (0.024 + v * 0.008), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
          label(ctx, fg.short, x, y0, MIN * 0.022, 'rgba(0,0,0,.8)');
        });
      }
      if (this.fx) { ctx.globalAlpha = clamp(this.fx.life, 0, 1); label(ctx, this.fx.text, this.fx.x, this.fx.y, MIN * 0.06, '#fde047'); ctx.globalAlpha = 1; }
      if (this.challenge && this.combo >= 3) label(ctx, `combo x${this.combo}`, W / 2, H * 0.5, MIN * 0.05, '#fbbf24');
      if (!this.challenge) label(ctx, `Mão aberta sobre as peças · batuque FIRME com os dedos, como numa mesa · desafio em ${Math.ceil(this.modeTimer)} s`, W / 2, H * 0.205, MIN * 0.03, '#fde68a');
    },
    finish() {
      const names = FINGERS.map((f, i) => `${f.short} ${this.fingerHits[i]}`).join(' · ');
      api.endMini({ title: 'FIM DO SOLO!', score: this.score, bestKey: 'bestBateria', stats: `${this.hits} batidas · combo máx. ${this.maxCombo} · por dedo: ${names}` });
    },
  };

  // ===========================================================================
  // 2. CORREDOR
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

  $('btnBateria').addEventListener('click', () => api.startMini(drums));
  $('btnCorredor').addEventListener('click', () => api.startMini(runner));
  return { drums, runner };
}
