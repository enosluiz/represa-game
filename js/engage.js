// =============================================================================
// ENGAJAMENTO SAUDÁVEL — progresso, conquistas, desafio do dia e compartilhamento
// -----------------------------------------------------------------------------
// Princípios (adequados a crianças, em linha com o ECA Digital — Lei 15.211/2025):
//   • Recompensas são SEMPRE pelo que o jogador fez (nada aleatório, nada de "caixa").
//   • Nada de punir ausência: a sequência de dias tem tolerância e nunca "zera" com alarde.
//   • Sem notificações, sem contagem regressiva de "oferta", sem compra.
//   • Lembrete de pausa após 20 min seguidos de jogo.
// Guardado só no aparelho (localStorage).
// =============================================================================
import { SITE_URL } from './config.js';
import { brandIcon } from './brands.js';

const KEY = 'represa.profile';
const GAMES = {
  bestCampaign: { name: 'Represa', btn: 'btnCampaign', base: 2500, color: '#0ea5e9' },
  bestEndless: { name: 'Represa Infinita', btn: 'btnEndless', base: 1500, color: '#6366f1' },
  bestCorredor: { name: 'Corredor', btn: 'btnCorredor', base: 400, color: '#22c55e' },
  bestBateria: { name: 'Bateria no Ar', btn: 'btnBateria', base: 1000, color: '#f43f5e' },
  bestGoleiro: { name: 'Goleiro', btn: 'btnGoleiro', base: 800, color: '#10b981' },
  bestMalabares: { name: 'Malabares', btn: 'btnMalabares', base: 1500, color: '#a855f7' },
  bestPratinhos: { name: 'Pratinhos', btn: 'btnPratinhos', base: 300, color: '#f97316' },
  bestInsetos: { name: 'Esmaga Insetos', btn: 'btnInsetos', base: 800, color: '#84cc16' },
  bestRitmo: { name: 'Ritmo', btn: 'btnRitmo', base: 1500, color: '#ec4899' },
  bestJokenpo: { name: 'Jokenpô', btn: 'btnJokenpo', base: 300, color: '#eab308' },
  bestLibras: { name: 'Libras', btn: 'btnLibras', base: 1200, color: '#14b8a6' },
  bestSoletrar: { name: 'Soletrar', btn: 'btnSoletrar', base: 1000, color: '#06b6d4' },
};
const DAILY_POOL = Object.keys(GAMES).filter((k) => k !== 'bestCampaign');

