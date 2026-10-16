# Runtime Node do ExportaTrust no Railway

O app foi escrito para Cloudflare Workers (D1 + R2) e continua compilando igual
(`npm run build`). No Railway ele roda em Node através de `server/railway/`, sem
alterar o código das rotas.

## Como funciona

| Peça | Arquivo | Papel |
|---|---|---|
| Servidor HTTP | `server/railway/server.mjs` | Serve `dist/client`, chama o Worker de `dist/server/index.js`, aplica login |
| `cloudflare:workers` | `server/railway/hooks.mjs` + `cloudflare-workers-shim.mjs` | Redireciona o import para um `env` Node |
| `env.DB` | `server/railway/d1-postgres.mjs` | API do D1 (`prepare/bind/first/all/run/raw/batch`) sobre PostgreSQL |
| Tradução SQL | `server/railway/sql-translate.mjs` | SQLite → PostgreSQL (placeholders, DDL, `INSERT OR IGNORE`, `PRAGMA table_info`, `LIKE`, aliases) |
| Migrações | `server/railway/migrate.mjs` | Aplica `drizzle/*.sql` (mesma ordem do wrangler) na inicialização; controle em `_exportatrust_pg_migrations` |
| `env.BUCKET` | `server/railway/r2-s3.mjs` | API do R2 (`get/head/put/delete/list`) sobre storage S3 |
| Login | `server/railway/auth.mjs` | E-mail autorizado + senha de acesso; cookie assinado |

### Regras de conversão SQLite → PostgreSQL

- `integer` vira `bigint` (o SQLite usa inteiros de 64 bits); `integer PRIMARY KEY AUTOINCREMENT` vira `bigserial`.
- `real` vira `double precision`; `CURRENT_TIMESTAMP` gera texto no formato do SQLite (`YYYY-MM-DD HH:MM:SS`, UTC).
- `TRUE`/`FALSE` viram `1`/`0`; `LIKE` vira `ILIKE` (no SQLite o LIKE ignora maiúsculas).
- `null` no `id` de um INSERT vira `DEFAULT`; inserções com `id` explícito ressincronizam a sequência.
- FKs de `CREATE TABLE` nas migrações são aplicadas no fim de cada migração (o SQLite aceita FK para tabela futura).
- Transações interativas (`BEGIN`) não são suportadas, como no D1: use `DB.batch()`, que roda numa transação.

## Segurança do login

- Cabeçalhos de identidade vindos do cliente (`oai-authenticated-*`, `cf-access-*`, `x-exportatrust-authenticated-*`, `x-exportatrust-auth-provider`) são **sempre removidos**. No Railway não existe ChatGPT Sites/Cloudflare Access para garanti-los.
- Com login válido o servidor injeta `x-exportatrust-authenticated-user-email`, já reconhecido por `lib/security.ts`.
- Páginas sem sessão redirecionam para `/__auth/login`. APIs sem sessão seguem sem identidade: rotas protegidas respondem 401 e rotas públicas por desenho (token Bearer dos agentes, `/api/secure-documents`, webhook Stripe, `/api/health`) continuam funcionando.
- Hosts `localhost`/`127.0.0.1`/`terminal.local` não ativam o modo "preview" do app.
- O **primeiro** usuário a entrar num banco vazio vira `administrador` (regra existente em `lib/security.ts`).
- Remover um e-mail de `EXPORTATRUST_ALLOWED_EMAILS` revoga as sessões dele imediatamente.
- Este login é para homologação. Produção deve usar um provedor de identidade (pendência).

## Variáveis do serviço `web-api`

| Variável | Uso |
|---|---|
| `APP_ENV` | `homologation` / `production` |
| `DATABASE_URL` | PostgreSQL do próprio projeto |
| `STORAGE_S3_ENDPOINT`, `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | Bucket de documentos (referências `${{documents-homologation.*}}`) |
| `STORAGE_S3_URL_STYLE` | `virtual` para buckets do Railway; omitir para path-style |
| `EXPORTATRUST_ALLOWED_EMAILS` | E-mails autorizados, separados por vírgula |
| `EXPORTATRUST_ACCESS_PASSWORD` | Senha de acesso (mín. 12 caracteres) |
| `EXPORTATRUST_SESSION_SECRET` | Segredo do cookie (mín. 32 caracteres) |
| `EXPORTATRUST_SESSION_TTL_HOURS` | Opcional, padrão 12 |
| `VINEXT_TRUST_PROXY` | `1` — URLs com `https` atrás do proxy do Railway |
| `RAILPACK_NODE_VERSION` | `22` (o `package.json` exige Node ≥ 22.13) |
| `RUN_MIGRATIONS` | Opcional; `0` desliga as migrações na inicialização |

Integrações (OpenAI, Google/Gmail, ShipsGo, Stripe, `AGENT_API_TOKEN`...) usam as mesmas variáveis de antes e chegam ao app via `env`.

## Configuração do serviço

- Build: `npm run build:railway` (corrige o cache de fontes e roda `npm run build`)
- Start: `npm run start:railway`
- Healthcheck: `/api/health` (verifica banco e storage)

## Rodar localmente

```bash
npm ci
npm run build:railway
DATABASE_URL=postgres://... STORAGE_DRIVER=memory APP_ENV=development \
EXPORTATRUST_ALLOWED_EMAILS=voce@exemplo.com EXPORTATRUST_ACCESS_PASSWORD=uma-senha-longa \
EXPORTATRUST_SESSION_SECRET=$(openssl rand -hex 32) PORT=8080 npm run start:railway
```

`STORAGE_DRIVER=memory` guarda arquivos na memória do processo (perdidos ao reiniciar) e é recusado com `APP_ENV=production`.
