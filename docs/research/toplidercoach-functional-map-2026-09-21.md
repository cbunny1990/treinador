# Mapa funcional de referência — TopLiderCoach / PlanificadorPro

Data da análise: 2026-09-21
Objetivo: inventariar funções, fluxos e padrões de produto observáveis publicamente para servir de referência ao desenvolvimento futuro do Vision Coach.

## Âmbito e método

Este documento não copia código, conteúdos premium nem bases de dados do TopLiderCoach.
Regista, em linguagem própria, funcionalidades e estruturas visíveis em páginas públicas, documentação e materiais oficiais.
Quando uma função aparece apenas num produto adjacente/loja e não no HUB, isso é indicado.
As prioridades para o Vision Coach são sugestões de produto, não uma tentativa de reproduzir o serviço.

## Mapa macro

1. Dashboard
2. Gestão de clube/época
3. Plantel e jogador
4. Planificador de sessões
5. Biblioteca/banco de exercícios
6. Pizarra tática
7. Calendário
8. Presenças
9. Wellness e carga
10. Jogos / MatchStats
11. Convocatórias
12. Alinhamento e sistema
13. Estatísticas de equipa
14. Estatísticas individuais
15. Vídeo
16. Análise própria de jogo
17. Análise do adversário
18. Plano de jogo / scouting
19. Balão parado / ABP
20. PDFs e documentos profissionais
21. Assistentes IA
22. App móvel / offline
23. Favoritos, filtros e pesquisa
24. Recursos editoriais: exercícios, vídeos, ebooks
25. Loja e produtos complementares

---

# 1. Dashboard principal

Funções observadas:
- resumo geral da equipa;
- próximos jogos e próximos treinos;
- sequência/racha de resultados;
- vitórias, empates e derrotas;
- golos marcados e sofridos;
- comparação casa vs fora;
- top goleadores;
- atalhos para módulos principais;
- gráficos visuais de desempenho.

Valor para Vision Coach:
- transformar o atual Workspace/Home numa página operacional “Hoje”;
- mostrar próximo treino, próximo jogo, últimas observações e ações pendentes;
- deixar o Head Coach gerar/atualizar automaticamente os cartões do dashboard.
# 2. Gestão de clube e época

Funções observadas:
- criar e gerir épocas;
- definir categorias/escalões;
- configurar competições;
- guardar objetivos de época;
- manter histórico por temporada;
- associar plantel e dados à época ativa.

Valor para Vision Coach:
- manter uma entidade Season simples;
- ligar jogos, treinos, documentos e estatísticas a uma época;
- arquivar épocas sem perder memória histórica.

# 3. Plantel e ficha de jogador

Funções observadas:
- criar/editar jogadores;
- fotografia;
- posição;
- dorsal;
- dados pessoais;
- organização do plantel;
- utilização da fotografia/número em convocatórias, alinhamentos e PDFs.

Valor para Vision Coach:
- manter apenas dados necessários ao futebol de formação;
- fotografia, nome, dorsal, posição e observações;
- evitar recolher telefone, documento, peso ou outros dados sensíveis sem necessidade clara.
# 4. Planificador de sessões

Funções observadas:
- criar uma sessão completa;
- organizar por fases: aquecimento, parte principal e retorno à calma;
- adicionar exercícios da biblioteca;
- reorganizar tarefas por drag & drop;
- controlar tempos e duração total;
- definir tema e objetivos da sessão;
- adicionar notas e variantes;
- guardar sessão;
- editar sessão;
- duplicar sessão anterior;
- pesquisar sessões por nome/data;
- organizar por microciclo;
- exportar sessão para PDF;
- consultar arquivo/histórico de sessões.

Valor para Vision Coach:
- sessão como documento técnico estruturado, não apenas texto;
- Head Coach pode criar automaticamente a sessão a partir do próximo jogo, modelo de jogo e observações;
- treinador continua a poder editar manualmente blocos, tempos e consignas.
# 5. Biblioteca de exercícios

Funções observadas:
- grande biblioteca de exercícios;
- filtros por tema;
- filtros por treinador/referência;
- filtros por dificuldade;
- filtros por número de jogadores;
- categorias como rondos, posse, finalização, pressing, transições, físico-tático, tática/sistemas e futebol base;
- ações de bola parada;
- vídeos reais;
- exercícios animados;
- favoritos;
- atualização contínua de conteúdos;
- adaptação por idade/nível.

