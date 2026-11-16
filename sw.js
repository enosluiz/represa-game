/* =============================================================================
 * Service Worker — Represa (PWA)
 * -----------------------------------------------------------------------------
 * Estratégias:
 *   • Navegação (HTML)        → network-first, cai para o index.html em cache.
 *   • App (css/js/ícones)     → stale-while-revalidate (abre rápido, atualiza ao fundo).
 *   • MediaPipe WASM e modelo → cache-first (arquivos grandes e imutáveis).
 *
 * Para publicar uma versão nova: altere VERSION. O app mostra "Nova versão
 * disponível" e só troca quando o jogador toca em "Atualizar" (nunca no meio
 * de uma partida).
 * ========================================================================== */
const VERSION = 'v2.3.0';
const APP_CACHE = `represa-app-${VERSION}`;
const RUNTIME_CACHE = 'represa-runtime-v1'; // WASM/modelo: mantido entre versões

const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Instalação: shell do app + MediaPipe (variante SIMD, usada por todo aparelho moderno)
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/minigames.js',
  './js/libras.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];
const HEAVY = [
  './vendor/mediapipe/vision_bundle.js',
  './vendor/mediapipe/wasm/vision_wasm_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_SHELL);

    // Pesados: em cache próprio, e sem derrubar a instalação se algo falhar
    const rt = await caches.open(RUNTIME_CACHE);
    await Promise.all(HEAVY.map(async (url) => {
      if (!(await rt.match(url))) await rt.add(url).catch(() => {});
    }));
    // Modelo do Google (CORS liberado): já deixa o jogo pronto para offline
    if (!(await rt.match(REMOTE_MODEL))) await rt.add(REMOTE_MODEL).catch(() => {});
  })());
  // Não chama skipWaiting aqui: a página decide quando ativar (mensagem SKIP_WAITING)
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('represa-app-') && k !== APP_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

const isHeavy = (url) =>
  url.href === REMOTE_MODEL ||
  url.pathname.includes('/vendor/mediapipe/') ||
  url.pathname.endsWith('.task') ||
  url.hostname === 'cdn.jsdelivr.net';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Navegação: rede primeiro (pega versão nova), cache se offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const app = await caches.open(APP_CACHE);
        app.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html', { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  // 2) Arquivos grandes e imutáveis: cache primeiro
  if (isHeavy(url)) {
    event.respondWith((async () => {
      const rt = await caches.open(RUNTIME_CACHE);
      const hit = await rt.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && (res.type === 'basic' || res.type === 'cors')) rt.put(req, res.clone());
      return res;
    })());
    return;
  }

  // 3) Demais arquivos do próprio site: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const app = await caches.open(APP_CACHE);
      const hit = await app.match(req, { ignoreSearch: true });
      const update = fetch(req).then((res) => {
        if (res.ok) app.put(req, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await update) || Response.error();
    })());
  }
});
