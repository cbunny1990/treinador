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

## Chat contextual (Fase 3)

O chat usa uma abstração de provider, atualmente ligada ao OpenRouter, e só envia o contexto relevante depois de consentimento explícito no formulário. Fotografias, cópias de segurança completas e a chave da API não fazem parte do contexto enviado.

As respostas têm uma estrutura validada: factos, observações, hipóteses, diagnósticos, incertezas, perguntas e recomendações. IDs de evidência que não existam no contexto são removidos; factos ou diagnósticos sem evidência válida passam a hipóteses. Uma recomendação aceite ou alterada torna-se uma decisão na memória. Uma recomendação rejeitada fica apenas registada no histórico da conversa.

Conversas e mensagens são guardadas localmente em IndexedDB e continuam legíveis offline. Fazer uma nova pergunta exige internet e uma chave OpenRouter configurada em **Dados → IA**.

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

## Dashboard Head Coach (Fase 2)

O dashboard é construído localmente por `HeadCoachDashboard.load()` e apresenta:

- estado atual e modelo de jogo;
- três prioridades, distinguindo prioridades confirmadas de sugestões baseadas em evidência;
- próximo treino, exercícios, aspetos a observar e forma de medição;
- último jogo e comparação simples com o anterior;
- jogadores com observações, hipóteses ou diagnósticos recentes;
- resultados medidos e últimas observações.

Uma prioridade só é considerada confirmada quando o treinador seleciona Prioridade 1, 2 ou 3 no registo de memória. Na ausência dessa decisão, o dashboard pode mostrar observações coletivas como sugestões claramente identificadas — nunca como factos ou diagnósticos automáticos.
