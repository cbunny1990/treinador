# Publicar imagens aprovadas no Vision Coach

## Objetivo e pré-condições
Uma imagem original por exercício, na Biblioteca e na Consulta do treino, sem conversão e sem duplicar dados.
O servidor MCP utiliza o conector já autorizado. São necessários os scopes `read`, `write` e `media` para publicar, e acesso aos bytes originais.
O ficheiro pode estar no ambiente da IA (`/mnt/data/...`), no PC autorizado ou noutro ambiente com acesso binário HTTP.
Não é necessário guardar um ZIP no PC quando a IA já consegue ler o original e enviar um pedido HTTP.
Uma IA sem acesso ao ficheiro ou sem capacidade de envio binário não pode transferi-lo por um simples nome/ID de anexo: deve identificar a limitação concreta, não voltar a gerar a imagem.

## Via MCP: sem entregar o token do conector ao terminal
1. Obter o ficheiro real aprovado. Medir SHA-256, tamanho e dimensões sem o alterar.
2. `get_exercise_image` com **um** `id` remoto UUID ou `external_key` exato. Guardar `updated_at`.
3. `prepare_exercise_image_upload`: mesmo identificador, `approved: true`, `expected_updated_at`, `file_name`, `mime_type`, `size_bytes`, `width`, `height`, `sha256`.
4. Quando `already_linked: true`, verificar a referência e os bytes existentes; não repetir o upload.
5. Caso contrário, fazer **PUT binário** dos bytes originais para `upload_url`, com os `headers` devolvidos. Não enviar JSON, multipart nem base64. Não adicionar o token MCP ao pedido de Storage.
6. `complete_exercise_image_upload` com o `ticket`. Só esta chamada verifica os bytes no servidor e atualiza o exercício existente.
7. `get_exercise_image` com `download: true`; ler o URL temporário e comparar o SHA-256. Não apresentar esse URL ao utilizador.
8. Abrir Biblioteca/Consulta numa sessão da equipa, confirmar o exercício e usar “Ampliar / tamanho original”. Distinguir validação do servidor, teste de navegador e observação em equipamento real.

O ticket de associação é válido durante 30 minutos. A capacidade de upload do Storage tem validade própria de duas horas, mas não permite concluir uma associação com um ticket expirado.
Após uma expiração, repetir a preparação; não alterar manualmente o caminho ou o conteúdo do ticket.
O servidor não procura imagens por nome nem vai buscar URLs arbitrários: só lê o objeto privado que ele próprio autorizou.

## Via CLI: um comando para um ficheiro ou um lote
Requer Node.js 22 ou superior; não tem dependências adicionais. A credencial vem de `VISION_COACH_TOKEN`, provisionada no ambiente seguro do agente — nunca da linha de comando ou de um ficheiro versionado.
`VISION_COACH_MCP_URL` é opcional; o valor padrão aponta para a ligação Vision Coach deste projeto.

```sh
npm run images:publish -- --file /mnt/data/original.png --exercise UUID_REMOTO --approved
npm run images:publish -- --manifest approved-images.json --dry-run
npm run images:publish -- --manifest approved-images.json
```

O manifesto é relativo à pasta onde se encontra, não à diretoria corrente:
```json
{"images":[{"file":"original.png","external_key":"chave-exata-do-exercicio","approved":true,"sha256":"SHA256_OPCIONAL_DO_ORIGINAL_APROVADO"}]}
```

O modo `--dry-run` não requer credenciais e não efetua alterações. Confirma apenas ficheiros, mapeamento e metadados locais.
O modo de publicação lê todos os destinos antes de começar, envia os ficheiros individualmente, associa e volta a descarregar para confirmar os bytes.
O resultado JSON inclui sucesso/erro por imagem, dimensões, SHA-256 e se já estava associada; não inclui credenciais ou URLs assinados.
Um lote não é uma transação única: uma falha pode deixar imagens anteriores concluídas. Repetir o mesmo lote é seguro para os ficheiros já associados e não cria novos exercícios.

