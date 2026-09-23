# Vision Coach: análise pós-jogo

## Registo do treinador

Calendário → jogo → Depois. A página mostra o resultado apenas quando ambos os valores foram introduzidos, a lista cronológica de lances e as utilizações gravadas pelo cronómetro. Estatísticas derivam dos lances presentes e identificam-se como contadas. Minutos são registos de utilização. A ausência de dados aparece como desconhecida ou não registada; não se transforma em 0–0 nem em factos inventados.

O treinador pode registar resumo, pontos positivos, problemas, perdas, recuperações, criação ofensiva, comportamento defensivo, transições, bolas paradas, utilização, aspetos a manter/corrigir, observações, interpretação, hipóteses, decisões e prioridades seguintes. Causas de golos sofridos são hipóteses ligadas a um evento concreto. Os campos antigos permanecem preservados.

## Memória e próximo treino

“Guardar análise” guarda apenas o registo do jogo. “Guardar análise e atualizar memória” é a ação explícita que cria ou atualiza a memória ligada ao jogo. O registo tem identidade UUID estável, chave externa determinística e origem; uma memória apagada por tombstone não é recriada, e uma memória com outra proveniência não é substituída. Alterações posteriores assinalam a memória como desatualizada.

“Preparar treino desta análise” preenche um rascunho de treino com a prioridade e decisão existentes. Não cria o treino até o treinador o guardar. Não são contadas sessões como prova de melhoria.

## Revisões e MCP

Schema `vision-match-analysis@1` dentro de `jogos.post_game.analysis`. Revisões monotónicas impedem gravação sobre uma revisão já alterada; o conflito apresenta uma mensagem e mantém o formulário aberto. A gravação local é uma transação IndexedDB com o jogo e, apenas quando pedido, a memória.

`get_match_analysis` é somente leitura. `prepare_match_analysis` grava uma proposta marcada como proposta do Head Coach, separada das observações e decisões do treinador; requer permissões de leitura e escrita, confirmação explícita, `expected_updated_at`, revisão e referências a eventos existentes. Não executa ações de jogo, não aprova plano nem cria memória.

`get_recurring_match_patterns` agrega perdas registadas nos jogos ativos da equipa. Só agrupa quando motivo e zona foram ambos indicados, conta IDs de evento únicos e exige pelo menos dois jogos distintos para apresentar um padrão. Devolve adversário, data, UUID remoto do jogo e IDs dos lances para abrir as fontes. Perdas sem motivo/zona não entram nesta contagem; texto livre, interpretações e hipóteses não são convertidos em dados estruturados. O resultado é uma relação observada, não uma causa nem uma prioridade recomendada. A análise semântica posterior deve citar estas fontes e manter a hipótese separada da decisão do treinador.

`get_cross_session_evidence` reúne as análises e lances dos jogos recentes e as avaliações/notas dos treinos recentes, sempre dentro da equipa autorizada. Cada entrada inclui o UUID remoto, data, campo e categoria (`registered_fact`, `coach_observation`, `interpretation`, `hypothesis`, `coach_decision` ou `coach_evaluation`). A consulta é de leitura, não cria memórias e limita cada tipo de registo a 50 fontes; limita ainda o retorno a 25 evidências textuais e 150 lances, indicando quando há truncagem. O limite textual alterna evidências de jogo e treino para evitar excluir uma fonte por excesso da outra.

`evaluate_cross_session_relation` aceita uma afirmação do Head Coach e referências exatas a um campo atual de jogo e treino (UUID, campo, revisão e, para lances, ID). Volta a ler cada registo diretamente pelo UUID dentro da equipa autorizada; esta leitura não depende do limite de fontes recentes nem do limite de itens devolvidos pela pesquisa de evidências. Recusa citações ambíguas, ausentes ou desatualizadas. Só após chamada explícita envia ao serviço TypeSafe/Jev as duas citações selecionadas e a afirmação, com contexto mínimo; não envia o registo completo. Requer `TYPESAFE_API_KEY` apenas no ambiente da Edge Function. Em respostas 429/529, repete até duas vezes, respeitando `Retry-After` até ao limite de cinco segundos; outros erros não são repetidos. Devolve a probabilidade Noul sem converter o valor em facto, causa, melhoria ou decisão; inclui as citações e exige revisão do treinador. Não grava dados nem cria propostas. A chave ou a avaliação não são necessárias para as restantes operações. A regressão MCP simula fontes mais antigas que os 50 registos recentes e confirma que as citações explícitas continuam a ser verificadas. A API externa foi exercitada com fetch simulado; a chamada real ainda não foi validada porque não há chave local e esta branch não foi publicada no runtime Edge.

## Limites e verificação

Não foram criados nem alterados jogos reais. A sincronização remota usa o workspace e os mecanismos de conflito existentes; a auditoria física PC↔telemóvel continua necessária. Testes locais cobrem modelo, MCP, gravação offline, memória explícita e preservação de texto durante sincronização simulada. TypeSafe ainda não foi configurado nem publicado nesta fase.

No telemóvel, os campos de seleção e botões dos formulários de análise e evidência têm pelo menos 44 px de altura. A página foi verificada a 390 px sem rolagem horizontal.
