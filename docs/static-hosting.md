# Alojamento estático do Vision Coach

O frontend pode ser servido por um alojamento web estático, incluindo um domínio ou subpasta como `/treinador/`. O router usa fragmentos (`#/...`) e os caminhos de HTML, manifest, scripts e service worker são relativos. O E2E `npm run test:e2e:subpath` verifica o arranque e o âmbito PWA em `/treinador/`.

## Ficheiros a publicar

Gerar um pacote local com `npm run build:static` e copiar o conteúdo de `dist/vision-coach/` para a raiz pública do site. O script recusa sobrescrever uma pasta de saída existente e inclui apenas:

- `.htaccess` para Apache, `index.html`, `manifest.webmanifest` e `sw.js`;
- pastas `css/`, `js/`, `vendor/`, `icons/` e `assets/`.

Para escolher outra pasta nova dentro do repositório: `npm run build:static -- --out dist/cbunny-review`.

O pacote local mais recente preparado para revisão é `dist/cbunny-server-review-v200-final/`. Foi gerado da cache PWA v200 e ainda não foi enviado para o alojamento. O E2E em subpasta passou 1/1; os seis ficheiros aprovados de exercícios correspondem byte a byte aos originais (SHA-256). O `main` publicado permanece na v170 e está 147 commits atrás desta branch; a publicação de todo o pacote incluiria esses trabalhos ainda não integrados.

Preservar os nomes, maiúsculas/minúsculas, subpastas e bytes dos ficheiros. As imagens aprovadas dos exercícios são servidas dos originais em `assets/`; não as recomprimir nem substituir.

Não publicar `node_modules/`, `tests/`, repositórios `.git/`, ficheiros locais `.env` ou configurações que contenham credenciais. O frontend continua a obter dados e media privada do Supabase. A chave pública anon/publishable já configurada no frontend é a única chave client-side; chaves `service_role`, tokens MCP e chaves de providers permanecem em secrets do backend.

## Requisitos do servidor

- HTTPS, necessário para service workers e APIs seguras do browser;
- servir `manifest.webmanifest` como `application/manifest+json` e JavaScript como `text/javascript` ou equivalente;
- em alojamento Apache, o pacote inclui `.htaccess` com o MIME do manifest e revalidação de `index.html`, manifest e service worker; em servidores Nginx, configurar os mesmos cabeçalhos no painel do alojamento;
- permitir obter `sw.js` no mesmo domínio e diretório da app;
- não é necessária regra de rewrite do servidor para rotas da app, porque são fragmentos após `#`.

O teste local cobre o caminho `/treinador/`, mas não substitui a validação de configuração, HTTPS, cabeçalhos, limites de upload ou políticas da conta cbunny. O alojamento e a publicação só podem ser preparados para produção depois de conhecidos o domínio e o método de upload; este documento não publica nem migra dados.

Validação adicional: servi o pacote de revisão num Apache 2.4 isolado, com `AllowOverride All` ativo para reproduzir a leitura de `.htaccess`. `index.html`, manifest e `sw.js` responderam 200; os MIME foram `text/html`, `application/manifest+json` e `text/javascript`; os três receberam `Cache-Control: no-cache, no-store, must-revalidate` e `X-Content-Type-Options: nosniff`. `/assets/` respondeu 403, sem listagem. Um smoke test Chromium abriu a página inicial e Definições em viewport móvel, confirmou manifest e service worker com start URL `/treinador/index.html` e scope `/treinador/`; os pedidos para outros domínios foram bloqueados. Isto valida o pacote em Apache local, não confirma que a conta Cbunny permita `.htaccess`, HTTPS ou os mesmos cabeçalhos.

Revalidação da v198 (26/09/2026): o pacote `dist/cbunny-server-review-v198/` passou `httpd -t` num container Apache 2.4 isolado, servido em `/treinador/`. HTML, manifest e service worker responderam 200 com os MIME e cabeçalhos acima; o service worker servido contém `vision-coach-v198`. A listagem de `assets/` respondeu 403. O container foi parado e removido; nenhum ficheiro foi enviado ao alojamento.