## Formatos e privacidade
PNG, JPEG e WebP; máximo 16 MiB e 60 milhões de píxeis por imagem. SVG e ficheiros incompletos são recusados.
Não há redução, compressão, recorte, ampliação artificial nem mudança de proporção. O SHA-256 do original é verificado no servidor.
Os novos ficheiros ficam no bucket **privado** `team-media`, com caminho exclusivo por equipa, exercício e upload; `upsert` está desativado.
O registo guarda `visual_storage_path`, `visual_storage_bucket` e `visual_image` (incluindo dimensões, SHA-256 e bytes); nunca guarda o URL assinado.
O browser cria URLs temporários com a sessão autorizada, verifica o hash e pode guardar os bytes originais para consulta offline, separados por utilizador/equipa. A saída da conta limpa esta cache privada.
As cinco imagens previamente publicadas como assets permanecem intactas. As novas imagens não requerem commits nem uma nova versão da PWA.

## Conflitos, remoção e auditoria
Uma alteração concorrente ao exercício interrompe a associação (`record_conflict_read_again` / `record_conflict`); reler e reconciliar, nunca forçar overwrite.
Um exercício apagado não pode ser recriado pelo upload. Um identificador ambíguo é recusado.
`remove_exercise_image` exige versão atual e `confirmed: true`; remove a associação visual, não o exercício nem o histórico. Os bytes antigos não são purgados automaticamente.
O fluxo usa `head_coach_put_record` com controlo de versão, idempotência e autoria do agente. Um upload que nunca seja concluído pode deixar um objeto privado sem associação; não é exibido na app.

## Testes e manutenção
`npm run check`; `npm test`; `npx playwright test tests/e2e/image_workflow.spec.js`.
Os testes cobrem SHA-256, identificação exata, aprovação, scopes, tickets adulterados/expirados, equipa errada, conflitos, repetição, remoção e visualização privada.
A implementação do servidor está em `supabase/functions/vision-coach-mcp/image_uploads.mjs`, incluída no MCP principal.
A implantação deve preservar as operações já ativas (incluindo gestão do plantel), autenticação própria e versões fixas das dependências.
Para uma IA que tenha uma lista de ferramentas antiga, renovar `tools/list`/reabrir a ligação; não criar outro servidor ou outro token sem necessidade.

## Documentação Supabase verificada na implementação
- https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
- https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl
- https://supabase.com/docs/reference/javascript/file-buckets-createsignedurls

## Verificação desta entrega — 22/09/2026
- 80 testes unitários passaram, incluindo 12 testes específicos do novo percurso.
- 3 testes de navegador passaram: vistas de 390 px e 1440 px, cache offline, ampliação original, limpeza da cache e recusa de equipa errada. São testes em navegador, não observação nos aparelhos físicos do treinador.
- O servidor de pré-validação efetuou um envio binário real para o Supabase, associou-o a um exercício temporário e voltou a descarregar exatamente os 1 754 859 bytes do PNG original de 1448 × 1086.
- O SHA-256 foi igual antes e depois; repetir a operação devolveu `already_linked` sem criar outro exercício ou substituir bytes.
- Acesso sem autenticação devolveu 401. O conector temporário de teste tem expiração e será revogado após a confirmação em produção.
- Não foram alteradas as cinco imagens aprovadas do treino. A suíte geral de navegador tinha falhas anteriores a esta entrega; não se declara toda a aplicação isenta de erros.
- O advisor do Supabase não indicou problemas de RLS nesta entrega; continua o aviso de configuração anterior sobre proteção de passwords comprometidas. Essa configuração de Auth não foi alterada.

O deploy desta versão utiliza um import HTTPS de código deste repositório fixo num SHA de commit revisto, nunca numa branch mutável. A fonte completa e as dependências relativas ficam nesse commit, mesmo quando `get_edge_function` mostra apenas o pequeno entrypoint de import. A CLI Supabase também pode publicar diretamente a pasta `supabase/functions/vision-coach-mcp`, respeitando a autenticação própria já existente.