Valor para Vision Coach:
- não precisamos de replicar milhares de exercícios;
- criar um banco próprio curto e de alta qualidade;
- permitir que o Head Coach proponha tarefas e guarde apenas as que realmente usamos;
- filtros focados em Sub-8, objetivo, nº jogadores, espaço e duração.
# 6. Pizarra tática — estrutura geral

Funções observadas na documentação oficial:
- modo exercício estático;
- modo exercício animado;
- tipos de campo: completo, meio campo para cima, meio campo para baixo e campo livre;
- personalização da cor do relvado;
- jogadores das duas equipas;
- cor da equipa e cor específica do guarda-redes;
- formações predefinidas;
- inserção manual de jogadores;
- carregar jogadores reais do plantel;
- nome/número real;
- mostrar/ocultar dorsal.

Possível uso no Vision Coach:
- começar por um editor estático leve;
- suportar Sub-8/5v5 antes de sistemas de futebol 11;
- reutilizar jogadores reais do plantel.
# 7. Pizarra tática — ferramentas de desenho

Funções observadas:
- selecionar/mover/apagar elementos;
- desenho livre;
- seta reta;
- seta curva com ponto de controlo;
- linha simples;
- retângulo;
- círculo/elipse;
- texto;
- espessura do traço;
- linha tracejada;
- escolha de cor;
- undo/redo;
- atalhos Ctrl+Z e Ctrl+Y.

Material colocável:
- bola;
- cones;
- marcadores;
- picas;
- barreiras;
- mini-balizas;
- balizas em vários tamanhos;
- manequins;
- redimensionamento;
- rotação por passos e por ângulo.
# 8. Pizarra tática — animação

Funções observadas:
- sequência frame a frame;
- criação automática do frame inicial;
- adicionar/remover frames;
- mover jogadores e bola entre frames;
- desenhar trajetórias de movimento;
- interpolação visual;
- pré-visualização Play/Stop;
- navegação entre frames;
- velocidades de reprodução 0.5x, 1x e 2x;
- desenhos persistentes ou removidos a partir de frames específicos;
- guardar alterações de uma animação existente;
- regenerar o vídeo quando o desenho muda.

Possível Vision Coach:
- fase posterior; não é necessária para o núcleo inicial;
- valor elevado para mostrar exercícios e planos de jogo visualmente.
# 9. Ficha técnica de exercício

Campos observados:
- nome;
- duração;
- número de jogadores;
- dificuldade;
- categoria;
- categoria etária;
- tema;
- fase do jogo;
- número de guarda-redes;
- espaço: largura x comprimento;
- EII / espaço individual de interação em m² por jogador;
- material;
- objetivos;
- descrição;
- variantes;
- notas do treinador.

Automatismos observados:
- cálculo do EII;
- miniatura do desenho;
- ligação entre ficha e pizarra.

Possível Vision Coach:
- este modelo de dados é muito útil e deve servir de referência ao futuro banco próprio de tarefas.
# 10. Banco pessoal de exercícios

Funções observadas:
- guardar exercícios criados pelo treinador;
- miniatura;
- etiquetas;
- dificuldade;
- pesquisa por nome;
- filtros por tema, categoria, idade, dificuldade, fase de jogo, jogadores, guarda-redes e duração;
- ver ficha;
- editar ficha;
- editar desenho;
- eliminar com confirmação;
- exercícios pessoais aparecem no Planificador;
- miniatura e descrição passam automaticamente para o PDF da sessão.

Valor Vision Coach:
- banco pessoal deve ser curado pelo uso real;
- ligação direta “exercício → sessão → PDF” é um padrão importante.
# 11. Calendário

Funções observadas:
- calendário de treinos;
- vista semanal;
- vista mensal;
- calendário de jogos;
- resultados com código visual;
- organização de toda a época;
- próximos eventos no dashboard;
- filtros por competição/data/estado.

Valor Vision Coach:
- criar um calendário único Treinos + Jogos;
- permitir ao agente preencher automaticamente datas;
- mostrar relação treino → próximo jogo.

# 12. Presenças

Funções observadas:
- marcar presença por sessão;
- registo rápido para o plantel;
- histórico por treino;
- histórico por jogador;
- estatísticas de assiduidade;
- dashboard de presença;
- relatório PDF individual/resumo.

