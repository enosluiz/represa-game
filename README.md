# Represa — PWA de hand tracking

Jogo em que você tampa vazamentos de uma represa com as mãos, usando a câmera do celular
(MediaPipe Tasks Vision `HandLandmarker`, rodando 100% no aparelho).

**Jogar:** https://enosluiz.github.io/represa-game/

## Modos
- **Campanha** — 10 cenários de 45 s, cada um com mecânica própria, estrelas (1–3 pelo nível do reservatório) e desbloqueio progressivo.
- **Infinito** — todas as mecânicas juntas, dificuldade crescente.
- **1 ou 2 jogadores** — por escolha ou automático: a mão que entra pela esquerda da câmera é P1, pela direita é P2. Reservatório compartilhado, pontuação individual.

## Cenários
| # | Nome | Mecânica |
|---|---|---|
| 1 | A Represa Velha | furos simples (treino) |
| 2 | Tempestade | vento desloca o cursor; chuva e raios |
| 3 | Rachaduras | furo não reparado em 5 s gera outro |
| 4 | Canos Rompidos | canos exigem 2 mãos ao mesmo tempo |
| 5 | Apagão | só a "lanterna" da mão revela a parede |
| 6 | Comporta | válvulas levam 2,2× o tempo |
| 7 | Enchente | ondas periódicas dobram a vazão |
| 8 | Furos Móveis | os furos deslizam pela parede |
| 9 | Sabotagem | bombas (X vermelho) custam água ao tocar |
| 10 | O Grande Rompimento | chefe com barra de vida + furos |

## Publicar (precisa de HTTPS — câmera e service worker não funcionam sem)

**Netlify Drop (mais rápido):** abra https://app.netlify.com/drop no computador e arraste
**a pasta `represa-pwa` inteira** (descompactada). Sai um link `https://…netlify.app`.

**GitHub Pages:** suba o conteúdo da pasta num repositório → Settings → Pages → branch `main`, pasta `/`.

## Instalar no celular

- **Android (Chrome):** abra o link → botão **⬇ Instalar app** no menu (ou ⋮ → Instalar app).
  Abre em tela cheia e na horizontal.
- **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início**.

## Offline

Na **primeira vez**, abra com internet e toque em **Ativar câmera**: o modelo de IA
(`hand_landmarker.task`, baixado do Google) fica no cache. O menu passa a mostrar
“📦 Pronto para jogar offline”. O MediaPipe (JS + WASM) já vem dentro de `vendor/`.

Opcional: para não depender do Google nem na 1ª vez, baixe o modelo em
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
e salve como `models/hand_landmarker.task`. O app usa a cópia local automaticamente.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | HUD e menus |
| `js/app.js` | câmera, tracking, jogo, render, PWA (comentado por seções) |
| `css/app.css` | Tailwind compilado (fonte em `css/input.css`) |
| `sw.js` | cache offline e atualização (mude `VERSION` a cada publicação) |
| `manifest.webmanifest` | nome, ícones, tela cheia, paisagem |
| `vendor/mediapipe/` | MediaPipe Tasks Vision 0.10.14 (Apache 2.0) |
| `_headers` | cache/MIME para Netlify (outros hosts ignoram) |

## Editar estilos

Se adicionar classes Tailwind novas no HTML/JS, recompile:

```bash
npx tailwindcss@3 -i css/input.css -o css/app.css --content "./index.html,./js/app.js" --minify
```

## Balanceamento

Todos os parâmetros do jogo estão no objeto `CONFIG`, no topo de `js/app.js`.
