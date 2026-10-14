# ExportaTrust — Change Log

> Registro append-only. Não apagar entradas anteriores.

## 2026-10-14 — ChatGPT / Jarvis — Base de controle multiagente

- **ID:** CHG-20261014-001
- **Branch:** `docs/change-control-registry`
- **PR:** a preencher
- **Destino:** main + sincronização com homologation
- **Tipo:** docs / governança
- **Arquivos/módulos alterados:** `AGENTS.md`, `CLAUDE.md`, `docs/change-control/*`
- **Motivo:** impedir sobrescritas e manter ChatGPT, Codex e Claude sincronizados.
- **O que mudou:** criada base canônica com estado atual, changelog append-only, template e índice machine-readable.
- **Impacto esperado:** todo agente passa a consultar e registrar mudanças antes/depois de editar o projeto.
- **Riscos:** baixo.
- **Dados/migração:** nenhuma.
- **Compatibilidade:** sem impacto funcional.
- **Testes executados:** documental.
- **CI:** pendente.
- **Railway homologation:** sem mudança de runtime.
- **Railway production:** sem mudança de runtime.
- **Rollback:** remover apenas estes arquivos de governança, se necessário.
- **Conflitos/coordenação com outros agentes:** este registro passa a ser a referência principal.
- **Status:** em andamento


## 2026-10-14 — ChatGPT / Jarvis — Agentes separados no Railway

- **ID:** CHG-20261014-002
- **Branch:** `docs/railway-agent-separation`
- **PR:** a preencher
- **Destino:** main + sincronização com homologation
- **Tipo:** infra
- **Arquivos/módulos alterados:** documentação de change control
- **Motivo:** separar operacionalmente o agente de homologação do agente de produção.
- **O que mudou:** criado serviço `agent-homologation` no projeto Railway de homologação e `agent-production` no projeto Railway de produção. Cada serviço possui variáveis próprias de ambiente, branch alvo e política de aprovação.
- **Impacto esperado:** homologação e produção passam a ter agentes independentes, reduzindo risco de ações cruzadas.
- **Riscos:** baixo; os serviços de agente estão sem source/deploy nesta etapa.
- **Dados/migração:** nenhuma.
- **Compatibilidade:** sem impacto funcional no app atual.
- **Testes executados:** verificação de criação dos serviços e variáveis no Railway.
- **CI:** pendente.
- **Railway homologation:** `agent-homologation`, APP_ENV=homologation, TARGET_BRANCH=homologation.
- **Railway production:** `agent-production`, APP_ENV=production, TARGET_BRANCH=main, REQUIRE_HUMAN_APPROVAL=true, ALLOW_DIRECT_PRODUCTION_CHANGES=false.
- **Rollback:** remover apenas os serviços de agente se a arquitetura for abandonada; não afeta banco/app.
- **Conflitos/coordenação com outros agentes:** agentes devem consultar CURRENT_STATE/CHANGELOG antes de qualquer alteração.
- **Status:** em andamento


## 2026-10-14 — ChatGPT / Jarvis — Runtime dos agentes Railway

- **ID:** CHG-20261014-003
- **Branch:** `infra/agent-runtime-online`
- **PR:** a preencher
- **Destino:** homologation primeiro
- **Tipo:** infra
- **O que mudou:** criado runtime Node mínimo para manter `agent-homologation` e `agent-production` online, com endpoints de saúde/status e trava explícita de execução em produção.
- **Impacto esperado:** serviços deixam de ficar offline e passam a expor health/status independentes.
- **Riscos:** baixo; o runtime não executa mutações de negócio em produção.
- **Railway homologation:** será conectado à branch `homologation`.
- **Railway production:** será promovido somente após homologação e aprovação explícita.
- **Status:** em andamento


## 2026-10-14 — Claude — Runtime Web/API do app no Railway (PostgreSQL + storage S3 + login)

