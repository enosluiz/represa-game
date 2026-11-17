// =============================================================================
// IDIOMAS — Português (original), English, Español
// -----------------------------------------------------------------------------
// Tradução só na EXIBIÇÃO; o código continua escrito em português (regras, testes
// de conquista e textos de diagnóstico enviados ao editor não mudam).
//   • DOM: um MutationObserver traduz cada texto/atributo que aparece ou muda
//     (inclui banner, toast, telas de resultado montadas com innerHTML).
//   • Canvas: fillText / strokeText / measureText passam pelo tradutor, então tudo
//     o que os jogos desenham sai traduzido sem mexer em cada jogo.
//   • Chaves com {} são modelos: "Recorde: {}" casa com "Recorde: 2.288"; o trecho
//     capturado também é traduzido (ex.: nome do jogo dentro da frase).
// =============================================================================
import { DICT } from './i18n-dict.js';

export const LANGS = [
  { id: 'pt', label: 'Português', short: 'PT', html: 'pt-BR' },
  { id: 'en', label: 'English', short: 'EN', html: 'en' },
  { id: 'es', label: 'Español', short: 'ES', html: 'es' },
];
const KEY = 'represa.lang';
const IDX = { en: 0, es: 1 };

function detect() {
  try { const s = localStorage.getItem(KEY); if (s && IDX[s] !== undefined || s === 'pt') return s; } catch { /* */ }
  const n = (navigator.languages && navigator.languages[0]) || navigator.language || 'pt';
  return /^es/i.test(n) ? 'es' : /^en/i.test(n) ? 'en' : 'pt';
}
export let lang = detect();
window.__t = (s) => t(s);   // depuração: ver tradução no console

// ---- tabela: exatas + modelos com {} ----
const EXACT = new Map(), PATTERNS = [];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const [k, v] of Object.entries(DICT)) {
  if (k.includes('{}')) PATTERNS.push({ re: new RegExp('^' + k.split('{}').map(esc).join('([\\s\\S]*?)') + '$'), v, n: k.split('{}').length - 1, len: k.length });
  else EXACT.set(k, v);
}
PATTERNS.sort((a, b) => b.len - a.len);   // modelo mais específico primeiro

const cache = new Map();
const EDGE = /^([\s·•|/–\-:,]*)([\s\S]*?)([\s]*)$/;
/** Traduz um texto completo (preserva espaços e separadores nas pontas). */
export function t(s, depth = 0) {
  if (lang === 'pt' || typeof s !== 'string' || !/[A-Za-zÀ-ú]/.test(s)) return s;
  const hit = cache.get(s); if (hit !== undefined) return hit;
  let out = s;
  const m = EDGE.exec(s), pre = m[1], core = m[2], post = m[3];
  const ex = EXACT.get(core);
  if (ex) out = pre + ex[IDX[lang]] + post;
  else if (depth < 3) {
    for (const p of PATTERNS) {
      const mm = p.re.exec(core); if (!mm) continue;
      let i = 0; out = pre + p.v[IDX[lang]].replace(/\{\}/g, () => t(mm[++i] ?? '', depth + 1)) + post; break;
    }
  }
  if (cache.size > 4000) cache.clear();
  cache.set(s, out);
  return out;
}

// ---- Canvas ----
(function patchCanvas() {
  const P = CanvasRenderingContext2D.prototype;
  for (const name of ['fillText', 'strokeText', 'measureText']) {
    const orig = P[name];
    P[name] = function (s, ...rest) { return orig.call(this, lang === 'pt' ? s : t(String(s)), ...rest); };
  }
})();

// ---- DOM ----
const ORIG = new WeakMap(), OUT = new WeakMap();
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'CANVAS', 'svg', 'SVG', 'path', 'VIDEO', 'TEXTAREA']);
function doText(node) {
  const cur = node.data;
  let orig = OUT.get(node) === cur ? ORIG.get(node) : cur;
  if (OUT.get(node) !== cur) ORIG.set(node, cur);
  const out = t(orig);
  if (out !== cur) node.data = out;
  OUT.set(node, out);
}
function doEl(el) {
  for (const a of ATTRS) {
    if (!el.hasAttribute || !el.hasAttribute(a)) continue;
    const k = 'i18n' + a.replace(/-./g, (x) => x[1].toUpperCase());
    const cur = el.getAttribute(a);
    if (el.dataset[k + 'Out'] !== cur) el.dataset[k] = cur;
    const out = t(el.dataset[k]); el.dataset[k + 'Out'] = out;
    if (out !== cur) el.setAttribute(a, out);
  }
}
function walk(root) {
  if (root.nodeType === 3) { if (!root.parentElement || !SKIP.has(root.parentElement.nodeName)) doText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
  doEl(root);
  for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
}
let observer = null;
export function installDom(onChange) {
  document.documentElement.lang = LANGS.find((l) => l.id === lang).html;
  walk(document.body);
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') { const n = m.target; if (OUT.get(n) !== n.data && (!n.parentElement || !SKIP.has(n.parentElement.nodeName))) doText(n); }
      else if (m.type === 'attributes') { if (ATTRS.includes(m.attributeName)) doEl(m.target); }
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  installDom.onChange = onChange;
}
export function setLang(id) {
  if (!LANGS.some((l) => l.id === id) || id === lang) return;
  lang = id; cache.clear();
  try { localStorage.setItem(KEY, id); } catch { /* */ }
  document.documentElement.lang = LANGS.find((l) => l.id === id).html;
  // re-traduz a partir dos originais guardados
  (function re(root) {
    if (root.nodeType === 3) { if (ORIG.has(root)) { const out = t(ORIG.get(root)); root.data = out; OUT.set(root, out); } else doText(root); return; }
    if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
    doEl(root); for (let c = root.firstChild; c; c = c.nextSibling) re(c);
  })(document.body);
  installDom.onChange?.(id);
}

// ---- Bandeiras (SVG simples, sem emoji: emoji de bandeira não aparece no Windows/TVs) ----
export const FLAGS = {
  pt: '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#009b3a"/><path d="M15 2.6 27.4 10 15 17.4 2.6 10z" fill="#fedf00"/><circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9.1c3-.9 6.2-.6 8.8.9" stroke="#fff" stroke-width=".9" fill="none"/></svg>',
  en: '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff"/><g fill="#b22234">' +
    Array.from({ length: 7 }, (_, i) => `<rect y="${(i * 2 * 20) / 13}" width="30" height="${20 / 13}"/>`).join('') +
    '</g><rect width="13" height="10.77" fill="#3c3b6e"/><g fill="#fff">' +
    Array.from({ length: 12 }, (_, i) => `<circle cx="${1.6 + (i % 4) * 3.3 + (Math.floor(i / 4) % 2) * 1.6}" cy="${1.8 + Math.floor(i / 4) * 3.4}" r=".75"/>`).join('') + '</g></svg>',
  es: '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/></svg>',
};
