// =============================================================================
// LIBRAS — alfabeto manual (subconjunto estático) com a mesma câmera
//   • "Aprender": mostra a letra e um esquema da mão; segure o sinal 0,7 s para avançar.
//   • "Soletrar": soletre palavras letra a letra contra o relógio (90 s).
//
// Como funciona: de cada mão extraímos um vetor de características geométricas
// (cada dedo: estendido / meio / dobrado; polegar fora ou junto; indicador e médio
// afastados; ponta do indicador encostando no polegar). Cada letra tem um gabarito
// desse vetor. O esquema da mão na tela é desenhado A PARTIR do mesmo gabarito, então
// o que o jogo "espera" é exatamente o que ele mostra.
//
// LIMITES (honestos): só letras estáticas e distinguíveis por geometria de frente para
// a câmera. Fora desta versão: letras com movimento (H, J, K, X, Z) e letras que
// dependem da orientação da mão ou da posição fina do polegar (E, G, M, N, P, Q, R, S, T).
// Esquemas são aproximações didáticas; valide com um instrutor de Libras.
// =============================================================================
export function install(api) {
  const { state, sfx, tone, banner, show, hide, setText, PLAYER_COLORS, rand, clamp, pick, fmtTime, emit } = api;
  const $ = (id) => document.getElementById(id);

  // ---- Gabaritos: f = [indicador, médio, anelar, mínimo] com 2 = estendido, 1 = meio-dobrado, 0 = dobrado
  //      thumb: 'out' (afastado) | 'in' (junto/por cima) | 'any'; spread: indicador–médio afastados? ; touch: ponta do indicador encosta no polegar?
  const LETTERS = {
    A: { f: [0, 0, 0, 0], thumb: 'in',  dica: 'Mão fechada, polegar encostado ao lado do indicador.' },
    B: { f: [2, 2, 2, 2], thumb: 'in',  spread: false, dica: 'Quatro dedos juntos para cima, polegar dobrado sobre a palma.' },
    C: { f: [1, 1, 1, 1], thumb: 'out', dica: 'Dedos e polegar curvados formando um "C".' },
    D: { f: [2, 0, 0, 0], thumb: 'in',  dica: 'Só o indicador para cima; os outros dedos tocam o polegar.' },
    F: { f: [0, 2, 2, 2], thumb: 'any', touch: true, dica: 'Indicador e polegar formam um círculo; os outros três ficam para cima.' },
    I: { f: [0, 0, 0, 2], thumb: 'in',  dica: 'Só o dedo mínimo para cima.' },
    L: { f: [2, 0, 0, 0], thumb: 'out', dica: 'Indicador para cima e polegar aberto para o lado, em "L".' },
    O: { f: [1, 1, 1, 1], thumb: 'any', touch: true, dica: 'Todos os dedos curvados tocando o polegar, formando um "O".' },
    U: { f: [2, 2, 0, 0], thumb: 'in',  spread: false, dica: 'Indicador e médio para cima, juntos.' },
    V: { f: [2, 2, 0, 0], thumb: 'in',  spread: true,  dica: 'Indicador e médio para cima, afastados em "V".' },
    W: { f: [2, 2, 2, 0], thumb: 'in',  dica: 'Indicador, médio e anelar para cima; mínimo dobrado.' },
    Y: { f: [0, 0, 0, 2], thumb: 'out', dica: 'Mínimo para cima e polegar aberto para o lado.' },
  };
  const ORDER = Object.keys(LETTERS);
  const WORDS = ['BOLA', 'LUA', 'VACA', 'BOCA', 'FACA', 'CUBO', 'DADO', 'VIDA', 'VILA', 'LOBO', 'CABO', 'OVO', 'UVA', 'VOU', 'BOLO', 'CALO', 'FIO', 'DIA', 'VIOLA', 'FAVO', 'LOUCO', 'CUIA', 'BULA', 'AVO', 'LIDO', 'DUO'];

  // ---- Extração de características de uma mão (21 landmarks normalizados)
  function features(lm) {
    const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
    const palm = d(5, 17) || 1e-6;
    const f = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]].map(([tip, pip, mcp]) => {
      const r = d(tip, 0) / (d(pip, 0) || 1e-6);
      return r > 1.15 ? 2 : r < 0.92 ? 0 : 1;
    });
    const thumbOut = d(4, 17) > d(2, 17) * 1.25 && d(4, 5) > palm * 0.55;
    const spread = d(8, 12) > palm * 0.45;
    const touch = d(4, 8) < palm * 0.35;
    return { f, thumb: thumbOut ? 'out' : 'in', spread, touch };
  }
  /** Compara características com um gabarito: retorna pontuação (1 = perfeito) e a 1ª dica de correção. */
  function match(feat, tpl) {
    let score = 0, total = 0, hint = null;
    const names = ['indicador', 'médio', 'anelar', 'mínimo'], verbo = ['dobre', 'curve', 'estique'];
    tpl.f.forEach((want, i) => { total += 2; const diff = Math.abs(feat.f[i] - want); score += Math.max(0, 2 - diff * 1.5); if (diff >= 1 && !hint) hint = `${verbo[want]} o ${names[i]}`; });
    if (tpl.thumb !== 'any') { total += 1.5; if (feat.thumb === tpl.thumb) score += 1.5; else if (!hint) hint = tpl.thumb === 'out' ? 'abra o polegar para o lado' : 'encoste o polegar'; }
    if (tpl.spread !== undefined) { total += 1; if (feat.spread === tpl.spread) score += 1; else if (!hint) hint = tpl.spread ? 'afaste indicador e médio' : 'junte indicador e médio'; }
    if (tpl.touch) { total += 1.5; if (feat.touch) score += 1.5; else if (!hint) hint = 'encoste o indicador no polegar'; }
    return { score: score / total, hint };
  }
  /** Melhor letra para a mão (ou null), com a dica para a letra-alvo. */
  function recognize(lm, target) {
    const feat = features(lm); let best = null, bs = 0;
    for (const L of ORDER) { const { score } = match(feat, LETTERS[L]); if (score > bs) { bs = score; best = L; } }
    const tgt = target ? match(feat, LETTERS[target]) : null;
    return { letter: bs >= 0.85 ? best : null, score: bs, targetScore: tgt?.score ?? 0, hint: tgt?.hint ?? null };
  }

  // ---- Esquema da mão desenhado a partir do gabarito (ou de características reais)
  function drawHandSchematic(ctx, x, y, size, tpl, color = '#fcd9b6') {
    ctx.save(); ctx.translate(x, y);
    const pw = size * 0.42, ph = size * 0.5;
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = size * 0.02; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Palma
    ctx.beginPath(); ctx.roundRect(-pw / 2, -ph / 2, pw, ph, size * 0.08); ctx.fill(); ctx.stroke();
    // Dedos: base na borda superior da palma
    const baseXs = [-pw * 0.33, -pw * 0.11, pw * 0.11, pw * 0.33];
    const lens = [0.42, 0.48, 0.44, 0.34];
    const spreadA = tpl.spread ? 0.22 : 0.04;
    tpl.f.forEach((st, i) => {
      const w = size * 0.1, L = size * lens[i] * (st === 2 ? 1 : st === 1 ? 0.6 : 0.28);
      const ang = (i - 1.5) * spreadA * (st === 2 ? 1 : 0.3);
      ctx.save(); ctx.translate(baseXs[i], -ph / 2 + size * 0.02); ctx.rotate(ang);
      if (st === 1) ctx.rotate(0.35); // meio-dobrado inclina para dentro
      ctx.beginPath(); ctx.roundRect(-w / 2, -L, w, L + size * 0.03, w / 2); ctx.fill(); ctx.stroke();
      if (st === 0) { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.roundRect(-w / 2, -L, w, L, w / 2); ctx.fill(); ctx.fillStyle = color; }
      ctx.restore();
    });
    // Polegar
    const tw = size * 0.11;
    ctx.save(); ctx.translate(-pw / 2 + size * 0.02, -ph * 0.1);
    if (tpl.thumb === 'out') { ctx.rotate(-1.0); ctx.beginPath(); ctx.roundRect(-tw / 2, -size * 0.36, tw, size * 0.4, tw / 2); ctx.fill(); ctx.stroke(); }
    else if (tpl.touch) { ctx.rotate(-0.4); ctx.beginPath(); ctx.roundRect(-tw / 2, -size * 0.3, tw, size * 0.34, tw / 2); ctx.fill(); ctx.stroke(); }
    else { ctx.rotate(0.15); ctx.beginPath(); ctx.roundRect(-tw / 2, -size * 0.22, tw, size * 0.26, tw / 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.beginPath(); ctx.roundRect(-tw / 2, -size * 0.22, tw, size * 0.26, tw / 2); ctx.fill(); }
    ctx.restore();
    ctx.restore();
  }
  function label(ctx, text, x, y, size, color = '#fff') {
    ctx.font = `900 ${Math.round(size)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function bg(ctx, a, b) { const g = ctx.createLinearGradient(0, 0, 0, api.H); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, api.W, api.H); }

  /** Mão do jogador com landmarks (prefere a mão com a melhor leitura). */
  function bestHand(target) {
    let best = null;
    for (const c of api.cursors) { if (!c.lm) continue; const r = recognize(c.lm, target); if (!best || r.targetScore > best.r.targetScore) best = { c, r }; }
    return best;
  }

  // ---- Base comum dos dois modos
  const base = {
    HOLD: 0.7,
    common(ctx, t, title, subtitle) {
      const W = api.W, H = api.H, MIN = api.MIN;
      bg(ctx, '#0f766e', '#042f2e');
      label(ctx, title, W / 2, H * 0.2, MIN * 0.055, '#99f6e4');
      if (subtitle) label(ctx, subtitle, W / 2, H * 0.27, MIN * 0.032, '#ccfbf1');
    },
    /** Desenha alvo (letra + esquema) à esquerda e leitura ao vivo à direita. Retorna leitura. */
    drawPair(ctx, target, hold) {
      const W = api.W, H = api.H, MIN = api.MIN;
      if (!target || !LETTERS[target]) return null;
      // Alvo
      label(ctx, target, W * 0.25, H * 0.47, MIN * 0.26, '#fff');
      drawHandSchematic(ctx, W * 0.25, H * 0.76, MIN * 0.42, LETTERS[target]);
      // Ao vivo
      const bh = bestHand(target);
      const live = bh?.r.letter || '?';
      label(ctx, live, W * 0.75, H * 0.47, MIN * 0.26, live === target ? '#4ade80' : live === '?' ? 'rgba(255,255,255,.4)' : '#fbbf24');
      if (bh) drawHandSchematic(ctx, W * 0.75, H * 0.76, MIN * 0.42, features(bh.c.lm), '#bfdbfe');
      else label(ctx, '✋ mostre a mão', W * 0.75, H * 0.76, MIN * 0.045, '#fde68a');
      // Barra de progresso de "segurar"
      if (hold > 0) { ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(W * 0.3, H * 0.93, W * 0.4, MIN * 0.03); ctx.fillStyle = '#4ade80'; ctx.fillRect(W * 0.3, H * 0.93, W * 0.4 * clamp(hold / this.HOLD, 0, 1), MIN * 0.03); }
      // Dica
      const hint = bh && live !== target ? (bh.r.hint ? `Quase: ${bh.r.hint}` : LETTERS[target].dica) : LETTERS[target].dica;
      label(ctx, hint, W / 2, H * 0.36, MIN * 0.036, '#fde68a');
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(W / 2, H * 0.4); ctx.lineTo(W / 2, H * 0.9); ctx.stroke();
      return bh?.r;
    },
    tick(dt, target) {
      const bh = bestHand(target);
      if (bh && bh.r.letter === target) { this.hold += dt; if (this.hold >= this.HOLD) { this.hold = 0; return true; } }
      else this.hold = Math.max(0, this.hold - dt * 2);
      return false;
    },
  };

  // ---- Modo APRENDER
  const aprender = {
    ...base, name: 'Aprender Libras',
    start() { this.idx = 0; this.hold = 0; this.done = 0; this.t = 0; show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'LETRA'); setText('hudLevel', `1/${ORDER.length}`); setText('hudTime', '∞'); hide('hudCombo'); hide('hudP'); },
    update(dt) {
      this.t += dt; const target = ORDER[this.idx];
      if (this.tick(dt, target)) {
        this.done++; sfx.level(); banner(`${target} ✓`); emit(api.W * 0.75, api.H * 0.42, 30, 'dust');
        this.idx++; setText('hudScore', String(this.done * 100)); setText('hudLevel', `${Math.min(this.idx + 1, ORDER.length)}/${ORDER.length}`);
        if (this.idx >= ORDER.length) return api.endMini({ title: 'ALFABETO CONCLUÍDO!', score: this.done * 100, bestKey: 'bestLibras', stats: `${ORDER.length} letras em ${fmtTime(this.t)}` });
      }
    },
    render(ctx, t) { this.common(ctx, t, 'APRENDER LIBRAS', 'Faça o sinal da letra e segure até a barra encher'); this.drawPair(ctx, ORDER[this.idx], this.hold); },
  };

  // ---- Modo SOLETRAR
  const soletrar = {
    ...base, name: 'Soletrar em Libras', DURATION: 90,
    start() { this.t = 0; this.score = 0; this.words = 0; this.hold = 0; this.nextWord(); show('hud'); setText('hudScore', '0'); setText('hudLevelLabel', 'PALAVRAS'); setText('hudLevel', '0'); setText('hudTime', fmtTime(this.DURATION)); hide('hudCombo'); hide('hudP'); },
    nextWord() { this.word = pick(WORDS.filter((w) => w !== this.word)); this.pos = 0; this.wordStart = this.t; },
    update(dt) {
      this.t += dt; if (this.t >= this.DURATION) return api.endMini({ title: 'TEMPO ESGOTADO!', score: this.score, bestKey: 'bestSoletrar', stats: `${this.words} palavras soletradas` });
      const target = this.word[this.pos];
      if (this.tick(dt, target)) {
        this.score += 100; this.pos++; sfx.patch(this.pos); emit(api.W * 0.75, api.H * 0.42, 20, 'dust');
        if (this.pos >= this.word.length) { const bonus = Math.max(0, Math.round((12 - (this.t - this.wordStart)) * 25)); this.score += 200 + bonus; this.words++; banner(`${this.word}! +${200 + bonus}`); sfx.level(); this.nextWord(); }
        setText('hudScore', this.score.toLocaleString('pt-BR')); setText('hudLevel', String(this.words));
      }
      setText('hudTime', fmtTime(this.DURATION - this.t));
    },
    render(ctx, t) {
      const W = api.W, H = api.H, MIN = api.MIN;
      this.common(ctx, t, 'SOLETRAR', null);
      // Palavra com a letra atual destacada
      const size = MIN * 0.075, total = this.word.length * size * 0.9, x0 = W / 2 - total / 2 + size * 0.45;
      this.word.split('').forEach((ch, i) => label(ctx, ch, x0 + i * size * 0.9, H * 0.28, size, i < this.pos ? '#4ade80' : i === this.pos ? '#fde047' : 'rgba(255,255,255,.45)'));
      this.drawPair(ctx, this.word[this.pos], this.hold);
    },
  };

  $('btnLibras').addEventListener('click', () => api.startMini(aprender));
  $('btnSoletrar').addEventListener('click', () => api.startMini(soletrar));
  window.__libras = { LETTERS, features, recognize };
  return { aprender, soletrar };
}
