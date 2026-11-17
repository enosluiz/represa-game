// =============================================================================
// FEEDBACK + DIAGNÓSTICO
//   • Tela "Feedback": nota (1–5), categorias rápidas (escolhíveis só com a mão),
//     mensagem e contato opcionais (teclado do celular) e diagnóstico técnico opcional.
//     Envio por FormSubmit (formulário → email, sem servidor próprio). O destino fica
//     em js/config.js (FEEDBACK_KEY). Sem internet ou sem destino configurado, guarda
//     numa fila local e reenvia quando possível.
//   • Tela "Testar câmera": vídeo em tela cheia com o esqueleto da mão, métricas ao
//     vivo e um veredito em português simples do motivo provável de falha.
//
// PRIVACIDADE: nenhuma imagem da câmera é enviada. Só texto: o que a pessoa escreve e,
// se ela deixar marcado, dados técnicos (aparelho, navegador, desempenho da IA).
// =============================================================================
import { FEEDBACK_KEY } from './config.js';
const ENDPOINT = FEEDBACK_KEY ? `https://formsubmit.co/ajax/${encodeURIComponent(FEEDBACK_KEY)}` : '';
const QUEUE_KEY = 'represa.fbQueue';

const CATEGORIES = [
  { id: 'camera', label: 'A câmera não vê minha mão', icon: 'scan-eye' },
  { id: 'lento', label: 'Travou ou ficou lento', icon: 'activity' },
  { id: 'dificil', label: 'Difícil demais', icon: 'shield' },
  { id: 'facil', label: 'Fácil demais', icon: 'sparkles' },
  { id: 'ideia', label: 'Tenho uma ideia', icon: 'message-square' },
  { id: 'gostei', label: 'Gostei!', icon: 'star' },
];

