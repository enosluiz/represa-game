# Levanta e Brinca — PWA de jogos com hand tracking

Jogos que você joga com as mãos, sem tocar na tela, usando a câmera do celular
(MediaPipe Tasks Vision `HandLandmarker`, rodando 100% no aparelho). Inclui o jogo da Represa (10 cenários) e minijogos.

**Jogar:** https://www.levantaebrinca.com.br

## Design system
- **Base**: fundo escuro `#0b1220` (alto contraste para TV), cada jogo com gradiente próprio; tipografia **Fredoka** (títulos) + **Nunito** (texto), embutidas em `vendor/fonts` (OFL) para uso offline.
- **Ícones**: Lucide (ISC) embutidos em `js/icons.js` — sem emojis na interface.
- **Movimento**: Motion (MIT, `vendor/motion`) com molas (rigidez 320, amortecimento 28) na entrada de telas e cartões em cascata; respeita `prefers-reduced-motion`.
- **Interação por mão**: segurar 1,2 s sobre botões; 2,5 s sobre a pausa durante o jogo; botão sob a mão ao abrir uma tela só aceita depois que a mão sai.
- **Layout**: a grade de jogos sempre cabe na tela (6×2 deitado, 3×4 em pé), porque não há rolagem com a mão.

## Engajamento saudável e compartilhamento
- **Progresso**: XP por partida (participação, pontuação, jogo novo, recorde, desafio do dia), níveis e 16 conquistas por mérito — nada aleatório, sem compras, sem loot boxes, sem notificações.
- **Desafio do dia**: um jogo e uma meta alcançável por dia (igual para todos, calculado pela data). Sequência de dias com tolerância de 1 dia, sem punição por ausência.
- **Fim de partida**: comemoração de recorde (confete), "faltaram X pontos", próxima conquista e lembrete de pausa após 20 min seguidos.
- **Compartilhe com os amigos!**: compartilhamento nativo com imagem do resultado (1080×1080) e botões de WhatsApp, Facebook, X, Telegram e copiar link; **Baixar o jogo** abre a instalação nativa ou o passo a passo (iPhone, Android, computador). Endereço dos links em `js/config.js` (`SITE_URL`).
- Desenhado para respeitar o ECA Digital (Lei 15.211/2025): sem técnicas que explorem vulnerabilidades de crianças para aumentar tempo de tela.

