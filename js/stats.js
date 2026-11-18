// =============================================================================
// ESTATÍSTICAS ANÔNIMAS (acessos, jogos, incidentes) → GoatCounter
// -----------------------------------------------------------------------------
// Sem cookies, sem identificador do aparelho, sem texto digitado, sem imagem da câmera.
// Só contadores: "jogo/inicio/batatinha", "incidente/camera-NotAllowedError" etc.
// Respeita "Do Not Track" e a opção em Ajustes. Não conta em localhost nem em testes
// automatizados (navigator.webdriver). Incidentes contam no máximo 1 vez por sessão.
// =============================================================================
import { STATS_CODE } from './config.js';

const OPT = 'represa.stats';
export function statsOn() {
  try { if (localStorage.getItem(OPT) === 'off') return false; } catch { /* */ }
  return !!STATS_CODE && navigator.doNotTrack !== '1' && window.doNotTrack !== '1';
}
export function setStatsOn(v) { try { localStorage.setItem(OPT, v ? 'on' : 'off'); } catch { /* */ } }

const sent = new Set();
const blocked = () => !statsOn() || /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname) || location.protocol === 'file:' || navigator.webdriver;
/** Conta um evento (ou um acesso de página quando event=false). unique = só 1 vez por sessão. */
export function track(path, { title = '', event = true, unique = false } = {}) {
  if (blocked()) return;
  path = String(path).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9/\-_.:]+/g, '-').slice(0, 120);
  if (unique) { if (sent.has(path)) return; sent.add(path); }
  const q = new URLSearchParams({ p: event ? path : '/' + path.replace(/^\//, ''), t: title || path, e: event ? 'true' : 'false', rnd: Math.random().toString(36).slice(2, 9), s: `${screen.width},${screen.height},${window.devicePixelRatio || 1}` });
  if (!event && document.referrer && !document.referrer.startsWith(location.origin)) q.set('r', document.referrer);
  const url = `https://${STATS_CODE}.goatcounter.com/count?${q}`;
  try { if (!(navigator.sendBeacon && navigator.sendBeacon(url))) new Image().src = url; } catch { /* sem rede: ignora */ }
}
export const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^best/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Erros de JavaScript viram incidentes (só arquivo:linha, nunca o conteúdo da tela)
window.addEventListener('error', (e) => { const f = String(e.filename || '').split('/').pop() || 'inline'; track(`incidente/js-erro/${f}:${e.lineno || 0}`, { unique: true }); });
window.addEventListener('unhandledrejection', (e) => track(`incidente/promessa/${slug(e.reason?.name || 'erro')}`, { unique: true }));
