# Levanta e Brinca — PWA de jogos com hand tracking

Jogos que você joga com as mãos, sem tocar na tela, usando a câmera do celular
(MediaPipe Tasks Vision `HandLandmarker`, rodando 100% no aparelho). Inclui o jogo da Represa (10 cenários) e minijogos.

**Jogar:** https://www.levantaebrinca.com.br

## Domínio próprio (GitHub Pages)
O arquivo `CNAME` contém `www.levantaebrinca.com.br`. No provedor do domínio, crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `enosluiz.github.io.` |

Depois, em Settings → Pages do repositório: Custom domain = `www.levantaebrinca.com.br` → Save → aguardar a checagem de DNS → marcar **Enforce HTTPS**.

## Modos
- **Campanha** — 10 cenários de 45 s, cada um com mecânica própria, estrelas (1–3 pelo nível do reservatório) e desbloqueio progressivo.
- **Infinito** — todas as mecânicas juntas, dificuldade crescente.
- **1 ou 2 jogadores** — por escolha ou automático: a mão que entra pela esquerda da câmera é P1, pela direita é P2. Reservatório compartilhado, pontuação individual.

## Outros jogos (mesma câmera, com reconhecimento de gestos)
- **🪲 Insetos** — esmague baratas, formigas e moscas; abelhas picam. 60 s, 3 vidas.
- **🎵 Ritmo** — notas descem em 4 pistas; acerte com mão aberta ✋ ou fechada ✊ na pista certa.
- **✊✋✌ Jokenpô** — melhor de 5 contra o computador ou entre P1 e P2.

- **🤟 Libras (Aprender)** e **🔤 Soletrar** — alfabeto manual: 12 letras estáticas (A B C D F I L O U V W Y) com esquema da mão, dica por dedo ("quase: dobre o anelar") e palavras para soletrar contra o relógio. Fora desta versão: letras com movimento (H J K X Z) e as que dependem da orientação/polegar (E G M N P Q R S T). Os esquemas são aproximações didáticas — valide com instrutor de Libras.

- **🥁 Bateria no Ar** — 7 peças; bater = entrar na peça com a mão descendo rápido. 20 s de toque livre, depois Desafio de 60 s (peças acendem no ritmo, pontos por precisão). Sons sintetizados (sem arquivos).
- **🏃 Corredor** — 3 pistas controladas pela mão: esquerda/centro/direita = pista, mão no alto = pular, mão embaixo = abaixar. Moedas, poderes (escudo, ímã, ×2), obstáculos (barreira: pule; viga: abaixe; muro: troque de pista), 3 vidas, velocidade crescente. *Controle pelo corpo (pose) fica para uma etapa futura.*

- **🍽 Pratinhos** — pratos giram em varas; faça círculos com a mão ao redor do prato (velocidade angular) para repor o giro. Medidor por prato, até 5 pratos, 3 vidas.
- **🤹 Malabares** — bolas com gravidade; a mão rebate por baixo (impulso calculado para chegar ao topo; direção pela posição relativa e arrasto da mão). Até 5 bolas, combo, 3 vidas.
- **🧤 Goleiro** — chutes com curva e fintas, alvo amarelo mostra o ponto de chegada; defenda com a mão (ou duas) antes da bola chegar. 3 gols sofridos encerram.

Gestos: contagem de dedos estendidos a partir dos 21 pontos (punho = 0–1, tesoura = indicador+médio, aberta = 4–5). Funciona com a mão de frente para a câmera.

## Se a mão não é detectada
1. Ligue **Debug** no menu: deve aparecer `IA x ms (GPU|CPU)` e `mãos N`. Se `IA` não aparecer, o modelo não carregou (precisa de internet na 1ª vez).
2. Se `IA` roda mas `mãos` fica em 0: toque em **🧠 IA** até ficar em **CPU** (alguns Android falham na GPU em silêncio).
3. Mão a 0,5–1,5 m da câmera, palma de frente, luz vindo de frente (não de trás).

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
