# Evolução individual

Na ficha de cada atleta existe a secção **Objetivos individuais**. Cada registo guarda objetivo, data de início, estado escolhido pelo treinador (`ativo`, `melhorou`, `continuar`, `concluído`), evidências ligadas por UUID a jogos/treinos/observações, exercícios relacionados, notas e histórico de alterações. O app e o MCP validam estes UUIDs e a origem dentro da equipa antes de guardar.

O estado não é inferido do número de sessões nem das presenças. A ficha preserva o histórico de presenças em treino e de participação em jogo. A área longitudinal de jogo mostra convocações, titularidades, total de entradas e saídas, minuto de cada substituição e minutos de utilização registados; uma convocação sem cronómetro aparece sem minutos conhecidos, não como zero. Nos jogos com cronómetro, as posições utilizadas são derivadas do alinhamento inicial e dos movimentos registados; jogos sem esses dados não recebem posições presumidas. Não cria comparações ou rankings públicos entre crianças. Alterar exige a revisão atual; apagar pede confirmação. O MCP usa as mesmas linhas de atleta, com permissões e revisão.

## Eliminação definitiva e arquivo histórico

Antes de retirar definitivamente um atleta, a app pede confirmação explícita e, na interface, que o treinador escreva o nome exato. Se existirem objetivos individuais, cria primeiro um documento `player_archive` no Workspace partilhado. A identidade é determinada por equipa + UUID estável do atleta; repetir uma tentativa usa o mesmo documento, sem duplicar o arquivo. O snapshot mantém os objetivos, versões anteriores, estados, notas e UUIDs de evidências/exercícios. Não copia fotografias, URLs privadas ou bytes de media, que continuam nos registos de origem.

Se faltar o UUID partilhado, o arquivo estiver inválido, mais recente ou divergente, ou não for possível persistir o snapshot local, a remoção é cancelada. O arquivo é só de leitura em **Equipa → Histórico de atletas** e sincroniza como documento do Workspace para PC e telemóvel. A remoção da ficha continua a usar o tombstone existente; presenças e convocatórias/alinhamentos de jogos iniciados ou concluídos mantêm-se. O fluxo existente retira o atleta de jogos ainda abertos. Media continua nos respetivos registos e não é apagada.

O MCP `get_player_participation_history` lê o mesmo histórico por UUID remoto do atleta e inclui presenças registadas em treinos. É somente de leitura, limita-se à equipa do conector e devolve `minutes_ms: null` quando o jogo não tem relógio registado. A operação não inicia relógios nem deduz participação.
