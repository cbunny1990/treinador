# Vision Coach — Formação do treinador

Espaço pessoal de aprendizagem: guias-síntese, recomendações (Ver / Ler / Seguir) e treinos-exemplo por escalão. Começa pelo Sub-8.

## Utilização

- Ligar: Definições → “Mostrar a secção Formação (em testes)”.
- Rotas: `#/formacao`, `#/formacao/sub8`, `#/formacao/sub8/<módulo>[/ver|ler|seguir]`, `#/formacao/plano/sub8`, `#/formacao/biblioteca/sub8`, `#/formacao/treino/<id>`.
- Só aparece conteúdo aprovado e sem “link partido”.

## Plano da época

- O cartão **Plano da época** abre `#/formacao/plano/<escalão>` e mostra o plano aprovado, agrupado por bloco, com objetivo e datas de cada semana, treinos A/B e pausas. A semana atual fica destacada e é trazida para a área visível ao abrir a página.
- O plano é guardado em `learning_season_plans`; as semanas ficam em `learning_plan_weeks` e apontam para treinos aprovados em `learning_sessions`.
- Sem plano aprovado, a página explica que ainda não há plano disponível.

## Biblioteca de treinos

- O cartão **Biblioteca de treinos** abre `#/formacao/biblioteca/<escalão>`. A lista mostra código, título, foco, pilares, duração e bloco; permite filtrar por pilar, bloco e foco.
- Cada cartão abre o treino completo em `#/formacao/treino/<id>`, com código, foco e semanas em que é usado no plano aprovado.
- Os treinos completos entram como registos de `learning_sessions` no módulo `treinos-exemplo`, com `library_code`, `focus` e `season_block`. Um plano entra como um registo aprovado em `learning_season_plans` e as respetivas semanas em `learning_plan_weeks`.
- Nesta fase, a app apresenta conteúdo aprovado; ainda não tem o fluxo de propostas e aprovação. A criação e aprovação dos registos requerem uma operação autorizada pelo treinador.

## Treinos v2

Os treinos da biblioteca usam `library_code` como ordem de progressão: `T01` é o primeiro a ensinar e o mais simples; `T30` é o mais exigente e prepara o grupo para o Sub-9. Cada treino inclui `progression`, com o que o grupo já deve saber e o que o treino prepara.

Cada exercício mantém os campos existentes (`fase`, `organizacao`, `regras`, `variantes`, `pontos_ensino` e `erros_comuns`) e pode acrescentar:

- `espaco`, `jogadores` e `duracao_min`;
- `material`: lista de objetos `{ "item": "cones", "qtd": 4 }`;
- `preparacao`: lista numerada de 2 a 4 ações para montar o espaço;
- `passos`: lista numerada de 3 a 6 ações para jogar;
- `mais_criancas` (opcional): uma frase curta para integrar a 9.ª e a 10.ª crianças sem criar uma fila;
- `diagrama`: posições e movimentos para o desenho automático.

Exemplo de `diagrama`:

```json
{
  "campo": { "largura": 18, "comprimento": 24 },
  "elementos": [
    { "tipo": "cone", "x": 10, "y": 15 },
    { "tipo": "jogador_a", "x": 25, "y": 50, "rotulo": "A1" },
    { "tipo": "jogador_b", "x": 70, "y": 50 },
    { "tipo": "bola", "x": 28, "y": 50 },
    { "tipo": "mini_baliza", "x": 90, "y": 50 }
  ],
  "setas": [
    { "tipo": "conducao", "de": [25, 50], "para": [55, 50], "passo": 1 },
    { "tipo": "passe", "de": [55, 50], "para": [70, 50], "passo": 2 }
  ],
  "legenda": "A equipa A conduz até ao espaço livre e passa ao colega. A equipa B tenta recuperar a bola."
}
```

Tipos de elemento: `cone`, `jogador_a`, `jogador_b`, `bola`, `baliza`, `mini_baliza` e `treinador`. Tipos de seta: `conducao`, `passe`, `corrida` e `remate`. `x` e `y` são percentagens entre 0 e 100. O campo mostra a forma e a cor de cada tipo; a legenda repete o símbolo com o nome. Se uma seta tiver `passo`, o número aparece sobre a seta e corresponde ao mesmo número em `passos`. A frase `legenda` surge como texto selecionável por baixo do desenho. Texto vindo da base de dados é escapado; tipos desconhecidos e coordenadas inválidas são ignorados.

No topo do treino, a app apresenta o nível, a progressão e o material agregado. Para cada material, a quantidade agregada é a maior quantidade indicada num exercício. Treinos antigos sem estes campos continuam a ser apresentados no formato anterior.

## Regras

1. Os dados vivem nas tabelas `learning_*` (RLS por dono) e não entram na sincronização do workspace.
2. Nenhum agente aprova conteúdo; aprovar é sempre uma ação do treinador na app (fase 2).
3. Vídeos YouTube só via `youtube-nocookie.com`; restantes fontes abrem no sítio original, sem cópia.