// Conquistas: critério verificável, ícone e dica de como ganhar (mostrada como "próxima meta")
const BADGES = [
  { id: 'primeira', name: 'Primeira jogada', icon: 'play', hint: 'Jogue qualquer jogo', test: (c) => c.prof.plays >= 1 },
  { id: 'explorador', name: 'Explorador', icon: 'sparkles', hint: 'Jogue 6 jogos diferentes', test: (c) => c.prof.games.length >= 6 },
  { id: 'todos', name: 'Conhece tudo', icon: 'crown', hint: 'Jogue os 12 jogos', test: (c) => c.prof.games.length >= 12 },
  { id: 'recorde', name: 'Superação', icon: 'trophy', hint: 'Bata o seu próprio recorde', test: (c) => c.info.isRecord && c.info.prevBest > 0 },
  { id: 'dupla', name: 'Dupla dinâmica', icon: 'users', hint: 'Jogue com 2 jogadores', test: (c) => c.info.twoPlayers },
  { id: 'diario', name: 'Desafio cumprido', icon: 'target', hint: 'Complete um desafio do dia', test: (c) => c.dailyDoneNow },
  { id: 'dias3', name: '3 dias jogando', icon: 'flame', hint: 'Jogue em 3 dias seguidos', test: (c) => c.prof.streak >= 3 },
  { id: 'dias7', name: 'Uma semana inteira', icon: 'flame', hint: 'Jogue em 7 dias seguidos', test: (c) => c.prof.streak >= 7 },
  { id: 'nivel5', name: 'Nível 5', icon: 'zap', hint: 'Chegue ao nível 5', test: (c) => c.level >= 5 },
  { id: 'campanha5', name: 'Meio caminho', icon: 'droplets', hint: 'Vença 5 cenários da Represa', test: (c) => Object.keys(c.progress.stars || {}).length >= 5 },
  { id: 'campanha10', name: 'Salvou a represa', icon: 'shield', hint: 'Vença os 10 cenários da Represa', test: (c) => Object.keys(c.progress.stars || {}).length >= 10 },
  { id: 'abc', name: 'Alfabeto em Libras', icon: 'hand', hint: 'Complete o modo Libras', test: (c) => c.info.gameId === 'bestLibras' && /CONCLU/i.test(c.info.title || '') },
  { id: 'maestro', name: 'Maestro', icon: 'drum', hint: 'Faça 2.000 pontos na Bateria', test: (c) => c.info.gameId === 'bestBateria' && c.info.score >= 2000 },
  { id: 'muralha', name: 'Muralha', icon: 'shield', hint: 'Faça 1.500 pontos no Goleiro', test: (c) => c.info.gameId === 'bestGoleiro' && c.info.score >= 1500 },
  { id: 'equilibrio', name: 'Equilibrista', icon: 'disc-3', hint: 'Termine os Pratinhos sem perder todos', test: (c) => c.info.gameId === 'bestPratinhos' && /SHOW/i.test(c.info.title || '') },
  { id: 'malabarista', name: 'Malabarista', icon: 'orbit', hint: 'Faça 5.000 pontos nos Malabares', test: (c) => c.info.gameId === 'bestMalabares' && c.info.score >= 5000 },
];

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 86400000);
// Nível: cada nível pede 100 XP a mais que o anterior (100, 200, 300…)
const levelOf = (xp) => { let l = 1, need = 100, acc = 0; while (xp >= acc + need) { acc += need; l++; need += 100; } return { level: l, into: xp - acc, need }; };
const hash = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export function install(api) {
  const { $, icon, progress, sfx, toast } = api;
  const load = () => { try { return { xp: 0, plays: 0, games: [], badges: {}, lastDay: null, streak: 0, bestStreak: 0, daily: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { xp: 0, plays: 0, games: [], badges: {}, lastDay: null, streak: 0, bestStreak: 0, daily: {} }; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prof)); } catch { /* sem storage */ } };
  let prof = load();
  const session = { start: performance.now(), playSec: 0, breakShown: false };

  // ---------------------------------------------------------------------------
  // Desafio do dia: mesmo para todos no mesmo dia (sem servidor), meta alcançável
  // ---------------------------------------------------------------------------
  function daily() {
    const d = dayKey(), gameId = DAILY_POOL[hash(d) % DAILY_POOL.length], g = GAMES[gameId];
    const best = progress[gameId] || 0;
    const target = Math.max(50, Math.round(Math.max(g.base * 0.6, best * 0.85) / 50) * 50);
    return { day: d, gameId, name: g.name, target, done: !!(prof.daily[d]) };
  }

  // ---------------------------------------------------------------------------
  // Sequência de dias (com 1 dia de tolerância; nunca anuncia "perdeu")
  // ---------------------------------------------------------------------------
  function touchDay() {
    const d = dayKey();
    if (prof.lastDay === d) return;
    const gap = prof.lastDay ? dayDiff(prof.lastDay, d) : 99;
    prof.streak = gap <= 2 ? prof.streak + 1 : 1;
    prof.bestStreak = Math.max(prof.bestStreak, prof.streak); prof.lastDay = d;
  }

  // ---------------------------------------------------------------------------
  // Fim de partida: XP, nível, conquistas, desafio do dia → painel de recompensas
  // info = { gameId, score, prevBest, isRecord, title, twoPlayers, playSec, target: 'go'|'res' }
  // ---------------------------------------------------------------------------
  function onGameEnd(info) {
    session.playSec += info.playSec || 0;
    touchDay();
    const before = levelOf(prof.xp);
    const firstTime = !prof.games.includes(info.gameId);
    if (firstTime) prof.games.push(info.gameId);
    prof.plays++;
    const dl = daily(); let dailyDoneNow = false;
    if (!dl.done && info.gameId === dl.gameId && info.score >= dl.target) { prof.daily[dl.day] = true; dailyDoneNow = true; }
    const gains = [['Partida', 20], ['Pontuação', Math.min(60, Math.round(12 * Math.log10(1 + info.score)))]];
    if (firstTime) gains.push(['Jogo novo', 30]);
    if (info.isRecord && info.prevBest > 0) gains.push(['Novo recorde', 40]);
    if (dailyDoneNow) gains.push(['Desafio do dia', 60]);
    const gained = gains.reduce((s, [, v]) => s + v, 0);
    prof.xp += gained;
    const after = levelOf(prof.xp);
    const ctx = { info, prof, progress, level: after.level, dailyDoneNow };
    const newBadges = BADGES.filter((b) => !prof.badges[b.id] && b.test(ctx));
    for (const b of newBadges) prof.badges[b.id] = dayKey();
    // limpeza: guarda só os últimos 30 dias de desafios
    const days = Object.keys(prof.daily).sort(); while (days.length > 30) delete prof.daily[days.shift()];
    save();
    renderRewards(info, { gains, gained, before, after, newBadges, dailyDoneNow, dl, firstTime });
    renderMenu();
    return { gained, leveledUp: after.level > before.level, newBadges };
  }

  function nextGoal(info) {
    const pending = BADGES.filter((b) => !prof.badges[b.id]);
    const sameGame = pending.find((b) => b.hint && new RegExp(GAMES[info.gameId]?.name.split(' ')[0] || '#', 'i').test(b.hint));
    return sameGame || pending[0] || null;
  }

  function renderRewards(info, r) {
    const box = $(info.target === 'res' ? 'resRewards' : 'goRewards'); if (!box) return;
    const lines = [];
    // Recorde / quase
    if (info.isRecord && info.prevBest > 0) lines.push(`<div class="rw-note rw-gold">${icon('trophy')} Novo recorde! Você superou ${info.prevBest.toLocaleString('pt-BR')} pts.</div>`);
    else if (!info.isRecord && info.prevBest > 0) {
      const miss = info.prevBest - info.score;
      if (miss > 0 && miss <= Math.max(150, info.prevBest * 0.25)) lines.push(`<div class="rw-note">${icon('target')} Faltaram só ${miss.toLocaleString('pt-BR')} pts para o seu recorde!</div>`);
    }
    // Desafio do dia
    if (r.dailyDoneNow) lines.push(`<div class="rw-note rw-gold">${icon('target')} Desafio do dia cumprido!</div>`);
    else if (!r.dl.done && info.gameId === r.dl.gameId) lines.push(`<div class="rw-note">${icon('target')} Desafio do dia: ${r.dl.target.toLocaleString('pt-BR')} pts neste jogo. Você fez ${info.score.toLocaleString('pt-BR')}.</div>`);
    // Conquistas novas
    const badges = r.newBadges.map((b) => `<span class="rw-badge">${icon(b.icon)}<span>${b.name}</span></span>`).join('');
    // Próxima meta
    const goal = nextGoal(info);
    // Pausa saudável
    const mins = Math.floor((performance.now() - session.start) / 60000);
    const pause = mins >= 20 && !session.breakShown ? (session.breakShown = true, `<div class="rw-note rw-calm">${icon('heart')} Você está jogando há ${mins} min. Que tal uma pausa para beber água e alongar?</div>`) : '';
    const lv = r.after, pct = Math.round((lv.into / lv.need) * 100), pct0 = r.after.level > r.before.level ? 0 : Math.round((r.before.into / r.before.need) * 100);
    box.innerHTML = `
      <div class="rw-xp">
        <span class="rw-level">${icon('zap')} Nível ${lv.level}</span>
        <div class="rw-bar"><div class="rw-fill" style="width:${pct0}%"></div></div>
        <span class="rw-gain">+${r.gained} XP</span>
      </div>
      ${badges ? `<div class="rw-badges">${badges}</div>` : ''}
      ${lines.join('')}
      ${goal ? `<div class="rw-next">${icon('award')} Próxima conquista: <b>${goal.name}</b> · ${goal.hint}</div>` : ''}
      ${pause}`;
    // anima a barra (e celebra subida de nível / conquistas)
    requestAnimationFrame(() => requestAnimationFrame(() => { const f = box.querySelector('.rw-fill'); if (f) f.style.width = pct + '%'; }));
    if (r.after.level > r.before.level) { setTimeout(() => { api.banner(`NÍVEL ${r.after.level}!`); sfx.level(); confetti(); }, 500); }
    else if (r.newBadges.length || (info.isRecord && info.prevBest > 0)) setTimeout(() => { confetti(); sfx.level(); }, 350);
    renderShare(info.target === 'res' ? 'resShare' : 'goShare', info);
  }

  // ---------------------------------------------------------------------------
  // Confete (DOM + Motion, só transform/opacity; desligado com movimento reduzido)
  // ---------------------------------------------------------------------------
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !window.Motion) return;
    const colors = ['#fde047', '#f472b6', '#38bdf8', '#4ade80', '#fb923c', '#a78bfa'];
    const layer = document.createElement('div'); layer.className = 'confetti'; document.body.appendChild(layer);
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i'); p.style.background = colors[i % colors.length]; p.style.left = `${50 + (Math.random() - 0.5) * 20}%`; layer.appendChild(p);
      const dx = (Math.random() - 0.5) * innerWidth * 0.9, dy = innerHeight * (0.5 + Math.random() * 0.6), rot = (Math.random() - 0.5) * 900;
      window.Motion.animate(p, { transform: ['translate(0,0) rotate(0deg)', `translate(${dx}px, ${-innerHeight * 0.35}px) rotate(${rot / 2}deg)`, `translate(${dx * 1.2}px, ${dy}px) rotate(${rot}deg)`], opacity: [1, 1, 0] }, { duration: 1.6 + Math.random() * 0.8, ease: 'easeOut' });
    }
    setTimeout(() => layer.remove(), 2800);
  }

  // ---------------------------------------------------------------------------
  // Compartilhar: imagem do resultado + WhatsApp / Facebook / X / Telegram / link
  // ---------------------------------------------------------------------------
  const siteUrl = () => SITE_URL || (location.origin + location.pathname.replace(/index\.html$/, ''));
  let last = null; // último resultado (para o texto e a imagem)
  function shareText(info) {
    const n = GAMES[info.gameId]?.name || 'Levanta e Brinca';
    return info.score > 0
      ? `Fiz ${info.score.toLocaleString('pt-BR')} pontos em ${n} no Levanta e Brinca, jogando só com as mãos, sem tocar na tela! Consegue me superar?`
      : `Conheça o Levanta e Brinca: jogos que você joga só com as mãos, sem tocar na tela!`;
  }
  function renderShare(id, info) {
    last = info; const box = $(id); if (!box) return;
    const url = encodeURIComponent(siteUrl()), text = encodeURIComponent(shareText(info));
    const links = [
      ['whatsapp', 'WhatsApp', `https://wa.me/?text=${text}%20${url}`],
      ['facebook', 'Facebook', `https://www.facebook.com/sharer/sharer.php?u=${url}`],
      ['x', 'X', `https://twitter.com/intent/tweet?text=${text}&url=${url}`],
      ['telegram', 'Telegram', `https://t.me/share/url?url=${url}&text=${text}`],
    ];
    box.innerHTML = `
      <div class="sh-title">${icon('share-2')} Compartilhe com os amigos!</div>
      <button class="btn btn-share sh-native" type="button">${icon('share-2')} Compartilhar resultado</button>
      <div class="sh-row">
        ${links.map(([k, label, href]) => `<a class="sh-btn sh-${k}" href="${href}" target="_blank" rel="noopener" aria-label="Compartilhar no ${label}">${brandIcon(k)}</a>`).join('')}
        <button class="sh-btn sh-copy" type="button" aria-label="Copiar link">${icon('link-2')}</button>
      </div>
      ${api.isStandalone() ? '' : `<button class="btn btn-dl sh-dl" type="button">${icon('download')} Baixar o jogo</button>`}`;
    box.querySelector('.sh-native').addEventListener('click', () => shareNative(info));
    box.querySelector('.sh-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(`${shareText(info)} ${siteUrl()}`); toast('Link copiado! Cole no Instagram, TikTok ou onde quiser.'); }
      catch { toast(siteUrl(), 5000); }
    });
    box.querySelector('.sh-dl')?.addEventListener('click', () => api.installApp());
  }
  /** Gera a imagem do resultado (1080×1080) para o compartilhamento nativo. */
  async function resultImage(info) {
    const S = 1080, c = document.createElement('canvas'); c.width = S; c.height = S; const x = c.getContext('2d');
    const col = GAMES[info.gameId]?.color || '#0ea5e9';
    const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, col); g.addColorStop(1, '#0b1220'); x.fillStyle = g; x.fillRect(0, 0, S, S);
    const rg = x.createRadialGradient(S * 0.8, S * 0.1, 0, S * 0.8, S * 0.1, S * 0.7); rg.addColorStop(0, 'rgba(255,255,255,.25)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = rg; x.fillRect(0, 0, S, S);
    try { await document.fonts.load('700 80px Fredoka'); } catch { /* */ }
    const T = (t, y, size, color = '#fff', weight = 700) => { x.font = `${weight} ${size}px Fredoka, Nunito, sans-serif`; x.textAlign = 'center'; x.fillStyle = color; x.fillText(t, S / 2, y); };
    T('LEVANTA E BRINCA', 140, 64, '#fde68a');
    T(GAMES[info.gameId]?.name || '', 300, 90);
    T(info.score.toLocaleString('pt-BR'), 520, 230);
    T('pontos', 600, 56, 'rgba(255,255,255,.85)', 600);
    if (info.isRecord && info.prevBest > 0) T('NOVO RECORDE!', 700, 64, '#fde047');
    T(`Nível ${levelOf(prof.xp).level}`, 790, 52, 'rgba(255,255,255,.9)', 600);
    T('Joguei só com as mãos. Consegue me superar?', 900, 44, '#fff', 600);
    T(siteUrl().replace(/^https?:\/\//, '').replace(/\/$/, ''), 990, 40, 'rgba(255,255,255,.8)', 600);
    const logo = document.getElementById('brand-logo');
    if (logo && logo.complete && logo.naturalWidth) { const h = 150, w = h * logo.naturalWidth / logo.naturalHeight; x.drawImage(logo, S - w - 40, S - h - 30, w, h); }
    return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.9));
  }
  async function shareNative(info) {
    const text = shareText(info), url = siteUrl();
    try {
      const blob = await resultImage(info);
      const file = blob && new File([blob], 'levanta-e-brinca.jpg', { type: 'image/jpeg' });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: `${text} ${url}`, title: 'Levanta e Brinca' }); return; }
      if (navigator.share) { await navigator.share({ text, url, title: 'Levanta e Brinca' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    // Sem compartilhamento nativo: abre o WhatsApp, o mais usado no Brasil
    window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank', 'noopener');
  }

  // ---------------------------------------------------------------------------
  // Menu: nível/XP, dias seguidos e desafio do dia
  // ---------------------------------------------------------------------------
  function renderMenu() {
    const lv = levelOf(prof.xp), dl = daily();
    const p = $('hubProfile');
    if (p) p.innerHTML = `<span class="hp-level">${icon('zap')} Nível ${lv.level}</span><span class="hp-bar"><span style="width:${Math.round((lv.into / lv.need) * 100)}%"></span></span>${prof.streak > 1 ? `<span class="hp-streak">${icon('flame')} ${prof.streak} dias</span>` : ''}<span class="hp-badges">${icon('award')} ${Object.keys(prof.badges).length}/${BADGES.length}</span>`;
    const d = $('hubDaily');
    if (d) { d.innerHTML = dl.done ? `${icon('check')} Desafio do dia cumprido` : `${icon('target')} Desafio do dia: <b>${dl.name}</b> · ${dl.target.toLocaleString('pt-BR')} pts`; d.classList.toggle('done', dl.done); }
    const dl2 = $('hubDownload'); if (dl2) dl2.classList.toggle('hidden', api.isStandalone());
  }
  $('hubDaily')?.addEventListener('click', () => { const dl = daily(); $(GAMES[dl.gameId].btn)?.click(); });
  $('hubDownload')?.addEventListener('click', () => api.installApp());
  renderMenu();

  return { onGameEnd, renderMenu, daily, get profile() { return prof; }, BADGES, levelOf };
}
