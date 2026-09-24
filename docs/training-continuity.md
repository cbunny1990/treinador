# Continuidade de treino — fase 2

Compatibilidade de avaliações: em registos antigos, a avaliação final pode estar em `session.review`. Quando `review` no nível do plano está ausente ou vazio, a aplicação usa essa avaliação de sessão; um estado explícito no plano, incluindo `pending`, mantém precedência. A normalização e a migração dos índices operacionais aplicam esta regra sem apagar nem mover o conteúdo original.

## Percurso humano
Abrir a ficha do treino pelo Planeador ou pelo fim da Consulta do treino. No modo de treino em campo mantém-se o acesso à avaliação final.

1. **Guardar avaliação**: o que melhorou, o que continua por corrigir, conclusão e próxima ação. É necessário pelo menos um campo com conteúdo.
2. A avaliação atualiza **um único registo de memória** desse treino. Editar não cria cópias em cada clique ou dispositivo.
3. Abrir **Avaliação → próximo treino**. São mostradas as citações exatas da avaliação e das observações dos blocos, com data e origem.
4. **Gerar proposta de continuidade**: o rascunho usa a próxima ação registada; na sua ausência, o que continua por corrigir. Os exercícios iniciais são os do plano anterior que ainda estão disponíveis na biblioteca.
5. Ajustar foco, justificação, critério observável de melhoria, data, hora, exercícios e tempos. **Guardar ajustes da proposta** antes de aprovar.
6. **Aprovar e criar treino** pede confirmação. Gerar, consultar ou editar a proposta NÃO cria um treino.
7. O novo treino mantém a ligação à sessão anterior e as evidências usadas na decisão. Não copia presenças, tempos realizados nem avaliação.
8. Na avaliação seguinte, assinalar **Por avaliar, Melhorou, Continua por corrigir ou Sem conclusão**. A origem acompanha proposta → treino criado → realizado → avaliado.

## O que é automático e o que não é
O rascunho inicial é um **modelo local baseado nos registos**, identificado como tal. Não é uma chamada a um modelo de IA nem análise automática dos vídeos, do adversário ou da época inteira.
Não inventa problemas, métricas ou melhorias. O critério de avaliação começa vazio, para ser definido pelo treinador ou proposto pela IA autorizada.
O Head Coach externo pode consultar as evidências e rever o rascunho pelo MCP. Essa revisão fica marcada como **Proposta da IA autorizada**; as evidências permanecem as do registo de origem.
Esta fase usa a avaliação e notas da sessão de origem. Tendências automáticas entre vários jogos/treinos e adaptação ao plantel disponível ficam para aprofundamento posterior.
Não cria exercícios ou imagens, não inicia cronómetros e não marca presenças.

## Preservação, edição e remoção
**Apagar avaliação** arquiva a memória gerida e invalida rascunhos dependentes; mantém plano e observações da sessão.
**Apagar proposta** retira apenas o rascunho com confirmação. A avaliação, exercícios e imagens são preservados.
Uma aprovação não é apagada como rascunho. O treino seguinte pode ser apagado pela sua ficha; repetir a aprovação não o recria.
Se a avaliação mudar depois da aprovação, a decisão e as suas evidências anteriores mantêm-se e a diferença é indicada.
Uma memória gerida anteriormente apagada não é recriada pela rotina. O resultado indica que não ficou ligada.
Só pode haver um treino seguinte por origem; para continuar a sequência, partir do novo treino.

## Identidade, concorrência e sincronização
Modelo partilhado: `js/training_continuity.js`, schema `vision-training-continuity@1`.
A origem guarda `continuity`; o treino seguinte guarda `source_training_ref` e `continuity_origin`.
UUIDs determinísticos identificam a memória e o treino seguinte por origem. IDs numéricos locais não entram nessa identidade. A proposta inclui uma impressão digital das evidências.
A memória usa `external_key=training-review-UUID` e `metadata.managed_by=training_review_v1`. Não substitui memórias de outro formato.
No browser, gravações relacionadas são feitas numa única transação IndexedDB. Se falhar, não ficam dados parcialmente gravados.
No MCP, a RPC `head_coach_commit_training_continuity` bloqueia e verifica a origem, verifica as versões dos exercícios, e grava origem, memória, treino seguinte e auditoria numa só transação. Só `service_role` pode executar a RPC, através do conector autenticado e dos seus scopes.
A sincronização normal IndexedDB/backend continua a enviar registos separadamente. Uma interrupção pode tornar o treino seguinte temporariamente indisponível noutro dispositivo. A app não o duplica por esse motivo.
Conflitos de edição simultânea offline continuam a exigir reconciliação; esta entrega não promete merge distribuído automático.
Antes de aprovar, alterações à avaliação/notas ou à ficha de um exercício tornam o rascunho desatualizado. A versão antiga é recusada sem apagar o texto que estava a ser escrito.

## MCP — operações para agentes
Ler pelo UUID remoto ou `external_key` exato. `get_training_continuity` devolve `updated_at`, `review_key`, `continuity.revision`, evidências e progresso.
Escritas exigem `read` + `write`, `expected_updated_at` e `expected_revision` atuais.

- `get_training_continuity`: leitura, sem criar propostas.
- `save_training_review`: campos fornecidos pelo treinador; requer `confirmed: true`, mantém campos não enviados e atualiza a memória ligada.
- `clear_training_review`: remover a avaliação com confirmação explícita.
- `prepare_training_continuity`: rascunho identificado como modelo local. Devolve um rascunho inalterado sem o substituir, salvo `replace_existing: true` explicitamente solicitado.
- `update_training_continuity`: revisão da IA, com foco, justificação, critério observável, data, hora e exercícios existentes.
- `dismiss_training_continuity`: retirar rascunho com confirmação.
- `approve_training_continuity`: apenas depois de o treinador aprovar o conteúdo apresentado, com `confirmed: true`.

Exemplo: “Lê a avaliação de segunda, prepara a continuidade para quinta e mostra a proposta antes de criar o treino.” Depois da revisão: “Aprovo esta proposta. Cria o treino.”
Um pedido de desenvolvimento da app não autoriza aprovar uma sessão real. Nunca assinalar melhoria por inferência.
O guia de imagens continua em `docs/ai-image-workflow.md`; originais e carregamento não são alterados por esta fase.

## Validação
Passaram 124 testes unitários e 32 testes de navegador durante o desenvolvimento, incluindo 390 × 844 e 1440 × 900.
Cobertura: memória única, evidências exatas, identidade determinística, aprovação explícita, revisões antigas, concorrência, não ressurreição, preservação de texto e arquivo da avaliação.
Testes transacionais PostgreSQL com rollback confirmaram a negação de acesso público à RPC, recusa de versão antiga, reversão integral de uma falha após tentativa de criar o treino e memória única. Esses testes não gravaram dados de treino de forma persistente.
Emulação de ecrã móvel não constitui teste no telemóvel físico do treinador.

## Referências técnicas
https://supabase.com/docs/guides/database/functions
https://www.postgresql.org/docs/current/explicit-locking.html

A validação de CI detetou uma corrida de navegação após guardar uma avaliação. A ficha agora rejeita uma renderização tardia quando o treinador já mudou para a continuidade; um teste determinístico protege esse caso.
O fluxo MCP foi também exercitado no endpoint de pré-validação com registos técnicos temporários: avaliação parcial preservada, rascunho sem criação de sessão, confirmação explícita, criação atómica e repetição sem duplicação. O acesso sem autenticação devolveu 401.
