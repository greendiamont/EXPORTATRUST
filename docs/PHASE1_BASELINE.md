# Migração Fase 1 — Baseline e Inventário

## Baseline congelado

- Repositório: `greendiamont/EXPORTATRUST`
- Branch: `main`
- Commit baseline: `fbfd2f5b99cf9112ef5ea11c9265f01d5bde587b`
- Data da fotografia: 2026-09-21
- Produção de referência: ChatGPT Sites / Cloudflare
- D1 binding atual: `DB`
- R2 binding atual: `BUCKET`

Este commit é a referência funcional antes do início da migração externa.

## Regra de segurança da Fase 1

A Fase 1 é somente leitura.

Não é permitido:
- excluir registros;
- renomear ou remover tabelas;
- apagar objetos R2;
- alterar object keys;
- reescrever documentos;
- migrar produção por cima do ambiente atual.

## Inventário administrativo

Foi criada a rota:

`GET /api/admin/migration-inventory`

Permissão exigida: `export` (perfil autorizado a exportar os dados da organização).

A rota:
- lista as tabelas SQLite/D1;
- conta registros por tabela;
- calcula total de linhas;
- conta objetos R2;
- soma bytes armazenados;
- agrupa objetos pelo primeiro prefixo;
- retorna uma amostra limitada de chaves para conferência;
- não executa INSERT, UPDATE, DELETE, DROP ou PUT.

## Checklist da fotografia

Após publicar esta rota no ambiente atual, salvar o JSON retornado como evidência do baseline e conferir, no mínimo:

- organizations
- app_users
- organization_memberships
- suppliers
- importer_clients
- master_products
- operations
- rural_properties
- operation_documents
- forest_documents
- operation_partners
- export_control_settings
- export_milestones
- operation_tasks / tarefas equivalentes
- shipment_advices
- audit_logs
- backup_snapshots

Para R2, conferir:
- total de objetos;
- total de bytes;
- prefixos `organizations/` e outros existentes;
- amostra de chaves de documentos.

## Critério de conclusão da Fase 1

A Fase 1 só será considerada concluída quando tivermos:

1. baseline commit registrado;
2. inventário D1 salvo;
3. inventário R2 salvo;
4. contagens críticas revisadas;
5. procedimento de export/backup documentado;
6. nenhuma alteração destrutiva realizada.


## Diagnóstico de compatibilidade D1 no ChatGPT Sites

O inventário não deve depender de introspecção de catálogo (`sqlite_schema`, `sqlite_master` ou `PRAGMA table_list`) no runtime gerenciado.

Embora o D1 padrão documente essas consultas, o ambiente hospedado pode aplicar controles adicionais e retornar `SQLITE_AUTH`.

A versão 3 do inventário usa uma allowlist derivada de `db/schema.ts` e executa somente `SELECT COUNT(*)` contra tabelas conhecidas do ExportaTrust.

Falhas são isoladas:
- uma tabela ausente/protegida vira `missing-or-unreadable`;
- falha no D1 não impede o bloco R2 de responder;
- falha no R2 não impede o bloco D1 de responder;
- nenhuma introspecção de tabelas internas do Cloudflare é executada.

Isto mantém o endpoint estritamente somente leitura e compatível com o objetivo da Fase 1.