export function install(api) {
  const { $, state, settings, stats, toast, icon, showScreen } = api;
  const fb = { rating: 0, cats: new Set(), returnTo: null };

  // ---------------------------------------------------------------------------
  // Envio e fila offline
  // ---------------------------------------------------------------------------
  const loadQ = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };
  const saveQ = (q) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-20))); } catch { /* sem storage */ } };
  async function post(payload) {
    if (!ENDPOINT) throw new Error('destino não configurado');
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json().catch(() => ({}));
    if (j.success === 'false' || j.success === false) throw new Error(j.message || 'recusado');
    return j;
  }
  async function flushQueue() {
    if (!navigator.onLine || !ENDPOINT) return;
    const q = loadQ(); if (!q.length) return;
    const rest = [];
    for (const p of q) { try { await post(p); } catch { rest.push(p); } }
    saveQ(rest);
    if (rest.length < q.length) toast(`Feedback pendente enviado (${q.length - rest.length}).`);
  }
  window.addEventListener('online', flushQueue);
  setTimeout(flushQueue, 4000);

  // ---------------------------------------------------------------------------
  // Diagnóstico técnico (texto legível; a pessoa vê antes de enviar)
  // ---------------------------------------------------------------------------
  function diagnostics() {
    const v = document.getElementById('video');
    return {
      'Versão do app': api.APP_VERSION,
      'Data/hora': new Date().toLocaleString('pt-BR'),
      'Navegador': navigator.userAgent,
      'Tela': `${screen.width}×${screen.height} @${(devicePixelRatio || 1).toFixed(2)} · janela ${innerWidth}×${innerHeight}`,
      'Instalado como app': api.isStandalone() ? 'sim' : 'não',
      'Online': navigator.onLine ? 'sim' : 'não',
      'Câmera': `${settings.facing === 'user' ? 'frontal' : 'traseira'} · ${v?.videoWidth || 0}×${v?.videoHeight || 0} · espelhar ${settings.mirror ? 'sim' : 'não'} · zoom ${api.zoom ? api.zoom() : 1}× (${settings.zoom})`,
      'IA': `${stats.delegate} (escolha: ${settings.delegate}) · ${stats.inferMs.toFixed(1)} ms/quadro · ${stats.detFps} detecções/s`,
      'Desempenho': `${stats.fps} fps de tela`,
      'Mãos': `vistas em ${stats.handsEver} quadros · máx. simultâneas ${stats.maxHands || 0} · tamanho da última ${stats.handSize ? Math.round(stats.handSize * 100) + '% da largura' : '—'}`,
      'Luz': `${state.luma != null ? Math.round(state.luma) : '—'} de 255${state.lowLight ? ' (POUCA LUZ)' : ''}`,
      'Ajustes': `contato ${settings.contact} · modo TV ${settings.tvMode ? 'sim' : 'não'} · jogadores ${settings.players}`,
      'Último jogo': state.lastGame || '—',
    };
  }
  const diagText = () => Object.entries(diagnostics()).map(([k, v]) => `${k}: ${v}`).join('\n');

  // ---------------------------------------------------------------------------
  // Tela de feedback
  // ---------------------------------------------------------------------------
  $('fbCats').innerHTML = CATEGORIES.map((c) => `<button class="fb-cat" data-cat="${c.id}" data-hover aria-pressed="false">${icon(c.icon)}<span>${c.label}</span></button>`).join('');
  $('fbStars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="fb-star" data-star="${n}" data-hover aria-label="${n} de 5">${icon('star')}</button>`).join('');

  function paint() {
    for (const b of document.querySelectorAll('.fb-star')) b.classList.toggle('on', +b.dataset.star <= fb.rating);
    for (const b of document.querySelectorAll('.fb-cat')) { const on = fb.cats.has(b.dataset.cat); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
    $('fbDiagText').textContent = diagText();
    $('fbSend').disabled = !(fb.rating || fb.cats.size || $('fbMsg').value.trim());
  }
  document.querySelectorAll('.fb-star').forEach((b) => b.addEventListener('click', () => { fb.rating = +b.dataset.star; paint(); }));
  document.querySelectorAll('.fb-cat').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.cat; if (fb.cats.has(id)) fb.cats.delete(id); else fb.cats.add(id); paint(); }));
  $('fbMsg').addEventListener('input', paint);

  function openFeedback(preselect) {
    fb.returnTo = { phase: state.phase, screen: api.currentScreen() };
    fb.rating = 0; fb.cats = new Set(preselect ? [preselect] : []); $('fbMsg').value = '';
    $('fbResult').textContent = ''; $('fbResult').className = 'fb-result';
    $('fbDiag').checked = true; $('fbSend').innerHTML = `${icon('send')} Enviar`;
    state.phase = 'feedback'; showScreen('feedback'); paint();
  }
  function closeFeedback() {
    const r = fb.returnTo;
    if (r && r.screen && !['feedback', 'camtest'].includes(r.phase)) { state.phase = r.phase; showScreen(r.screen); }
    else api.goMenu();
  }
  $('fbBack').addEventListener('click', closeFeedback);

  $('fbSend').addEventListener('click', async () => {
    const btn = $('fbSend'); if (btn.disabled) return;
    const cats = CATEGORIES.filter((c) => fb.cats.has(c.id)).map((c) => c.label);
    const payload = {
      _subject: `Levanta e Brinca · feedback${fb.rating ? ' ★' + fb.rating : ''}${cats.length ? ' · ' + cats[0] : ''}`,
      _template: 'table', _captcha: 'false',
      'Avaliação': fb.rating ? `${'★'.repeat(fb.rating)}${'☆'.repeat(5 - fb.rating)} (${fb.rating}/5)` : 'não informada',
      'Categorias': cats.join(' · ') || '—',
      'Mensagem': $('fbMsg').value.trim() || '—',
      'Contato': $('fbContact').value.trim() || '—',
      'Diagnóstico': $('fbDiag').checked ? diagText() : 'não autorizado',
    };
    btn.disabled = true; btn.innerHTML = `${icon('refresh-cw', 'ico spin')} Enviando…`;
    const res = $('fbResult');
    try {
      if (!navigator.onLine) throw new Error('offline');
      await post(payload);
      res.textContent = 'Recebido, obrigado! Sua mensagem foi para o editor.'; res.className = 'fb-result ok';
      btn.innerHTML = `${icon('check')} Enviado`; api.sfx.level();
      setTimeout(closeFeedback, 2200);
    } catch {
      const q = loadQ(); q.push(payload); saveQ(q);
      res.textContent = !navigator.onLine ? 'Sem internet: guardei e envio quando a conexão voltar.'
        : !ENDPOINT ? 'Guardado no aparelho (envio por email ainda não configurado pelo editor).'
        : 'Não consegui enviar agora. Guardei e tento de novo sozinho.';
      res.className = 'fb-result warn'; btn.innerHTML = `${icon('check')} Guardado`;
      setTimeout(closeFeedback, 2600);
    }
  });

  // ---------------------------------------------------------------------------
  // Tela "Testar câmera"
  // ---------------------------------------------------------------------------
  const ct = { since: 0, noHandFor: 0 };
  async function openCamTest() {
    if (!api.hasTracker()) { const ok = await api.activateCamera(); if (!ok) return; }
    ct.since = performance.now(); ct.noHandFor = 0;
    state.phase = 'camtest'; showScreen('camtest');
  }
  /** Veredito do teste: { level: ok|warn|bad, text }. */
  function verdict(now, dt) {
    const hands = state.lastLandmarks.length;
    ct.noHandFor = hands ? 0 : ct.noHandFor + dt;
    const v = document.getElementById('video');
    if (!v || v.readyState < 2) return { level: 'bad', text: 'A câmera não está enviando imagem. Feche outros apps que usam a câmera e reabra.' };
    if (now - ct.since > 3000 && stats.detFps === 0) return { level: 'bad', text: 'A IA não está processando. Na 1ª vez é preciso internet para baixar o modelo.' };
    if (hands) {
      if (stats.handSize && stats.handSize < 0.09) return { level: 'warn', text: 'Mão detectada, mas pequena: chegue mais perto da câmera (0,5 a 1,5 m).' };
      if (stats.inferMs > 70) return { level: 'warn', text: `Mão detectada, mas a IA está lenta (${Math.round(stats.inferMs)} ms). Teste a outra opção de processamento.` };
      return { level: 'ok', text: `Mão detectada! ${hands === 2 ? 'Duas mãos.' : 'Mostre a outra mão também.'} Pode jogar.` };
    }
    if (ct.noHandFor < 2) return { level: 'warn', text: 'Mostre a palma da mão aberta, de frente para a câmera.' };
    if (state.lowLight) return { level: 'bad', text: 'Pouca luz. Acenda a luz de frente para você (não atrás).' };
    if (stats.delegate === 'GPU' && ct.noHandFor > 5) return { level: 'bad', text: 'Nenhuma mão em 5 s com a IA na GPU. Toque em "Trocar para CPU" e teste de novo.' };
    if (state.luma > 200) return { level: 'warn', text: 'Imagem estourada (clara demais). Evite janela ou lâmpada atrás de você.' };
    return { level: 'bad', text: 'Nenhuma mão ainda. Fique a 0,5–1,5 m, palma aberta de frente, com fundo sem muita bagunça.' };
  }
  function updateCamTest(now, dt) {
    const v = verdict(now, dt), el = $('ctVerdict');
    if (el.textContent !== v.text) { el.textContent = v.text; el.className = `ct-verdict ${v.level}`; }
    $('ctStats').innerHTML = [
      ['IA', `${stats.delegate} · ${stats.inferMs.toFixed(0)} ms`],
      ['Detecções/s', stats.detFps],
      ['Mãos', state.lastLandmarks.length],
      ['Tamanho da mão', stats.handSize ? Math.round(stats.handSize * 100) + '%' : '—'],
      ['Luz', state.luma != null ? Math.round(state.luma) : '—'],
      ['Zoom', `${(api.zoom ? api.zoom() : 1).toFixed(1).replace('.', ',')}×`],
    ].map(([k, val]) => `<div><span>${k}</span><b>${val}</b></div>`).join('');
    const label = `Trocar para ${stats.delegate === 'GPU' ? 'CPU' : 'GPU'}`;
    if (!$('ctSwitch').textContent.includes(label)) $('ctSwitch').innerHTML = `${icon('cpu')} ${label}`;
  }
  $('ctSwitch').addEventListener('click', async () => {
    settings.delegate = stats.delegate === 'GPU' ? 'CPU' : 'GPU'; api.saveSettings();
    await api.reloadTracker(); ct.since = performance.now(); ct.noHandFor = 0;
  });
  $('ctSend').addEventListener('click', () => openFeedback('camera'));
  $('ctBack').addEventListener('click', () => api.goMenu());

  return { openFeedback, openCamTest, updateCamTest, flushQueue, diagnostics, configured: !!ENDPOINT };
}
