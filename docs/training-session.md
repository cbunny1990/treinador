# Vision Coach — treino completo, fase 1

## Utilização
Aceder por `Workspace → Consultar treino → Treino em campo / presenças`, ou pela ficha em `Planos → Planeador de treino → treino`.
O novo percurso é `#/sessao/ID_LOCAL`. A consulta anterior e as imagens aprovadas mantêm-se.

1. Marcar cada atleta: **Por marcar, Presente, Atrasado, Ausente ou Falta justificada**. Disponibilidade no plantel não conta como presença. Não existem campos médicos nesta sessão.
2. **Iniciar treino** congela uma cópia dos blocos planeados para comparar com o realizado. Guardam-se nomes, identificadores, ordem, duração prevista e notas planeadas.
3. **Pausar / Retomar** exclui as interrupções do tempo ativo. **Exercício seguinte** fecha o bloco atual; o treino não muda automaticamente de exercício.
4. O tempo decorre com a app em segundo plano ou fechada. Ao regressar, é reconstruído a partir dos instantes guardados. Não é prometido alarme em segundo plano; é necessário usar Pausar para descontar intervalos. Uma mudança manual do relógio do dispositivo pode afetar o tempo, que nunca é apresentado negativo.
5. Escrever observações por bloco, editar ou apagar com confirmação. A receção de alterações não substitui uma nota ainda não guardada. Se a versão da sessão mudou, o guardar é recusado e o texto mantém-se para revisão.
6. **Terminar treino** pede confirmação e apresenta presenças, tempos reais e previstos e observações. Blocos não realizados não recebem minutos nem ficam artificialmente concluídos.
7. A avaliação final existente continua na ficha do treino. Esta fase não gera automaticamente o foco seguinte.
8. **Apagar registo da sessão** remove presenças, cronómetro e notas da sessão, com confirmação e apenas quando não está a contar. O plano, exercícios e imagens não são apagados.

## Preparação e cópias
A ficha oferece **Duplicar treino**: escolher outra data e hora, copiar objetivo, exercícios, ordem, tempos e notas. Não copia identificadores, presenças, tempos realizados ou avaliação.
A cópia preserva `source_training_ref`. A sua data é validada antes de criar; não se cria nada só por abrir o formulário.
No planeador, **Subir / Descer** altera a ordem sem arrastar. As notas próprias de cada bloco ficam preservadas ao guardar.
Depois de iniciada a sessão, o plano fica protegido; para preparar uma nova sessão a partir dele, deve duplicar-se.
A ficha de cada atleta inclui o histórico de presenças por treino; apenas estados efetivamente marcados entram no denominador.

## Dados e sincronização
Tudo fica no campo `session` do registo `treinos` já sincronizado como `kind=training`; não usa as antigas tabelas locais `presencas` nem cria um segundo calendário ou outro exercício.
Schema `vision-training-session@1`, revisão monotónica, presenças por UUID estável do atleta, blocos congelados, instantes e duração acumulada.
As ações são guardadas localmente com leitura/alteração/escrita na mesma transação IndexedDB. Só se confirma o guardar após o commit; versões antigas e registos apagados são recusados.
Não há escrita a cada segundo: apenas ações do treinador. O ecrã distingue guardar localmente de enviar ao servidor.
O mecanismo remoto existente mantém controlo de versão e tombstones; esta entrega não introduz merge silencioso de duas versões concorrentes.

### Controlo do cronómetro
Um controlador por sessão: outro dispositivo pode consultar, marcar presenças e tomar notas, mas não operar silenciosamente o mesmo cronómetro.
Para passar o controlo, pausar no dispositivo atual, sincronizar e escolher **Assumir controlo neste dispositivo** no outro.
Dois dispositivos desligados da rede ainda podem iniciar cópias antigas simultaneamente: a resolução depende do conflito remoto, não existe um bloqueio distribuído enquanto estão offline. Não declarar esta condição como resolvida.
As provas em formato móvel/PC são testes de navegador; não constituem observação no telemóvel físico do treinador.

## Operações para a IA autorizada
A ligação MCP existente ganha:
- `get_training_session`: plano, presenças, execução e resumo; ler não inicia o treino.
- `update_training_attendance`: estados explícitos para UUIDs de jogadores da mesma equipa; nomes vêm dos registos reais, não de texto inventado pelo agente.
- `write_training_session_note`: criar/editar uma nota de bloco pelo seu `note_id` estável.
- `remove_training_session_note`: remoção explicitamente confirmada.
- `control_training_session`: iniciar, pausar, retomar, avançar, terminar, assumir controlo em pausa ou apagar o registo, apenas quando o treinador pedir.
- `duplicate_training_plan`: nova data, plano limpo e `request_key` estável para tentativas repetidas da mesma operação.

Ler primeiro pelo UUID remoto ou `external_key` exato. Para alterar, fornecer `expected_updated_at` e `expected_revision` atuais. Não usar IDs numéricos de outro browser.
Leitura exige scope `read`; escritas exigem também `write`. O servidor filtra sempre a equipa do conector, usa `head_coach_put_record` e regista autoria do agente.
O modelo é partilhado com o frontend; não são duas implementações independentes do cronómetro.
Não enviar comandos para iniciar sessões futuras nem marcar atletas presentes por inferência.

## Testes e atualização
`npm run check`, `npm test`, `npx playwright test tests/e2e/training_session.spec.js`, e a suíte geral `npm run test:e2e`.
Cobertura: estado inicial, presenças, histórico, pausa, retoma, persistência, conclusão antecipada, controlador, concorrência local, versão remota, equipa errada, scopes, notas, remoção e duplicação/reordenação.
Foi reproduzida na base anterior uma falha de recarga durante a primeira instalação do service worker: interrompia formulários. A primeira instalação deixa de forçar recarga; uma atualização posterior é adiada quando há formulário ou treino em campo aberto.
A app passa para v65. Imagens originais, procedimentos de upload e a funcionalidade de consulta permanecem intactos.

## Próxima fase (não incluída)
Ligar avaliação à memória e produzir propostas de continuidade explicadas e aprovadas pelo treinador. Depois: jogo visual/rotações, relatórios PDF e planeamento da época.

## Referência técnica do temporizador
https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout
https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
A contagem usa instantes persistidos, não o número de callbacks de um temporizador, porque páginas em segundo plano podem ter callbacks adiados.

O teste antigo de retirada do plantel clicava em “Retirar definitivamente” mas esperava que o registo existisse. A cobertura foi separada: retirada reversível preserva o registo; eliminação definitiva remove-o, cria tombstone e preserva as presenças históricas na sessão. Não foi alterado o comportamento da app para satisfazer o teste.

## Atualização — fase 2
O percurso de avaliação/memória/proposta/aprovação está agora em `training-continuity.md`. A avaliação do treino em campo alimenta esse percurso, sem criar outro registo de sessão.
