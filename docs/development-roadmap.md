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
Hotfix v68 publicado no PR #42 para o erro reportado `invalid input syntax for type uuid: "default"`: reparação de `sync_id` sem versão remota; tombstones verificam a equipa UUID e versão atuais, sem enviar o `team_id` local `default` ao Supabase. Validação: `npm run check`, 151 testes unitários, 40 testes Playwright com um worker, CI e GitHub Pages passaram. A execução Playwright paralela teve 11 falhas intermitentes que passaram na repetição sequencial. A abertura da v68 numa nova aba já não mostrou o erro UUID, mas revelou uma falha seguinte de chave IndexedDB; continua pendente confirmar a consolidação integral nos dispositivos reais.
Continuação v69: depois da publicação v68, a consolidação avançou e expôs uma segunda falha em referências de objetos: UUIDs remotos chegavam a `DB.obter`, que convertia a chave numérica local para `NaN` e lançava `IDBObjectStore.get: parameter is not a valid key`. Referências UUID passam a ser validadas dentro da equipa remota; chaves locais inválidas ficam em conflito sem bloquear outros registos. A atualização da PWA mostra uma ação manual para recarregar depois de guardar formulários abertos. Preparado em `fix/sync-reference-key-20260923`; `npm run check`, 154 testes unitários, 40 testes Playwright em sequência, o teste de navegador adicional com IndexedDB real e `git diff --check` passaram. A publicação e a consolidação nos dois dispositivos reais ainda não estão confirmadas.
Continuar a validar sincronização real entre dispositivos, offline/reconexão e conflitos. Um teste com payloads partilhados ou emulação móvel não equivale a observação em dois dispositivos físicos.
Animação, reconhecimento automático e gestão complexa multiequipa ficam para depois do núcleo.
