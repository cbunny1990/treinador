# Vision Coach — Human–AI Shared Workspace

## Conceito

O Vision Coach não é um chatbot embutido numa aplicação de gestão.

É um **workspace partilhado entre humano e agente**. O treinador usa uma interface visual. O agente usa um contrato de operações próprio. Ambos trabalham sobre os mesmos objetos: equipa, jogadores, jogos, observações, planos, media e atividade.

A conversa pode acontecer fora da app, por exemplo no ChatGPT. A app continua a ser o espaço persistente onde os dados e o trabalho ficam registados.

## Princípios

1. **A app é o workspace, não o agente.**
2. **Humano e agente são autores distintos.** Cada criação ou alteração deve indicar quem a fez.
3. **Os mesmos objetos são lidos e escritos pelos dois lados.**
4. **A interface humana não deve expor classificações técnicas desnecessárias.**
5. **A memória é persistente e independente do fornecedor/modelo de IA.**
6. **Media tem contexto.** Vídeos, imagens e ficheiros devem estar ligados a jogo, jogador, treino, memória ou documento.
7. **Offline continua válido.** O browser mantém uma camada local utilizável sem rede.

## Navegação humana

A navegação principal tem seis áreas:

- **Workspace** — estado atual da equipa, próximos eventos, prioridades, observações recentes ativas, planos recentes e atividade.
- **Equipa** — perfil, jogadores e jogos.
- **Planos** — planos de treino, análises de jogo, notas e briefings.
- **Media** — biblioteca visual partilhada.
- **Timeline** — histórico de dados, documentos e ações de humano/agente.

Pesquisa e histórico (`#/pesquisa`), Semana e evolução (`#/evolucao`) e Épocas (`#/epocas`) são páginas secundárias, acessíveis a partir do Workspace e dos registos relacionados; não são separadores da navegação principal.

Quando existem conflitos de sincronização, o cartão **Conflitos de sincronização** do Workspace abre a fila de revisão na mesma página. Os casos com duas versões oferecem comparação por campo; identidades duplicadas de registos pesquisáveis oferecem procura por chave externa exata antes de qualquer ligação. Casos sem chave segura continuam preservados e pedem revisão manual. A revisão nunca executa automaticamente uma decisão do treinador.

O painel operacional apresenta até quatro observações ativas mais recentes, com data, origem, excerto e ligação à ficha completa. Memórias arquivadas e outros tipos de memória não aparecem neste cartão; a pesquisa abre o histórico completo.

Chat embutido, OpenRouter, gerador de treino IA, biblioteca antiga de exercícios e dashboard Head Coach antigo foram removidos do produto ativo.

## Dados ativos

IndexedDB v15 mantém os objetos principais e a fila/tombstones necessários para sincronização remota:

- `teams`
- `jogadores`
- `jogos`
- `treinos`
- `game_models`
- `memory_items`
- `media_items`
- `workspace_documents`
- `activity_items`

Alguns stores antigos permanecem na base apenas para compatibilidade/migração. Não fazem parte da navegação nem do bundle ativo.

### `workspace_documents`

Documentos de trabalho partilhados.

Tipos:
- `training_plan`
- `match_analysis`
- `note`
- `brief`
- `weekly_plan` — foco semanal, treinos/jogo associados por UUID e avaliação do treinador.
- `team_goal` — objetivo da equipa com origem, sessões, facto observado, interpretação, hipótese e decisão.
- `season_index` — épocas, plantéis por UUID estável e limites temporais para relatórios separados, sem mover ou apagar o histórico.

Estados:
- `draft`
- `ready`
- `approved`
- `archived`

Auditoria:
- `created_by`: `human | agent | system`
- `created_by_label`
- `updated_by`
- `updated_by_label`
- `created_at`
- `updated_at`

### `activity_items`

Registo imutável de ações relevantes no workspace.

Campos principais:
- `actor`
- `actor_label`
- `action`
- `summary`
- `entity_type`
- `entity_id`
- `created_at`

## Contrato do agente

O browser expõe `AgentWorkspaceAPI` com schema:

`treinador-agent-workspace@2`

Operações atuais:

- `snapshot(options)`
- `listDocuments(options)`
- `getDocument(id)`
- `createDocument(input)`
- `updateDocument(id, changes)`
- `addObservation(input)`
- `listMedia(input)`
- `addMediaLink(input)`

O MCP permite também `get_media` por UUID remota e `update_external_media` para links externos. A edição requer `confirmed: true`, `expected_updated_at` obtido na leitura e scope `media`; a operação volta a ler a linha na equipa autorizada e usa a RPC versionada. Não edita bytes nem media em Storage privado.

As operações de leitura usam os mesmos stores e UUIDs da interface. A API do browser limita a escrita genérica a `brief` em rascunho. `updateDocument` só edita um brief de agente ainda em rascunho e exige `expected_updated_at`; não pode aprovar ou mudar o tipo do documento. `addHypothesis` só guarda uma hipótese após `confirmed: true`, com citações presentes em registos do workspace e identidade idempotente. Não cria factos nem observações atribuídas ao treinador. `addObservation` é um alias de compatibilidade para `addHypothesis` na versão 2. Para planos, análise de jogo, objetivos e decisões, o Head Coach usa as operações MCP específicas com revisão, evidências e confirmação requeridas por cada módulo.

### Exemplo conceptual

O agente recebe:

> Analisa o último jogo e prepara o treino de terça.

Fluxo pretendido:

1. `snapshot()` e operações MCP de leitura — recolhem os mesmos registos e respetivas versões.
2. O agente prepara uma análise ou proposta através da operação MCP específica, com as evidências citadas.
3. Um brief livre pode ser guardado como `draft`; a API genérica não cria análises, objetivos ou planos prontos/aprovados.
4. Se a proposta originar um treino, o treinador revê e aprova explicitamente através do fluxo de continuidade.
5. A atividade e a autoria do Head Coach ficam registadas no workspace partilhado.

