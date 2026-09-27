# Formação — Treinos v2: progressão, passo a passo e desenho do exercício — desenho

Data: 2026-09-27 · Estado: aprovado em conversa · Base: `2026-09-27-formacao-epoca-sub8-design.md`

## Pedido do treinador

1. Treinos por ordem: T01 = o primeiro a ensinar e o mais simples → T30 = o mais complexo e difícil, já preparação para o Sub-9.
2. Explicação de cada exercício mais simples: passo a passo, lista de material, como preparar.
3. Uma imagem simples com pontos (cones, jogadores, bola, setas).

## Decisões

| Tema | Decisão |
|---|---|
| Ordem | `library_code` é a ordem de progressão: T01 (nível 1) … T30 (nível 30). Cada treino diz o que já devem saber e o que prepara (`progression`). |
| Bloco 5 | Passa a "Consolidar e preparar o Sub-9" (T25–T30 introduzem exigências do Sub-9). |
| Imagem | Desenho automático em SVG, gerado pela app a partir de posições guardadas no exercício. Sem ficheiros de imagem, sem custos. |
| Linguagem | Frases curtas, simples, uma ação por passo; sem jargão ou, se inevitável, explicado. |

## Dados

- `learning_sessions.progression text` (migração aditiva). Restantes campos novos vivem dentro de `exercises` (jsonb), sem migração.
- Cada exercício em `exercises[]` ganha:
  - `espaco` (ex.: "15 x 15 m"), `jogadores` (ex.: "8 — 4 contra 4"), `duracao_min`;
  - `material`: `[{"item":"cones","qtd":8}]`;
  - `preparacao`: passos curtos para montar o espaço;
  - `passos`: como se joga, passo a passo (3–6 passos);
  - `diagrama`: `{"campo":{"largura":20,"comprimento":30},"elementos":[{"tipo":"cone|jogador_a|jogador_b|bola|baliza|mini_baliza|treinador","x":0-100,"y":0-100,"rotulo":"opcional"}],"setas":[{"tipo":"conducao|passe|corrida|remate","de":[x,y],"para":[x,y]}]}`
  - cada seta pode ter `"passo": N` (número do passo em `passos` que ela mostra) e cada elemento pode ter `rotulo` curto ("1", "GR", "A");
  - `diagrama.legenda`: 1–2 frases simples que explicam o desenho ("Os azuis conduzem a bola até ao cone e passam ao colega. Os vermelhos tentam roubar.");
  - mantém `fase`, `organizacao`, `regras`, `variantes`, `pontos_ensino`, `erros_comuns`.
- Exercícios antigos sem estes campos continuam a ser mostrados como hoje.

## Ecrãs

- **Treino-exemplo:** topo com "Nível N de 30", `progression`, e **Material para o treino** (lista agregada: para cada item, a maior quantidade pedida num exercício). Cada exercício: desenho, Espaço/Jogadores/Duração, **Material**, **Como preparar** (lista numerada), **Passo a passo** (lista numerada), depois pontos de ensino, erros comuns e variantes.
- **Desenho:** retângulo verde com proporção do campo, cones (triângulo laranja), equipa A (círculo azul cheio), equipa B (círculo branco com contorno vermelho), bola, balizas, treinador ("T"), setas (condução = linha contínua ondulada ou contínua, passe = tracejado, corrida = pontilhado, remate = grossa); legenda sempre visível com o símbolo desenhado + nome de cada tipo usado ("▲ Cone", "● Equipa A (com bola)", "- - → Passe"); setas com `passo` mostram um círculo numerado no meio, igual ao número da lista "Passo a passo"; por baixo do desenho, a frase `diagrama.legenda` em texto normal (fora do SVG, legível e selecionável). Pedido explícito do treinador: tem de ser intuitivo e fácil de entender sem ler mais nada; `role="img"` + `aria-label` com resumo. Coordenadas fora de 0–100 são limitadas; tipos desconhecidos ignorados; rótulos escapados.
- **Biblioteca:** mostra "Nível N" e ordena por nível.

## Conteúdo

Nova versão `sub8-epoca-v2.json`: 30 treinos reescritos em progressão com os campos novos (desenho em todos os exercícios) e plano de 47 semanas re-mapeado (mesmas regras de pausas e blocos). Em produção, atualizar as linhas existentes por `library_code` (mantém ids e ligações) e o plano no mesmo sítio.

## Testes e aceitação

- Unit do desenho: nº de formas por tipo, limites 0–100, escape, legenda só com tipos usados, sem `diagrama` → string vazia.
- Unit do treino: material agregado, listas numeradas, compatível com exercícios antigos.
- `npm run check` / `npm test` / e2e verdes, contagens ≥ 420/414 e 165; interruptor desligado → app idêntica.
