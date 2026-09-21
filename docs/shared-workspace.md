# Treinador Pro — Human–AI Shared Workspace

## Conceito

O Treinador Pro não é um chatbot embutido numa aplicação de gestão.

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

IndexedDB v8 mantém os objetos principais:

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

Para o agente aceder a media remotamente será necessária uma camada de armazenamento autenticada, com URLs privadas/temporárias e permissões explícitas.

## Estado atual da ligação remota

A UI, o modelo de dados, autoria e contrato do agente estão implementados.

Ainda falta uma peça para o cenário “abro o ChatGPT e ele vai à app sozinho”: um **backend autenticado e acessível pela internet**. O GitHub Pages é estático e o IndexedDB existe apenas no dispositivo, portanto não podem servir diretamente como API remota.

O backend futuro deve:

1. autenticar o treinador;
2. autorizar um agente específico;
3. sincronizar os objetos do workspace;
4. guardar media fora do IndexedDB quando for necessário acesso remoto;
5. manter audit log;
6. expor apenas as operações do `AgentWorkspaceAPI` ou equivalentes server-side;
7. permitir revogar o acesso do agente.

Nenhuma chave privada deve ser colocada no JavaScript publicado no GitHub Pages.

## Migração da aplicação anterior

A migração v3 → v8 é automática. Registos de jogadores, jogos, treinos e memória continuam disponíveis.

A reformulação remove o produto antigo da experiência sem apagar silenciosamente os dados existentes. Stores legados podem ser eliminados numa migração posterior apenas depois de confirmar que nada útil precisa de ser convertido para o novo modelo.

## Testes

A suíte deve validar, no mínimo:

- migração de dados antigos para IndexedDB v8;
- funcionamento offline;
- captura de observação pelo treinador;
- documentos partilhados;
- associação de media;
- escrita do agente através de `AgentWorkspaceAPI`;
- autoria distinta humano/agente;
- ausência do chatbot e gerador IA antigos no bundle ativo.