Valor Vision Coach:
- útil quando começarmos a registar treinos reais;
- dados de baixa sensibilidade se mantidos apenas como presença/ausência.
# 13. Wellness, fadiga e carga

Funções observadas:
- escalas de wellness;
- fadiga;
- dor muscular;
- zonas de dor;
- peso;
- evolução do estado físico;
- alertas de risco;
- RPE/carga em produtos e recursos complementares;
- minutos e, em produtos avançados, GPS/testes físicos.

Nota:
- wellness/carga existe no Planificador;
- funcionalidades como GPS e análise física mais profunda aparecem também em agentes/produtos complementares.

Valor Vision Coach:
- NÃO priorizar para Sub-8;
- se usado, limitar a sinais simples e não médicos;
- evitar criar inferências de lesão/saúde sem necessidade e sem contexto profissional.
# 14. Gestão de jogos / MatchStats

Funções observadas:
- criar jogo;
- data e adversário;
- competição;
- resultado;
- calendário completo;
- histórico de confrontos;
- distinguir vitória/empate/derrota;
- filtros por data/estado/competição;
- escudo do adversário;
- estatísticas coletivas;
- posse;
- remates;
- cantos;
- faltas;
- outras métricas do encontro.

Valor Vision Coach:
- já temos o objeto Match;
- devemos evoluir para página completa Antes / Durante / Depois.
# 15. Estatísticas por jogador

Funções observadas:
- golos;
- assistências;
- minutos;
- amarelos;
- vermelhos;
- autogolos/golos na própria;
- progressão ao longo da época;
- ranking de goleadores;
- dashboard individual;
- dashboard global do plantel;
- PDF de estatísticas por jogador.

Valor Vision Coach:
- para Sub-8, usar com moderação;
- priorizar minutos/participação e observações de desenvolvimento sobre rankings competitivos.
# 16. Vídeo de jogo

Funções observadas:
- link para jogo completo;
- links de momentos-chave;
- videoteca associada ao jogo;
- revisão posterior com equipa técnica.

Valor Vision Coach:
- já temos media_assets;
- ligar vídeo a jogo, jogador, treino, observação ou documento;
- permitir que o Head Coach crie notas e clips de referência sem tornar o URL público.

# 17. Convocatórias

Funções observadas:
- selecionar convocados;
- fotografias;
- dorsais;
- dados/logística do jogo;
- escudos das equipas;
- gerar PDF profissional;
- partilhar/imprimir.

Valor Vision Coach:
- muito útil para os próximos jogos;
- adicionar hora de concentração/saída como campos próprios;
- selecionar jogadores convocados a partir do plantel.

# 18. Alinhamento e campo de jogo

Funções observadas:
- distinguir titulares e suplentes;
- escolher sistema;
- colocar jogadores num campo interativo;
- fotografias e dorsais;
- guardar posições;
- integrar alinhamento no PDF;
- formações predefinidas no produto genérico.

Valor Vision Coach:
- adaptar primeiro a 5v5/Sub-8;
- sistemas e posições devem ser configuráveis;
- o alinhamento pode alimentar posteriormente análise de jogo.

# 19. Análise própria do jogo

Funções observadas:
- sistema utilizado;
- alterações de sistema;
- pontos fortes;
- aspetos a melhorar;
- notas táticas;
- conclusões;
- aprendizagens;
- histórico por jogo;
- exportação para PDF.

Valor Vision Coach:
- ligar automaticamente conclusões à memória do Head Coach;
- cada conclusão deve guardar evidência: jogo, media ou observação.

# 20. Análise do adversário

Funções observadas no HUB:
- sistema/formação rival;
- pontos fortes;
- pontos fracos;
- notas do rival;
- preparação para o próximo confronto.

Funções encontradas em produtos complementares do mesmo site:
- jogadores-chave;
- variantes táticas;
- contador de ações ao vivo;
- KPIs comparativos;
- distribuição por intervalos de 15 minutos;
- zonas de golo;
- histórico comparativo de vários rivais.

Importante:
- as funções avançadas acima pertencem a produtos/plantilhas adjacentes e não devem ser assumidas como parte integral do HUB.

# 21. Plano de jogo e scouting

