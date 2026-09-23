# Próximas fases Vision Coach — 22/09/2026

## Fase 1 — treino completo
Implementação nesta entrega: presenças e histórico individual, iniciar/pausar/retomar/terminar, cronómetro por bloco e total, notas editáveis, resumo realizado, duplicação sem copiar execução e reordenação com notas preservadas. Guia: training-session.md.
O treino planeado é preservado. Imagens e consulta anteriores não são redesenhadas.

## Fase 2 — continuidade do Head Coach
Implementado: avaliação ligada a memória única, rascunho com evidências, revisão pela IA autorizada, aprovação explícita e ligação ao treino seguinte com resultado assinalado. Guia: training-continuity.md. O rascunho inicial é um modelo local, não análise automática de toda a época; agregação de tendências fica para aprofundamento posterior.

## Fase 3 — jogo e quadro tático
Implementado o primeiro incremento: campo 5v5, alinhamento e suplentes, plano de rotações, substituições e trocas de funções confirmadas, cronómetro e minutos registados por atleta/GR. Guia: match-visual.md. Pendente: lances e zonas (remates/perdas/cantos), estatísticas coletivas, adversário estruturado e quadro tático completo com cones/setas.

## Fase 4 — relatórios na app
Pendente: PDF de treino com originais, convocatória/alinhamento e relatório pós-jogo, usando os dados atuais e partilha no telemóvel.

## Fase 5 — desenvolvimento dos atletas
Pendente: objetivos individuais, evolução longitudinal e relatórios centrados em participação/desenvolvimento. O histórico de presenças básico já entra na fase 1.

## Fase 6 — semana e época
Pendente: Workspace operacional com pendentes, objetivos semanais, sessões relacionadas e arquivo de épocas.

## Fase 7 — vídeo
Pendente: marcação de momentos e ligação de evidências aos jogos, atletas, análises e propostas.

## Transversal
Hotfix local v68 para o erro reportado `invalid input syntax for type uuid: "default"`: reparação de `sync_id` sem versão remota; tombstones verificam a equipa UUID e versão atuais, sem enviar o `team_id` local `default` ao Supabase. Código e testes preparados no branch isolado `fix/default-sync-id-20260923`; ainda não publicados. Validação local: `npm run check`, 151 testes unitários e 40 testes Playwright com um worker passaram. A execução Playwright paralela teve 11 falhas intermitentes que passaram na repetição sequencial; falta confirmar persistência real em dois dispositivos e a versão publicada.
Continuar a validar sincronização real entre dispositivos, offline/reconexão e conflitos. Um teste com payloads partilhados ou emulação móvel não equivale a observação em dois dispositivos físicos.
Animação, reconhecimento automático e gestão complexa multiequipa ficam para depois do núcleo.
