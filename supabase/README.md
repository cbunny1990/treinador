# Ligar o Vision Coach ao Supabase

A aplicação continua a funcionar offline com IndexedDB, mas o deployment oficial já está ligado ao projeto remoto **Vision Coach**, alojado em Londres (`eu-west-2`).

## 1. Estado do projeto oficial

O projeto Supabase de produção já existe e as migrations em `supabase/migrations/` foram aplicadas. Para criar outro ambiente do zero, aplicar as migrations pela ordem do nome do ficheiro.

As migrations criam e protegem:
- equipas e membros;
- registos partilhados;
- media;
- activity log;
- autorizações futuras do agente;
- RLS;
- bucket privado `team-media`.

## 2. Configurar Auth

Em Authentication, configurar a URL pública da app como Site URL:

`https://cbunny1990.github.io/treinador/`

Adicionar também a URL de retorno permitida:

`https://cbunny1990.github.io/treinador/?auth=1`
## 3. Credenciais do frontend

O deployment oficial já inclui:
- Project URL;
- Publishable key.

São valores públicos próprios para frontend. Nunca colocar na app:
- secret key;
- service-role key;
- password da base de dados.

O acesso real aos dados é limitado por Auth + RLS.

## 4. Ativar a conta na app

1. Abrir Vision Coach.
2. Definições e backup.
3. Introduzir o email e escolher “Enviar link de acesso”.
4. Abrir o link recebido no email.
5. Voltar a Definições.
6. Escolher “Criar a partir desta equipa”.
7. Escolher “Sincronizar agora”.

A partir daí a app agenda sincronização automática sempre que existem alterações locais e quando recupera ligação à Internet.

## Media

Com o remoto desligado, ficheiros locais continuam limitados a 5 MB.
Com o remoto ligado, um ficheiro escolhido na app é enviado diretamente para o bucket privado `team-media`.
O browser guarda apenas metadados e uma URL assinada temporária. A URL é renovada nas sincronizações seguintes.

## Conflitos

A sincronização não faz overwrite silencioso quando deteta que a mesma versão foi alterada local e remotamente.

Nesse caso:
- o registo local é mantido;
- o registo remoto é mantido;
- a sincronização reporta o conflito para revisão.

## Agente

A tabela `agent_authorizations` já existe, mas o servidor MCP do agente é uma camada separada.

Nunca entregar a secret key à PWA. O futuro servidor MCP guarda a sua credencial no servidor e só expõe operações autorizadas do workspace.