Funções observadas em materiais oficiais:
- scouting do rival;
- formação/estilo;
- fortes/fracos;
- plano tático;
- ligação a ABP;
- planeamento semanal;

- apoio à charla/reunião tática;
- análise pós-jogo;
- relatório final.

Valor Vision Coach:
- antes do jogo: “o que sabemos / objetivo / plano”;
- depois do jogo: “o que aconteceu / evidências / aprendizagens / próximo treino”.

# 22. Balão parado / ABP

No ecossistema TopLiderCoach aparecem:
- córners ofensivos;
- córners defensivos;
- faltas diretas;
- faltas laterais/frontais;
- penáltis;
- lançamentos/jogadas combinadas;
- inventário de variantes;
- zonas de campo;
- responsabilidades por jogador.

Nota:
- parte destas funções está em conteúdos/produtos complementares, não necessariamente no núcleo do HUB.

# 23. PDFs e documentos

Documentos observados:
- sessão de treino compacta;
- sessão detalhada/com títulos;
- análise de jogo;
- ata/relatório de jogo;
- convocatória;
- alinhamento;

- estatísticas de jogador;
- estatísticas gerais do plantel;
- presença e wellness;
- ficha de exercício/pizarra.

Padrões:
- fotos de jogadores;
- escudos;
- dados do jogo;
- miniaturas táticas;
- saída pronta para imprimir/partilhar.

Valor Vision Coach:
- três primeiros PDFs prioritários: Plano de Treino, Ficha/Convocatória de Jogo, Relatório Pós-Jogo.

# 24. Assistentes IA

Padrão observado:
- vários especialistas;
- acesso aos dados reais do utilizador;
- respostas adaptadas a plantel, jogos e estatísticas;
- áreas: sessões/exercícios, rendimento/preparação física, tática, mentalidade.

Nota importante:
- páginas públicas do próprio site descrevem os nomes/papéis dos três assistentes de forma inconsistente;
- o padrão útil não é copiar as personas, mas permitir IA especializada sobre o mesmo dataset.

Decisão Vision Coach:
- manter UM Head Coach com acesso ao workspace;
- mudar de “modo” conforme a tarefa: planeamento, análise, tática, comunicação;
- evitar obrigar o treinador a escolher entre vários chatbots.

# 25. App móvel e offline

Funções observadas:
- iOS e Android;
- exercícios no telemóvel;
- acesso ao planificador;
- utilização no campo;
- consulta de exercícios offline;
- mesma subscrição web/mobile.

Valor Vision Coach:
- a PWA já cobre grande parte deste padrão;
- manter mobile-first e offline-first;
- sincronizar quando a rede regressa.

# 26. Favoritos, pesquisa e filtros

Funções observadas:
- favoritos pessoais;
- pesquisa;
- filtros por tema;
- treinador;
- dificuldade;
- idade;
- número de jogadores;
- fase;
- duração;
- guarda-redes;
- data;
- competição/estado em jogos.

Valor Vision Coach:
- pesquisa global futura;
- filtros contextuais por módulo;
- Head Coach deve conseguir consultar pelos mesmos critérios.

# 27. Conteúdo e recursos editoriais

Ecossistema observado:
- biblioteca de exercícios;
- vídeos animados;
- vídeos reais;
- treinadores de referência;
- ebooks;
- temas de treino;
- futebol base;
- tática e sistemas;
- físico-tático;
- ABP;
- conteúdos atualizados frequentemente.

Valor Vision Coach:
- não replicar catálogo editorial;
- o nosso diferencial é transformar dados reais da equipa em decisões e planos;
- referências externas podem ser guardadas como media/links.

# 28. Loja e produtos complementares

O site também comercializa:
- agentes IA especializados;
- templates de treino;
- templates de estatística;
- wellness/carga/RPE;
- scouting e análise de rival;
- ABP;
- roster/plantel;
- torneios;
- apps especializadas;
- packs e outros recursos.

Uso para Vision Coach:
- tratar estes itens como radar de necessidades do treinador, não como backlog automático.

---

# Fluxos de utilizador observados

## Fluxo A — Preparar treino
Dashboard → Planificador → Criar sessão → Escolher exercícios → Organizar blocos → Ajustar tempo/notas → Guardar → PDF → Calendário.

## Fluxo B — Criar exercício próprio
Pizarra → Campo/elementos → Ficha técnica → Guardar → Banco pessoal → Adicionar ao Planificador → PDF.

