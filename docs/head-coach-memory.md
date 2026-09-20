# Head Coach — memória estruturada (V1)

## Decisões

- A memória pertence à equipa e é guardada em IndexedDB, não no histórico de um modelo de IA.
- A V1 continua local-first e sem backend. O backup JSON inclui todas as novas stores.
- A integração futura com IA deve consumir `HeadCoachMemory.buildContext()`; não deve ler diretamente o DOM nem depender do OpenRouter.
- Informação introduzida pelo treinador começa como `observation`. `fact`, `hypothesis`, `diagnosis`, `decision`, `intervention` e `result` são classificações explícitas.
- Diagnósticos exigem evidência. Intervenções e resultados exigem ligação à cadeia anterior.
- Uma correção cria uma revisão e marca a versão anterior como `superseded`. Arquivar não apaga o histórico.

## IndexedDB v4

Stores novas:

- `teams`: perfil estável da equipa.
- `game_models`: modelo de jogo e respetiva vigência.
- `memory_items`: memória classificada, proveniência, referências e relações.

Na migração, jogadores, treinos e jogos existentes recebem `team_id: "default"`. O upgrade ocorre numa única transação IndexedDB.

## API interna

```text
HeadCoachMemory.list(teamId, filters)
HeadCoachMemory.get(id)
HeadCoachMemory.create(record)
HeadCoachMemory.revise(id, changes)
HeadCoachMemory.archive(id)
HeadCoachMemory.buildContext(teamId, options)
```

`buildContext()` devolve `head-coach-context@1`, com equipa, modelo de jogo, memória ativa e eventos recentes. Não inclui chaves de API.

## Importação privada

O formato é `treinador-team-memory@1`. A importação valida o pacote antes da primeira escrita e faz merge por `external_key`; não substitui o backup atual.

Ficheiros `*.private.json` são ignorados pelo Git. Dados reais de menores nunca devem ser adicionados ao repositório, fixtures ou screenshots de testes.

## Verificação

```text
npm run check
npm test
npm run test:e2e
```

Os testes end-to-end cobrem a migração v3→v4, criação/revisão, histórico, funcionamento offline e importação sintética.
