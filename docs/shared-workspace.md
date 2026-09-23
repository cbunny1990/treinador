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

A aplicação principal tem cinco áreas:

- **Workspace** — estado atual da equipa, próximos eventos, prioridades, planos recentes e atividade.
- **Equipa** — perfil, jogadores e jogos.
- **Planos** — planos de treino, análises de jogo, notas e briefings.
- **Media** — biblioteca visual partilhada.
- **Timeline** — histórico de dados, documentos e ações de humano/agente.
- **Pesquisa e histórico** — pesquisa transversal com filtros de data/época e atalhos para a origem dos registos.
- **Semana e evolução** — organização semanal e objetivos explícitos da equipa, sem inferir melhoria.

Chat embutido, OpenRouter, gerador de treino IA, biblioteca antiga de exercícios e dashboard Head Coach antigo foram removidos do produto ativo.

## Dados ativos

IndexedDB v9 mantém os objetos principais e a fila/tombstones necessários para sincronização remota:

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

Exceção explícita por operação: `evaluate_cross_session_relation` envia ao TypeSafe apenas a afirmação escolhida e duas citações textuais selecionadas pelo Head Coach, com tipo de origem e contexto mínimo (data/adversário/zona quando disponíveis). A operação só é executada quando o agente a invoca, revalida as revisões antes do envio, e não transmite media, fotos, o registo completo ou dados de outras equipas. A chamada usa `TYPESAFE_API_KEY` configurada no servidor Edge Function; a chave não é exposta ao browser nem ao treinador. O resultado é uma probabilidade interpretativa sujeita a revisão humana.

A fundação remota usa Storage privado Supabase. Ficheiros remotos são acedidos com sessão autorizada ou URLs assinadas temporárias; `data_url` local continua excluído do contrato do agente. Falhas de sincronização com o dispositivo ainda online são repetidas com espera progressiva limitada (2 s até 60 s); alterações locais mantêm-se na base local até uma passagem posterior sincronizar ou apresentar conflito.

## Estado atual da ligação remota

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

O código não contém credenciais privadas. A PWA aceita apenas Project URL + publishable key; secret/service-role ficam reservadas às Edge Functions.

Eliminações offline guardam a versão remota que o treinador viu. A sincronização usa essa versão numa atualização condicional; se outro dispositivo editou entretanto, mantém o tombstone e apresenta o conflito com as duas versões. Em Definições, o treinador escolhe manter a cópia remota ou confirmar a sua eliminação. Se houver nova edição durante a decisão, a comparação condicional volta a recusar a eliminação e sinaliza o conflito.
Antes de qualquer consulta por identidade, o cliente verifica que `sync_id` é um UUID remoto. IDs locais legados sem versão remota confirmada são substituídos por um UUID estável e sincronizados; IDs inválidos com versão remota ou tombstone ficam em conflito, sem consulta malformada nem perda de dados.
O mesmo controlo é aplicado durante a consolidação inicial: um valor local como `default` recebe UUID antes de entrar no fluxo normal de sincronização; uma identidade inválida já associada a uma versão remota não é reatribuída.
Cada registo sincronizado guarda localmente a UUID do workspace remoto de origem. Ao mudar de workspace, a app não envia registos nem media já associados a outra equipa; tombstones também continuam dirigidos à equipa de origem. Registos antigos sem origem recuperável ficam em conflito para evitar uma cópia silenciosa entre equipas.
As relações entre media, atletas, jogos, treinos, memórias e documentos usam UUIDs remotos. A conversão para IDs locais só ocorre quando o registo pertence ao workspace remoto ativo; uma referência local que não possa ser resolvida é recusada, em vez de enviar um ID numérico de outro browser.
Remover media da biblioteca é uma eliminação lógica sincronizada: o registo deixa de aparecer nas vistas ativas, mas o blob permanece no bucket privado para preservar o histórico. A confirmação na interface informa que esta ação não elimina fisicamente o ficheiro.
Trocar de workspace exige ligação para identificar os dados locais antigos; a seleção não muda offline. A interface filtra registos e media pela equipa remota ativa, mantendo dados locais ainda não associados visíveis no workspace atual.
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

Ao descarregar, a app compara dentro da transação IndexedDB a cópia local vista antes de hidratar referências ou pedir uma URL assinada. Se o treinador a tiver alterado entretanto, mantém a edição local e mostra conflito quando a versão remota diverge. Um registo apagado nesse intervalo não é recriado pela confirmação do pull.