## Fluxo C — Preparar jogo
Calendário/Partidos → Ficha do jogo → Convocados → Titulares/suplentes → Sistema/alinhamento → Análise rival/plano → PDF.

## Fluxo D — Pós-jogo
Jogo → Resultado e stats → Stats por jogador → Vídeo → Análise própria → Análise rival → Conclusões → PDF/histórico.

## Fluxo E — Acompanhar jogador
Plantel → Ficha jogador → presença → stats → evolução → relatórios.

## Fluxo F — IA
Dashboard/módulo → especialista IA → consulta dados reais → proposta → treinador aplica no módulo.

# Modelo de dados de referência para Vision Coach

Entidades futuras sugeridas:
- season
- competition
- team
- player
- training_session
- session_block
- exercise
- tactical_board
- match
- match_callup
- lineup

- match_event
- player_match_stats
- match_analysis
- opponent_profile
- set_piece
- attendance
- wellness_entry
- media_asset
- report
- activity_log
- agent_authorization

Campos importantes que hoje ainda não são entidades próprias:
- match.departure_time
- match.meeting_time
- match.competition
- match.opponent_logo
- match.callups
- lineup.formation
- lineup.positions
- training_session.total_duration
- training_session.objectives
- exercise.space_width/space_length
- exercise.eii

# Priorização proposta para Vision Coach

## Prioridade A — alto valor imediato
- calendário único jogos + treinos;
- página de jogo completa;
- hora de saída/concentração;
- convocatória;
- alinhamento 5v5;
- plano pré-jogo;
- análise pós-jogo;
- planeador de sessão por blocos;
- PDFs básicos;
- ligação automática Head Coach → documentos/observações.

## Prioridade B — depois do núcleo
- banco pessoal de exercícios;
- pizarra tática estática;
- estatísticas simples por jogador;
- presença;
- vídeo/clip tagging;
- análise de adversário estruturada.

## Prioridade C — fase avançada
- pizarra animada;
- MP4;
- wellness/carga;
- ABP avançado;
- dashboards estatísticos extensos;
- múltiplas épocas/competições complexas.

# Coisas que NÃO devemos copiar diretamente

- três chatbots separados só porque o concorrente os tem;
- recolha excessiva de dados pessoais de menores;
- wellness/saúde como diagnóstico;
- rankings de crianças como eixo principal da experiência;
- catálogo gigantesco de exercícios sem curadoria;
- complexidade de futebol 11 antes de resolver bem Sub-8/5v5;
- funções de loja/subscrição sem relevância para o treinador;
- textos, vídeos, imagens, PDFs, desenhos ou exercícios proprietários.

# Princípio do Vision Coach

O TopLiderCoach é principalmente um HUB de ferramentas e conteúdos.
O Vision Coach deve ser um workspace operacional em que Humano + Head Coach usam os mesmos dados.

A vantagem pretendida:
- menos formulários;
- mais contexto;
- IA escreve no workspace;
- dados do jogo alimentam memória;
- memória alimenta treino;
- treino e jogo alimentam Timeline;
- tudo auditável por autoria.

# Fontes públicas consultadas

- https://toplidercoach.com/
- https://toplidercoach.com/toplidercoach-com-en/
- https://toplidercoach.com/hub-toplidercoach/
- https://toplidercoach.com/planifica-tus-sesiones-como-un-pro/
- https://toplidercoach.com/en/estadisticas-de-tu-equipo/
- https://toplidercoach.com/wp-content/uploads/2026/03/manual-breve-de-usuario.pdf
- https://toplidercoach.com/plantilla-analisis-del-rival/
- https://toplidercoach.com/plantilla-analisis-pro-del-rival/
- https://toplidercoach.com/en/plantilla-balon-parado-abp/
- https://toplidercoach.com/en/webinar-mayo-2026/
- https://toplidercoach.com/en/tienda-toplidercoach/

## Nota de manutenção

Esta é uma fotografia funcional do produto público em 2026-09-21.
Antes de implementar uma função inspirada neste mapa, confirmar de novo:
1. se continua relevante para o nosso Sub-8;
2. se já existe algo equivalente no Vision Coach;
3. se os dados necessários são realmente necessários;
4. se a função deve ser humana, automática ou partilhada com o Head Coach.
