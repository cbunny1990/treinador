# Planeamento semanal e evolução da equipa

## Percurso na app

O ecrã **Semana e evolução** abre em **Planear e avaliar a semana**. A segunda tarefa, **Acompanhar objetivos da equipa**, abre a ficha dos objetivos sem misturar os dois formulários. Cada tarefa mostra as semanas ou os objetivos já guardados sem expor os campos extensos. A ação **Planear nova semana** ou **Registar novo objetivo** fica visível no início do painel e abre o formulário recolhido depois dos registos; **Editar** abre diretamente o formulário preenchido. Na criação, a avaliação final da semana, as fontes e a análise detalhada de um objetivo também ficam recolhidas até o treinador as abrir. Ao editar, as secções com dados existentes abrem para revisão. As fichas históricas mostram o resumo e mantêm evidências e avaliação acessíveis em **Ver sessões e avaliação** ou **Ver evidências e avaliação**. Links vindos de propostas e pesquisas abrem diretamente a tarefa dos objetivos.

## Plano semanal

Abre **Workspace → Semana e evolução**. Cada plano usa a segunda-feira como chave da semana e liga treino 1, treino 2 e jogo aos registos existentes por UUID remoto. A nota de relação descreve a progressão planeada. A avaliação final é preenchida pelo treinador depois das sessões; o sistema não a deduz do número de treinos. O treinador pode associar à avaliação fontes explícitas — treinos, jogos e observações existentes — e consultá-las na semana. Ao editar, as ligações existentes mantêm-se e as avaliações substituídas ficam acessíveis no histórico da semana. As associações aos objetivos são listas de seleção por toque para PC e telemóvel e podem incluir sessões e exercícios.

Só pode existir um plano ativo por semana. Editar exige a mesma revisão e `updated_at` lidos inicialmente. Se outro dispositivo alterar o registo, a gravação é recusada e a versão local permanece no formulário para o treinador comparar.

Se um plano antigo contiver uma ligação que não seja um UUID remoto válido, a edição mantém o valor visível e selecionado. Guardar sem o corrigir é recusado; o treinador pode voltar a associar um registo disponível ou limpar a referência. A app não converte IDs locais antigos nem os descarta silenciosamente.

Os planos aparecem do mais recente para o mais antigo e identificam a semana atual, a seguinte e as anteriores. A segunda-feira é a referência da semana.

## Objetivos da equipa

Cada objetivo preserva separadamente facto observado, interpretação, hipótese, avaliação e decisão do treinador. O estado segue `identificado → planeado → trabalhado → observado → avaliado → melhorou / continua`. Para marcar como trabalhado ou avaliado, associa pelo menos um treino ou jogo; exercícios podem ser associados por UUID estável e são preservados ao editar. `Avaliado`, `Melhorou` e `Continua` exigem texto de avaliação e decisão explícita do treinador. A ficha mostra ligações para as sessões que originaram o objetivo, exercícios utilizados e evidências, além da avaliação e decisão guardadas. Os planos semanais mostram os nomes das sessões associadas, a relação planeada e a avaliação final. Nenhum estado é inferido automaticamente.

As sessões relacionadas/de origem (`sessions`) são distintas das sessões em que o treinador confirma que trabalhou o foco (`worked_sessions`). Uma associação, uma sessão planeada ou um exercício relacionado não contam como trabalho realizado. Para avançar a `Trabalhado`, `Observado`, `Avaliado`, `Melhorou` ou `Continua`, o treinador assinala pelo menos uma sessão concluída; a app e o MCP verificam o registo concluído na equipa autorizada. A ficha apresenta a contagem e as sessões correspondentes. Objetivos anteriores à separação mostram “trabalho sem contagem em registo antigo”; as associações antigas não são convertidas automaticamente em trabalho.

O campo de avaliação foi acrescentado sem substituir os objetivos existentes: documentos antigos são lidos com avaliação vazia e mantêm histórico e revisões. Para avançar a `Avaliado`, `Melhorou` ou `Continua`, o treinador precisa de preencher a avaliação separada e a decisão; preencher o campo não avança o estado automaticamente.

Ao editar um objetivo, referências antigas de sessões, trabalho realizado, evidências e exercícios que já não existam neste dispositivo aparecem como ligações sem origem disponível, selecionadas. A gravação rejeita referências não UUID; para continuar, o treinador deve removê-las explicitamente ou substituí-las por registos atuais. Factos, revisão e histórico permanecem intactos enquanto a gravação é recusada.

Os documentos sincronizam pela coleção existente `workspace_documents`, com identidade remota estável e tombstones nos apagamentos. O MCP expõe `get_team_development`, `save_weekly_plan`, `save_team_development_goal` (inclui avaliação separada da decisão) e operações específicas de proposta descritas abaixo; as gravações requerem escopo de escrita, confirmação explícita, UUIDs de sessões pertencentes à equipa e revisão atual.

## Propostas do Head Coach

`prepare_cross_session_priority` cria um objetivo em estado **Identificado**, marcado **Proposta do Head Coach · por rever**. A interpretação, a hipótese e as referências exatas (tipo, UUID, campo/lance, citação e versão da origem) ficam guardadas separadamente; a decisão do treinador começa vazia. O MCP volta a ler cada origem na equipa autorizada e recusa citação ou versão desatualizada. A chave determinística inclui as versões/citações das evidências e a idempotência evita duplicados; se a fonte mudar, a nova proposta fica ligada à nova versão em vez de reutilizar evidências antigas.

Na app, o treinador pode editar a proposta e as suas interpretações. **Aceitar como objetivo** exige que preencha a decisão do treinador e confirme a ação. A aceitação preserva o histórico e não cria treino. **Rejeitar proposta** também pede confirmação e mantém as fontes e o histórico. As operações MCP `accept_team_priority_proposal` e `dismiss_team_priority_proposal` exigem confirmação, versão atual e, na aceitação, uma decisão textual explícita.

Quando `save_weekly_plan` edita os campos de planeamento, uma avaliação final já registada e as suas evidências ficam intactas se a operação não fornecer uma avaliação nova. A IA não deve inferir nem inventar a avaliação do treinador.

Ao editar um objetivo da equipa por MCP, listas e textos omitidos são preservados; listas vazias e textos vazios enviados explicitamente podem removê-los. O estado legado `worked_sessions: null` continua a significar “histórico de trabalho não detalhado” até o treinador fornecer uma substituição explícita.

### Proposta de progressão semanal

O MCP pode preparar uma progressão semanal como proposta pendente com fontes exatas de jogos/treinos, citação e revisão. A proposta não altera outra semana já existente, não se aprova a si mesma e não cria sessões de treino. O treinador revê-a na fila **Propostas do Head Coach · por rever** da página **Semana e evolução** e aprova ou rejeita com confirmação; aprovar exige uma decisão textual e nova leitura das revisões/citações de todas as fontes. A app sincroniza antes da decisão quando o Workspace remoto está configurado, valida as revisões localmente e não permite aprovar offline nesse caso. Enquanto estiver pendente, a edição direta do plano e `save_weekly_plan` recusam alterações que contornem a decisão.
