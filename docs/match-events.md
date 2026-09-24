# Vision Coach — lances e estatísticas do jogo

## Acesso
**Calendário → jogo → Jogo visual / substituições**, secção *Lances e estatísticas*. Usa o mesmo registo do jogo (`jogos`, `kind=match`); não cria fichas nem eventos novos no calendário.

## Registo de lances

No telemóvel, os botões de registo rápido ficam em duas colunas com altura mínima de 48 px; em ecrãs largos ficam em quatro colunas. Escolher um tipo prepara o formulário com o minuto atual, mas o treinador confirma detalhes e grava explicitamente.
O registo usa o minuto do **cronómetro do jogo**: só é possível registar lances depois de iniciar a utilização (jogo a correr, em pausa ou terminado). Toca no tipo de lance na grelha rápida — o formulário fica preenchido com o minuto atual — confirma atleta, zona, motivo e observação quando se aplicam, e guarda.

Tipos: golo a favor, golo sofrido, remate à baliza, remate para fora, canto a favor, canto contra, recuperação de bola, perda de bola, bola em profundidade, bola no pé do avançado, acontecimento livre. O toque no botão “Registar lance” grava a ação explicitamente; não aparece uma confirmação adicional em cada lance.

Cada lance pode guardar: minuto, atleta da nossa equipa por UUID, nome escrito pelo treinador para um atleta adversário quando relevante, lado (remates e notas livres), zona do campo, motivo (apenas perdas) e observação. O nome adversário é texto manual ligado apenas ao lance; não cria um atleta no plantel nem pressupõe que a identidade foi reconhecida automaticamente. Motivos de perda: passe errado, receção, condução, decisão, pressão adversária, duelo, outro. Registar um lance nunca altera o resultado, o alinhamento nem os minutos.

## Correções
Editar e apagar lances exige **pausa ou jogo terminado** — o mesmo critério das correções de utilização. Apagar pede confirmação e não pode ser recuperado depois da sincronização. Enquanto o jogo corre, o treinador acrescenta lances; correções cronológicas ficam para a pausa.

## Zonas do campo
Modelo único partilhado: três terços (defesa, meio-campo, ataque) × três corredores (esquerda, centro, direita), definidos em `VisionMatchEvents.zones`. A função `zoneFromPoint` classifica também as coordenadas normalizadas dos marcadores no campo visual; as linhas do campo mostram as mesmas nove células e cada posição expõe a sua zona. A metade superior representa ataque (`ATACAR ↑`), e o cálculo é partilhado com a consulta MCP `get_match_visual`. O mesmo modelo serve perdas, recuperações, remates, golos e análises seguintes.

## Estatísticas e proveniência
As estatísticas são **contadas a partir dos lances registados**; cada linha da tabela indica a origem (`contada`). Se `match_events.events` não existir, as contagens são desconhecidas (`null`) e a interface identifica que ainda não há registo de lances. Uma lista guardada, mesmo vazia, representa zero lances e produz zeros contados. Não inferir zero a partir da ausência de dados. Golos contados vs. resultado na ficha geram um aviso de reconciliação, mas o resultado mantém o valor registado pelo treinador. O resultado da ficha e os relatórios identificam-no como introduzido manualmente; a API de estatísticas mantém-no separado dos golos contados nos lances.

As substituições já executadas não são copiadas para `match_events`: a cronologia do ecrã combina os lances com os movimentos `substitute` guardados em `visual_match.events`, pela mesma origem persistida. A tabela mostra uma contagem de substituições realizadas com proveniência **Registo de utilização**. Para corrigir uma substituição, usa o histórico de movimentos do modo de jogo; a estatística é derivada novamente, sem criar um segundo evento.

**Posse de bola** é sempre introduzida pelo treinador com uma das proveniências: medida, estimada ou desconhecida. Uma estimativa nunca é apresentada como medição exata.

## Dados e sincronização
Schema `vision-match-events@1`, campo `match_events` no mesmo registo `jogos`, sincronizado como `kind=match`. Sem novas tabelas, migrações ou relaxamento de RLS. Revisão monotónica; escritas locais usam `DB.modificar` com verificação de revisão. Na leitura, cada lance é validado com as mesmas regras da gravação, incluindo minuto, tipo, referências opcionais, observação e ID único; registos malformados ou IDs duplicados são recusados em vez de entrarem nas estatísticas. Registos de lances permanecem após *Apagar registo de utilização* (a utilização é apagada; os lances continuam válidos como historial do treinador, com o minuto que tinha sido registado). Formulários com alterações não guardadas não são substituídos por sincronizações.

## MCP para a IA autorizada
Cinco operações no servidor existente (mesma autenticação, `expected_updated_at`/`expected_revision`, scopes `read`/`write`, UUIDs remotos e RPC `head_coach_put_record`):
- `get_match_events`: leitura dos lances, estatísticas e posse; não regista nada.
- `record_match_event`: registo de um lance **explicitamente confirmado e reportado pelo treinador**, com `event_id` estável; nunca inventa lances. minute 0–240; em jogo a correr usa o minuto atual do cronómetro quando omitido.
- `update_match_event`: alteração em pausa ou jogo terminado; o tipo de lance é imutável.
- `delete_match_event`: apagar com confirmação explícita.
- `save_match_possession`: guardar a proveniência medida/estimada/desconhecida; exige confirmação.

O tipo de lance não muda em edições: para representar outra coisa, apaga-se e regista-se o correto. Um pedido de desenvolvimento da app não autoriza registar lances de um jogo real sem relato do treinador.

## Limites desta entrega
Os atletas da nossa equipa usam UUID estável; adversários podem ser identificados manualmente pelo nome em cada lance, sem criar registos de plantel. A preparação pode guardar sistema, estilo, pontos fortes e vulnerabilidades observados do adversário. Vídeo/evidências, análise pós-jogo e exportação PDF estão documentados em `match-video-evidence.md`, `match-analysis.md` e `reports.md`. Jogos sem cronómetro iniciado não têm lances.

## Verificação
`npm run check`, `npm test` e `npx playwright test tests/e2e/match_events.spec.js`. A app passa para v69; imagens aprovadas e workflows anteriores permanecem intactos.