Uma hipótese só entra na memória depois de confirmação do treinador, validada contra texto que existe nas fontes escolhidas. A chave de idempotência impede repetir a mesma hipótese e as citações ficam ligadas pelos UUIDs remotos.

## Media e privacidade

O contrato público do agente **não inclui `data_url` local**. Um ficheiro guardado apenas no IndexedDB não deve ser enviado automaticamente para um agente externo.

Exceção explícita por operação: `evaluate_cross_session_relation` envia ao TypeSafe apenas a afirmação escolhida e duas citações textuais selecionadas pelo Head Coach, com tipo de origem e contexto mínimo (data/adversário/zona quando disponíveis). A operação só é executada quando o agente a invoca, revalida as revisões antes do envio, e não transmite media, fotos, o registo completo ou dados de outras equipas. Antes do pedido, aplica o filtro de dados de saúde/pessoais sensíveis, oculta nomes reconhecidos do plantel e falha fechada se não conseguir carregar o plantel para redigi-los. A chamada usa `TYPESAFE_API_KEY` configurada no servidor Edge Function; a chave não é exposta ao browser nem ao treinador. O resultado é uma probabilidade interpretativa sujeita a revisão humana.

`evaluate_cross_session_pattern` aplica as mesmas regras de privacidade e isolamento às citações explicitamente escolhidas de vários jogos/treinos (2–5 jogos distintos e 1–3 treinos distintos). Cada fonte é verificada por UUID e revisão antes do envio. A operação devolve probabilidade e proveniência; não grava nem aprova prioridades.

A fundação remota usa Storage privado Supabase. Ficheiros remotos são acedidos com sessão autorizada ou URLs assinadas temporárias; `data_url` local continua excluído do contrato do agente. Falhas de sincronização com o dispositivo ainda online são repetidas com espera progressiva limitada (2 s até 60 s); alterações locais mantêm-se na base local até uma passagem posterior sincronizar ou apresentar conflito.

## Estado atual da ligação remota

### Pesquisa RAG do Head Coach

A pesquisa semântica complementar está descrita em [`team-knowledge-rag.md`](team-knowledge-rag.md). Vetores e chunks derivados não substituem os registos nem entram na sincronização PWA; usam o UUID e `updated_at` de `workspace_records` e são sempre filtrados para a equipa autorizada. Consultas de disponibilidade, presença, calendário, resultado e estatísticas mantêm-se estruturadas. `get_training_planning_context` junta dados estruturados para a data pedida com excertos RAG dos últimos cinco jogos e do trabalho recente, preservando as fontes e indicando informação ausente. A operação é de leitura para o treinador; pode atualizar apenas o índice derivado. Não aprova nem cria planos.

A fundação remota está implementada com Supabase:

1. autenticação do treinador por email;
2. RLS por equipa e membership;
3. sincronização IndexedDB ↔ Supabase;
4. UUIDs estáveis entre dispositivos;
5. deteção de conflitos sem overwrite silencioso;
6. tombstones para eliminações offline;
7. Storage privado para media;
8. activity log e tabela de autorizações do agente;
9. sincronização automática ao alterar dados, abrir a app ou recuperar rede.

Os papéis `owner` e `coach` podem escrever registos, media, atividade e ficheiros privados da equipa; `viewer` só pode ler. A migration `20260926150407_20260926120000_enforce_team_member_roles.sql` aplica esta distinção nas policies RLS/Storage. O papel omitido ao criar uma membership é `coach`, compatível com a restrição de valores permitidos.

O código não contém credenciais privadas. A PWA aceita apenas Project URL + publishable key; secret/service-role ficam reservadas às Edge Functions.

Eliminações offline guardam a versão remota que o treinador viu. A sincronização usa essa versão numa atualização condicional; se outro dispositivo editou entretanto, mantém o tombstone e apresenta o conflito com as duas versões. Em Definições, o treinador escolhe manter a cópia remota ou confirmar a sua eliminação. Se houver nova edição durante a decisão, a comparação condicional volta a recusar a eliminação e sinaliza o conflito.
Para rever vários conflitos de edição, a pré-visualização em lote combina alterações em campos diferentes e assinala separadamente os campos alterados nos dois dispositivos. O treinador pode preencher esses campos com a versão deste dispositivo ou do workspace remoto, rever e alterar cada escolha e só então confirmar a sincronização. A pré-seleção não grava dados; versões alteradas desde a comparação continuam protegidas por controlo de revisão.
Antes de qualquer consulta por identidade, o cliente verifica que `sync_id` é um UUID remoto. IDs locais legados sem versão remota confirmada são substituídos por um UUID estável e sincronizados; IDs inválidos com versão remota ou tombstone ficam em conflito, sem consulta malformada nem perda de dados.
O mesmo controlo é aplicado durante a consolidação inicial: um valor local como `default` recebe UUID antes de entrar no fluxo normal de sincronização; uma identidade inválida já associada a uma versão remota não é reatribuída.
Cada registo sincronizado guarda localmente a UUID do workspace remoto de origem. Ao mudar de workspace, a app não envia registos nem media já associados a outra equipa; tombstones também continuam dirigidos à equipa de origem. Registos antigos sem origem recuperável ficam em conflito para evitar uma cópia silenciosa entre equipas.
As relações entre media, atletas, jogos, treinos, memórias e documentos usam UUIDs remotos. A conversão para IDs locais só ocorre quando o registo pertence ao workspace remoto ativo; uma referência local que não possa ser resolvida é recusada, em vez de enviar um ID numérico de outro browser.
Remover media da biblioteca é uma eliminação lógica sincronizada: o registo deixa de aparecer nas vistas ativas, mas o blob permanece no bucket privado para preservar o histórico. A confirmação na interface informa que esta ação não elimina fisicamente o ficheiro.
Online, a troca de workspace identifica a origem dos registos locais antes de mudar. Offline, a lista usa apenas memberships previamente confirmadas para a mesma conta e o mesmo projeto. A troca fica bloqueada se houver registos ou eliminações sem equipa remota confirmada, ou alterações pendentes no perfil da equipa; quando é segura, carrega também o snapshot local do perfil escolhido e não inicia chamadas de rede. Registos e media continuam filtrados pela UUID remota ativa; o sync retoma ao reconectar.
Se um registo eliminado remotamente ainda tiver alterações locais por sincronizar, essas alterações ficam preservadas. Em Definições, o treinador pode confirmar o restauro da cópia remota na versão eliminada, usando comparação de versão antes de voltar a enviar as alterações locais.