- **ID:** CHG-20261014-004
- **Branch:** `claude/railway-homologation-runtime`
- **PR:** #84
- **Destino:** homologation
- **Tipo:** infra / migration / security
- **Arquivos/módulos alterados:** `server/railway/*` (novo), `scripts/railway-build.sh` (novo), `package.json`/`package-lock.json` (scripts `build:railway`/`start:railway`, dependências `pg` e `aws4fetch`), `docs/RAILWAY_RUNTIME.md` (novo), docs de change control. Nenhum arquivo de `app/`, `lib/`, `db/` ou `worker/` foi alterado.
- **Motivo:** no Railway o `web-api` de homologação subia com `vinext start`, mas todas as APIs falhavam (`cloudflare:workers` inexistente em Node) e a autenticação dependia de cabeçalhos do ChatGPT/Cloudflare que, fora dessas plataformas, qualquer cliente poderia falsificar.
- **O que mudou:**
  - servidor Node próprio que executa o mesmo build do vinext e fornece `cloudflare:workers` com `env.DB` (API D1 sobre PostgreSQL, com tradução SQLite→PostgreSQL) e `env.BUCKET` (API R2 sobre storage S3);
  - migrações `drizzle/*.sql` aplicadas no PostgreSQL na inicialização, na mesma ordem do wrangler, com controle em `_exportatrust_pg_migrations`;
  - login de homologação (e-mail autorizado + senha de acesso, cookie HMAC) e remoção de cabeçalhos de identidade vindos do cliente;
  - correção das fontes Geist (404) no build do Railway.
- **Impacto esperado:** homologação funcional de ponta a ponta no Railway (páginas, APIs, documentos) com banco e storage isolados.
- **Riscos:** moderado. A tradução SQL cobre os padrões usados hoje; SQL novo com recursos específicos do SQLite pode exigir ajuste em `sql-translate.mjs`. Uploads são bufferizados em memória antes do envio ao S3.
- **Dados/migração:** banco PostgreSQL de homologação recebe o schema completo (29 migrações, 43 tabelas) vazio. Nenhum dado de produção foi lido, copiado ou alterado. Importação D1→PostgreSQL continua pendente e depende de autorização.
- **Compatibilidade:** build e comportamento no ChatGPT Sites/Cloudflare inalterados (nenhum código de app alterado; `pg`/`aws4fetch` só são usados por `server/railway`).
- **Testes executados:** 29 migrações aplicadas em PostgreSQL 16 limpo e reaplicação idempotente; schema comparado com `db/schema.ts` (43/43 tabelas); `tests/agent-e2e.mjs` (com CNPJ válido) passou contra o servidor Railway local em PostgreSQL — fornecedor, operação, propriedade, upload de documento, job de agente, ledger e dossiê PDF; varredura de todas as rotas GET autenticadas sem erro de SQL; testes de login (senha errada, e-mail não autorizado, cabeçalho `oai-*`/`x-exportatrust-*` falsificado, host `localhost`); `node --test tests/*.test.mjs` 49/49; eslint sem erros.
- **CI:** não há CI configurado para este fluxo.
- **Railway homologation:** projeto `ExportaTrust Homologation`: criado bucket `documents-homologation` (sjc); `web-api` recebeu variáveis `STORAGE_S3_*` (referências ao bucket), `EXPORTATRUST_ALLOWED_EMAILS`, `EXPORTATRUST_ACCESS_PASSWORD`, `EXPORTATRUST_SESSION_SECRET`, `VINEXT_TRUST_PROXY=1`, `RAILPACK_NODE_VERSION=22`. Após o merge em `homologation`: build `npm run build:railway`, start `npm run start:railway`, healthcheck `/api/health` (configurar no serviço e redeployar).
- **Railway production:** sem alteração.
- **Rollback:** no `web-api` de homologação, voltar build/start para o padrão (`npm run build` / `npm start`) e remover o healthcheck; reverter o merge deste PR. O bucket e as variáveis podem permanecer sem efeito.
- **Conflitos/coordenação com outros agentes:** nenhum conflito. Branch criada sobre `3a8d82d` (CHG-20261014-003, runtime dos agentes), que não foi alterado. `services/agent-runtime` e `agent-homologation` intocados.
- **Status:** em andamento


