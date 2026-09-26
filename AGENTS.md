# Vision Coach: instruções para agentes

## Formação
Lê `docs/learning.md` antes de alterar a secção Formação. Mantém o interruptor desligado por omissão, a separação da sincronização do workspace e a aprovação do conteúdo sob controlo do treinador.

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
Preserva as revisões, UUIDs dos atletas, plano original e registo realizado. A fase 2 está em `docs/training-continuity.md`: modelo local identificado como tal ou proposta revista pela IA autorizada, sempre sujeita a aprovação explícita antes de criar o treino.

## Continuidade de treino
Lê `docs/training-continuity.md`. Usa as sete operações MCP com versões atuais; não escreve diretamente várias linhas para simular uma aprovação. Distingue registos do treinador, propostas e resultados assinalados. Nunca marca uma melhoria por inferência.

## Jogo visual e utilização
Lê `docs/match-visual.md`. Usa o jogo existente e UUIDs estáveis. Planear uma rotação não executa a substituição. Só inicia cronómetros ou regista entradas/saídas mediante pedido explícito; nunca atribui minutos por inferência. Preserva convocatória/alinhamento iniciais e usa movimentos para mudanças em jogo.

## Lances e estatísticas
Lê `docs/match-events.md`. Regista apenas lances explicitamente confirmados e reportados pelo treinador; nunca inventa observações, remates ou golos. As estatísticas são contadas dos lances registados e a posse é medida/estimada/desconhecida conforme introduzida — nunca apresentar estimativa como medição. Corrigir lances exige pausa ou jogo terminado.

## Análise pós-jogo
Lê `docs/match-analysis.md` e `docs/match-video-evidence.md`. Mostra só factos presentes nos registos e mantém separados facto, observação, interpretação, hipótese e decisão. Atualizar a memória requer ação explícita do treinador. Uma proposta do Head Coach não é decisão nem cria treino; evidências têm de apontar para registos existentes e escritas têm de usar revisão e `expected_updated_at`.

## Evolução individual
Lê `docs/player-development.md`. Objetivos e estados são definidos pelo treinador; sessões trabalhadas não são prova automática de melhoria. Preserva evidências, histórico e UUIDs estáveis. Não cria rankings públicos de crianças.

## Relatórios
Lê `docs/reports.md`. Exporta a partir de dados persistidos atuais, mostra proveniência e dados ausentes, e inclui imagens aprovadas sem as reprocessar. Exportar é leitura; não altera sessões.