O MCP do Vision Coach já está exposto como Edge Function autenticada por tokens de conector guardados apenas como hash. Cada conector fica associado a uma equipa e a scopes explícitos; operações de escrita passam pelas RPCs auditadas e verificam a versão esperada do registo. Registar presença, nota factual, criar treino, editar o alinhamento inicial, controlar cronómetros e alterar disponibilidade/plantel exigem `confirmed: true`; o handler repete a validação e recusa versões antigas. O gateway Head Coach usa separadamente `agent_authorizations`. Estas funções estão no repositório e não se considera que estejam publicadas até confirmar o estado remoto do projeto Supabase.

## Migração da aplicação anterior

A migração v3 → v9 é automática. Registos de jogadores, jogos, treinos e memória continuam disponíveis; UUIDs remotos são atribuídos de forma lazy na primeira sincronização.

### Correção de sincronização v68

Um `sync_id` local legado como `default` recebe UUID apenas quando ainda não existe uma versão remota reconhecida. Se já existe versão remota, a cópia local permanece para reconciliação. Tombstones guardam `team_id = default` porque essa é a equipa local; a eliminação remota consulta primeiro a equipa UUID do próprio registo e exige a versão remota vista antes de apagar. Um conflito mantém o tombstone pendente. Publicado no PR #42.

Os blocos planeados e os blocos congelados da sessão usam o UUID remoto do exercício ao sair deste dispositivo. Um treino legado que ainda contenha o ID numérico local é convertido pela ligação ao exercício da mesma equipa; se o exercício já não existir ou pertencer a outra equipa, o treino fica em conflito e não é enviado com uma referência inválida. Os exercícios são sincronizados antes dos treinos, para que um plano novo possa referir o exercício já persistido. Depois de confirmado o envio, a cópia local recebe também as referências UUID; uma edição feita durante o envio permanece pendente e não é substituída.

Na convocatória e no alinhamento de um jogo legado, IDs numéricos locais de atletas também são convertidos em UUIDs antes do envio. UUIDs de atletas que foram eliminados depois continuam válidos para preservar o histórico do jogo, desde que o registo pertença à mesma equipa; esta exceção não permite voltar a selecionar o atleta na interface.

A confirmação de um envio compara a revisão local exata dentro da transação IndexedDB. Se o treinador alterou o registo enquanto a rede respondia, a edição e o texto permanecem locais, marcados para nova sincronização sobre a versão remota recém-confirmada. Um tombstone pendente impede que a leitura seguinte ressuscite um registo apagado durante o envio; quando a eliminação ocorre nesse intervalo, o tombstone recebe a versão acabada de gravar para que a eliminação condicional possa concluir-se.

O mesmo controlo aplica-se a media. Uma mudança de título ou nota feita durante o upload permanece pendente sem repetir os bytes. Os novos uploads locais usam um caminho privado com SHA-256 dos bytes: uma alteração posterior da fotografia recebe um caminho diferente e o ficheiro anterior permanece intacto. Se os bytes mudarem durante o upload, a nova versão continua pendente. Um tombstone de media pendente impede que a fotografia reapareça no pull.
Uploads diretos de ficheiros resolvem primeiro a referência ao atleta, jogo ou outro registo; uma referência inválida falha antes de enviar bytes ao Storage, evitando objetos sem entrada de media.

Conflitos repetidos para a mesma identidade, cópia local e motivo, encontrados em diferentes fases ou nas duas passagens da consolidação, são deduplicados no resultado e no painel. Conflitos reais distintos continuam listados separadamente; a deduplicação não resolve nem descarta decisões pendentes.

Ao descarregar, a app compara dentro da transação IndexedDB a cópia local vista antes de hidratar referências ou pedir uma URL assinada. Se o treinador a tiver alterado entretanto, mantém a edição local e mostra conflito quando a versão remota diverge. Um registo apagado nesse intervalo não é recriado pela confirmação do pull.

A fotografia de perfil é atualizada pela media associada sem gravar uma ficha de atleta que tenha mudado no mesmo intervalo. Uma fotografia local mais recente aguarda a criação/receção da sua media; a ausência temporária de media não apaga um `data_url` sem referência gerida.

Ao receber uma eliminação remota, a remoção local também compara a cópia vista com a linha atual dentro da transação IndexedDB. Se houve edição local entretanto, conserva-a e sinaliza o conflito, incluindo em jogos e media.

Depois da v68, uma referência de documento/memória/media já expressa em UUID podia ser interpretada como ID numérico da IndexedDB. A v69 valida o UUID na equipa remota antes de o reutilizar; uma referência local ausente ou inválida fica em conflito, preservando o registo de origem, enquanto a restante sincronização continua.

A reformulação remove o produto antigo da experiência sem apagar silenciosamente os dados existentes. Stores legados podem ser eliminados numa migração posterior apenas depois de confirmar que nada útil precisa de ser convertido para o novo modelo.

## Testes

A suíte deve validar, no mínimo:

