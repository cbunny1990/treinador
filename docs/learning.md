# Vision Coach — Formação do treinador

Espaço pessoal de aprendizagem: guias-síntese, recomendações (Ver / Ler / Seguir) e treinos-exemplo por escalão. Começa pelo Sub-8.

## Utilização

- Ligar: Definições → “Mostrar a secção Formação (em testes)”.
- Rotas: `#/formacao`, `#/formacao/sub8`, `#/formacao/sub8/<módulo>[/ver|ler|seguir]`, `#/formacao/plano/sub8`, `#/formacao/biblioteca/sub8`, `#/formacao/treino/<id>`.
- Só aparece conteúdo aprovado e sem “link partido”.

## Plano da época

- O cartão **Plano da época** abre `#/formacao/plano/<escalão>` e mostra o plano aprovado, agrupado por bloco, com objetivo e datas de cada semana, treinos A/B e pausas. A semana atual fica destacada e é trazida para a área visível ao abrir a página.
- O plano é guardado em `learning_season_plans`; as semanas ficam em `learning_plan_weeks` e apontam para treinos aprovados em `learning_sessions`.
- Sem plano aprovado, a página explica que ainda não há plano disponível.

## Biblioteca de treinos

- O cartão **Biblioteca de treinos** abre `#/formacao/biblioteca/<escalão>`. A lista mostra código, título, foco, pilares, duração e bloco; permite filtrar por pilar, bloco e foco.
- Cada cartão abre o treino completo em `#/formacao/treino/<id>`, com código, foco e semanas em que é usado no plano aprovado.
- Os treinos completos entram como registos de `learning_sessions` no módulo `treinos-exemplo`, com `library_code`, `focus` e `season_block`. Um plano entra como um registo aprovado em `learning_season_plans` e as respetivas semanas em `learning_plan_weeks`.
- Nesta fase, a app apresenta conteúdo aprovado; ainda não tem o fluxo de propostas e aprovação. A criação e aprovação dos registos requerem uma operação autorizada pelo treinador.

## Regras

1. Os dados vivem nas tabelas `learning_*` (RLS por dono) e não entram na sincronização do workspace.
2. Nenhum agente aprova conteúdo; aprovar é sempre uma ação do treinador na app (fase 2).
3. Vídeos YouTube só via `youtube-nocookie.com`; restantes fontes abrem no sítio original, sem cópia.
