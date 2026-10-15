# Login individual — continuação do PR #87

Data: 2026-10-15 · Codex/Jarvis · branch `codex/individual-login` · PR #88.

## Estado e dependência

Implementação proposta, **não publicada nem homologada no Railway**. Branch criada
do commit `b1ae21f02491f85cda3039df9bf0a8f567ba2053` de `claude/redesign-etapa1`, pois
o PR #87 ainda não estava integrado em `homologation` no início. Ivam autorizou
publicar somente em homologação para testes; o #87 foi integrado em `0bbaff14`.
A branch remota deste trabalho parte desse merge e preserva o trabalho do Claude.
`main` e produção não foram alterados.

## Comportamento

- Mantém o bootstrap atual (`EXPORTATRUST_ALLOWED_EMAILS`,
  `EXPORTATRUST_ACCESS_PASSWORD`, `EXPORTATRUST_SESSION_SECRET`). Essas variáveis
  continuam obrigatórias; nenhuma foi alterada por este trabalho.
- O bootstrap só inicia uma instalação sem vínculos ou acessa uma pessoa com
  usuário/vínculo/empresa ativos. O acesso da pessoa não é recriado automaticamente.
- Membros ativos podem acessar com senha individual mesmo fora da allowlist do
  bootstrap. Hash `scrypt` assíncrono, salt aleatório de 16 bytes, sem senha em texto.
- `Cadastros → Equipe → Gerar link de senha`: administrador da empresa atual gera
  link apenas para membro ativo da mesma empresa. Não envia e-mail automaticamente.
- Link de uso único, válido por 72 horas. Só SHA-256 do token é armazenado.
  Novo link invalida links anteriores da pessoa. Consumo e gravação da senha
  usam uma transação com bloqueio do usuário; duas requisições não consomem o mesmo link.
- `/__auth/definir-senha`: confirmação da senha (mínimo 10 caracteres, máximo
  1024 bytes), feedback de erro e retorno ao login sem token na URL após sucesso.
- Sessões individuais incluem uma versão aleatória. Nova senha revoga sessões
  individuais anteriores; inativação do usuário/vínculo/empresa é revalidada em
  **cada request** (mais restritivo que o cache de 60 s previsto no plano).
- Sessões antigas do bootstrap continuam regidas pela allowlist e pelo vínculo;
  definir senha individual não desativa a senha compartilhada de bootstrap.
- POSTs de autenticação exigem `Origin` da própria aplicação. Páginas de senha
  têm `no-store`, `no-referrer`, proteção contra iframe e CSP restrita.
- Links privados ficam apenas no estado da tela (não localStorage). Copiar exige
  ação do operador; botão Ocultar remove o link da tela.
- No Cloudflare/Sites, sem endpoint de capabilities, o botão fica oculto.

## Dados e backups

Inicialização do runtime Railway cria somente duas tabelas adicionais:

- `railway_user_credentials`: email, password_hash, session_version, updated_at;
- `railway_password_tokens`: token_hash, email, organization_id, expires_at,
  used_at, created_by, created_at.

Não modifica tabelas de negócio, D1, R2 nem o bucket S3. Os campos extras
`session_version` e `organization_id` permitem revogar sessões e limitar o convite
à empresa que o emitiu. O schema Drizzle/Cloudflare permanece inalterado.

Essas tabelas **não fazem parte do exportador de migração D1**, que tem lista
explícita de tabelas. Backups/restauração do PostgreSQL precisam preservá-las
também (backup privado integral do banco). Nunca publique hashes, tokens, links
de senha ou backups em logs, PRs ou releases públicas.

## Validação local

- `npm ci --ignore-scripts --no-audit --no-fund`;
- `npm run build:railway`: passou;
- `node --experimental-strip-types --test tests/*.test.mjs`: testes unitários;
- Para incluir a integração com PostgreSQL embarcado (PGlite), instalar o
  pacote **somente num diretório temporário**, fora das dependências do app, e rodar:

  ```sh
  AUTH_TEST_PGLITE_MODULE=/caminho/absoluto/node_modules/@electric-sql/pglite/dist/index.js \
    node --experimental-strip-types --test tests/*.test.mjs
  ```

- Com PGlite: 63/63 testes, sem skips. Inclui replay concorrente, expiração,
  invalidação de links, hash aleatório, senha incorreta, revogação e isolamento.
- Smoke HTTP do servidor compilado sem banco: login bootstrap, CSRF, capabilities,
  rota privada e falha segura sem DB. Não equivale a teste completo no Railway.
- ESLint dos cinco arquivos de implementação/teste: sem erros.
- TypeScript: 89 erros no projeto, nenhum em `app/ui/equipe-view.tsx`; baseline documentado no PR #87 também é 89. Não tratar o typecheck global como aprovado.

## Antes de aprovar em homologação

1. Integrar o PR #87 somente com autorização do Ivam; atualizar esta branch sem
   descartar commits do Claude. Revisar os diffs antes do merge deste trabalho.
2. Aprovar e integrar este trabalho em `homologation`, nunca direto em `main`.
3. Verificar o deploy Railway, healthcheck e criação idempotente das duas tabelas.
4. Com administrador de teste: convidar membro ativo, gerar link, definir senha,
   acessar e confirmar o perfil correto. Testar móvel e desktop.
5. Testar link repetido/expirado, membro de outra empresa, usuário inativo,
   administrador removido e revogação da sessão depois de redefinir a senha.
6. Confirmar que Cloudflare/Sites e o app clássico continuam funcionando.
7. Antes do cutover final: validar migração dos dados, backups privados de
   credenciais, rate limiting distribuído (o atual é por IP/processo), auditoria
   operacional dos eventos de senha e modelo final de autenticação de produção.

Rollback de código: reverter apenas o PR; preservar as tabelas e os dados. Não
apagar credenciais para desfazer deploy. Produção só muda com “pode produzir”.