- migração de dados antigos até à versão IndexedDB v15;
- funcionamento offline;
- captura de observação pelo treinador;
- documentos partilhados;
- associação de media;
- escrita do agente através de `AgentWorkspaceAPI`;
- autoria distinta humano/agente;
- ausência do chatbot e gerador IA antigos no bundle ativo.

### Verificação multi-dispositivo (23/09/2026)

Os testes de `remote_workspace.test.js` executam o sincronizador do cliente com duas bases locais isoladas e um backend em memória partilhado. Confirmam: criação no dispositivo A e leitura no B; edição no B e atualização no A; eliminação offline com tombstone, propagação da eliminação e ausência de ressurreição; conflito explícito quando A e B editam a mesma revisão; upload de media para um caminho do workspace e leitura no outro por URL assinada. Também confirmam que chamadas simultâneas para o mesmo workspace não correm em paralelo e provocam uma passagem adicional para apanhar alterações durante a sync; uma chamada para outro workspace espera pela execução atual, e a seleção de equipa não muda até essa execução terminar. São testes determinísticos do contrato de sincronização, não uma ligação ao projeto Supabase nem um ensaio em aparelhos físicos.

Cobertura adicional no mesmo teste: ida PC → backend → telemóvel → backend → PC para jogo com o formato real `match_events` + `visual_match`, treino com presenças e exercícios, memória e proposta/documento; os minutos são recalculados pelos movimentos sincronizados e os lances conservam UUIDs. A fotografia de atleta é enviada como media ligada à UUID remota do jogador, descarregada como URL assinada, apresentada no perfil do telemóvel e outra fotografia regressa ao PC sem transportar `data_url`. Apagar a fotografia mais recente offline cria tombstone, remove-a nos dois dispositivos após reconexão, mantém a fotografia anterior e não a ressuscita na passagem seguinte. O teste compara os dados aninhados e confirma uma única cópia por referência estável. O backend continua em memória: isto confirma os mapeamentos do cliente, mas não valida RLS, Realtime, autenticação, Storage real ou sessões em aparelhos.

### Combinação assistida de edições sem sobreposição

Cada gravação enviada ou recebida guarda localmente o último `payload` remoto comum em `_sync_base`; este campo é excluído do payload de rede. Ao comparar um conflito de um registo versionado, o cliente calcula alterações por campo de topo usando essa base. Só oferece combinação automática quando PC e telemóvel mudaram campos diferentes; listas e objetos aninhados são tratados como um único campo. A prévia mostra o resultado e os campos alterados, e o treinador confirma antes da escrita condicional contra a versão remota ainda atual. Se ambos alteraram o mesmo campo ou falta a base comum, o treinador pode escolher explicitamente qual versão fornece cada campo que difere; campos iguais são mantidos. A escrita verifica que as escolhas abrangem exatamente os campos ainda diferentes e revalida as versões local e remota antes de sincronizar. Referências por resolver bloqueiam combinação. Media e atividade imutável nunca são combinadas. Registos mais antigos sem base comum podem assim ser reconciliados campo a campo, sem eliminar silenciosamente a versão oposta.

Quando a base comum existe e apenas um lado alterou o conteúdo, a comparação identifica a versão alterada e permite ao treinador confirmá-la explicitamente. A revisão agrupada inclui estes casos na prévia com a decisão (`keep_local` ou `keep_remote`) visível; os registos sobrepostos, sem base comum ou media continuam para escolha individual. A aplicação revalida as duas revisões antes de cada escrita e sincroniza o lote uma vez após as decisões confirmadas.

Regressão de duas bases ampliada (24/09/2026): o lote verifica ambos os casos de conteúdo unilateral. Para `keep_remote`, o conteúdo remoto alterado aparece no dispositivo depois da decisão; para `keep_local`, uma edição local é enviada quando o remoto avançou de versão mas voltou ao conteúdo comum. No mesmo lote, duas combinações independentes são sincronizadas, um conflito sobreposto continua pendente, há uma única passagem final de sync e permanecem cinco registos sem duplicação. A prévia é lida antes de confirmar e não altera o backend.

Esta revisão da interface e do sincronizador está incluída na shell da PWA `vision-coach-v154`; a ativação migra a cache da app mantendo a cache persistente dos originais aprovados de exercícios.

### Carregamento inicial do Workspace

O estado de sessão remota, o snapshot local operacional e os documentos arquivados para a época são lidos em paralelo. A página não aguarda a ronda de sincronização para apresentar o snapshot local; a sync continua em segundo plano. O E2E mantém as três leituras suspensas e confirma que começam antes de qualquer uma terminar, protegendo contra regressão para esperas sequenciais.

Validação read-only do projeto Supabase em 23/09/2026: projeto ativo; RLS ligado nas tabelas partilhadas consultadas; bucket `team-media` marcado como privado. Esta consulta verifica configuração, mas não substitui uma tentativa de acesso com sessões reais de treinador em duas equipas/dispositivos.

Auditoria read-only adicional em 23/09/2026: `workspace_records`, `media_assets` e `teams` constam da publicação `supabase_realtime`, mas `activity_log` não constava, embora o cliente sincronize essa tabela. O cliente também subscreve `activity_log`, e a migração local `20260926150348_20260923120000_workspace_activity_realtime.sql` adiciona a tabela à publicação. Depois de alinhar os ficheiros locais com o histórico remoto, a stack isolada de auditoria ficou saudável: `migration list --local` confirmou as 20 versões aplicadas e `db lint --local --schema public,private --fail-on error` não encontrou erros. `npm run test:supabase-local`, direcionado para essa stack com `VISION_COACH_SUPABASE_LOCAL_WORKDIR`, passou os testes RLS/sincronização com duas sessões e a PWA offline/religação. A stack normal deste worktree conserva um histórico antigo (`001`, `002` e versões antigas de continuidade) e não foi alterada; a seleção explícita da stack no runner evita tocar nesses dados. Nenhuma migração foi aplicada ao projeto publicado. O projeto confirmou RLS nas tabelas partilhadas e bucket `team-media` privado; o advisor também sinalizou que a proteção de palavras-passe comprometidas está desativada.

