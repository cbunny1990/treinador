# Ligar o Treinador Pro ao Supabase

A aplicação continua a funcionar localmente sem Supabase. Esta configuração ativa a cópia remota partilhada, autenticação e Storage privado.

## 1. Criar o projeto

1. Criar um projeto no Supabase.
2. Abrir o SQL Editor.
3. Executar integralmente:
   `supabase/migrations/001_workspace.sql`

A migração cria:
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
## 3. Obter as credenciais públicas

No projeto Supabase, copiar:
- Project URL;
- Publishable key.

Não usar na app:
- secret key;
- service-role key;
- password da base de dados.

A publishable key pode existir no browser porque o acesso real aos dados é limitado por RLS.

## 4. Ligar na app

1. Abrir Treinador Pro.
2. Definições e backup.
3. Em Backend remoto, preencher Project URL e Publishable key.
4. Guardar.
5. Introduzir o email e escolher “Enviar link de acesso”.
6. Abrir o link recebido no email.
7. Voltar a Definições.
8. Escolher “Criar a partir desta equipa”.
9. Escolher “Sincronizar agora”.

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
