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

`treinador-agent-workspace@1`

Operações atuais:

- `snapshot(options)`
- `listDocuments(options)`
- `getDocument(id)`
- `createDocument(input)`
- `updateDocument(id, changes)`
- `addObservation(input)`
- `listMedia(input)`
- `addMediaLink(input)`

Estas operações usam exatamente os mesmos stores e regras usados pela interface humana.

### Exemplo conceptual

O agente recebe:

> Analisa o último jogo e prepara o treino de terça.

Fluxo pretendido:

1. `snapshot()` — lê equipa, jogadores, jogos, memória, planos e media.
2. O agente faz a análise.
3. `createDocument({ type: "match_analysis", ... })`
4. `createDocument({ type: "training_plan", ... })`
5. A atividade fica registada com `actor = "agent"`.
6. O treinador abre a app e encontra os documentos já no workspace.

## Media e privacidade

O contrato público do agente **não inclui `data_url` local**. Um ficheiro guardado apenas no IndexedDB não deve ser enviado automaticamente para um agente externo.

A fundação remota usa Storage privado Supabase. Ficheiros remotos são acedidos com sessão autorizada ou URLs assinadas temporárias; `data_url` local continua excluído do contrato do agente.

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

O código não contém credenciais privadas. A PWA aceita apenas Project URL + publishable key; secret/service-role ficam reservadas ao futuro servidor do agente.

Para o cenário “abro o ChatGPT e ele vai à app sozinho”, falta apenas expor o backend através de um **servidor MCP autenticado** que aplique `agent_authorizations` e as operações do workspace. A base de dados e sincronização usadas por esse servidor já ficam preparadas.

## Migração da aplicação anterior

A migração v3 → v9 é automática. Registos de jogadores, jogos, treinos e memória continuam disponíveis; UUIDs remotos são atribuídos de forma lazy na primeira sincronização.

### Correção de sincronização v68

Um `sync_id` local legado como `default` recebe UUID apenas quando ainda não existe uma versão remota reconhecida. Se já existe versão remota, a cópia local permanece para reconciliação. Tombstones guardam `team_id = default` porque essa é a equipa local; a eliminação remota consulta primeiro a equipa UUID do próprio registo e exige a versão remota vista antes de apagar. Um conflito mantém o tombstone pendente. Publicado no PR #42.

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


## Publicação rápida de imagens por IA

O procedimento atual está em [ai-image-workflow.md](ai-image-workflow.md). Usa o MCP autenticado ou `npm run images:publish`; não volta a gerar imagens aprovadas nem requer alterações de frontend por imagem.