Teste de integração local (`npm run test:supabase-local`): com duas sessões de treinador sintéticas, usa o cliente Supabase real contra localhost para verificar criação/leitura da equipa, escrita e leitura por membro, isolamento de uma conta externa, conflito por `updated_at`, tombstone, upload privado e URL assinada para foto de atleta. `VISION_COACH_SUPABASE_LOCAL_WORKDIR` permite escolher uma pasta Supabase local isolada; por omissão é usado o worktree atual. As credenciais são recolhidas da stack escolhida apenas em memória, o runner recusa URLs não locais e as contas sintéticas são removidas no fim. A migração `20260926150350_20260923120100_allow_team_owner_select_during_creation.sql` corrige a criação: permite ao proprietário ler apenas a sua própria linha durante `INSERT ... RETURNING`, antes de o trigger adicionar a membership; membros continuam autorizados pela policy normal. Foi aplicada ao projeto pelo fluxo autorizado de migrations, sem ser reaplicada durante esta reauditoria.

Regressão de religação automática (27/09/2026): no E2E de duas PWA com Supabase local, uma edição semanal feita no telemóvel simulado enquanto offline é sincronizada após a religação sem chamar `syncNow()` no teste. A verificação aguarda que a fila local fique limpa, que a UUID apareça uma única vez no servidor com o texto editado e que não exista conflito. O PC lê depois a mesma edição. `VISION_TEST_PORT` permite usar uma porta de navegador livre quando há outra pré-visualização local; por omissão mantém-se 18765. A stack isolada passou 5/5 integrações e 2/2 testes E2E locais; a suíte geral Playwright passou 201/201. Isto continua a não substituir o ensaio no telemóvel físico.

Auditoria de fotografia e sincronização (25/09/2026): numa stack Supabase temporária, criada com as migrations atuais deste branch, `node scripts/test-supabase-local.mjs` passou 3 testes de integração reais (inclui Storage privado, URL assinada da fotografia, sessões separadas, RLS, conflito e tombstone) e 1 teste PWA PC↔telemóvel/religação. Nesse E2E, a foto é escolhida e guardada pela interface móvel enquanto offline; depois de reconectar, o teste confirma o objeto no Storage, a URL assinada no PC, a referência local no telemóvel e uma edição offline posterior sem conflito. Os três testes WebKit móveis do formulário também passaram, incluindo imagem grande sem `createImageBitmap`. O runner recusou primeiro uma stack anterior cujo histórico divergia e não aplicou migrations nela. A stack temporária recebeu apenas contas, equipa e ficheiros sintéticos de teste. Isto valida o percurso automatizado contra Supabase local; não reproduz ainda o problema no telemóvel físico do treinador. Nenhuma alteração ou publicação foi feita no Supabase remoto.

Round-trip de imagem original aprovada de exercício (25/09/2026, local): a integração Supabase acrescenta uma imagem original da biblioteca sem alterar os bytes. O PC sincroniza UUID, caminho privado e SHA-256 do exercício; o segundo dispositivo recebe os mesmos metadados e, numa sessão Supabase distinta, ambos obtêm URLs assinadas válidas cujo conteúdo confere com o SHA-256 original. A rota pública continua recusada. `npm run check`, `npm test` (389 aprovados; 6 integrações locais opcionais ignoradas), os 3 testes Supabase locais e o E2E PWA PC↔telemóvel 1/1 passaram. O ficheiro foi removido da Storage no cleanup; dados sintéticos apenas, sem escrita ou publicação remota.

Estado visível de sincronização da foto (25/09/2026): a ficha do atleta mostra pendente, sincronizada ou erro quando existe uma fotografia de perfil, sem expor URLs privadas. A atualização dos rótulos reage aos eventos de sincronização sem navegar novamente, para não perder posição de ecrã. O E2E local testa a transição pendente → sincronizada no mesmo telemóvel; a regressão WebKit provoca um evento de falha e confirma que a foto continua guardada localmente e que surge o atalho para Definições. Ainda falta reproduzir a queixa no telemóvel físico.

Bytes de fotografia em origem única (25/09/2026): novas fotos guardam os bytes apenas no respetivo item `media_items`; o atleta mantém a UUID estável em `profile_media_ref`, sem duplicar o `data_url`. A sincronização converte as referências antigas de media gerida para este formato quando a media correspondente está disponível. Fotos antigas sem item media mantêm-se como legado e não são apagadas. `applyPlayerProfilePhotos` continua a abastecer as vistas de plantel, atleta e quadro visual, e os E2E verificam que os dados ficam fora do registo de atleta enquanto a imagem continua renderizada.

Seleção da versão de foto (25/09/2026): enquanto a media ligada por `profile_media_ref` está `sync_dirty`, essa escolha local prevalece, incluindo em datas iguais. Quando a media fica sincronizada, a seleção segue a versão mais recente partilhada por `updated_at`, com desempate pela UUID remota estável; assim todos os dispositivos escolhem a mesma foto quando os relógios registam a mesma data. Testes unitários e E2E cobrem a edição pendente, datas empatadas e o round-trip Supabase/PC/telemóvel.

O mesmo comando também executa `tests/realtime_supabase_local.test.js`: duas sessões de treinador da mesma equipa estabelecem uma subscrição Postgres Changes com confirmação do servidor; uma atividade escrita pelo segundo treinador tem de chegar ao primeiro por `activity_log`, enquanto uma terceira conta sem membership não pode ler essa atividade. O teste recusa endpoints que não sejam loopback e limpa canal, equipa e utilizadores sintéticos no `finally`. Isto valida o percurso real do serviço Realtime numa stack isolada, não em dispositivos móveis físicos nem no projeto publicado.