A fotografia de perfil é atualizada pela media associada sem gravar uma ficha de atleta que tenha mudado no mesmo intervalo. Uma fotografia local mais recente aguarda a criação/receção da sua media; a ausência temporária de media não apaga um `data_url` sem referência gerida.

Ao receber uma eliminação remota, a remoção local também compara a cópia vista com a linha atual dentro da transação IndexedDB. Se houve edição local entretanto, conserva-a e sinaliza o conflito, incluindo em jogos e media.

Depois da v68, uma referência de documento/memória/media já expressa em UUID podia ser interpretada como ID numérico da IndexedDB. A v69 valida o UUID na equipa remota antes de o reutilizar; uma referência local ausente ou inválida fica em conflito, preservando o registo de origem, enquanto a restante sincronização continua.

A reformulação remove o produto antigo da experiência sem apagar silenciosamente os dados existentes. Stores legados podem ser eliminados numa migração posterior apenas depois de confirmar que nada útil precisa de ser convertido para o novo modelo.

## Testes

A suíte deve validar, no mínimo:

- migração de dados antigos para IndexedDB v9;
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

Validação read-only do projeto Supabase em 23/09/2026: projeto ativo; RLS ligado nas tabelas partilhadas consultadas; bucket `team-media` marcado como privado. Esta consulta verifica configuração, mas não substitui uma tentativa de acesso com sessões reais de treinador em duas equipas/dispositivos.

Auditoria read-only adicional em 23/09/2026: `workspace_records`, `media_assets` e `teams` constam da publicação `supabase_realtime`, mas `activity_log` não constava, embora o cliente sincronize essa tabela. O cliente também subscreve `activity_log`, e a migração local `20260923120000_workspace_activity_realtime.sql` adiciona a tabela à publicação. Depois de alinhar os ficheiros locais com o histórico remoto, a stack isolada de auditoria ficou saudável: `migration list --local` confirmou as 20 versões aplicadas e `db lint --local --schema public,private --fail-on error` não encontrou erros. `npm run test:supabase-local`, direcionado para essa stack com `VISION_COACH_SUPABASE_LOCAL_WORKDIR`, passou os testes RLS/sincronização com duas sessões e a PWA offline/religação. A stack normal deste worktree conserva um histórico antigo (`001`, `002` e versões antigas de continuidade) e não foi alterada; a seleção explícita da stack no runner evita tocar nesses dados. Nenhuma migração foi aplicada ao projeto publicado. O projeto confirmou RLS nas tabelas partilhadas e bucket `team-media` privado; o advisor também sinalizou que a proteção de palavras-passe comprometidas está desativada.

Teste de integração local (`npm run test:supabase-local`): com duas sessões de treinador sintéticas, usa o cliente Supabase real contra localhost para verificar criação/leitura da equipa, escrita e leitura por membro, isolamento de uma conta externa, conflito por `updated_at`, tombstone, upload privado e URL assinada para foto de atleta. `VISION_COACH_SUPABASE_LOCAL_WORKDIR` permite escolher uma pasta Supabase local isolada; por omissão é usado o worktree atual. As credenciais são recolhidas da stack escolhida apenas em memória, o runner recusa URLs não locais e as contas sintéticas são removidas no fim. A migração `20260923120100_allow_team_owner_select_during_creation.sql` corrige a criação: permite ao proprietário ler apenas a sua própria linha durante `INSERT ... RETURNING`, antes de o trigger adicionar a membership; membros continuam autorizados pela policy normal. Não foi aplicada ao projeto publicado.

Na v69 publicada, o treinador confirmou a consolidação no PC e a leitura dos dados recentes no telemóvel depois de sincronizar. Continuam por verificar em aparelhos reais: telemóvel editar/apagar → PC receber; PC apagar → telemóvel deixar de mostrar; reconexão após trabalho offline; conflito entre edições feitas nos dois aparelhos; upload e leitura de fotografia/media; confirmação visual após reabrir a PWA e atualizar o service worker. Este percurso confirmado não conclui a auditoria PC↔telemóvel. A sincronização imediata de `activity_log` em produção depende de aplicar a migração pendente, depois da revisão e validação local.

