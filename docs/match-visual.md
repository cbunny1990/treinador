# Vision Coach — jogo visual 5v5 e utilização

## Acesso
**Calendário → jogo → Jogo visual / substituições**. Também está disponível ao abrir um jogo pela Equipa.
O percurso `#/jogo-visual/ID_LOCAL` usa o jogo existente; não cria uma segunda ficha nem outro evento no calendário.

## Antes do jogo
Definir a convocatória na ficha do jogo. No novo ecrã, escolher **Guarda-redes, Defesa, Ala esquerda, Ala direita e Avançado**. Os convocados restantes ficam como suplentes.
Guardar o alinhamento visual. Só atletas convocados e disponíveis podem ser selecionados; um atleta não ocupa duas posições.
O campo reutiliza nomes, dorsais e as fotografias existentes quando acessíveis. Não gera nem altera imagens de exercícios.
Selecionar uma posição e tocar numa zona livre do campo para mover o seu marcador; no teclado, usar as setas. A disposição é guardada em coordenadas normalizadas, com margens de apresentação para não cortar os nomes.
Mover um marcador altera apenas o desenho: não troca o guarda-redes, não efetua uma substituição e não altera os minutos.
O modo de desenho também permite colocar cones e setas de movimento. As marcações são partilhadas, permanecem ao limpar a utilização e podem ser apagadas individualmente ou em conjunto com confirmação. Não mudam a convocatória, o alinhamento inicial nem os minutos. O MCP tem uma operação específica para editar estas marcações e verifica revisão e equipa.
**Repor posições no campo** restaura a disposição 1-2-1; **Apagar alinhamento** limpa a seleção inicial, mantendo a convocatória. Ambas pedem confirmação.

No telemóvel (390 px), os marcadores do campo têm pelo menos 44 × 44 px, os seletores e botões dos formulários têm pelo menos 44 px de altura e o quadro não cria rolagem horizontal.

## Rotações previstas
Escolher quem sai, quem entra, minuto previsto e nota. Guardar; pode editar ou apagar uma rotação ainda não realizada.
Uma rotação é uma intenção: nunca se executa automaticamente. Quando o minuto previsto passa, aparece um aviso na página aberta, sem prometer notificações em segundo plano.
**Realizar agora** pede confirmação e regista a substituição no instante real do cronómetro, mesmo que seja diferente do minuto previsto.
A entrada tem de ser possível nesse momento: quem sai está no campo e quem entra está no banco e disponível. O sistema não inventa a execução de uma sequência de rotações.

## Durante o jogo
**Iniciar jogo e contar minutos** exige confirmação e exatamente um GR + quatro jogadores de campo. Congela o alinhamento inicial e os nomes/dorsais dos convocados disponíveis; não copia fotografias nem dados médicos para o histórico de utilização.
Os titulares começam no minuto zero. Suplentes que ainda não entraram ficam em 00:00.
**Pausar / intervalo** suspende a contagem. Em pausa durante a 1.ª parte, escolhe explicitamente **Retomar 1.ª parte** ou **Iniciar 2.ª parte**; a segunda ação pede confirmação, persiste o limite entre partes e retoma o relógio sem apagar o tempo ou os minutos já registados. Na 2.ª parte, a ação disponível é **Retomar 2.ª parte**. O início da segunda parte só pode ser marcado uma vez. O tempo é reconstruído por instantes guardados ao fechar/reabrir a app, não pelo número de callbacks do temporizador. O intervalo não entra no tempo total. A alteração do modo de jogo avança a cache da PWA para v99.
**Registar substituição** escolhe quem sai e quem entra e confirma o instante atual. São permitidas reentradas; a contagem mantém todos os intervalos de utilização.
**Trocar posições agora** regista uma troca entre funções, incluindo GR quando selecionado. O tempo total não muda; o tempo como guarda-redes passa a ser contabilizado para o atleta correto.
**Terminar utilização** termina apenas o cronómetro e os minutos registados. Não preenche o resultado nem a análise, nem altera por si o estado administrativo do jogo.
Não inicia registo em jogos marcados como concluídos ou cancelados, para não inventar utilização retroativa.

## Minutos e correções
A tabela mostra tempo total em campo e tempo como GR para cada atleta do registo inicial. São derivados da sequência de movimentos e do cronómetro, não são estatísticas de vídeo nem estimativas históricas.
O resumo operacional apresenta a diferença entre o maior e o menor tempo registado e identifica, por ordem alfabética, quem jogou menos de metade do tempo decorrido. O limiar fica explícito e atualiza-se com o cronómetro. Serve para apoiar a decisão do treinador; não é uma classificação dos atletas.
A ficha de cada atleta mostra os jogos com utilização registada; registos ainda em curso são assinalados como parciais. Não são criados rankings.
Na pausa ou depois de terminar, cada movimento da cronologia pode ser editado ou anulado. A edição guarda os valores anteriores para auditoria; anular mantém o evento marcado como anulado. Em ambos os casos, a cronologia é reproduzida e os minutos são recalculados. **Anular último movimento** continua disponível como atalho durante a pausa.
Se uma alteração tornar um movimento posterior impossível (por exemplo, fazer sair alguém que ainda não entrou), a gravação é recusada sem alterar o original. Corrige os movimentos dependentes em sequência ou mantém o histórico. Uma substituição inversa que acontece agora continua a ser um novo movimento, não uma correção.
**Apagar registo de utilização** exige pausa ou conclusão e confirmação. Apaga tempos/movimentos/snapshot de utilização, mas mantém o jogo, resultado, análise, alinhamento e rotações previstas.
Atletas retirados do plantel depois do início mantêm o seu histórico. Podem sair do campo; não podem voltar a entrar enquanto não estiverem disponíveis no plantel.