`tests/team_knowledge_supabase_local.test.js` cria duas equipas e conectores MCP reais, indexa relatórios de cada uma com embeddings simulados e executa o retriever contra Postgres/pgvector local. Cada conector só pode recuperar a UUID e os excertos da sua equipa; o escalão devolvido tem de corresponder aos metadados da equipa. As fixtures são removidas no `finally`; o provider externo não é chamado.

Confirmação histórica PC↔telemóvel na PWA v69 (25/09/2026): o treinador confirmou a consolidação no PC e a leitura dos dados recentes no telemóvel depois de sincronizar. Isto prova apenas aquele percurso nessa versão; não valida a PWA v170 nem os commits locais posteriores. Continuam por verificar em aparelhos reais: telemóvel editar/apagar → PC receber; PC apagar → telemóvel deixar de mostrar; reconexão após trabalho offline; conflito entre edições feitas nos dois aparelhos; upload e leitura de fotografia/media; confirmação visual após reabrir a PWA e atualizar o service worker. Na data deste registo, a sincronização imediata de `activity_log` ainda aguardava a migration `20260926150348_20260923120000_workspace_activity_realtime.sql`, aplicada remotamente em 26/09/2026.

Reconciliação pré-deploy, read-only (23/09/2026): foram recuperados os 17 ficheiros com as versões registadas pelo Supabase MCP em produção, incluindo as sete migrações base e `20260922103529_enable_workspace_realtime`. A pasta local contém essas 17 versões mais três migrações pendentes: Realtime de `activity_log`, criação de equipa durante `INSERT ... RETURNING` e hardening RLS de duas tabelas privadas. Os antigos baselines consolidados e migrações de continuidade com versões posteriores foram substituídos para manter a mesma sequência de histórico. Os 20 ficheiros coincidem com a exportação e as migrações locais. A validação ocorreu numa stack de auditoria isolada. A tentativa de `supabase migration list --linked` falhou porque este worktree não está ligado ao projeto. Nenhuma ligação, reparação, aplicação remota ou `db push` foi feita. Antes de publicar, rever as três migrações novas e confirmar as 17 versões já existentes no remoto.

Em 24/09/2026, após autorização explícita do treinador, aplicou-se `20260924144849_enable_private_internal_table_rls.sql` no projeto Supabase Vision Coach. `private.agent_request_log` e `private.mcp_connector_tokens` têm RLS ativo; `PUBLIC`, `anon` e `authenticated` não têm grants, e as RPCs continuam a usar o acesso backend existente. O advisor confirma RLS sem policies para estas tabelas internas; uma stack Supabase descartável independente passou as regressões reais de RLS/RPCs.


### Scroll do Workspace durante sincronização

O Workspace mostra primeiro o snapshot local e inicia a sincronização remota em segundo plano. Quando chega `visioncoach:sync-complete`, a rota é atualizada sem iniciar outra sync. Isto evita o ciclo de renderizações/sincronizações repetidas. `setView()` só reposiciona a janela para o topo quando muda a rota; na mesma rota, cada renderização agora também preserva a posição, salvo intenção de scroll do treinador no mesmo frame. A regressão Playwright em `tests/e2e/workspace.spec.js` segura a sync, verifica uma só chamada e confirma a posição do scroll depois do evento. A cache PWA é v117.

A lista de sincronização agrupa a contagem por ação: escolha do treinador, correção de identidade e falha temporária repetível. Metadados técnicos ficam recolhidos. Nenhuma versão é escolhida automaticamente. Conflitos sem sobreposição podem ser combinados depois de prévia e confirmação; campos sobrepostos e registos legados sem base comum podem ser reconciliados com escolhas explícitas por campo. A resolução revalida a cópia local e a remota antes de gravar. Falhas de URL assinada continuam sujeitas a retry.

O fluxo de escolha campo a campo foi verificado em viewport de 390 × 844 sem rolagem horizontal. A suíte de sincronização `tests/remote_workspace.test.js` cobre duas cópias concorrentes, alterações independentes/sobrepostas, base ausente, eliminação de campo, revalidação e ida e volta de fotos, media, lances, minutos e sessões.

Atalho operacional (24/09/2026): o cartão de conflitos no Workspace abre `Definições?focus=conflitos` e desloca diretamente para a fila, sem procurar manualmente pela página. A regressão E2E confirma destino e posição visível em viewport móvel. As decisões de resolução continuam explícitas e protegidas por revalidação.

Nas prévias de conflitos, campos de URL assinada conhecidos são removidos. A limpeza também deteta URLs assinados por caminho Supabase Storage ou parâmetros de assinatura comuns, incluindo `X-Amz-*` e `X-Goog-*`; conteúdo `data:` é substituído por marcador. URLs regulares de vídeo continuam visíveis para comparar os registos. Quando a prévia limita listas, campos ou texto muito longo, indica explicitamente a quantidade omitida; a escolha continua a aplicar a versão completa e revalida as versões antes de gravar.

Combinação segura em lote (24/09/2026): quando existem vários conflitos de versão, o treinador pode pré-visualizar os registos cujas alterações são independentes nos dois dispositivos e aplicar essas combinações numa confirmação. A prévia não grava; cada par de versões local/remota é revalidado antes da aplicação. Conflitos sobrepostos, legados sem base comum e media permanecem na fila para escolha individual. O envio agrupado usa uma única sincronização, não cria cópias adicionais e deixa os conflitos não resolvidos intactos. Verificado com três registos em duas bases simuladas (dois combinados, um sobreposto preservado), teste da interface e cache PWA v139.