## 2026-10-14 — Claude — Validação do runtime Railway em homologação (complemento de CHG-20261014-004)

- **ID:** CHG-20261014-004 (atualização de status)
- **Status:** homologado — PR #84 mergeado em `homologation` (`bdd2081`); deploy `deea28ef` no Railway com build `npm run build:railway` (Node 22), 29 migrações aplicadas no PostgreSQL de homologação, autoteste do bucket `documents-homologation` OK e healthcheck `/api/health` aprovado.


## 2026-10-14 — Claude — Correções: aplicabilidade EUDR, 401/403 nas APIs, e2e; parecer funcional

- **ID:** CHG-20261014-005
- **Branch:** `claude/fixes-eudr-auth-review`
- **PR:** a preencher
- **Destino:** homologation
- **Tipo:** fix / security / docs
- **Arquivos/módulos alterados:** `lib/export-control.ts`; `app/api/agent-control/route.ts`, `app/api/agent-discovery/route.ts`, `app/api/documents/route.ts`, `app/api/eudr-report/route.ts`, `app/api/exception-actions/route.ts`, `app/api/export-control/route.ts`, `app/api/forest-documents/route.ts`, `app/api/forest-dossier/route.ts`, `app/api/industrial-plan/route.ts`, `app/api/integrations/route.ts`, `app/api/operations/route.ts`, `app/api/partners/route.ts`, `app/api/payments/route.ts`, `app/api/product-catalog/route.ts`, `app/api/properties/route.ts`, `app/api/satellite-map/route.ts`, `app/api/shipment-advice/route.ts`, `app/api/stage-settings/route.ts`, `app/api/suppliers/route.ts`; `tests/agent-e2e.mjs`; `tests/eudr-applicability.test.mjs` (novo); `docs/reviews/FUNCTIONAL_REVIEW_2026-10-14.md` (novo); docs de change control.
- **Motivo:** varredura funcional encontrou (1) EUDR desligado para destinos da UE escritos em inglês ou ISO ("Italy", "DE") e para 6 das 7 commodities, liberando aprovação de embarque sem DDS; (2) detecção de madeira por `includes("44")`; (3) palavra-chave `ht` (NIMF 15) casando com "weight"/"freight"; (4) 37 blocos `catch` em 19 rotas devolvendo 500 em vez de 401/403; (5) teste e2e com CNPJ inválido.
- **O que mudou:** países da UE em PT/EN/ISO; commodities EUDR do Anexo I por prefixo do SH, com palavras-chave de produto como reserva; `isWoodProduct` por capítulo 44; correspondência por palavra inteira para termos curtos; `catch` que respondem 500 agora devolvem o `Response` de autenticação; e2e gera CNPJ válido; parecer funcional documentado.
- **Impacto esperado:** processos para a UE passam a exigir EUDR corretamente — **operações já existentes com destino em inglês voltam a ter a etapa "Origem e compliance EUDR" ativa e a aprovação de embarque passa a exigir prontidão EUDR**. APIs respondem 401/403 corretos.
- **Riscos:** baixo/moderado. Comportamento mais restritivo para destinos UE antes não reconhecidos (intencional). Produtos não-EUDR com palavras como "papel" ou "couro" no nome podem passar a exigir EUDR (conservador).
- **Dados/migração:** nenhuma migração; status da etapa EUDR é recalculado ao abrir o processo.
- **Compatibilidade:** ChatGPT Sites/Cloudflare e Railway.
- **Testes executados:** `node --test tests/*.test.mjs` 56/56 (7 novos de aplicabilidade EUDR e palavras-chave); `tests/agent-e2e.mjs` original passou contra o runtime Railway local em PostgreSQL; 401 verificado em 7 rotas sem login; operação com destino "Italy" passou de "Suspenso" para "Em andamento" na etapa EUDR; `tsc` sem erros novos (88 pré-existentes); eslint sem erros.
- **CI:** não configurado.
- **Railway homologation:** deploy automático após merge.
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge deste PR.
- **Conflitos/coordenação com outros agentes:** nenhum; branch criada de `homologation` @ `bdd2081`.
- **Status:** em andamento