## Sincronização e controlo
Schema `vision-match-visual@1`, campo `visual_match` no mesmo registo `jogos`, sincronizado como `kind=match`.
Não há novas tabelas, migrações ou relaxamento de RLS. O modelo partilhado está em `js/match_visual.js`.
As ações locais usam `DB.modificar` numa transação IndexedDB; a revisão do jogo visual e a versão do alinhamento são verificadas. Não há gravação a cada segundo.
Há um controlador por cronómetro. Para trocar de dispositivo, pausar, sincronizar e **Assumir controlo neste dispositivo**. Uma IA não rouba silenciosamente o cronómetro do treinador.
Dois dispositivos com cópias antigas e sem rede continuam sujeitos a conflitos de sincronização. Não existe bloqueio distribuído offline; os conflitos devem ser reconciliados, não ignorados.
Formulários com alterações não guardadas não são substituídos por sincronizações. Uma gravação desatualizada é recusada preservando o texto. A indicação de guardar localmente não afirma que o outro dispositivo já recebeu os dados.
A primeira abertura pode precisar de rede para receber os registos/fotografias. Não se garante disponibilidade offline de uma fotografia que ainda não tenha sido carregada.

## MCP para a IA autorizada
Nove operações no servidor existente:
- `get_match_visual`: leitura sem iniciar cronómetro; inclui elegibilidade atual e utilização registada, sem fotos privadas no resultado.
- `save_match_visual_lineup`: guardar/limpar alinhamento inicial antes de iniciar.
- `set_match_visual_position`: posição no desenho ou reposição, sem modificar a utilização.
- `edit_match_tactics`: adicionar cone/seta exige confirmação explícita do Head Coach; apagar uma marcação ou limpar o quadro exige também confirmação e não altera alinhamento, cronómetro ou minutos.
- `save_match_rotation`: criar/editar plano pelo `rotation_id`.
- `delete_match_rotation`: apagar plano não realizado com confirmação.
- `control_match_usage`: iniciar/pausar/retomar/iniciar explicitamente a 2.ª parte/terminar/assumir controlo/apagar utilização, apenas quando o treinador o pedir.
- `record_match_movement`: substituição, troca de funções ou anulação do último movimento, com confirmação explícita.
- `correct_match_movement`: editar ou anular qualquer movimento por ID, em pausa ou após conclusão; reprova sequências incompatíveis.
Ler primeiro. Escritas exigem `expected_updated_at`, `expected_revision`, scopes `read` e `write`, UUIDs remotos e pertença à equipa. Usam a RPC existente `head_coach_put_record`, com controlo de versão e auditoria.
Uma chamada repetida com revisão antiga é recusada em vez de voltar a executar a substituição. Reutilizar um ID de movimento não duplica entradas.
Um pedido de desenvolvimento da app não autoriza iniciar um jogo real, marcar uma substituição ou atribuir minutos a atletas.

## Limites desta entrega
A base é 5v5 com cinco jogadores em campo; inferioridade numérica, expulsões e entradas adicionais fora da convocatória congelada não estão incluídas.
Não deteta lances pelo vídeo, não calcula estatísticas por si nem anima movimentos. Cones e setas são marcações manuais do treinador; não representam eventos ocorridos nem executam alterações no jogo. As estatísticas, evidências e relatórios vivem nas secções próprias da ficha do mesmo jogo.
Mudanças manuais do relógio do dispositivo podem afetar a contagem; sequências inconsistentes são recusadas, não corrigidas com números inventados.
Os testes de ecrã móvel são emulação de navegador, não observação no telemóvel físico do treinador.

## Verificação e referências
`npm run check`, `npm test`, `npm run test:e2e`.
A base inicial passou 124 testes unitários e 32 testes de navegador. Os testes cobrem matemática de utilização/GR, planos versus execução, correção/anulação individual com auditoria, UUIDs, transações, revisões, equipa/scopes, retorno à app, offline e preservação do histórico.
https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect

## Resultado local desta entrega
Passaram 147 testes unitários e 40 testes de navegador, incluindo as suites anteriores de imagens, sessões e continuidade. O novo percurso foi verificado em 390 × 844 e 1440 × 900. Os testes verificam que a soma dos tempos individuais corresponde a cinco vezes o tempo registado com cinco jogadores em campo. Foram inspecionadas capturas de ecrã. Estes resultados não substituem a validação no telemóvel físico.
As operações MCP têm testes com cliente simulado para identidade, permissões, revisão e preservação dos dados. Gravar o alinhamento inicial, alterar o desenho da posição e qualquer comando de cronómetro exigem `confirmed: true`; o handler volta a rejeitar operações sem confirmação ou com revisão desatualizada. Não se afirma que houve uma partida real controlada pelo MCP durante estes testes.