Auditoria automatizada adicional (24/09/2026): `tests/remote_workspace.test.js` passou 81/81 e `tests/e2e/workspace.spec.js` com UX global móvel passou 52/52. A suíte cobre tombstones offline e durante pull/push, alterações concorrentes, decisão de conflitos, retenção de media privada e sincronização de dados de jogo/treino. Isto complementa a integração Supabase local anteriormente documentada; não equivale a executar com dois aparelhos físicos. O teste físico PC↔telemóvel permanece pendente.

Redesenho do Workspace após sincronização (24/09/2026): o painel só volta a consultar e construir o snapshot se a sincronização recebeu/apagou registos ou se o conjunto de conflitos mudou. Envios sem alterações recebidas atualizam o indicador remoto e mantêm o DOM/posição de leitura; uma falha recuperada remove o aviso local sem reconstruir o painel. O estado de conflitos é comparado por identidade, causa e revisões, pelo que uma notificação repetida não provoca novo redesenho. Regressão E2E verifica scroll, pull remoto, conflito novo e estado repetido.

### Deduplicação de atividade imutável

O registo de atividade é imutável e uma repetição da mesma UUID só é considerada sincronizada se o conteúdo corresponder. O timestamp compara-se como instante UTC, não como texto ISO: Postgres pode devolver `Z` ou `+00:00` e precisão decimal diferente para o mesmo instante. Uma diferença real de instante ou de conteúdo continua em conflito e não é sobrescrita. Cache PWA v118; regressão em `tests/remote_workspace.test.js`.

Quando uma atividade antiga aponta para uma chave externa textual, o sincronizador só a converte para UUID se encontrar exatamente um documento dessa equipa com `external_key` igual, verificar a UUID desse documento no workspace remoto e confirmar o respetivo tipo. Correspondências ausentes/ambíguas continuam em conflito. O formulário do arquivo de épocas passou também a registar a UUID real do documento recém-criado, em vez da chave `season-index:default`.

Consolidação mais leve e recuperação de identidade (24/09/2026): a verificação de equipa para registos locais não ligados ao workspace consulta UUIDs remotos em lotes de até 100, em vez de uma chamada por registo; aplica-se a dados de jogo/treino, media e atividade. O arranque não agenda uma sync em paralelo à consolidação emitida pelo evento inicial de sessão. Um conflito `invalid_local_sync_id` pode procurar uma única correspondência por `external_key`, mostrar as duas cópias e ligar os IDs após confirmação do treinador, revalidando a versão antes da operação. Chave ausente ou resultado ambíguo mantém o conflito e não cria cópia nova.

Consolidação para históricos grandes (25/09/2026): a verificação de registos já associados ao workspace consulta apenas as UUIDs locais, em lotes de até 100, em `workspace_records` e `media_assets`. Cada lote usa paginação por UUID, incluindo quando o limite configurado da API é inferior a 100. Não descarrega todos os IDs da equipa. A regressão simulou 1.007 IDs locais com limite de resposta 25; a integração PostgREST confirmou a presença de UUIDs numa página tardia num histórico de 1.007 registos. Conflitos, pertença da equipa e apagamentos continuam sujeitos às verificações existentes.

Leituras completas durante a sync (25/09/2026): cada tabela começa com um snapshot remoto paginado. As escritas locais confirmadas atualizam esse mapa com a resposta do servidor; a app volta a descarregar a tabela apenas se a operação detetar um conflito e precisar da revisão remota atual para apresentar ao treinador. Alterações remotas concorrentes fora desse snapshot continuam a chegar por Realtime ou pela sincronização seguinte; nenhuma versão local ou remota é escolhida silenciosamente.

Pull de históricos grandes (25/09/2026): ao aplicar o snapshot remoto, a sincronização cria um índice em memória por módulo para encontrar registos locais por UUID estável ou identidade externa. Antes, carregava e percorria novamente toda a tabela local para cada registo remoto (1.010 leituras para puxar 1.007 jogos); agora faz uma leitura do índice por módulo e atualiza-o após inserir, alterar ou remover registos. A gravação continua a comparar o snapshot local exato antes de aplicar a versão remota, preservando o conflito explícito se houver uma edição concorrente. Regressão cobre 1.007 jogos e a suíte Supabase local cobre tombstones, conflitos e sincronização entre clientes. Cache PWA v171.

Referências repetidas em media (25/09/2026): durante uma sincronização, UUIDs repetidos de atleta/equipa são resolvidos com uma leitura local por tipo de origem e cache limitado àquela execução; não há cache persistente que possa ficar obsoleto entre syncs. Regressão puxa 1.007 ficheiros do mesmo atleta e confirma uma leitura do plantel, preservando o vínculo local e a media. `npm test` passou 410/410 sem falhas (7 testes locais ignorados por requererem stack); E2E de fotografia móvel 2/2, integração Supabase local 4/4 e PWA offline/conflito PC↔PWA 1/1 passaram. Stack descartável encerrada com backup; sem publicação ou escrita remota.

Referências em atividade (25/09/2026): o pull aplica o mesmo cache temporário ao converter a origem dos eventos, evitando carregar o plantel repetidamente quando muitos eventos apontam para a mesma pessoa. Regressão importa 1.007 eventos com a mesma UUID, confirma uma leitura e verifica que todos mantêm o ID local correto. Check, 410 testes unitários, Playwright 164/164, Supabase local 4/4 e PWA offline/conflito PC↔PWA 1/1 passaram. Stack encerrada com backup; sem alteração remota ou publicação.

Resolução de referências em históricos (25/09/2026): a hidratação de payloads durante o pull partilha o cache de UUID→ID local com a sincronização e o atualiza ao inserir, atualizar ou apagar origens. Uma regressão importa 1.007 documentos ligados ao mesmo atleta: depois das duas leituras iniciais do módulo, uma única leitura do plantel resolve todas as referências, que continuam ligadas ao ID local correto. Check, 411 testes unitários, 88 testes de sincronização, Supabase local 4/4 e E2E offline PC↔PWA 1/1 passaram; stack encerrada com backup. Sem dados remotos, imagens aprovadas ou publicação alterados.

