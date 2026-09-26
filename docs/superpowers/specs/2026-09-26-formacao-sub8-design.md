# Formação de treinador (Sub-8 primeiro) — desenho

Data: 2026-09-26 · Estado: aprovado em conversa, aguarda revisão desta spec

## Objetivo

Um espaço pessoal de aprendizagem para o treinador, dentro do Vision Coach, com tudo o que
precisa para ensinar um escalão a jogar: guias práticos, treinos-exemplo justificados e
recomendações externas (ver / ler / seguir). Começa pelo **Sub-8**; a estrutura serve
depois Sub-9 até Sénior sem mudanças de esquema.

## Decisões fechadas

| Tema | Decisão |
|---|---|
| Utilizadores | Só o treinador dono da conta. Sem partilha, sem moderação. |
| Origem do conteúdo | Internet (YouTube, blogs, manuais/PDF, redes sociais). A app guarda link + resumo, nunca copia o conteúdo. |
| Recolha | Um agente pesquisa a pedido do treinador numa conversa e **propõe** via MCP. Só o treinador aprova, na app. |
| Organização | Escalão → Bloco → Módulo → conteúdos. |
| Integração | Secção "Formação" dentro do Vision Coach, escondida por interruptor até ser ligada. |
| Custo | 0 €: sem APIs pagas; a pesquisa é feita pelo agente na conversa. |

## Estrutura Sub-8 (12 módulos)

**Bloco 1 — O jogador:** quem são (7–8 anos: corpo, atenção, emoções) · como aprendem ·
objetivos até esta idade · o que fica para depois.

**Bloco 2 — O que ensinar (4 pilares):** técnica (condução, passe, receção, remate, drible) ·
tática (princípios simples em jogo reduzido: atacar/defender, espaço, 1x1, 2x1) ·
físico/coordenação (agilidade, equilíbrio, velocidade — sempre com bola e lúdico) ·
psicossocial (confiança, cooperação, erro, perder).

**Bloco 3 — O treinador:** como ensinar e explicar · como agir (feedback, jogo, pais) ·
planeamento da época · treinos-exemplo.

Os escalões seguintes reutilizam os mesmos blocos; os módulos são dados, não código.

## Modelo de dados (Supabase, tabelas novas, migração só aditiva)

Nenhuma chave estrangeira para tabelas existentes. RLS: dono = `auth.uid()`, sem exceções.

- `learning_age_groups` — id, code (`sub8`…`senior`), name, sort, active.
- `learning_modules` — id, age_group_id, block (`jogador`|`ensinar`|`treinador`), slug, title, sort.
- `learning_items` — recomendações externas:
  id, owner_id, module_id, kind (`ver`|`ler`|`seguir`), media (`video`|`artigo`|`manual`|`blog`|`rede_social`|`canal`|`outro`),
  title, url, url_normalized (**único por dono**), source, summary_pt, key_points (jsonb, 3–5),
  why (porquê ver/ler), status (`proposto`|`aprovado`|`rejeitado`), reject_reason,
  broken (bool), seen_at, notes, proposed_by, created_at, updated_at.
- `learning_guides` — guia-síntese por módulo: id, owner_id, module_id, body_md, citations (jsonb: ideia → item_id/url),
  status, version, created_at, updated_at. Só um guia `aprovado` por módulo; nova versão fica `proposto`.
- `learning_sessions` — treino-exemplo: id, owner_id, module_id, title, objective, pillars (array), duration_min,
  equipment, season_phase (`inicio`|`meio`|`fim`), exercises (jsonb: fase, organização, regras, variantes,
  pontos de ensino, erros comuns), why, citations, status, seen_at, notes, created_at, updated_at.

"Visto" e "notas" ficam nas próprias linhas (um só utilizador). Não entra na sincronização do workspace:
a secção lê e escreve diretamente nestas tabelas.

## Fluxo de propostas

1. Treinador na conversa: "procura conteúdo para Sub-8 / como aprendem".
2. Agente pesquisa, lê e resume em pt-PT.
3. Agente chama o MCP do Vision Coach (autenticação própria existente):
   - `learning_get_structure` — escalões, módulos e URLs já existentes (para não repetir);
   - `learning_propose_items` — lote de recomendações;
   - `learning_propose_content` — guia-síntese ou treino-exemplo.
   Tudo entra com `status = proposto`. **Nenhuma operação MCP aprova.** URL repetido → devolve o existente, não duplica.
4. Na app, ecrã **Propostas**: aprovar, rejeitar (motivo opcional) ou mudar de módulo.

## Ecrãs (mobile-first)

1. **Início Formação** — escalões (Sub-8 ativo, restantes "em breve"), progresso, n.º de propostas pendentes.
2. **Escalão** — 3 blocos, 12 módulos, "x/y vistos" por módulo.
3. **Módulo** — guia-síntese no topo com fontes clicáveis; separadores **Ver / Ler / Seguir**;
   cada item: título, fonte, resumo, pontos-chave, porquê, marcar visto, notas, "link partido".
4. **Treino-exemplo** — objetivo, exercícios, porquê, fase da época.
5. **Propostas** — lista com aprovar / rejeitar / mudar módulo.

YouTube embebido via `youtube-nocookie.com`; Instagram, TikTok, blogs e PDFs abrem no sítio original.
Só conteúdo `aprovado` e não `broken` aparece fora do ecrã Propostas.

## Pontos de contacto com o Vision Coach atual

1. Menu: botão "Formação" atrás de interruptor (desligado por omissão).
2. Service worker/manifesto: registar os ficheiros novos da secção.
3. MCP: 3 operações novas; as existentes não mudam.

## Fases

1. **Fundação** — migração + RLS + interruptor + ecrãs de leitura (1–4).
2. **Propostas** — operações MCP + ecrã Propostas.
3. **Conteúdo Sub-8** — pesquisa por módulo: recomendações Ver/Ler/Seguir, 12 guias-síntese, 12 treinos-exemplo
   (4 por fase da época); aprovação pelo treinador.
4. **Ligar** — verificação na interface e ativação do interruptor só com "sim" explícito.

## Testes e critérios de aceitação

- `npm run check` e `npm test` verdes, contagem de testes igual ou superior à de `origin/main` (comparar antes/depois).
- Novos testes: MCP não consegue aprovar; URL duplicado não cria linha; outra conta não lê nem escreve (RLS);
  conteúdo `proposto`/`rejeitado`/`broken` não aparece nos módulos.
- Playwright: abrir Formação → aprovar proposta → aparece no módulo → marcar visto.
- Regressão: percorrer na interface treinos, jogos e atletas; com o interruptor desligado a app fica idêntica.
- Documentação (`docs/learning.md`) e código MCP no mesmo PR.

## Fora de âmbito (agora)

Copiar treino-exemplo para os treinos do Vision Coach · outros escalões · partilha com outros treinadores ·
testes/quizzes · alojar vídeos.
