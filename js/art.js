// =============================================================================
// ART — texturas procedurais, iluminação e primitivas de acabamento compartilhadas
// Tudo gerado por código (sem imagens): ruído, grão, vinheta, sombras, especular.
// Texturas são cacheadas por chave + tamanho (custo só no primeiro uso).
// =============================================================================
const cache = new Map();

/** Ruído de valor 2D suave (interpolação cúbica), determinístico por seed. */
function noise2(seed = 1) {
  const perm = new Uint8Array(512); let s = seed * 9301 + 49297;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, fx = x - Math.floor(x), fy = y - Math.floor(y);
    const h = (i, j) => perm[(perm[(X + i) & 255] + Y + j) & 255] / 255;
    const u = fade(fx), v = fade(fy);
    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
  };
}
/** Ruído fractal (várias oitavas) em [0,1]. */
function fbm(n, x, y, oct = 4) { let a = 0.5, f = 1, sum = 0, norm = 0; for (let i = 0; i < oct; i++) { sum += n(x * f, y * f) * a; norm += a; a *= 0.5; f *= 2; } return sum / norm; }

/**
 * Gera (e cacheia) uma textura em canvas offscreen.
 * kind: 'concrete' | 'wood' | 'grass' | 'tile' | 'asphalt' | 'velvet' | 'metal'
 * Retorna um CanvasPattern pronto para ctx.fillStyle.
 */
export function texture(ctx, kind, size = 256, seed = 7) {
  const key = `${kind}|${size}|${seed}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const x = c.getContext('2d'); const img = x.createImageData(size, size); const d = img.data; const n = noise2(seed);
  const put = (i, r, g, b) => { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = (py * size + px) * 4, u = px / size * 8, v = py / size * 8;
    const f = fbm(n, u, v, 5), g = fbm(n, u * 3.7 + 11, v * 3.7 + 5, 3); // grão fino
    if (kind === 'concrete') { const t = 150 + (f - 0.5) * 90 + (g - 0.5) * 30; put(i, t, t + 3, t + 8); }
    else if (kind === 'wood') { const ring = Math.sin((u * 0.6 + (f - 0.5) * 2.5) * Math.PI * 2) * 0.5 + 0.5; const t = 90 + ring * 60 + (g - 0.5) * 25; put(i, t + 40, t, t * 0.55); }
    else if (kind === 'grass') { const t = f * 0.6 + g * 0.4; put(i, 30 + t * 50, 110 + t * 90, 30 + t * 40); }
    else if (kind === 'tile') { const gx = (px % 64) < 3 || (py % 64) < 3; const t = gx ? 120 : 215 + (f - 0.5) * 30 + (g - 0.5) * 10; put(i, t, t, t - 8); }
    else if (kind === 'asphalt') { const t = 55 + (f - 0.5) * 30 + (g - 0.5) * 40; put(i, t, t + 2, t + 6); }
    else if (kind === 'velvet') { const t = 0.5 + (f - 0.5) * 0.6; put(i, 110 * t + 40, 10 * t, 20 * t); }
    else { const t = 120 + (f - 0.5) * 40 + Math.sin(v * 40) * 10; put(i, t, t + 4, t + 10); } // metal escovado
  }
  x.putImageData(img, 0, 0);
  const pat = ctx.createPattern(c, 'repeat'); cache.set(key, pat); return pat;
}

/** Vinheta cinematográfica. */
export function vignette(ctx, W, H, strength = 0.55) {
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${strength})`); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}
/** Luz direcional (holofote) suave vinda de um ponto. */
export function spotlight(ctx, x, y, r, color = 'rgba(255,240,200,.35)') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
/** Sombra elíptica no chão. */
export function groundShadow(ctx, x, y, rx, ry, a = 0.35) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
/** Esfera com iluminação (difusa + especular + luz de borda). */
export function sphere(ctx, x, y, r, color, light = { x: -0.4, y: -0.5 }) {
  const g = ctx.createRadialGradient(x + light.x * r, y + light.y * r, r * 0.05, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, color); g.addColorStop(0.85, shade(color, 0.45)); g.addColorStop(1, shade(color, 0.25));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  const rim = ctx.createRadialGradient(x - light.x * r * 0.6, y - light.y * r * 0.6, r * 0.6, x, y, r); rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(1, 'rgba(255,255,255,.25)');
  ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
/** Escurece/clareia uma cor hex (#rrggbb) por fator. */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
/** Céu com gradiente, sol/lua com halo e nuvens suaves (cacheado por tamanho). */
export function sky(ctx, W, H, opts = {}) {
  const key = `sky|${W}|${H}|${JSON.stringify(opts)}`;
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, opts.top || '#1d4ed8'); g.addColorStop(1, opts.bottom || '#bae6fd'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (opts.sun !== false) { const sx = W * (opts.sunX ?? 0.78), sy = H * (opts.sunY ?? 0.18), sr = Math.min(W, H) * 0.08; spotlight(x, sx, sy, sr * 6, 'rgba(255,230,150,.35)'); x.fillStyle = opts.sunColor || '#fff7cc'; x.beginPath(); x.arc(sx, sy, sr, 0, Math.PI * 2); x.fill(); }
    const n = noise2(3);
    for (let i = 0; i < 7; i++) { const cx = W * (i / 7 + 0.05), cy = H * (0.12 + (i % 3) * 0.08), cr = Math.min(W, H) * (0.08 + n(i, 0) * 0.08); for (let k = 0; k < 6; k++) { const g2 = x.createRadialGradient(cx + (k - 2.5) * cr * 0.5, cy + (k % 2) * cr * 0.2, 0, cx + (k - 2.5) * cr * 0.5, cy, cr); g2.addColorStop(0, `rgba(255,255,255,${opts.cloudAlpha ?? 0.35})`); g2.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g2; x.fillRect(0, 0, W, H * 0.5); } }
    cache.set(key, c);
  }
  ctx.drawImage(c, 0, 0);
}
/** Multidão de estádio: pontos coloridos em fileiras (cacheado). */
export function crowd(ctx, W, y0, y1, seed = 5) {
  const key = `crowd|${W}|${y0}|${y1}|${seed}`; let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = W; c.height = y1 - y0; const x = c.getContext('2d'); const n = noise2(seed);
    const cols = ['#f43f5e', '#3b82f6', '#facc15', '#f8fafc', '#22c55e', '#f97316', '#1e293b'];
    const rows = Math.max(3, Math.floor((y1 - y0) / 9));
    for (let r = 0; r < rows; r++) for (let i = 0; i < W / 7; i++) { const v = n(i * 0.7, r * 0.9); x.fillStyle = cols[Math.floor(v * cols.length) % cols.length]; x.globalAlpha = 0.5 + v * 0.5; x.beginPath(); x.arc(i * 7 + (r % 2) * 3.5, r * 9 + 4, 3, 0, Math.PI * 2); x.fill(); }
    cache.set(key, c);
  }
  ctx.drawImage(c, 0, y0);
}
export function clearArtCache() { cache.clear(); }
