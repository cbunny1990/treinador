# Épocas e histórico

Em **Workspace → Épocas**, guarda o período, o plantel associado por UUID estável e escolhe a época ativa. O arquivo recusa identificadores que não sejam UUID válidos, em vez de os omitir silenciosamente. Ativar outra época arquiva a anterior; treinos, jogos, presenças e utilizações não são movidos nem apagados.

Os cartões mostram ligações às fichas de treinos e jogos cujas datas estão dentro do intervalo inclusivo, além do resultado registado quando disponível. Também mostram objetivos de equipa identificados no período ou ligados a evidências nele registadas, e planos semanais com a avaliação explícita ou a indicação de que está pendente. Cada época mantém apenas referências aos registos originais. Os relatórios de atleta iniciados a partir de uma época aplicam o mesmo intervalo aos jogos, treinos e observações. O relatório assinala quando o atleta não pertencia ao plantel arquivado. Objetivos individuais são longitudinais e continuam a ser apresentados com as evidências registadas.

Editar uma época conserva os membros históricos do plantel que já não têm ficha ativa. Cada entrada continua identificada pelo UUID, nome e dorsal guardados no snapshot; o treinador pode removê-la explicitamente no formulário. Se existir arquivo do atleta, o relatório individual da época usa essa identidade histórica e calcula participação nos jogos e treinos originais, sem recriar a ficha. A origem do arquivo fica identificada no relatório e minutos continuam desconhecidos quando não há cronómetro.

Se um relatório receber o UUID de uma época que já não está no arquivo, a exportação é recusada com uma mensagem para atualizar a lista; não amplia o período para todo o histórico. Sem época definida nem selecionada, o relatório declara que mostra todo o histórico guardado.

Editar compara revisão do documento e `updated_at`; um conflito fica no formulário para nova leitura e comparação. O índice único sincroniza pelo workspace existente e conserva o UUID remoto. O MCP fornece `get_team_seasons` e `save_team_season`, valida jogadores na equipa, escopos e revisão e exige confirmação para gravação.

O índice conserva cada revisão nova com um snapshot integral das épocas, datas, plantéis por UUID e época ativa. Em **Versões anteriores do arquivo**, o treinador pode consultar os valores guardados antes de editar ou ativar. As revisões antigas criadas antes desta versão só tinham metadados e não conseguem recuperar valores que já tinham sido substituídos. Guardar e sincronizar uma revisão nova não remove versões mais antigas.

Sem época arquivada, os relatórios indicam “Período completo registado (sem época definida)”, em vez de atribuir dados a um período que não foi definido.