Se o evento de atividade continua válido mas a sua origem local já não existe ou a UUID não pertence ao workspace selecionado, o sincronizador envia o evento com `entity_ref` vazio e guarda tipo, referência original e motivo em `_vision_coach_unresolved_origin`. A referência fica explícita como proveniência, nunca é convertida num vínculo remoto. O mesmo aviso é mostrado no Workspace e na Timeline. Referências ambíguas, de outra equipa ou de equipa desconhecida continuam bloqueadas. Cache PWA v119.

## Publicação rápida de imagens por IA

O procedimento atual está em [ai-image-workflow.md](ai-image-workflow.md). Usa o MCP autenticado ou `npm run images:publish`; não volta a gerar imagens aprovadas nem requer alterações de frontend por imagem.

## Aceitação física PC↔telemóvel — pendente

Os testes Playwright/WebKit e Supabase local confirmam o código e o backend isolado, mas não verificam dois aparelhos físicos. Para testar a branch atual sem publicar, servir o build local numa rede de teste e apontá-lo a uma stack Supabase descartável acessível aos dois aparelhos. Usar uma equipa e registos sintéticos nessa stack; não criar, editar ou apagar dados na equipa real. A PWA publicada atualmente é v170, por isso testar essa URL valida apenas a versão publicada, não os commits locais posteriores.

1. Criar um atleta sintético no PC; confirmar no telemóvel a mesma UUID e uma única ficha. Editar campos e fotografia no telemóvel; confirmar texto, estado sincronizado e fotografia no PC. A fotografia de teste deve ser própria, sem substituir originais aprovados.
2. Criar treino, convocatória/alinhamento e jogo sintéticos; registar presença, sessão, evento, substituição/minutos e análise nos dois aparelhos. Confirmar que as contagens e referências são iguais após fechar e reabrir a PWA.
3. Apagar um registo de teste no PC e outro no telemóvel; sincronizar ambos os aparelhos, fechar/reabrir e confirmar que não reaparecem. Não limpar conflitos através de consolidação automática.
4. Pôr o telemóvel offline, editar um registo de teste e voltar a ligar; confirmar a sincronização sem cópia duplicada. Editar o mesmo campo em ambos os aparelhos offline; confirmar que o conflito é apresentado e que a escolha explícita preserva o valor escolhido em ambos.
5. Com texto por guardar ou sessão de treino/jogo ativa, confirmar que uma atualização da PWA não interrompe o trabalho nem salta o scroll; após sair da sessão, atualizar e reabrir, confirmar a versão/caches e a persistência dos dados sintéticos.

Registar para cada passo o aparelho/navegador, estado online/offline e resultado. Considerar concluída a auditoria física só depois de todas as direções de criação/edição/apagamento, fotografia, conflito e reconexão passarem. Encerrar apenas a stack/ambiente de teste após guardar a evidência; nunca executar limpeza sobre o projeto ou equipa reais.

Integração adicional em duas PWA locais (26/09/2026): `tests/e2e-local/match_full_cycle.spec.js` cria um jogo e alinhamento por UUID no PC; o telemóvel recebe o plano, inicia explicitamente o cronómetro, confirma uma substituição e um golo, e sincroniza. O PC recebe a cronologia, os minutos e as estatísticas calculadas e gera a ficha de jogo e o relatório pós-jogo a partir dos mesmos dados. O teste edita o jogo offline no telemóvel, reconecta e confirma o valor no PC; depois apaga o jogo offline e verifica tombstone e ausência de reaparecimento. Na stack Supabase isolada, a integração dirigida passou 1/1 e a suíte Supabase passou 5/5 mais 2/2 cenários de duas PWA. Isto reforça a cobertura automatizada; a aceitação nos aparelhos físicos acima continua pendente.

Recuperação de identidade já ligada (26/09/2026): quando a pesquisa pela chave externa encontra um UUID remoto que outra ficha local já utiliza, a pré-visualização recusa a ligação e mostra a razão. A confirmação volta a verificar a correspondência antes de escrever. Isto evita criar duas fichas locais com a mesma identidade remota e mantém o conflito para revisão explícita; não resolve automaticamente os conflitos já existentes. A regressão dirigida passou 100/100 testes de `remote_workspace`.

Revalidação v198 na stack Supabase isolada (26/09/2026): cinco integrações de PostgREST, Realtime/RLS, sincronização com fotografia privada e equipa errada, RAG e ordenação de evidências de jogo passaram 5/5. Os dois cenários de navegador com PWA separadas passaram 2/2, incluindo o ciclo de jogo, edição offline, reconexão, conflito e tombstone. A stack `vision-coach-match-v196-20260926` foi parada com backup; não houve escritas no Supabase partilhado. O ensaio nos aparelhos físicos permanece por fazer.

Reauditoria de atividade/conflitos (25/09/2026): `node --test tests/remote_workspace.test.js` passou 88/88, incluindo assinatura Realtime filtrada por equipa, falha parcial do canal de atividade, atividade idempotente/orfã, tombstones, edição concorrente durante push/pull e resolução explícita. A migration lógica `20260923120000_workspace_activity_realtime` estava ausente do histórico Supabase remoto na consulta daquele dia; o canal de atividade não estava coberto por essa publicação. Em 26/09/2026 foi aplicada como `20260926150348_20260923120000_workspace_activity_realtime.sql`. A integração Supabase local foi tentada novamente, mas `supabase start` parou antes de inspecionar a stack porque o Docker Desktop/Linux Engine não estava disponível; nenhum container, volume ou dado foi alterado. Mantém-se como evidência anterior a validação na stack descartável (Supabase local 4/4 e PWA PC↔telemóvel 1/1); esta passagem não substitui a revalidação integrada nem o ensaio em aparelhos físicos.
