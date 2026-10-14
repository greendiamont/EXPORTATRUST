# Cópia integral da produção para a homologação (Railway)

Objetivo: trazer **todos** os dados do ExportaTrust de produção (ChatGPT Sites/Cloudflare) para o
projeto Railway **ExportaTrust Homologation**, sem alterar nada na produção.

- Banco: as 43 tabelas do app (`/api/admin/migration-full-export`), com SHA-256 e contagens.
- Arquivos: todos os objetos do R2 (`/api/admin/migration-r2-export`), em um `.tar` com manifesto.
- Produção só é **lida**. As rotas de importação recusam `APP_ENV=production`.

## Pré-requisitos

1. Homologação publicada com este fluxo (CHG-20261014-006).
2. Banco de homologação **vazio**: no máximo 1 usuário (o seu primeiro login) e os registros automáticos
   do primeiro acesso (backup diário e auditoria). Não cadastre nada antes de importar.
3. O seu e-mail de login em homologação precisa estar em `EXPORTATRUST_ALLOWED_EMAILS`.

## Passo a passo

### Na produção (ChatGPT Sites) — somente leitura
Logado com uma conta que tenha permissão de exportação (perfis administrador, analista, auditor ou cliente):

1. Abra `<URL da produção>/api/admin/migration-full-export` → salve o JSON (`exportatrust-full-d1-AAAA-MM-DD.json`).
2. Abra `<URL da produção>/api/admin/migration-r2-export?mode=download` → salve o `.tar`.

### Na homologação
3. Entre em https://web-api-production-a92f.up.railway.app com o seu e-mail e a senha de acesso.
4. Abra `/api/admin/migration-full-import` → selecione o JSON → **Validar** → **Importar**.
   O resultado mostra `expectedTotalRows` = `actualTotalRows`, `mismatches: []`,
   `operatorAccess` (você continua administrador) e `coercions` (valores ajustados, ver abaixo).
5. Abra `/api/admin/migration-r2-import` → selecione o `.tar` → **Validar TAR** → **Importar arquivos** →
   **Validar destino**. O resultado precisa ter `missing: []` e `sizeMismatches: []`.
6. Salve os dois JSONs de resultado como evidência e registre no `CHANGELOG.md`.

## O que a importação faz além de copiar

- **Usuários:** a cópia traz os usuários e perfis da produção. Quem executou a importação é mantido como
  `administrador` da organização 1 (na produção o perfil de origem pode ser outro, ex.: `cliente`).
- **Valores incompatíveis:** o SQLite aceita texto em coluna numérica (ex.: `""` em `importer_client_id`);
  o PostgreSQL não. Esses valores viram `null` (coluna opcional) ou `0` (coluna obrigatória) e cada ajuste
  aparece em `coercions` no resultado.
- **Sequências de id:** ressincronizadas automaticamente após inserções com id explícito.
- **Repetição:** a importação de arquivos é idempotente (objetos iguais são ignorados). A do banco exige
  destino vazio; para repetir, peça a recriação do banco de homologação.

## Validado em 2026-10-14 (local, PostgreSQL 16)

- Banco: exportação gerada pelo próprio app → importação em banco vazio: 218/218 registros, 0 divergências,
  1 valor ajustado registrado, operador `cliente` → `administrador`, novos cadastros sem colisão de id.
- Arquivos: pacote real `exportatrust-full-r2-2026-09-29.tar` (release `phase5-r2-source`):
  451/451 objetos e 155.513.309/155.513.309 bytes no destino.
