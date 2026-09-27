# Formação — Biblioteca de treinos e plano da época Sub-8 — desenho

Data: 2026-09-27 · Estado: aprovado em conversa · Base: `docs/superpowers/specs/2026-09-26-formacao-sub8-design.md` (fase 1 em produção, merge eb1cb6c)

## Objetivo

Dar ao treinador do Sub-8 (2 treinos/semana, época setembro 2026 → julho 2027):
1. uma **biblioteca de ~30 treinos completos** reutilizáveis, filtráveis;
2. um **plano da época** semana a semana que usa a biblioteca (2 treinos por semana, repetição com progressão).

## Decisões fechadas

| Tema | Decisão |
|---|---|
| Biblioteca | Treinos completos (aquecimento, parte principal, jogo final), não exercícios soltos. |
| Ligação | Plano aponta para treinos da biblioteca; treinos repetem-se ao longo da época com progressão. |
| Frequência | 2 treinos por semana (A e B). |
| Época | Semana de 7 set 2026 até fim de julho 2027; pausas de Natal e Páscoa marcadas como semanas de pausa. |
| Blocos (indicativos) | 1 Set–Out adaptação/regras/gostar de jogar · 2 Nov–Dez condução, drible, 1x1 · 3 Jan–Fev passe, receção, jogar com colegas · 4 Mar–Abr finalização, atacar/defender em jogo reduzido · 5 Mai–Jul consolidar e festival de jogos. |
| Copiar para treinos reais | Fora de âmbito (fase seguinte). |
| Aprovação | Conteúdo gerado pelo agente com fontes; carregado como `aprovado` só com autorização explícita do treinador (ecrã Propostas continua para a fase 2). |

## Modelo de dados (migração aditiva)

- `learning_sessions` ganha: `library_code text` (T01…T30), `focus text` (ex.: "condução"), `season_block smallint` (1–5). Índice único parcial `(owner_id, library_code) where library_code is not null`.
- `learning_season_plans`: id, owner_id (default `auth.uid()`), age_group_code → `learning_age_groups`, season_label ("2026/27"), title, start_date, end_date, status (proposto|aprovado|rejeitado), notes, created_at, updated_at. Índice único parcial: um plano `aprovado` por (owner_id, age_group_code, season_label).
- `learning_plan_weeks`: id, owner_id, plan_id → `learning_season_plans` on delete cascade, week_no, starts_on (date), block_no (1–5), block_title, objective, is_break bool, session_a_id / session_b_id → `learning_sessions` (null em pausas), notes, created_at, updated_at. Único (plan_id, week_no).
- RLS: dono = `auth.uid()` nas duas tabelas novas (mesmo padrão `*_owner_all` da fase 1). Sem ligações a tabelas fora de `learning_*`.

## Ecrãs

- Página do escalão (`#/formacao/sub8`): dois cartões no topo — **Plano da época** e **Biblioteca de treinos** — antes dos 3 blocos.
- **Plano da época** `#/formacao/plano/<code>`: semanas agrupadas por bloco (título + objetivo do bloco), cada semana com datas, objetivo, links para treino A e B; semana atual destacada ("Esta semana") e visível ao abrir; pausas a cinzento; sem plano aprovado → aviso.
- **Biblioteca** `#/formacao/biblioteca/<code>`: lista de treinos aprovados (código, título, foco, pilares, duração, bloco); filtros por pilar, bloco e foco (links/`select`, estado na hash não necessário); cada treino abre o ecrã Treino-exemplo existente, que passa a mostrar código, foco e "Usado nas semanas: …".
- Correção: `.bottom-nav` deixa de ter 6 colunas fixas — uma só linha qualquer que seja o número de separadores.

## Conteúdo (ordem separada)

JSON com ~30 treinos (6 por bloco, cobrindo os 4 pilares, variantes mais fácil/mais difícil nos exercícios, "porquê" + fontes) e o plano de ~44 semanas (A/B por semana, pausas Natal 21 dez–3 jan e Páscoa 22 mar–4 abr 2027, progressão explícita no objetivo semanal).

## Testes e aceitação

- `npm run check` / `npm test` verdes, contagem ≥ 410/404 pass; e2e sem falhas novas.
- PGlite: RLS das tabelas novas; código de biblioteca único por dono; semana única por plano; cascade ao apagar plano.
- Unit: semana atual (antes do início → semana 1; depois do fim → última; dentro de pausa → a pausa), agrupamento por bloco, filtros da biblioteca.
- Render: pausas marcadas, "Esta semana", links dos treinos, escape de HTML.
- e2e: com interruptor ligado, barra de baixo com 7 separadores numa só linha a 390px.
- Interruptor desligado: app idêntica.
