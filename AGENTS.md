# Vision Coach: instruções para agentes

## Imagens de exercícios — caminho rápido
Lê `docs/ai-image-workflow.md` antes de publicar uma imagem.
Usa o conector **Vision Coach MCP** existente ou `npm run images:publish`.
O percurso é: identificar o exercício → ler a versão → preparar upload → enviar os bytes originais → concluir/verificar.
Não recries exercícios para lhes adicionar imagens. Não redesenhes, comprimas ou substituas um original aprovado.
Não voltes a editar a interface, o manifesto estático ou o service worker por cada nova imagem.
O guia explica a via MCP sem credenciais no terminal e a via CLI para ficheiros locais, incluindo `/mnt/data`.

## Segurança e preservação
Nunca peças ao treinador uma chave service-role, passwords ou tokens para colar na conversa.
Usa apenas conexões autorizadas; respeita scopes e pertença à equipa. Não desatives RLS nem tornes buckets privados públicos.
URLs de upload/download assinados são capacidades temporárias: não os publiques em mensagens, logs, commits ou payloads sincronizados.
Não declares sucesso só porque existe um ficheiro ou um commit. Confirma a associação persistida e o SHA-256 dos bytes publicados.
A leitura em telemóvel real só está verificada quando foi efetivamente observada; emulação não é um teste no dispositivo físico.

## Desenvolvimento
Lê o estado atual antes de alterar. Cria um worktree próprio a partir de `refs/remotes/origin/main`; não uses `switch -C`, reset, stash alheio ou force-push.
`npm run check` e `npm test` são obrigatórios. Executa os testes específicos do fluxo e, quando aplicável, os testes de navegador.
Não escondas falhas anteriores da suíte geral nem as atribuas a uma mudança sem comparação.
Mantém documentação e código da Edge Function no mesmo PR. Mantém a autenticação própria já existente no MCP.

## Treino em campo
Lê `docs/training-session.md`. Usa as operações MCP de sessão sobre o treino existente; não cria sessões/exercícios duplicados para marcar presença ou escrever notas.
Não inicia o cronómetro, assume controlo ou marca presença por inferência. São ações explícitas do treinador.
Preserva as revisões, UUIDs dos atletas, plano original e registo realizado. A proposta automática do foco seguinte pertence à fase 2 e ainda não está implementada.
