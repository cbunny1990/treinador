# Planeamento semanal e evolução da equipa

## Plano semanal

Abre **Workspace → Semana e evolução**. Cada plano usa a segunda-feira como chave da semana e liga treino 1, treino 2 e jogo aos registos existentes por UUID remoto. A nota de relação descreve a progressão planeada. A avaliação final é preenchida pelo treinador depois das sessões; o sistema não a deduz do número de treinos. As associações aos objetivos são listas de seleção por toque para PC e telemóvel e podem incluir sessões e exercícios.

Só pode existir um plano ativo por semana. Editar exige a mesma revisão e `updated_at` lidos inicialmente. Se outro dispositivo alterar o registo, a gravação é recusada e a versão local permanece no formulário para o treinador comparar.

## Objetivos da equipa

Cada objetivo preserva separadamente facto observado, interpretação, hipótese, avaliação e decisão do treinador. O estado segue `identificado → planeado → trabalhado → observado → avaliado → melhorou / continua`. Para marcar como trabalhado ou avaliado, associa pelo menos um treino ou jogo; exercícios podem ser associados por UUID estável e são preservados ao editar. `Avaliado`, `Melhorou` e `Continua` exigem texto de avaliação e decisão explícita do treinador. A ficha mostra ligações para as sessões que originaram o objetivo, exercícios utilizados e evidências, além da avaliação e decisão guardadas. Os planos semanais mostram os nomes das sessões associadas, a relação planeada e a avaliação final. Nenhum estado é inferido automaticamente.

O campo de avaliação foi acrescentado sem substituir os objetivos existentes: documentos antigos são lidos com avaliação vazia e mantêm histórico e revisões. Para avançar a `Avaliado`, `Melhorou` ou `Continua`, o treinador precisa de preencher a avaliação separada e a decisão; preencher o campo não avança o estado automaticamente.

Os documentos sincronizam pela coleção existente `workspace_documents`, com identidade remota estável e tombstones nos apagamentos. O MCP expõe `get_team_development`, `save_weekly_plan`, `save_team_development_goal` (inclui avaliação separada da decisão) e operações específicas de proposta descritas abaixo; as gravações requerem escopo de escrita, confirmação explícita, UUIDs de sessões pertencentes à equipa e revisão atual.

## Propostas do Head Coach

`prepare_cross_session_priority` cria um objetivo em estado **Identificado**, marcado **Proposta do Head Coach · por rever**. A interpretação, a hipótese e as referências exatas (tipo, UUID, campo/lance, citação e versão da origem) ficam guardadas separadamente; a decisão do treinador começa vazia. O MCP volta a ler cada origem na equipa autorizada e recusa citação ou versão desatualizada. A chave determinística inclui as versões/citações das evidências e a idempotência evita duplicados; se a fonte mudar, a nova proposta fica ligada à nova versão em vez de reutilizar evidências antigas.

Na app, o treinador pode editar a proposta e as suas interpretações. **Aceitar como objetivo** exige que preencha a decisão do treinador e confirme a ação. A aceitação preserva o histórico e não cria treino. **Rejeitar proposta** também pede confirmação e mantém as fontes e o histórico. As operações MCP `accept_team_priority_proposal` e `dismiss_team_priority_proposal` exigem confirmação, versão atual e, na aceitação, uma decisão textual explícita.
