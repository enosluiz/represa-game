// =============================================================================
// LEVANTA E BRINCA — jogos de hand tracking (MediaPipe) · Represa (10 cenários) + minijogos · 1–2 jogadores
// =============================================================================
// Módulos deste arquivo (ordem):
//   0 Config  1 Estado/utils  2 Canvas  3 Câmera  4 Tracker  5 Input/cursores/jogadores
//   6 Cenários (10)  7 Lógica do jogo  8 Render  9 HUD/UI  10 Fluxo de telas
//   11 Áudio  12 Plataforma/PWA  13 Eventos  14 Loop
// =============================================================================

import { texture, vignette, spotlight, sphere, groundShadow, sky, crowd, clearArtCache } from './art.js';

// Assets do MediaPipe: cópia local (funciona offline) com fallback para CDN
const MP_VERSION   = '0.10.14';
const LOCAL_MP     = new URL('../vendor/mediapipe/', import.meta.url).href;
const CDN_MP       = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/`;
const LOCAL_MODEL  = new URL('../models/hand_landmarker.task', import.meta.url).href;
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** Parâmetros de "game feel" (balanceamento). */
const CONFIG = {
  HOLD_MS: 380, HIT_PADDING: 1.1, PATCH_DECAY: 1.5,
  BASE_SPAWN_MS: 2200, MIN_SPAWN_MS: 450, SPAWN_DECAY: 0.86,
  BASE_MAX_HOLES: 3, MAX_HOLES_CAP: 9, LEVEL_SECONDS: 18,
  BASE_FLOW: 1.0, FLOW_LEVEL_GAIN: 0.18, FLOW_AGE_GAIN: 1.0,
  HOLE_R_BASE: 0.068, HOLE_R_MIN: 0.040, HOLE_R_SHRINK: 0.003,
  COMBO_WINDOW_S: 2.0,
  REACH_GAIN: 1.18, SMOOTH_MIN: 0.35, SMOOTH_SPEED_REF: 0.06,
  CURSOR_TTL_MS: 220, HAND_LOST_MS: 900, HOVER_CLICK_MS: 1200,
  MAX_PARTICLES: 800, MAX_DPR: 1.75,
  SCENARIO_SECONDS: 45,
};

const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

// =============================================================================
// 1. UTILITÁRIOS, SETTINGS, ESTADO
// =============================================================================
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function loadJSON(key, def) { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } }
function saveJSON(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* sem storage */ } }

const settings = loadJSON('represa.settings', {
  facing: 'user', mirror: true, contact: 'palm', camOpacity: 0.3, tvMode: false, debug: false,
  players: 'auto',   // 'auto' | '1' | '2'
  delegate: 'auto',  // 'auto' | 'GPU' | 'CPU' — alguns Android falham em silêncio na GPU
});
const saveSettings = () => saveJSON('represa.settings', settings);

// Progresso da campanha: estrelas por cenário e recordes
const progress = loadJSON('represa.progress', { stars: {}, bestCampaign: 0, bestEndless: 0 });
const saveProgress = () => saveJSON('represa.progress', progress);

const state = {
  phase: 'boot',       // boot | menu | select | intro | countdown | playing | paused | result | over
  countdown: 0, lastCount: 0,
  lastHandAt: 0, lastLandmarks: [], lowLight: false, lastLightCheck: 0,
  shake: 0,            // intensidade de tremor de tela
  mode: 'campaign',    // 'campaign' | 'endless'
  scenarioIdx: 0,
  p2SeenAt: -1e9,      // última vez que uma mão do lado do jogador 2 foi vista (modo auto)
};
const stats = { fps: 0, detFps: 0, inferMs: 0, frames: 0, detFrames: 0, lastTick: 0, delegate: '-', handsEver: 0 };

let game = null;

// =============================================================================
// 2. CANVAS
// =============================================================================
// Polyfill: roundRect não existe em iOS < 16 / Chrome < 99
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Array.isArray(r) ? r[0] : r, Math.abs(w) / 2, Math.abs(h) / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); return this;
  };
}
const gameCanvas = $('game'), gctx = gameCanvas.getContext('2d');
const fxCanvas = $('fx'), fctx = fxCanvas.getContext('2d');
let W = 0, H = 0, MIN = 1, DPR = 1, bgCache = null, bgCacheKey = '';

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
  W = window.innerWidth; H = window.innerHeight; MIN = Math.min(W, H);
  for (const c of [gameCanvas, fxCanvas]) {
    c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    c.style.width = W + 'px'; c.style.height = H + 'px';
  }
  gctx.setTransform(DPR, 0, 0, DPR, 0, 0); fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bgCacheKey = '';
}

function playArea() { return { left: W * 0.06, right: W * 0.94, top: H * 0.19, bottom: floodY() - MIN * 0.06 }; }
function floodY() { const lost = game ? game.waterLost : 0; return H - H * (0.05 + 0.15 * clamp(lost, 0, 100) / 100); }

// =============================================================================
// 3. CÂMERA
// =============================================================================
const video = $('video');
let stream = null;
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não dá acesso à câmera.');
  stream = await navigator.mediaDevices.getUserMedia({ audio: false,
    video: { facingMode: { ideal: settings.facing }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
  video.srcObject = stream; await video.play();
  const s = stream.getVideoTracks()[0]?.getSettings?.() || {};
  if (s.facingMode === 'user' || s.facingMode === 'environment') settings.facing = s.facingMode;
  lastVideoTime = -1; updateChips();
}
function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
function explainError(err) {
  switch (err?.name) {
    case 'NotAllowedError': return '🚫 Permissão da câmera negada. Libere nas configurações do navegador e recarregue.';
    case 'NotFoundError': return '🚫 Nenhuma câmera encontrada.';
    case 'NotReadableError': return '🚫 A câmera está em uso por outro app.';
    case 'OverconstrainedError': return '🚫 Esta câmera não suporta a configuração pedida.';
    default:
      if (/fetch|network|load/i.test(String(err?.message))) return '🌐 Não consegui baixar o modelo de IA. Na 1ª vez é preciso internet; depois funciona offline.';
      return '⚠️ Erro: ' + (err?.message || err);
  }
}

// =============================================================================
// 4. TRACKER
// =============================================================================
let tracker = null, lastVideoTime = -1;
async function loadVision() {
  try { return { mp: await import(`${LOCAL_MP}vision_bundle.js`), wasm: `${LOCAL_MP}wasm` }; }
  catch (e) { console.warn('MediaPipe local indisponível, usando CDN', e); return { mp: await import(`${CDN_MP}vision_bundle.mjs`), wasm: `${CDN_MP}wasm` }; }
}
async function resolveModelUrl() {
  try { const r = await fetch(LOCAL_MODEL, { method: 'HEAD' }); if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) return LOCAL_MODEL; } catch { /* */ }
  return REMOTE_MODEL;
}
async function initTracker() {
  const { mp, wasm } = await loadVision();
  const { FilesetResolver, HandLandmarker } = mp;
  const fileset = await FilesetResolver.forVisionTasks(wasm);
  const modelUrl = await resolveModelUrl();
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: modelUrl, delegate }, runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
  if (settings.delegate === 'CPU') { tracker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); stats.delegate = 'CPU'; return; }
  try { tracker = await HandLandmarker.createFromOptions(fileset, opts('GPU')); stats.delegate = 'GPU'; }
  catch (e) { console.warn('GPU indisponível, usando CPU', e); if (settings.delegate === 'GPU') throw e; tracker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); stats.delegate = 'CPU'; }
}
/** Troca GPU↔CPU em tempo real (sem recarregar). */
async function switchDelegate() {
  const order = ['auto', 'GPU', 'CPU']; settings.delegate = order[(order.indexOf(settings.delegate) + 1) % 3]; saveSettings(); updateChips();
  if (!tracker) return;
  const old = tracker; tracker = null; try { old.close?.(); } catch { /* */ }
  try { await initTracker(); toast(`IA rodando em ${stats.delegate}`); } catch (e) { setStatus(explainError(e), true); }
}
function detectHands(now) {
  if (!tracker || video.readyState < 2 || video.currentTime === lastVideoTime) return null;
  lastVideoTime = video.currentTime;
  const t0 = performance.now();
  try { const res = tracker.detectForVideo(video, now); stats.inferMs = performance.now() - t0; stats.detFrames++; return res; }
  catch (e) { console.warn('detectForVideo falhou', e); return null; }
}

// =============================================================================
// 5. INPUT: landmarks → cursores; cursores → jogadores
// =============================================================================
let cursors = [], nextCursorId = 1;
const PLAYER_COLORS = { 1: '#38bdf8', 2: '#fb923c' };

function contactPoint(lm) {
  if (settings.contact === 'index') return lm[8];
  let x = 0, y = 0; for (const i of [0, 5, 9, 13, 17]) { x += lm[i].x; y += lm[i].y; }
  return { x: x / 5, y: y / 5 };
}
function toScreen(p) {
  const g = CONFIG.REACH_GAIN, nx = settings.mirror ? 1 - p.x : p.x;
  return { x: (0.5 + (nx - 0.5) * g) * W, y: (0.5 + (p.y - 0.5) * g) * H };
}
function contactRadius() { return MIN * (settings.contact === 'palm' ? 0.05 : 0.022); }

/** Quantos jogadores estão ativos agora (modo auto: 2 se alguém foi visto do lado direito há pouco). */
function activePlayers(now = performance.now()) {
  if (settings.players === '1') return 1;
  if (settings.players === '2') return 2;
  return now - state.p2SeenAt < 4000 ? 2 : 1;
}

let ghosts = [];                                   // cursores recém-perdidos (até HAND_LOST_MS)
// Raio de pareamento: largo quando só há uma mão (sem ambiguidade), estreito com várias (evita troca cruzada)
const MATCH_R = (nPts) => (nPts <= 1 && cursors.length <= 1 ? MIN * 0.7 : MIN * 0.22);

function updateCursors(res, now) {
  state.lastLandmarks = res.landmarks || [];
  if (state.lastLandmarks.length) stats.handsEver++;
  const pts = state.lastLandmarks.map((lm) => { const p = toScreen(contactPoint(lm)); return { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H), raw: toScreen(lm[0]), lm }; });
  // 1) Pareamento global por distância (sem troca cruzada entre mãos próximas)
  const pairs = [];
  pts.forEach((p, i) => cursors.forEach((c) => pairs.push({ i, c, d: Math.hypot(c.x - p.x, c.y - p.y) })));
  pairs.sort((a, b) => a.d - b.d);
  const usedP = new Set(), usedC = new Set();
  for (const { i, c, d } of pairs) {
    if (d > MATCH_R(pts.length) || usedP.has(i) || usedC.has(c)) continue;
    usedP.add(i); usedC.add(c);
    const p = pts[i], a = clamp(CONFIG.SMOOTH_MIN + d / (MIN * CONFIG.SMOOTH_SPEED_REF), CONFIG.SMOOTH_MIN, 1);
    c.x += (p.x - c.x) * a; c.y += (p.y - c.y) * a; c.lastSeen = now; updateGesture(c, p.lm, now);
  }
  // 2) Pontos órfãos: herdam id/jogador de um "fantasma" próximo (mão que piscou); senão, lado de entrada
  pts.forEach((p, i) => {
    if (usedP.has(i)) return;
    const gi = ghosts.findIndex((g) => Math.hypot(g.x - p.x, g.y - p.y) < MIN * 0.3);
    const ghost = gi >= 0 ? ghosts.splice(gi, 1)[0] : null;
    const player = settings.players === '1' ? 1 : ghost ? ghost.player : (p.raw.x < W / 2 ? 1 : 2);
    const c = ghost ? Object.assign(ghost, { x: p.x, y: p.y, lastSeen: now })
                    : { id: nextCursorId++, x: p.x, y: p.y, lastSeen: now, player, wind: 0, gesture: 'none', fingers: 0, gestureSince: now };
    updateGesture(c, p.lm, now); cursors.push(c);
  });
  // 3) Dois jogadores só com DUAS mãos simultâneas em lados opostos
  if (pts.some((p) => p.raw.x < W / 2) && pts.some((p) => p.raw.x >= W / 2)) state.p2SeenAt = now;
}

/**
 * Classificador de gestos por geometria: dedo "estendido" quando a ponta está mais longe
 * do punho que a articulação do meio. Resultados: 'fist' (0–1 dedos), 'scissors'
 * (indicador+médio), 'open' (4–5 dedos), 'other'. Precisa da mão de frente para a câmera.
 */
function classifyGesture(lm) {
  const d = (a, b) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  const ratio = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => d(tip, 0) / (d(pip, 0) || 1e-6));
  const ext = ratio.map((r) => r > 1.15);
  const thumb = d(4, 17) > d(3, 17) * 1.1;
  const n = ext.filter(Boolean).length + (thumb ? 1 : 0);
  const frontMin = Math.min(ratio[0], ratio[1]), backMax = Math.max(ratio[2], ratio[3]);
  if (frontMin > 1.15 && backMax < frontMin - 0.2) return { g: 'scissors', n }; // tolera anelar meio solto
  if (n <= 1) return { g: 'fist', n };
  if (n >= 4) return { g: 'open', n };
  return { g: 'other', n };
}
function updateGesture(c, lm, now) {
  c.lm = lm;
  const { g, n } = classifyGesture(lm);
  c.fingers = n;
  // Debounce: só troca de gesto depois de 3 leituras iguais (~100 ms), evita tremor
  if (g === c.pendingG) { if (++c.pendingN >= 3 && g !== c.gesture) { c.gesture = g; c.gestureSince = now; } }
  else { c.pendingG = g; c.pendingN = 1; }
}

function pruneCursors(now) {
  const alive = [], dead = [];
  for (const c of cursors) (now - c.lastSeen < CONFIG.CURSOR_TTL_MS ? alive : dead).push(c);
  cursors = alive; ghosts = ghosts.concat(dead).filter((g) => now - g.lastSeen < CONFIG.HAND_LOST_MS);
  if (cursors.length) state.lastHandAt = now;
}
/** Posição efetiva do cursor (com vento, nos cenários que têm). */
const cx = (c) => c.x + c.wind;

// =============================================================================
// 6. CENÁRIOS — 10 fases com identidade visual e mecânica própria
// =============================================================================
// Campos: id, name, tag (subtítulo), tip (instrução curta), colors {sky, wall, mortar, water, accent},
// mods (multiplicadores), rules (quais mecânicas estão ligadas), e um draw de fundo opcional.
const SCENARIOS = [
  { id: 'velha', name: 'A Represa Velha', tag: 'Cenário 1 · Treino', tip: 'Cubra o furo com a mão até o anel verde fechar.',
    colors: { sky: ['#1e293b', '#0f172a'], wall: ['#6b7380', '#3b414b'], mortar: 'rgba(0,0,0,.3)', water: ['#38bdf8', '#0369a1'], accent: '#facc15' },
    mods: { spawn: 1.15, flow: 0.85, size: 1.1, maxHoles: 3 }, rules: {} },

  { id: 'tempestade', name: 'Tempestade', tag: 'Cenário 2 · Vento e chuva', tip: 'O vento empurra sua mão. Compense o desvio.',
    colors: { sky: ['#1f2937', '#030712'], wall: ['#4b5563', '#1f2937'], mortar: 'rgba(0,0,0,.4)', water: ['#60a5fa', '#1e3a8a'], accent: '#a5b4fc' },
    mods: { spawn: 1.0, flow: 1.0, size: 1.0, maxHoles: 4 }, rules: { wind: true, rain: true, lightning: true } },

  { id: 'rachaduras', name: 'Rachaduras', tag: 'Cenário 3 · Reação em cadeia', tip: 'Furos com rachadura geram outro furo se demorar. Priorize-os!',
    colors: { sky: ['#292524', '#0c0a09'], wall: ['#a8a29e', '#57534e'], mortar: 'rgba(0,0,0,.35)', water: ['#7dd3fc', '#0c4a6e'], accent: '#fb923c' },
    mods: { spawn: 1.1, flow: 0.9, size: 1.0, maxHoles: 5 }, rules: { cracks: true } },

  { id: 'canos', name: 'Canos Rompidos', tag: 'Cenário 4 · Trabalho em dupla', tip: 'Canos grandes precisam de DUAS mãos ao mesmo tempo.',
    colors: { sky: ['#134e4a', '#042f2e'], wall: ['#5f7470', '#2f3e3b'], mortar: 'rgba(0,0,0,.35)', water: ['#5eead4', '#115e59'], accent: '#fde68a' },
    mods: { spawn: 1.05, flow: 0.9, size: 1.0, maxHoles: 4 }, rules: { pipes: true } },

  { id: 'apagao', name: 'Apagão', tag: 'Cenário 5 · No escuro', tip: 'Só a lanterna da sua mão revela a parede. Varra a tela.',
    colors: { sky: ['#0b0b14', '#000000'], wall: ['#3f3f55', '#1a1a26'], mortar: 'rgba(0,0,0,.5)', water: ['#818cf8', '#312e81'], accent: '#fef08a' },
    mods: { spawn: 1.1, flow: 0.85, size: 1.1, maxHoles: 4 }, rules: { dark: true } },

  { id: 'comporta', name: 'Comporta', tag: 'Cenário 6 · Válvulas', tip: 'Válvulas levam o dobro do tempo. Não solte antes do fim.',
    colors: { sky: ['#3f2f1e', '#1c1410'], wall: ['#8b6f47', '#4a3a24'], mortar: 'rgba(0,0,0,.35)', water: ['#fbbf24', '#92400e'], accent: '#f87171' },
    mods: { spawn: 1.0, flow: 1.0, size: 1.0, maxHoles: 5 }, rules: { valves: true } },

  { id: 'enchente', name: 'Enchente', tag: 'Cenário 7 · Ondas de pressão', tip: 'A cada onda, TODOS os furos vazam em dobro. Limpe a parede antes.',
    colors: { sky: ['#0c4a6e', '#082f49'], wall: ['#64748b', '#334155'], mortar: 'rgba(0,0,0,.35)', water: ['#22d3ee', '#0e7490'], accent: '#f472b6' },
    mods: { spawn: 0.95, flow: 1.0, size: 1.0, maxHoles: 5 }, rules: { surges: true } },

  { id: 'moveis', name: 'Furos Móveis', tag: 'Cenário 8 · Alvos em movimento', tip: 'Os furos deslizam pela parede. Acompanhe com a mão.',
    colors: { sky: ['#312e81', '#1e1b4b'], wall: ['#7c7fa6', '#3d3f66'], mortar: 'rgba(0,0,0,.35)', water: ['#a78bfa', '#4c1d95'], accent: '#34d399' },
    mods: { spawn: 1.0, flow: 0.95, size: 1.05, maxHoles: 5 }, rules: { moving: true } },

  { id: 'sabotagem', name: 'Sabotagem', tag: 'Cenário 9 · Armadilhas', tip: 'Furos VERMELHOS com X são bombas: tocar custa água.',
    colors: { sky: ['#450a0a', '#1c0505'], wall: ['#7f6b6b', '#3f3030'], mortar: 'rgba(0,0,0,.4)', water: ['#fb7185', '#881337'], accent: '#fbbf24' },
    mods: { spawn: 0.9, flow: 1.05, size: 1.0, maxHoles: 6 }, rules: { decoys: true, moving: false } },

  { id: 'chefe', name: 'O Grande Rompimento', tag: 'Cenário 10 · CHEFE', tip: 'Desgaste a brecha gigante cobrindo-a várias vezes. Ignore-a e tudo acaba.',
    colors: { sky: ['#1f1f1f', '#000000'], wall: ['#525252', '#171717'], mortar: 'rgba(0,0,0,.45)', water: ['#f97316', '#7c2d12'], accent: '#ef4444' },
    mods: { spawn: 0.85, flow: 1.0, size: 0.95, maxHoles: 5 }, rules: { boss: true, cracks: true, wind: false } },
];
const ENDLESS = { id: 'endless', name: 'Modo Infinito', tag: 'Sobreviva o máximo possível', tip: 'Tudo junto, cada vez mais rápido.',
  colors: SCENARIOS[0].colors, mods: { spawn: 1, flow: 1, size: 1, maxHoles: 9 }, rules: { cracks: true, pipes: true, valves: true, moving: true, decoys: true, surges: true } };

const scenario = () => game?.sc || SCENARIOS[0];
const rule = (k) => !!scenario().rules[k];

// =============================================================================
// 7. LÓGICA DO JOGO
// =============================================================================
function resetGame(sc, carryScore = 0) {
  game = {
    sc, score: carryScore, p: { 1: 0, 2: 0 }, time: 0, level: 1, waterLost: 0, patched: 0, missed: 0,
    holes: [], spawnTimer: 1200, combo: 0, lastPatchAt: -99, floaters: [], decals: [],
    surgeTimer: 12, surge: 0, lightning: 0, windT: rand(0, 10), boss: null, bossSpawned: false,
    duration: sc === ENDLESS ? Infinity : CONFIG.SCENARIO_SECONDS, done: false,
  };
  particles.length = 0; rain.length = 0;
}

const spawnInterval = () => Math.max(CONFIG.MIN_SPAWN_MS, CONFIG.BASE_SPAWN_MS * Math.pow(CONFIG.SPAWN_DECAY, game.level - 1))
  * scenario().mods.spawn * (settings.tvMode ? 1.15 : 1) * (activePlayers() === 2 ? 0.75 : 1);
const maxHoles = () => Math.min(CONFIG.MAX_HOLES_CAP, scenario().mods.maxHoles + Math.floor((game.level - 1) * 0.7) + (activePlayers() === 2 ? 2 : 0));
const holeRadiusNorm = () => Math.max(CONFIG.HOLE_R_MIN, CONFIG.HOLE_R_BASE - (game.level - 1) * CONFIG.HOLE_R_SHRINK) * scenario().mods.size * (settings.tvMode ? 1.25 : 1);
const holeFlow = (h) => CONFIG.BASE_FLOW * scenario().mods.flow * (1 + CONFIG.FLOW_LEVEL_GAIN * (game.level - 1))
  * (1 + (Math.min(h.age, 12) / 12) * CONFIG.FLOW_AGE_GAIN) * (h.type === 'pipe' ? 1.8 : h.type === 'boss' ? 2.5 : h.type === 'decoy' ? 0 : 1) * (game.surge > 0 ? 2 : 1);
const holdMs = (h) => CONFIG.HOLD_MS * (h.type === 'valve' ? 2.2 : h.type === 'pipe' ? 1.4 : 1);

function makeHole(nx, ny, rn, type = 'normal') {
  const cracks = Array.from({ length: randInt(4, 7) }, () => ({ a: rand(0, Math.PI * 2), l: rand(1.4, 2.4), k: rand(-0.6, 0.6) }));
  const h = { nx, ny, rn, type, age: 0, patch: 0, emitAcc: 0, cracks, seed: rand(0, 100), spread: false, vx: 0, vy: 0, hp: 1 };
  if (rule('moving') && type === 'normal') { const a = rand(0, Math.PI * 2); const sp = 0.05 + 0.01 * game.level; h.vx = Math.cos(a) * sp; h.vy = Math.sin(a) * sp; }
  return h;
}

function pickHoleType() {
  const r = Math.random();
  if (rule('decoys') && r < 0.28) return 'decoy';
  if (rule('pipes') && r < 0.40) return 'pipe';
  if (rule('valves') && r < 0.45) return 'valve';
  if (rule('cracks') && r < 0.70) return 'crack';
  return 'normal';
}

function spawnHole(type = pickHoleType(), near = null) {
  const A = playArea();
  const r = holeRadiusNorm() * MIN * (type === 'pipe' ? 1.5 : type === 'boss' ? 2.6 : 1);
  for (let tries = 0; tries < 30; tries++) {
    let x, y;
    if (near) { const a = rand(0, Math.PI * 2); x = near.nx * W + Math.cos(a) * r * 3; y = near.ny * H + Math.sin(a) * r * 3; }
    else if (type === 'boss') { x = W / 2; y = (A.top + A.bottom) / 2; }
    else { x = rand(A.left + r, A.right - r); y = rand(A.top + r, Math.max(A.top + r + 1, A.bottom - r)); }
    x = clamp(x, A.left + r, A.right - r); y = clamp(y, A.top + r, A.bottom - r);
    const okHoles = game.holes.every((h) => Math.hypot(h.nx * W - x, h.ny * H - y) > (h.rn * MIN + r) * 1.5);
    const okHands = type === 'boss' || cursors.every((c) => Math.hypot(cx(c) - x, c.y - y) > r * 3);
    if (okHoles && okHands) {
      const h = makeHole(x / W, y / H, r / MIN, type);
      if (type === 'boss') { h.hp = 1; game.boss = h; }
      game.holes.push(h); sfx.spawn(type); return true;
    }
  }
  return false;
}

function coveringCursors(h) {
  const x = h.nx * W, y = h.ny * H, r = h.rn * MIN;
  const reach = r * CONFIG.HIT_PADDING * (settings.tvMode ? 1.15 : 1) + contactRadius();
  return cursors.filter((c) => Math.hypot(cx(c) - x, c.y - y) <= reach);
}

function patchHole(i, by) {
  const h = game.holes[i]; game.holes.splice(i, 1);
  game.combo = (game.time - game.lastPatchAt < CONFIG.COMBO_WINDOW_S) ? game.combo + 1 : 1;
  game.lastPatchAt = game.time;
  const mult = 1 + 0.25 * Math.min(game.combo - 1, 8);
  const quick = h.age < 1.2 ? 25 : 0;
  const typeBonus = { pipe: 60, valve: 40, crack: 20, normal: 0 }[h.type] || 0;
  const pts = Math.round((50 + 10 * game.level + quick + typeBonus) * mult);
  game.score += pts; game.p[by] += pts; game.patched++;
  const x = h.nx * W, y = h.ny * H;
  game.floaters.push({ x, y, text: `+${pts}`, life: 1, color: quick ? '#fde047' : PLAYER_COLORS[by] });
  game.decals.push({ nx: h.nx, ny: h.ny, rn: h.rn * (h.type === 'pipe' ? 1.3 : 1), life: 1 });
  emit(x, y, 18, 'dust'); sfx.patch(game.combo);
}

function hitDecoy(i, by) {
  const h = game.holes[i]; game.holes.splice(i, 1);
  game.waterLost += 6; game.combo = 0;
  game.floaters.push({ x: h.nx * W, y: h.ny * H, text: '-6% 💥', life: 1.2, color: '#ef4444' });
  emit(h.nx * W, h.ny * H, 30, 'fire'); state.shake = 1; sfx.boom();
}

function updateGame(dt, now) {
  const g = game;
  g.time += dt;
  if (game.sc !== ENDLESS && g.time >= g.duration) { finishScenario(true); return; }

  const newLevel = 1 + Math.floor(g.time / CONFIG.LEVEL_SECONDS);
  if (newLevel > g.level) { g.level = newLevel; if (game.sc === ENDLESS) { banner(`NÍVEL ${newLevel}`); sfx.level(); } }

  // --- Regras de cenário ---
  if (rule('wind')) { g.windT += dt; const wind = Math.sin(g.windT * 0.9) * MIN * 0.09 * (0.6 + 0.4 * Math.sin(g.windT * 3.1)); for (const c of cursors) c.wind = wind; }
  if (rule('rain')) spawnRain(dt);
  if (rule('lightning')) { g.lightning = Math.max(0, g.lightning - dt * 3); if (Math.random() < dt * 0.12) { g.lightning = 1; sfx.thunder(); } }
  if (rule('surges')) {
    g.surgeTimer -= dt;
    if (g.surge > 0) g.surge -= dt;
    if (g.surgeTimer <= 0) { g.surgeTimer = rand(9, 14); g.surge = 3.5; banner('🌊 ONDA!'); state.shake = 1.2; sfx.boom(); }
  }
  if (rule('boss') && !g.bossSpawned && g.time > 3) { g.bossSpawned = true; spawnHole('boss'); banner('⚠ BRECHA GIGANTE'); sfx.thunder(); }

  // --- Spawn ---
  g.spawnTimer -= dt * 1000;
  if (g.spawnTimer <= 0) {
    const cap = maxHoles() + (g.boss ? 1 : 0);
    if (g.holes.length < cap && spawnHole()) g.spawnTimer = spawnInterval() * rand(0.75, 1.25);
    else g.spawnTimer = 200;
  }

  // --- Furos ---
  const A = playArea();
  for (let i = g.holes.length - 1; i >= 0; i--) {
    const h = g.holes[i];
    h.age += dt;
    if (h.vx || h.vy) {
      h.nx += h.vx * dt * (MIN / W); h.ny += h.vy * dt * (MIN / H);
      const r = h.rn * MIN;
      if (h.nx * W < A.left + r || h.nx * W > A.right - r) h.vx *= -1;
      if (h.ny * H < A.top + r || h.ny * H > A.bottom - r) h.vy *= -1;
      h.nx = clamp(h.nx, (A.left + r) / W, (A.right - r) / W); h.ny = clamp(h.ny, (A.top + r) / H, (A.bottom - r) / H);
    }
    const flow = holeFlow(h);
    g.waterLost += flow * dt;
    h.emitAcc += flow * dt * 7; const n = Math.floor(h.emitAcc); h.emitAcc -= n;
    if (h.type !== 'decoy') emit(h.nx * W, h.ny * H + h.rn * MIN * 0.3, n, 'water');

    // Rachadura: gera um filho após 5 s sem reparo
    if (h.type === 'crack' && !h.spread && h.age > 5) { h.spread = true; spawnHole('normal', h); game.floaters.push({ x: h.nx * W, y: h.ny * H - h.rn * MIN * 1.6, text: 'RACHOU!', life: 1, color: '#fb923c' }); }

    const cov = coveringCursors(h);
    if (h.type === 'decoy') { if (cov.length) { h.patch += dt * 1000; if (h.patch >= 180) hitDecoy(i, cov[0].player); } else h.patch = 0; continue; }
    if (h.type === 'boss') {
      if (cov.length) { h.patch += dt * 1000; if (h.patch >= CONFIG.HOLD_MS * 1.5) { h.patch = 0; h.hp -= 0.045 + 0.02 * cov.length; emit(h.nx * W, h.ny * H, 25, 'dust'); state.shake = 0.6; sfx.patch(3); game.score += 150; game.p[cov[0].player] += 150; game.floaters.push({ x: h.nx * W, y: h.ny * H, text: '+150', life: 1, color: PLAYER_COLORS[cov[0].player] }); } }
      else h.patch = Math.max(0, h.patch - dt * 1000 * 2);
      if (h.hp <= 0) { g.holes.splice(i, 1); g.boss = null; game.score += 1500; game.floaters.push({ x: h.nx * W, y: h.ny * H, text: '+1500 BRECHA FECHADA', life: 2, color: '#fde047' }); emit(h.nx * W, h.ny * H, 80, 'dust'); state.shake = 2; sfx.level(); finishScenario(true); return; }
      continue;
    }
    const need = h.type === 'pipe' ? 2 : 1;
    if (cov.length >= need) h.patch += dt * 1000;
    else if (cov.length && h.type === 'pipe') h.patch = Math.min(h.patch, holdMs(h) * 0.3); // uma mão só segura um pouco
    else h.patch = Math.max(0, h.patch - dt * 1000 * CONFIG.PATCH_DECAY);
    if (h.patch >= holdMs(h)) patchHole(i, cov[0].player);
  }

  if (g.time - g.lastPatchAt > CONFIG.COMBO_WINDOW_S) g.combo = 0;
  for (const f of g.floaters) { f.life -= dt; f.y -= MIN * 0.12 * dt; }
  g.floaters = g.floaters.filter((f) => f.life > 0);
  for (const d of g.decals) d.life -= dt * 0.35;
  g.decals = g.decals.filter((d) => d.life > 0);
  state.shake = Math.max(0, state.shake - dt * 2.5);

  if (g.waterLost >= 100) { g.waterLost = 100; finishScenario(false); }
}

// --- Partículas ---
const particles = [], rain = [];
function emit(x, y, n, kind) {
  for (let i = 0; i < n && particles.length < CONFIG.MAX_PARTICLES; i++) {
    const water = kind === 'water', fire = kind === 'fire';
    particles.push({ x, y, kind,
      vx: (water ? rand(-0.12, 0.12) : rand(-0.45, 0.45)) * MIN, vy: (water ? rand(-0.18, 0.04) : rand(-0.5, 0.1)) * MIN,
      life: water ? rand(0.6, 1.2) : fire ? rand(0.4, 0.8) : rand(0.3, 0.6), size: (water ? rand(0.006, 0.012) : rand(0.005, 0.011)) * MIN });
  }
}
function updateParticles(dt) {
  const fy = floodY();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.vy += 1.6 * MIN * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.life <= 0 || (p.kind === 'water' && p.y > fy)) particles.splice(i, 1);
  }
  for (let i = rain.length - 1; i >= 0; i--) { const r = rain[i]; r.y += r.v * dt; r.x += r.vx * dt; if (r.y > H) rain.splice(i, 1); }
}
function spawnRain(dt) { for (let i = 0; i < 120 * dt && rain.length < 260; i++) rain.push({ x: rand(-W * 0.2, W * 1.2), y: -10, v: rand(1.2, 1.8) * H, vx: (game.windT ? Math.sin(game.windT * 0.9) : 0) * W * 0.25, len: rand(10, 22) }); }

// =============================================================================
// 8. RENDER
// =============================================================================
function buildBg(sc) {
  const c = document.createElement('canvas'); c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
  const x = c.getContext('2d'); x.setTransform(DPR, 0, 0, DPR, 0, 0);
  const col = sc.colors;
  // Céu
  const sky = x.createLinearGradient(0, 0, 0, H * 0.3); sky.addColorStop(0, col.sky[0]); sky.addColorStop(1, col.sky[1]);
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  // Silhueta de montanhas / cidade ao fundo
  x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.moveTo(0, H * 0.16);
  for (let i = 0; i <= 12; i++) x.lineTo((W / 12) * i, H * (0.08 + 0.07 * Math.abs(Math.sin(i * 1.7 + 0.3))));
  x.lineTo(W, H * 0.16); x.closePath(); x.fill();
  // Parede (começa em 15% da altura)
  const top = H * 0.15;
  const g = x.createLinearGradient(0, top, 0, H); g.addColorStop(0, col.wall[0]); g.addColorStop(1, col.wall[1]);
  x.fillStyle = g; x.fillRect(0, top, W, H - top);
  // Textura de concreto (ruído fractal) multiplicada sobre a cor do cenário + luz rasante do alto
  x.save(); x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.75; x.fillStyle = texture(x, 'concrete', 256, 11); x.fillRect(0, top, W, H - top); x.restore();
  x.save(); x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.5; x.fillStyle = texture(x, 'concrete', 128, 23); x.fillRect(0, top, W, H - top); x.restore();
  spotlight(x, W * 0.5, top, Math.max(W, H) * 0.9, 'rgba(255,245,220,.22)');
  // Borda superior (coroamento) com guarda-corpo
  x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(0, top, W, MIN * 0.012);
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, top + MIN * 0.012, W, MIN * 0.01);
  for (let i = 0; i < 260; i++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)'; x.beginPath(); x.arc(rand(0, W), rand(top, H), rand(2, MIN * 0.05), 0, Math.PI * 2); x.fill(); }
  const bh = Math.max(40, (H - top) / 8), bw = bh * 2.3;
  x.strokeStyle = col.mortar; x.lineWidth = 2;
  for (let row = 0, y = top + MIN * 0.022; y < H; row++, y += bh) {
    x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke();
    const off = (row % 2) * bw / 2; for (let bx = -off; bx < W; bx += bw) { x.beginPath(); x.moveTo(bx, y); x.lineTo(bx, y + bh); x.stroke(); }
  }
  // Escorrimentos úmidos (escuros, com brilho na borda) e musgo perto da água
  for (let i = 0; i < 18; i++) { const sx = rand(0, W), sh = rand(H * 0.1, H * 0.6), sw = rand(3, 12); const sg = x.createLinearGradient(0, top, 0, top + sh); sg.addColorStop(0, 'rgba(10,20,30,.35)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = sg; x.fillRect(sx, top, sw, sh); x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(sx + sw, top, 1.5, sh * 0.6); }
  const moss = x.createLinearGradient(0, H * 0.6, 0, H); moss.addColorStop(0, 'rgba(60,110,50,0)'); moss.addColorStop(1, 'rgba(60,110,50,.45)'); x.fillStyle = moss; x.fillRect(0, H * 0.6, W, H * 0.4);
  vignette(x, W, H, 0.55);
  return c;
}

let activeMini = null;
function render(now) {
  const t = now / 1000, sc = scenario();
  if (activeMini && ['mini', 'countdown', 'over', 'paused'].includes(state.phase) && !game) {
    activeMini.render(gctx, t, now);
    fctx.clearRect(0, 0, W, H); if (settings.debug) drawDebug(); drawCursors(now); return;
  }
  if (bgCacheKey !== sc.id) { bgCache = buildBg(sc); bgCacheKey = sc.id; }

  gctx.save();
  if (state.shake > 0) gctx.translate(rand(-1, 1) * state.shake * MIN * 0.012, rand(-1, 1) * state.shake * MIN * 0.012);
  gctx.drawImage(bgCache, 0, 0, W, H);

  if (settings.camOpacity > 0 && video.readyState >= 2) {
    const g = CONFIG.REACH_GAIN; gctx.save(); gctx.globalAlpha = settings.camOpacity * (rule('dark') ? 0.4 : 1);
    if (settings.mirror) { gctx.translate(W, 0); gctx.scale(-1, 1); }
    gctx.drawImage(video, W * (0.5 - 0.5 * g), H * (0.5 - 0.5 * g), W * g, H * g); gctx.restore();
  }

  if (game) {
    for (const d of game.decals) { gctx.fillStyle = `rgba(160,166,176,${0.75 * d.life})`; gctx.beginPath(); gctx.arc(d.nx * W, d.ny * H, d.rn * MIN * 1.15, 0, Math.PI * 2); gctx.fill(); }
    for (const h of game.holes) drawHole(h, t, sc);
  }
  for (const p of particles) {
    gctx.globalAlpha = clamp(p.life, 0, 1);
    gctx.fillStyle = p.kind === 'water' ? '#7dd3fc' : p.kind === 'fire' ? (Math.random() < 0.5 ? '#f97316' : '#fde047') : '#cbd5e1';
    gctx.beginPath(); gctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); gctx.fill();
  }
  gctx.globalAlpha = 1;
  if (rain.length) { gctx.strokeStyle = 'rgba(190,220,255,.35)'; gctx.lineWidth = 1.5; gctx.beginPath(); for (const r of rain) { gctx.moveTo(r.x, r.y); gctx.lineTo(r.x + r.vx * 0.02, r.y + r.len); } gctx.stroke(); }

  drawFlood(t, sc);

  if (game) {
    if (game.surge > 0) { gctx.fillStyle = `rgba(34,211,238,${0.12 + 0.1 * Math.sin(t * 20)})`; gctx.fillRect(0, 0, W, H); }
    if (game.lightning > 0) { gctx.fillStyle = `rgba(255,255,255,${game.lightning * 0.5})`; gctx.fillRect(0, 0, W, H); }
    if (rule('dark')) drawDarkness(t);
    gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
    for (const f of game.floaters) {
      gctx.globalAlpha = clamp(f.life, 0, 1);
      gctx.font = `900 ${Math.round(MIN * 0.06)}px system-ui, sans-serif`; gctx.lineWidth = MIN * 0.01; gctx.strokeStyle = 'rgba(0,0,0,.7)';
      gctx.strokeText(f.text, f.x, f.y); gctx.fillStyle = f.color || '#fff'; gctx.fillText(f.text, f.x, f.y);
    }
    gctx.globalAlpha = 1;
    if (game.boss) drawBossBar(game.boss);
  }
  gctx.restore();

  fctx.clearRect(0, 0, W, H);
  if (settings.debug) drawDebug();
  drawCursors(now);
}

function drawHole(h, t, sc) {
  const x = h.nx * W, y = h.ny * H, r = h.rn * MIN, urg = Math.min(1, h.age / 8);
  if (h.type === 'decoy') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 6 + h.seed);
    gctx.fillStyle = '#3b0a0a'; gctx.beginPath(); gctx.arc(x, y, r, 0, Math.PI * 2); gctx.fill();
    gctx.strokeStyle = `rgba(239,68,68,${0.6 + 0.4 * pulse})`; gctx.lineWidth = Math.max(4, r * 0.14); gctx.beginPath(); gctx.arc(x, y, r * 1.1, 0, Math.PI * 2); gctx.stroke();
    gctx.strokeStyle = '#fca5a5'; gctx.lineWidth = Math.max(4, r * 0.16); gctx.lineCap = 'round';
    gctx.beginPath(); gctx.moveTo(x - r * 0.5, y - r * 0.5); gctx.lineTo(x + r * 0.5, y + r * 0.5); gctx.moveTo(x + r * 0.5, y - r * 0.5); gctx.lineTo(x - r * 0.5, y + r * 0.5); gctx.stroke();
    return;
  }
  // Rachaduras
  gctx.strokeStyle = 'rgba(15,18,24,.85)'; gctx.lineCap = 'round'; gctx.lineWidth = Math.max(2, r * 0.08);
  const crackScale = h.type === 'crack' ? 1 + Math.min(h.age, 5) / 5 * 0.8 : 1;
  for (const c of h.cracks) {
    const a2 = c.a + c.k * 0.4; gctx.beginPath();
    gctx.moveTo(x + Math.cos(c.a) * r * 0.9, y + Math.sin(c.a) * r * 0.9);
    gctx.quadraticCurveTo(x + Math.cos(a2) * r * (1 + c.l) * 0.55 * crackScale, y + Math.sin(a2) * r * (1 + c.l) * 0.55 * crackScale, x + Math.cos(c.a) * r * c.l * crackScale, y + Math.sin(c.a) * r * c.l * crackScale);
    gctx.stroke();
  }
  if (h.type === 'pipe') { // cano de ferro atravessando
    gctx.fillStyle = '#374151'; gctx.fillRect(x - r * 2.2, y - r * 0.45, r * 4.4, r * 0.9);
    gctx.fillStyle = '#6b7280'; gctx.fillRect(x - r * 2.2, y - r * 0.45, r * 4.4, r * 0.18);
    gctx.fillStyle = '#1f2937'; for (const dx of [-1.7, 1.7]) gctx.fillRect(x + dx * r - r * 0.15, y - r * 0.6, r * 0.3, r * 1.2);
  }
  // Buraco
  const grd = gctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  grd.addColorStop(0, '#03060c'); grd.addColorStop(0.65, '#0c2340'); grd.addColorStop(1, 'rgba(56,140,220,.95)');
  gctx.fillStyle = grd; gctx.beginPath(); gctx.arc(x, y, r, 0, Math.PI * 2); gctx.fill();
  if (h.type === 'valve') { // volante da válvula
    gctx.strokeStyle = '#fca5a5'; gctx.lineWidth = Math.max(3, r * 0.1);
    gctx.beginPath(); gctx.arc(x, y, r * 0.65, 0, Math.PI * 2); gctx.stroke();
    const rot = t * 2 + (h.patch / holdMs(h)) * 6;
    for (let i = 0; i < 3; i++) { const a = rot + i * Math.PI * 2 / 3; gctx.beginPath(); gctx.moveTo(x, y); gctx.lineTo(x + Math.cos(a) * r * 0.65, y + Math.sin(a) * r * 0.65); gctx.stroke(); }
  }
  // Jato
  const jet = 0.6 + 0.4 * Math.sin(t * 14 + h.seed);
  gctx.fillStyle = `rgba(125,211,252,${0.35 + 0.25 * jet})`; gctx.beginPath();
  gctx.moveTo(x - r * 0.35, y + r * 0.2); gctx.quadraticCurveTo(x, y + r * (1.6 + urg) * (game.surge > 0 ? 1.8 : 1), x + r * 0.35, y + r * 0.2); gctx.fill();
  // Anel de urgência
  const pulse = 0.5 + 0.5 * Math.sin(t * (4 + urg * 8) + h.seed);
  gctx.strokeStyle = h.type === 'boss' ? `rgba(239,68,68,${0.7 + 0.3 * pulse})` : h.type === 'crack' ? `rgba(251,146,60,${0.6 + 0.4 * pulse})` : urg < 0.5 ? `rgba(250,204,21,${0.5 + 0.4 * pulse})` : `rgba(239,68,68,${0.55 + 0.45 * pulse})`;
  gctx.lineWidth = Math.max(3, r * 0.12); gctx.beginPath(); gctx.arc(x, y, r * (1.12 + 0.06 * pulse), 0, Math.PI * 2); gctx.stroke();
  if (h.type === 'pipe') { // ícone "2 mãos"
    gctx.font = `900 ${Math.round(r * 0.7)}px system-ui`; gctx.textAlign = 'center'; gctx.textBaseline = 'middle'; gctx.fillStyle = '#fde68a'; gctx.fillText('✋✋', x, y - r * 1.55);
  }
  // Progresso
  if (h.patch > 0 && h.type !== 'boss') {
    const p = clamp(h.patch / holdMs(h), 0, 1);
    gctx.strokeStyle = '#22c55e'; gctx.lineWidth = Math.max(6, r * 0.22);
    gctx.beginPath(); gctx.arc(x, y, r * 1.38, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); gctx.stroke();
  }
  if (h.type === 'boss' && h.patch > 0) { gctx.strokeStyle = '#fde047'; gctx.lineWidth = Math.max(6, r * 0.12); gctx.beginPath(); gctx.arc(x, y, r * 1.25, -Math.PI / 2, -Math.PI / 2 + clamp(h.patch / (CONFIG.HOLD_MS * 1.5), 0, 1) * Math.PI * 2); gctx.stroke(); }
}

function drawBossBar(b) {
  const w = W * 0.5, h = MIN * 0.035, x = W / 2 - w / 2, y = H * 0.155;
  gctx.fillStyle = 'rgba(0,0,0,.6)'; gctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  gctx.fillStyle = '#7f1d1d'; gctx.fillRect(x, y, w, h);
  gctx.fillStyle = '#ef4444'; gctx.fillRect(x, y, w * clamp(b.hp, 0, 1), h);
  gctx.font = `900 ${Math.round(h * 0.8)}px system-ui`; gctx.fillStyle = '#fff'; gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
  gctx.fillText('BRECHA GIGANTE', W / 2, y + h / 2);
}

function drawDarkness(t) {
  gctx.save();
  gctx.fillStyle = 'rgba(0,0,5,.93)'; gctx.fillRect(0, 0, W, H);
  gctx.globalCompositeOperation = 'destination-out';
  for (const c of cursors) {
    const r = MIN * (0.22 + 0.02 * Math.sin(t * 7));
    const g = gctx.createRadialGradient(cx(c), c.y, 0, cx(c), c.y, r); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.6, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = g; gctx.beginPath(); gctx.arc(cx(c), c.y, r, 0, Math.PI * 2); gctx.fill();
  }
  // Furos velhos brilham levemente mesmo no escuro (pista sonora/visual)
  if (game) for (const h of game.holes) if (h.age > 6) { const g = gctx.createRadialGradient(h.nx * W, h.ny * H, 0, h.nx * W, h.ny * H, h.rn * MIN * 2.2); g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); gctx.fillStyle = g; gctx.beginPath(); gctx.arc(h.nx * W, h.ny * H, h.rn * MIN * 2.2, 0, Math.PI * 2); gctx.fill(); }
  gctx.restore();
}

function drawFlood(t, sc) {
  const fy = floodY(), amp = MIN * 0.01 * (game?.surge > 0 ? 2.5 : 1);
  const grd = gctx.createLinearGradient(0, fy, 0, H); grd.addColorStop(0, sc.colors.water[0] + 'c0'); grd.addColorStop(1, sc.colors.water[1]);
  gctx.fillStyle = grd; gctx.beginPath(); gctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 24) gctx.lineTo(x, fy + Math.sin(x * 0.02 + t * 3) * amp);
  gctx.lineTo(W, H); gctx.closePath(); gctx.fill();
  gctx.strokeStyle = 'rgba(255,255,255,.35)'; gctx.lineWidth = 2; gctx.beginPath();
  for (let x = 0; x <= W; x += 24) gctx.lineTo(x, fy + Math.sin(x * 0.02 + t * 3) * amp); gctx.stroke();
}

function drawCursors(now) {
  const r = contactRadius(), two = activePlayers(now) === 2;
  for (const c of cursors) {
    const fresh = now - c.lastSeen < 120, col = two ? PLAYER_COLORS[c.player] : PLAYER_COLORS[1];
    fctx.globalAlpha = fresh ? 1 : 0.45;
    fctx.fillStyle = col + '38'; fctx.beginPath(); fctx.arc(cx(c), c.y, r * 1.6, 0, Math.PI * 2); fctx.fill();
    fctx.strokeStyle = '#fff'; fctx.lineWidth = Math.max(3, MIN * 0.007); fctx.beginPath(); fctx.arc(cx(c), c.y, r, 0, Math.PI * 2); fctx.stroke();
    fctx.fillStyle = col; fctx.beginPath(); fctx.arc(cx(c), c.y, Math.max(4, r * 0.25), 0, Math.PI * 2); fctx.fill();
    if (two) { fctx.font = `900 ${Math.round(r * 0.8)}px system-ui`; fctx.textAlign = 'center'; fctx.textBaseline = 'bottom'; fctx.fillStyle = col; fctx.fillText(`P${c.player}`, cx(c), c.y - r * 1.2); }
    if (c.wind) { fctx.strokeStyle = 'rgba(255,255,255,.5)'; fctx.setLineDash([4, 6]); fctx.beginPath(); fctx.moveTo(c.x, c.y); fctx.lineTo(cx(c), c.y); fctx.stroke(); fctx.setLineDash([]); }
  }
  fctx.globalAlpha = 1;
}

function drawDebug() {
  fctx.lineWidth = 3;
  for (const lm of state.lastLandmarks) {
    const pts = lm.map(toScreen); fctx.strokeStyle = 'rgba(34,197,94,.9)';
    for (const [a, b] of HAND_CONNECTIONS) { fctx.beginPath(); fctx.moveTo(pts[a].x, pts[a].y); fctx.lineTo(pts[b].x, pts[b].y); fctx.stroke(); }
    fctx.fillStyle = '#f43f5e'; for (const p of pts) { fctx.beginPath(); fctx.arc(p.x, p.y, 4, 0, Math.PI * 2); fctx.fill(); }
  }
  const txt = `FPS ${stats.fps} | det ${stats.detFps}/s | IA ${stats.inferMs.toFixed(1)}ms (${stats.delegate}) | cam ${video.videoWidth}x${video.videoHeight} | mãos ${state.lastLandmarks.length} (total ${stats.handsEver}) | jogadores ${activePlayers()} | part ${particles.length}`;
  fctx.font = `700 ${Math.round(clamp(MIN * 0.025, 11, 22))}px ui-monospace, monospace`; fctx.textAlign = 'left'; fctx.textBaseline = 'bottom';
  fctx.fillStyle = 'rgba(0,0,0,.65)'; fctx.fillRect(8, H - 8 - MIN * 0.045, fctx.measureText(txt).width + 16, MIN * 0.045);
  fctx.fillStyle = '#a3e635'; fctx.fillText(txt, 16, H - 14);
}

// =============================================================================
// 9. HUD / UI
// =============================================================================
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }

function updateHUD(now) {
  if (activeMini && !game) { /* o minijogo cuida do HUD */ }
  else if (game && ['playing', 'countdown', 'paused'].includes(state.phase)) {
    const water = Math.max(0, 100 - game.waterLost), two = activePlayers(now) === 2;
    setText('hudScore', game.score.toLocaleString('pt-BR'));
    $('hudP').classList.toggle('hidden', !two);
    if (two) { setText('hudP1', game.p[1].toLocaleString('pt-BR')); setText('hudP2', game.p[2].toLocaleString('pt-BR')); }
    setText('hudLevel', game.sc === ENDLESS ? String(game.level) : String(state.scenarioIdx + 1));
    setText('hudLevelLabel', game.sc === ENDLESS ? 'NÍVEL' : 'CENÁRIO');
    setText('hudTime', game.sc === ENDLESS ? fmtTime(game.time) : fmtTime(game.duration - game.time));
    setText('hudWaterPct', `${Math.ceil(water)}%`);
    const bar = $('hudWater'); bar.style.width = water + '%';
    bar.style.background = water < 30 ? 'linear-gradient(90deg,#dc2626,#f97316)' : 'linear-gradient(90deg,#0ea5e9,#38bdf8)';
    if (game.combo >= 2) { show('hudCombo'); setText('hudCombo', `🔥 COMBO x${(1 + 0.25 * Math.min(game.combo - 1, 8)).toFixed(2)}`); } else hide('hudCombo');
  }
  $('handHint').classList.toggle('hidden', !(['playing', 'mini'].includes(state.phase) && now - state.lastHandAt > CONFIG.HAND_LOST_MS));
  $('lightHint').classList.toggle('hidden', !(state.lowLight && state.phase !== 'boot'));
}

function setStatus(msg, isError = false) { const el = $('status'); el.textContent = msg; el.className = 'lead ' + (isError ? 'text-rose-300' : 'text-sky-300'); }
let toastTimer = null;
function toast(msg, ms = 2600) { const el = $('toast'); el.textContent = msg; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms); }
function banner(text) { const el = $('center'); el.textContent = text; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

function updateChips() {
  $('optFacing').textContent = `📷 Câmera: ${settings.facing === 'user' ? 'Frontal' : 'Traseira'}`;
  $('optMirror').textContent = `↔ Espelhar: ${settings.mirror ? 'Sim' : 'Não'}`;
  $('optContact').textContent = `✋ Contato: ${settings.contact === 'palm' ? 'Palma' : 'Indicador'}`;
  $('optCamView').textContent = `👁 Câmera ao fundo: ${Math.round(settings.camOpacity * 100)}%`;
  $('optTv').textContent = `📺 Modo TV: ${settings.tvMode ? 'On' : 'Off'}`;
  $('optDebug').textContent = `🐞 Debug: ${settings.debug ? 'On' : 'Off'}`;
  $('optDelegate').textContent = `🧠 IA: ${settings.delegate === 'auto' ? 'Auto' : settings.delegate}${tracker ? ' (' + stats.delegate + ')' : ''}`;
  for (const b of document.querySelectorAll('[data-players]')) b.classList.toggle('chip-on', b.dataset.players === settings.players);
  $('bestMenu').textContent = `Campanha ${progress.bestCampaign.toLocaleString('pt-BR')} · Infinito ${progress.bestEndless.toLocaleString('pt-BR')}`;
}

/** Monta a grade de seleção de cenários (desbloqueio progressivo). */
function buildSelect() {
  const grid = $('scGrid'); grid.innerHTML = '';
  SCENARIOS.forEach((sc, i) => {
    const unlocked = i === 0 || (progress.stars[SCENARIOS[i - 1].id] || 0) > 0;
    const stars = progress.stars[sc.id] || 0;
    const b = document.createElement('button');
    b.className = 'sc-card' + (unlocked ? '' : ' sc-locked');
    b.disabled = !unlocked; if (unlocked) b.setAttribute('data-hover', '');
    b.style.setProperty('--c1', sc.colors.wall[0]); b.style.setProperty('--c2', sc.colors.sky[1]); b.style.setProperty('--ac', sc.colors.accent);
    b.innerHTML = `<div class="sc-num">${i + 1}</div><div class="sc-name">${unlocked ? sc.name : '🔒'}</div><div class="sc-stars">${unlocked ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : 'Conclua o anterior'}</div>`;
    b.addEventListener('click', () => { state.mode = 'campaign'; state.scenarioIdx = i; startScenario(0); });
    grid.appendChild(b);
  });
}

// Hover-to-click
function updateHover(dtMs) {
  if (!['menu', 'select', 'paused', 'result', 'over', 'intro'].includes(state.phase)) return;
  for (const el of document.querySelectorAll('.screen:not(.hidden) [data-hover]')) {
    let p = hoverProgress.get(el) || 0;
    if (el.disabled) p = 0;
    else {
      const r = el.getBoundingClientRect();
      const over = cursors.some((c) => cx(c) >= r.left && cx(c) <= r.right && c.y >= r.top && c.y <= r.bottom);
      if (!over) hoverBlocked.delete(el);
      p = over && !hoverBlocked.has(el) ? p + dtMs : Math.max(0, p - dtMs * 2);
      if (p >= CONFIG.HOVER_CLICK_MS) { p = 0; sfx.click(); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); el.click(); }
    }
    hoverProgress.set(el, p); el.style.setProperty('--p', (p / CONFIG.HOVER_CLICK_MS).toFixed(3));
  }
}

// =============================================================================
// 10. FLUXO DE TELAS
// =============================================================================
const SCREENS = ['menu', 'select', 'intro', 'pause', 'result', 'gameover'];
const hoverProgress = new WeakMap();
const hoverBlocked = new WeakSet();
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', !['countdown', 'playing', 'paused'].includes(state.phase));
  // Botão que já está sob a mão ao abrir a tela só aceita hover depois que a mão sair dele
  for (const el of document.querySelectorAll('[data-hover]')) {
    hoverProgress.set(el, 0); el.style.setProperty('--p', '0');
    const r = el.getBoundingClientRect();
    if (r.width && cursors.some((c) => cx(c) >= r.left && cx(c) <= r.right && c.y >= r.top && c.y <= r.bottom)) hoverBlocked.add(el);
  }
}

function goMenu() { state.phase = 'menu'; game = null; activeMini = null; $('hudWaterBox').classList.remove('hidden'); particles.length = 0; rain.length = 0; bgCacheKey = ''; updateChips(); showScreen('menu'); }
function goSelect() { state.phase = 'select'; buildSelect(); showScreen('select'); }

function startEndless() {
  ensureAudio(); requestWakeLock(); state.mode = 'endless';
  resetGame(ENDLESS, 0); beginCountdown(3);
}

/** Mostra a tela de introdução do cenário e aguarda "Começar". */
function startScenario(carryScore) {
  ensureAudio(); requestWakeLock();
  const sc = SCENARIOS[state.scenarioIdx];
  resetGame(sc, carryScore);
  state.phase = 'intro';
  $('introTag').textContent = sc.tag; $('introName').textContent = sc.name; $('introTip').textContent = sc.tip;
  $('introPlayers').textContent = activePlayers() === 2 ? '👥 2 jogadores: esquerda = P1, direita = P2' : '👤 1 jogador';
  $('introBtn').style.setProperty('--ac', sc.colors.accent);
  showScreen('intro'); bgCacheKey = '';
}
function beginCountdown(n) { state.phase = 'countdown'; state.countdown = n; state.lastCount = 0; showScreen(null); }
function updateCountdown(dt) {
  state.countdown -= dt; const n = Math.ceil(state.countdown);
  if (n !== state.lastCount && n > 0) { state.lastCount = n; banner(String(n)); sfx.tick(); }
  if (state.countdown <= 0) { state.phase = activeMini && !game ? 'mini' : 'playing'; banner('VAI!'); sfx.level(); }
}
function pauseGame() { if (!['playing', 'mini'].includes(state.phase)) return; state.phase = 'paused'; showScreen('pause'); }
function resumeGame() { beginCountdown(2); }

/** Fim de cenário (campanha): vitória com estrelas, ou derrota. */
function finishScenario(won) {
  if (game.done) return; game.done = true;
  if (game.sc === ENDLESS) { gameOver(); return; }
  const sc = game.sc, water = Math.max(0, 100 - game.waterLost);
  if (!won) { gameOver(); return; }
  const stars = water >= 70 ? 3 : water >= 40 ? 2 : 1;
  progress.stars[sc.id] = Math.max(progress.stars[sc.id] || 0, stars);
  if (game.score > progress.bestCampaign) progress.bestCampaign = game.score;
  saveProgress(); sfx.level(); state.phase = 'result';
  $('resName').textContent = sc.name; $('resStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('resStats').textContent = `${Math.ceil(water)}% do reservatório · ${game.patched} reparos · ${game.score.toLocaleString('pt-BR')} pts acumulados`;
  const two = activePlayers() === 2;
  $('resPlayers').textContent = two ? `P1 ${game.p[1].toLocaleString('pt-BR')}  ·  P2 ${game.p[2].toLocaleString('pt-BR')}  → ${game.p[1] === game.p[2] ? 'empate' : (game.p[1] > game.p[2] ? 'P1 venceu a rodada' : 'P2 venceu a rodada')}` : '';
  const last = state.scenarioIdx >= SCENARIOS.length - 1;
  $('btnNext').textContent = last ? '🏆 Campanha concluída!' : '▶ Próximo cenário';
  $('btnNext').disabled = last;
  showScreen('result');
}
function nextScenario() { state.scenarioIdx++; startScenario(game.score); }

function gameOver() {
  state.phase = 'over'; sfx.over();
  const endless = game.sc === ENDLESS;
  const key = endless ? 'bestEndless' : 'bestCampaign';
  const isRecord = game.score > progress[key]; if (isRecord) { progress[key] = game.score; saveProgress(); }
  $('goTitle').textContent = endless ? 'A REPRESA SECOU!' : `ROMPEU EM: ${game.sc.name.toUpperCase()}`;
  $('goScore').textContent = `${game.score.toLocaleString('pt-BR')} pts`;
  $('goStats').textContent = `${game.patched} reparos · ${endless ? 'nível ' + game.level : 'cenário ' + (state.scenarioIdx + 1)} · ${fmtTime(game.time)}`;
  $('goBest').textContent = isRecord ? '🏆 NOVO RECORDE!' : `Recorde: ${progress[key].toLocaleString('pt-BR')}`;
  $('btnAgain').textContent = endless ? '↻ Jogar de novo' : '↻ Tentar de novo';
  showScreen('gameover');
}

// =============================================================================
// 11. ÁUDIO (sintetizado)
// =============================================================================
let actx = null;
function ensureAudio() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { /* */ } }
function tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slideTo = null) {
  if (!actx) return; const t0 = actx.currentTime + when; const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur, vol = 0.2) {
  if (!actx) return; const n = actx.sampleRate * dur, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
  s.buffer = buf; g.gain.value = vol; s.connect(f).connect(g).connect(actx.destination); s.start();
}
const sfx = {
  spawn: (type) => tone(type === 'decoy' ? 140 : 200, 0.18, 'triangle', 0.07, 0, 110),
  patch: (combo) => { const b = 520 + Math.min(combo, 8) * 45; tone(b, 0.08, 'square', 0.06); tone(b * 1.5, 0.12, 'square', 0.06, 0.07); },
  level: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'triangle', 0.09, i * 0.08)),
  over: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'sawtooth', 0.07, i * 0.18)),
  click: () => tone(880, 0.06, 'sine', 0.08), tick: () => tone(660, 0.1, 'sine', 0.1),
  boom: () => { noise(0.5, 0.35); tone(80, 0.5, 'sine', 0.2, 0, 30); },
  thunder: () => noise(1.2, 0.25),
};

// =============================================================================
// 12. PLATAFORMA / PWA
// =============================================================================
let wakeLock = null;
async function requestWakeLock() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* */ } }
async function toggleFullscreen() {
  try { if (!document.fullscreenElement) { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); try { await screen.orientation.lock('landscape'); } catch { /* */ } } else await document.exitFullscreen(); }
  catch { toast('Tela cheia indisponível aqui. No iPhone: Compartilhar → “Adicionar à Tela de Início”.', 4000); }
}
const probe = document.createElement('canvas'); probe.width = 32; probe.height = 24; const pctx = probe.getContext('2d', { willReadFrequently: true });
function checkLight(now) {
  if (now - state.lastLightCheck < 1500 || video.readyState < 2) return; state.lastLightCheck = now;
  try { pctx.drawImage(video, 0, 0, 32, 24); const d = pctx.getImageData(0, 0, 32, 24).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; state.lowLight = sum / (d.length / 4) < 55; } catch { /* */ }
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredInstall = null, pendingWorker = null, userAskedUpdate = false;
function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (!isStandalone()) show('btnInstall'); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; hide('btnInstall'); toast('✅ App instalado! Abra pelo ícone na tela inicial.'); });
  $('btnInstall').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => null); deferredInstall = null; hide('btnInstall'); });
  if (isIOS && !isStandalone()) show('iosHint');
  window.addEventListener('online', refreshOfflineStatus); window.addEventListener('offline', refreshOfflineStatus);
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { refreshOfflineStatus(); return; }
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const notify = (w) => {
      pendingWorker = w;
      // Fora de partida, aplica a atualização sozinho (evita index novo + scripts velhos)
      if (['boot', 'menu'].includes(state.phase) && !tracker) { userAskedUpdate = true; w.postMessage({ type: 'SKIP_WAITING' }); return; }
      show('updateBar');
    };
    if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) notify(w); if (w.state === 'activated') refreshOfflineStatus(); }); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW não registrado', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (userAskedUpdate) location.reload(); });
  $('btnUpdate').addEventListener('click', () => { if (state.phase === 'playing') return; userAskedUpdate = true; pendingWorker?.postMessage({ type: 'SKIP_WAITING' }); });
  navigator.serviceWorker.ready.then(refreshOfflineStatus);
}
async function refreshOfflineStatus() {
  const el = $('netStatus'); if (!('caches' in window)) { el.textContent = ''; return; }
  try {
    const [model, wasm] = await Promise.all([caches.match(REMOTE_MODEL).then((r) => r || caches.match(LOCAL_MODEL)), caches.match(`${LOCAL_MP}wasm/vision_wasm_internal.wasm`)]);
    const ready = !!(model && wasm);
    el.textContent = !navigator.onLine ? (ready ? '📴 Offline — jogando do cache' : '📴 Offline e o modelo ainda não foi baixado: conecte uma vez.') : (ready ? '📦 Pronto para jogar offline' : '📦 Ative a câmera uma vez com internet para liberar o modo offline');
  } catch { el.textContent = ''; }
}

// =============================================================================
// 13. EVENTOS
// =============================================================================
$('btnCam').addEventListener('click', async () => {
  ensureAudio();
  if (!window.isSecureContext) { setStatus('⚠️ A câmera só funciona em HTTPS (ou localhost).', true); return; }
  $('btnCam').disabled = true;
  try {
    setStatus('Abrindo a câmera…'); await startCamera();
    if (!tracker) { setStatus('Carregando o modelo de IA (só demora na 1ª vez)…'); await initTracker(); }
    state.phase = 'menu'; hide('btnCam'); show('menuPlay');
    setStatus(`✅ Pronto (${stats.delegate}). Mostre a mão e segure sobre um botão.`);
    setTimeout(refreshOfflineStatus, 1500);
  } catch (err) { console.error(err); setStatus(explainError(err), true); $('btnCam').disabled = false; }
});
$('btnCampaign').addEventListener('click', goSelect);
$('btnEndless').addEventListener('click', startEndless);
$('btnSelBack').addEventListener('click', goMenu);
$('introBtn').addEventListener('click', () => beginCountdown(3));
$('btnNext').addEventListener('click', nextScenario);
$('btnResMenu').addEventListener('click', goMenu);
$('btnAgain').addEventListener('click', () => { if (activeMini && !game) { miniAPI.startMini(activeMini); return; } if (game.sc === ENDLESS) startEndless(); else startScenario(Math.max(0, game.score - game.p[1] - game.p[2])); });
$('btnMenu').addEventListener('click', goMenu);
$('btnQuit').addEventListener('click', goMenu);
$('btnResume').addEventListener('click', resumeGame);
$('btnPause').addEventListener('click', pauseGame);
$('optFull').addEventListener('click', toggleFullscreen);
for (const b of document.querySelectorAll('[data-players]')) b.addEventListener('click', () => { settings.players = b.dataset.players; saveSettings(); updateChips(); });
$('optFacing').addEventListener('click', async () => { settings.facing = settings.facing === 'user' ? 'environment' : 'user'; settings.mirror = settings.facing === 'user'; saveSettings(); updateChips(); if (stream) { try { await startCamera(); } catch (e) { setStatus(explainError(e), true); } } });
$('optMirror').addEventListener('click', () => { settings.mirror = !settings.mirror; saveSettings(); updateChips(); });
$('optContact').addEventListener('click', () => { settings.contact = settings.contact === 'palm' ? 'index' : 'palm'; saveSettings(); updateChips(); });
$('optCamView').addEventListener('click', () => { const steps = [0, 0.2, 0.3, 0.6]; settings.camOpacity = steps[(steps.indexOf(settings.camOpacity) + 1) % steps.length] ?? 0.3; saveSettings(); updateChips(); });
$('optTv').addEventListener('click', () => { settings.tvMode = !settings.tvMode; saveSettings(); updateChips(); });
$('optDebug').addEventListener('click', () => { settings.debug = !settings.debug; saveSettings(); updateChips(); });
$('optDelegate').addEventListener('click', switchDelegate);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); else if (state.phase !== 'boot') requestWakeLock(); });
window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// =============================================================================
// 14. LOOP
// =============================================================================
let lastFrame = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  const res = detectHands(now); if (res) updateCursors(res, now); pruneCursors(now); checkLight(now);
  if (state.phase === 'countdown') updateCountdown(dt);
  else if (state.phase === 'playing') updateGame(dt, now);
  else if (state.phase === 'mini' && activeMini) activeMini.update(dt, now);
  if (state.phase !== 'paused') updateParticles(dt);
  render(now); updateHover(dt * 1000); updateHUD(now);
  stats.frames++; if (now - stats.lastTick >= 1000) { stats.fps = stats.frames; stats.detFps = stats.detFrames; stats.frames = 0; stats.detFrames = 0; stats.lastTick = now; }
}

// ---- API usada pelos minijogos (js/minigames.js) ----
const miniAPI = {
  get W() { return W; }, get H() { return H; }, get MIN() { return MIN; }, get cursors() { return cursors; }, cx,
  state, settings, sfx, tone, noise, banner, toast, show, hide, setText, showScreen, PLAYER_COLORS, activePlayers,
  emit, particles, rand, randInt, clamp, lerp, pick, fmtTime, contactRadius, ensureAudio, requestWakeLock, progress, saveProgress,
  startMini(mini) { ensureAudio(); requestWakeLock(); game = null; activeMini = mini; window.__mini = mini; mini.start(); $('hudWaterBox').classList.add('hidden'); beginCountdown(3); },
  endMini({ title, score, stats, bestKey }) {
    state.phase = 'over'; sfx.over();
    const isRecord = score > (progress[bestKey] || 0); if (isRecord) { progress[bestKey] = score; saveProgress(); }
    $('goTitle').textContent = title; $('goScore').textContent = `${score.toLocaleString('pt-BR')} pts`; $('goStats').textContent = stats;
    $('goBest').textContent = isRecord ? '🏆 NOVO RECORDE!' : `Recorde: ${(progress[bestKey] || 0).toLocaleString('pt-BR')}`;
    $('btnAgain').textContent = '↻ Jogar de novo'; showScreen('gameover');
  },
};
import('./minigames.js').then((m) => m.install(miniAPI)).catch((e) => console.warn('minijogos não carregaram', e));
import('./libras.js').then((m) => m.install(miniAPI)).catch((e) => console.warn('Libras não carregou', e));
import('./arcade.js').then((m) => m.install(miniAPI)).catch((e) => console.warn('Arcade não carregou', e));
import('./circo.js').then((m) => m.install(miniAPI)).catch((e) => console.warn('Circo não carregou', e));

window.__represa = { get game() { return game; }, get cursors() { return cursors; }, get state() { return state; }, CONFIG, SCENARIOS, startScenario, startEndless, settings };
resize(); updateChips(); setupPWA(); requestAnimationFrame(loop);