## Feedback e diagnóstico
- **Fale com o editor** (ícone de balão no menu, Ajustes, pausa e fim de jogo): nota 1–5 e assuntos escolhíveis só com a mão; mensagem e contato opcionais; diagnóstico técnico opcional (nunca imagens da câmera). Envio por [FormSubmit](https://formsubmit.co) para o email definido em `js/config.js`; sem internet ou sem destino configurado, o feedback fica numa fila no aparelho e é reenviado depois.
- **Testar câmera** (Ajustes): vídeo em tela cheia com o esqueleto da mão, métricas ao vivo (IA, detecções/s, mãos, tamanho da mão, luz) e um veredito do motivo provável de falha, com botão para trocar GPU/CPU.

**Configurar o email (dono do app):** edite `js/config.js` no GitHub, coloque o email em `FEEDBACK_KEY`, publique, envie um feedback de teste e clique em *Activate Form* no email do FormSubmit. Depois troque o email pelo código aleatório que vier na ativação, para o endereço não ficar público.

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

- **🤖 Batatinha 1, 2, 3** — o Robô Vigia (personagem original) canta de costas; cada jogador usa as **duas mãos** (2 jogadores = 4 mãos: metade esquerda J1, direita J2 — o detector passa a procurar 4 mãos só neste jogo). Para andar, **corra com os braços alternados** (um sobe enquanto o outro desce): só conta passo o movimento completo de um braço com o outro do lado oposto — braços juntos não andam e avisa "alterne os braços!"; o movimento precisa ir entre a "cintura" e o "alto" que o próprio jogador mostrou no tutorial (meio movimento avisa "movimento incompleto"); 26 passos até a CHEGADA. Quando o robô vira: **mãos para cima e estátua** — mão abaixada ou movimento depois de 0,9 s de reação = ZAP de laser e o jogador **volta para a largada**. Imobilidade medida em "palmas" com limite calibrado pela trepidação real; mão que a câmera perde não é punida. Antes do tutorial, 3 cartões animados "Como jogar" (um bonequinho demonstra correr alternado, estátua de mãos para cima e o ZAP); no tutorial, o quadro "FAÇA ASSIM" repete o gesto de cada passo. Botão **Pular tutorial** (segurar a mão ~1 s, tocar ou clicar) usa o último ajuste salvo no aparelho, ou o padrão. 90 s; vence quem chega primeiro (bônus sem nenhum ZAP).
- **🏃 Corredor** — 3 pistas controladas pela mão: esquerda/centro/direita = pista, mão no alto = pular, mão embaixo = abaixar. Moedas, poderes (escudo, ímã, ×2), obstáculos (barreira: pule; viga: abaixe; muro: troque de pista), 3 vidas, velocidade crescente. *Controle pelo corpo (pose) fica para uma etapa futura.*

- **🍽 Pratinhos** — pratos giram em varas; faça círculos com a mão ao redor do prato (velocidade angular) para repor o giro. Medidor por prato, até 5 pratos, 3 vidas.
- **🤹 Malabares** — bolas com gravidade; a mão rebate por baixo (impulso calculado para chegar ao topo; direção pela posição relativa e arrasto da mão). Até 5 bolas, combo, 3 vidas.
- **🧤 Goleiro** — chutes com curva e fintas, alvo amarelo mostra o ponto de chegada; defenda com a mão (ou duas) antes da bola chegar. 3 gols sofridos encerram.

Gestos: contagem de dedos estendidos a partir dos 21 pontos (punho = 0–1, tesoura = indicador+médio, aberta = 4–5). Funciona com a mão de frente para a câmera.

## Estatísticas anônimas e relatório diário
- `js/stats.js` conta acessos, jogos e incidentes no **GoatCounter** (`STATS_CODE` em `js/config.js`, hoje `enosluiz` → enosluiz.goatcounter.com). Sem cookies, sem identificador do aparelho, sem texto digitado e sem imagem da câmera: só contadores como `jogo/inicio/batatinha-1-2-3`, `jogo/fim/...`, `idioma/inicio/en`, `camera/ok`, `ia/gpu`, `feedback/nota-4`.
- Incidentes (no máximo 1 por sessão cada): `incidente/camera-NotAllowedError` (e outros erros de câmera), `incidente/camera-modelo-ia`, `incidente/gpu-cega`, `incidente/sem-https`, `incidente/sem-maos-60s/<GPU|CPU>` (câmera ligada há 60 s sem ver nenhuma mão), `incidente/js-erro/<arquivo:linha>`.
- Respeita "Do Not Track" e a opção **Ajustes → Estatísticas anônimas**; não conta em localhost nem em testes automatizados.
- Um relatório diário (acessos, incidentes e sugestões de melhoria) é montado por uma tarefa agendada e enviado por e-mail ao editor.

## Idiomas (PT / EN / ES)
- Bandeiras (SVG, sem emoji: emoji de bandeira não aparece no Windows nem em várias TVs) no topo da tela de entrada; a escolha fica salva no aparelho. Na 1ª visita, segue o idioma do navegador.
- `js/i18n.js` traduz **só a exibição**: um MutationObserver traduz textos e atributos (aria-label, title, placeholder) que aparecem ou mudam no DOM, e `fillText`/`strokeText`/`measureText` do canvas passam pelo tradutor, então tudo o que os jogos desenham sai traduzido sem mexer em cada jogo. Regras, testes de conquista e o diagnóstico enviado ao editor continuam em português.
- `js/i18n-dict.js`: PT → [EN, ES]. Chaves com `{}` são modelos ("Recorde: {}"); o trecho capturado também é traduzido. Para um texto novo, acrescente a frase em português e as duas traduções.
- Batatinha em inglês é "Red Light, Green Light" e em espanhol "Luz Roja, Luz Verde" (o canto muda junto). Libras aparece como "Sign Language (Libras)" / "Lengua de Señas (Libras)": é a língua de sinais **brasileira**, e as palavras do modo Soletrar continuam em português.

## Zoom de detecção (jogar longe da câmera)
A IA reduz cada imagem a 192×192 px para achar a palma; de longe, a mão some. O app recorta o centro da imagem (1×, 1,6× ou 2,3×) antes da detecção, e o recorte vira o campo de jogo. **Desligado por padrão (1×)** desde a v4.5: ligar em Ajustes → Distância da câmera. No modo Automático, o tamanho da mão visível escolhe o zoom (sem trocas às cegas). Medido com a IA real e vídeo de mãos reais: a 4× da distância de referência, detecção de 67% (sem zoom) → 100% (zoom 2,3× estabilizado).

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
