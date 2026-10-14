# ExportaTrust — Estado Atual

Atualizado em: 2026-10-14

## Fonte de verdade

- Repositório: `greendiamont/EXPORTATRUST`
- Produção: branch `main`
- Homologação: branch `homologation`

## Railway

### Produção
- Projeto: `ExportaTrust`
- Project ID: `74645f02-a85d-4b9a-8244-148784d8b633`
- Serviço DB: PostgreSQL
- Serviço app: `web-api`
- APP_ENV: `production`
- O app ainda não deve ser tratado como cutover final até concluir migração D1 → PostgreSQL e homologação.

### Homologação
- Projeto: `ExportaTrust Homologation`
- Project ID: `f1b37adf-57c3-4cad-9f52-786dd65357ad`
- Serviço DB: PostgreSQL próprio e isolado
- Serviço app: `web-api`
- Source: `greendiamont/EXPORTATRUST`
- Branch: `homologation`
- APP_ENV: `homologation`

## Storage

- Cloudflare R2 permanece como storage de documentos nesta fase.
- Não migrar/remover documentos sem validação e backup.

## Banco atual / migração

- Código legado ainda contém dependência de D1/SQLite e `cloudflare:workers`.
- A migração alvo é PostgreSQL no Railway.
- Nenhum cutover de produção deve ocorrer até:
  - schema PostgreSQL validado;
  - dados migrados e comparados;
  - autenticação validada;
  - documentos R2 testados;
  - homologação aprovada.

## Governança

Toda mudança deve passar por:
`work branch → homologation → validação → main`

Arquivos obrigatórios de coordenação:
- `AGENTS.md`
- `CLAUDE.md`
- `docs/change-control/CHANGELOG.md`
- `docs/AI_COLLABORATION_LOG.md`