Reconciliação pré-deploy, read-only (23/09/2026): foram recuperados os 17 ficheiros com as versões registadas pelo Supabase MCP em produção, incluindo as sete migrações base e `20260922103529_enable_workspace_realtime`. A pasta local contém essas 17 versões mais três migrações pendentes: Realtime de `activity_log`, criação de equipa durante `INSERT ... RETURNING` e hardening RLS de duas tabelas privadas. Os antigos baselines consolidados e migrações de continuidade com versões posteriores foram substituídos para manter a mesma sequência de histórico. Os 20 ficheiros coincidem com a exportação e as migrações locais. A validação ocorreu numa stack de auditoria isolada. A tentativa de `supabase migration list --linked` falhou porque este worktree não está ligado ao projeto. Nenhuma ligação, reparação, aplicação remota ou `db push` foi feita. Antes de publicar, rever as três migrações novas e confirmar as 17 versões já existentes no remoto.

O advisor remoto sinalizou `private.agent_request_log` e `private.mcp_connector_tokens` com RLS desligado. A auditoria confirmou que `anon` e `authenticated` não têm privilégios de tabela; a stack local isolada também confirmou RLS ativo, `service_role` com `BYPASSRLS` e RPCs do conector a funcionar sob RLS. A migração local `20260923140620_enable_private_internal_table_rls.sql` revoga novamente os privilégios de `PUBLIC`, `anon` e `authenticated` e ativa RLS, sem políticas de acesso para esses papéis. O projeto publicado não foi alterado; a migração aguarda a revisão antes de qualquer aplicação.


### Scroll do Workspace durante sincronização

O Workspace mostra primeiro o snapshot local e inicia a sincronização remota em segundo plano. Quando chega `visioncoach:sync-complete`, a rota é atualizada sem iniciar outra sync. Isto evita o ciclo de renderizações/sincronizações repetidas. `setView()` só reposiciona a janela para o topo quando muda a rota; na mesma rota, cada renderização agora também preserva a posição, salvo intenção de scroll do treinador no mesmo frame. A regressão Playwright em `tests/e2e/workspace.spec.js` segura a sync, verifica uma só chamada e confirma a posição do scroll depois do evento. A cache PWA é v117.

A lista de sincronização agrupa a contagem por ação: escolha do treinador, correção de identidade e falha temporária repetível. Metadados técnicos ficam recolhidos. Nenhuma versão é escolhida automaticamente. Conflitos de edição ainda não podem ser mesclados campo a campo porque o cliente não guarda uma cópia-base do último estado comum; uma futura mesclagem de três vias exige essa base persistida e testes de migração. Falhas de URL assinada continuam sujeitas a retry.

Nas prévias de conflitos, campos de URL assinada conhecidos são removidos. A limpeza também deteta URLs assinados por caminho Supabase Storage ou parâmetros de assinatura comuns, incluindo `X-Amz-*` e `X-Goog-*`; conteúdo `data:` é substituído por marcador. URLs regulares de vídeo continuam visíveis para comparar os registos.

### Deduplicação de atividade imutável

O registo de atividade é imutável e uma repetição da mesma UUID só é considerada sincronizada se o conteúdo corresponder. O timestamp compara-se como instante UTC, não como texto ISO: Postgres pode devolver `Z` ou `+00:00` e precisão decimal diferente para o mesmo instante. Uma diferença real de instante ou de conteúdo continua em conflito e não é sobrescrita. Cache PWA v118; regressão em `tests/remote_workspace.test.js`.

Quando uma atividade antiga aponta para uma chave externa textual, o sincronizador só a converte para UUID se encontrar exatamente um documento dessa equipa com `external_key` igual, verificar a UUID desse documento no workspace remoto e confirmar o respetivo tipo. Correspondências ausentes/ambíguas continuam em conflito. O formulário do arquivo de épocas passou também a registar a UUID real do documento recém-criado, em vez da chave `season-index:default`.

Se o evento de atividade continua válido mas a sua origem local já não existe ou a UUID não pertence ao workspace selecionado, o sincronizador envia o evento com `entity_ref` vazio e guarda tipo, referência original e motivo em `_vision_coach_unresolved_origin`. A referência fica explícita como proveniência, nunca é convertida num vínculo remoto. O mesmo aviso é mostrado no Workspace e na Timeline. Referências ambíguas, de outra equipa ou de equipa desconhecida continuam bloqueadas. Cache PWA v119.

## Publicação rápida de imagens por IA

O procedimento atual está em [ai-image-workflow.md](ai-image-workflow.md). Usa o MCP autenticado ou `npm run images:publish`; não volta a gerar imagens aprovadas nem requer alterações de frontend por imagem.
