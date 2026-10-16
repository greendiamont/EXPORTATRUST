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
- **PR:** #85
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


## 2026-10-14 — Claude — Cópia integral da produção para a homologação (banco + arquivos)

- **ID:** CHG-20261014-006
- **Branch:** `claude/data-migration-homologation`
- **PR:** #86
- **Destino:** homologation
- **Tipo:** migration / security
- **Arquivos/módulos alterados:** `app/api/admin/migration-full-import/route.ts`, `app/api/admin/migration-r2-import/route.ts`, `server/railway/auth.mjs`, `docs/RAILWAY_RUNTIME.md`, `docs/MIGRATION_PRODUCTION_TO_HOMOLOGATION.md` (novo), docs de change control.
- **Motivo:** Ivam pediu todos os dados do app em homologação. As rotas de importação da Fase 5 só aceitavam `APP_ENV=staging`; o destino é PostgreSQL; e o filtro de cabeçalhos do runtime Railway descartava os metadados enviados pelo importador R2.
- **O que mudou:**
  - importação do banco e dos arquivos liberada para `staging` e `homologation` (produção continua recusada);
  - valores de texto em colunas numéricas (aceitos pelo SQLite) ajustados para `null`/`0`, com cada ajuste listado no resultado;
  - quem executa a importação permanece `administrador` da organização 1 (na produção o Ivam é `cliente`);
  - registros automáticos do primeiro acesso (backup diário e auditoria, até 10) não bloqueiam a importação inicial;
  - runtime Railway remove só cabeçalhos de identidade (`x-exportatrust-authenticated-*`, `x-exportatrust-auth-provider`), preservando `x-exportatrust-http-metadata`/`custom-metadata` do importador R2;
  - roteiro em `docs/MIGRATION_PRODUCTION_TO_HOMOLOGATION.md`.
- **Impacto esperado:** homologação pode receber a cópia completa e atual da produção pelas telas `/api/admin/migration-full-import` e `/api/admin/migration-r2-import`.
- **Riscos:** baixo. Nenhuma escrita na produção. Na homologação, a importação substitui os usuários do destino pelos da produção.
- **Dados/migração:** a cópia em si depende das duas exportações feitas na produção por Ivam (ver roteiro). Nenhum dado de produção foi importado neste PR.
- **Compatibilidade:** ChatGPT Sites/Cloudflare (staging continua aceito) e Railway.
- **Testes executados:** local em PostgreSQL 16 — exportação integral gerada pelo app → importação em banco vazio de homologação: 218/218 registros, 0 divergências, 1 valor ajustado, operador promovido de `cliente` para `administrador`, cadastro posterior sem colisão de id; importação do pacote real `exportatrust-full-r2-2026-09-29.tar` pela tela: 451/451 objetos e 155.513.309 bytes conferidos no destino; cabeçalhos de identidade forjados continuam recusados (401); `node --test` 56/56; eslint sem erros.
- **CI:** não configurado.
- **Railway homologation:** deploy automático após merge; depois, executar o roteiro.
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge deste PR.
- **Conflitos/coordenação com outros agentes:** a correção de JavaScript do importador R2 do PR #72 (fix/r2-import-inline-script-syntax → main) já estava no código de `homologation`; o PR #72 pode ser fechado como já incorporado.
- **Status:** em andamento


## 2026-10-15 — Claude — Redesign etapa 1: novo visual, Painel, Pedidos, Novo processo, Cadastros

- **ID:** CHG-20261015-007
- **Branch:** `claude/redesign-etapa1`
- **PR:** #87
- **Destino:** homologation
- **Tipo:** feature / frontend / migration (aditiva)
- **Arquivos/módulos alterados:** `app/page.tsx` (novo Painel), `app/classico/page.tsx` (app anterior preservado), `app/pedidos/`, `app/novo-processo/`, `app/cadastros/`, `app/ui/*` (novo), `app/api/overview/route.ts` (novo), `lib/order-phases.ts` (novo), `lib/registration-columns.ts` (novo), `app/api/{importer-clients,master-products,suppliers}/route.ts`, `app/client-app.tsx` (abrir `?processo=` e `?module=` de cadastro), `db/schema.ts`, `drizzle/0029_redesign_registration_fields.sql`, `tests/order-phases.test.mjs`, `docs/redesign/*`.
- **Motivo:** redesign aprovado pelo Ivam (protótipo em `docs/redesign/prototipo/`; plano e decisões em `docs/redesign/PLANO_REDESIGN.md`).
- **O que mudou:**
  - nova barra superior e menu: Painel · Pedidos · Cadastros · EUDR · Relatórios;
  - Painel com pedidos por fase (6 fases), pendências com prazo e próximos embarques;
  - Pedidos com filtro por fase, andamento e próximo passo;
  - "+ Novo processo" com o formulário de 6 seções do app antigo, preenchido a partir dos cadastros;
  - Cadastros (Clientes, Fornecedores, Produtos, Florestas, Equipe) com completude, duplicidades, processos relacionados e campos novos;
  - o app anterior continua inteiro em `/classico` (link "Versão anterior").
- **Impacto esperado:** a página inicial passa a ser o Painel novo; todas as funções antigas seguem acessíveis em `/classico`.
- **Riscos:** baixo/moderado (tela inicial muda). As APIs são as mesmas; nenhuma rota antiga removida.
- **Dados/migração:** `0029` só adiciona 6 colunas texto com default `''`; também criadas sob demanda (`ensureRegistrationColumns`). Campos novos só são gravados quando enviados, para o app clássico não apagá-los. Correção: dados bancários do cliente eram descartados ao salvar.
- **Compatibilidade:** ChatGPT Sites/Cloudflare e Railway.
- **Testes executados:** `node --test` 59/59 (3 novos de fases); build Railway OK (rotas `/`, `/pedidos`, `/novo-processo`, `/cadastros`, `/classico`); runtime local em PostgreSQL 16: migration 0029 aplicada; Playwright: criação de processo pelo assistente → redireciona para `/classico?processo=<id>`; edição de cliente (EORI, notify party, dados bancários) e de produto (unidade de venda) persistem sem perder demais campos; todas as telas sem erro de console; eslint sem erros nos arquivos novos; `tsc` 89 erros (baseline 88 — os novos são do mesmo tipo pré-existente: módulo `cloudflare:workers` sem tipos e a cópia da página antiga em `/classico`).
- **CI:** não configurado.
- **Railway homologation:** deploy automático após merge (aplicará a migration 0029).
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge; as colunas novas podem permanecer (aditivas, sem impacto).
- **Conflitos/coordenação com outros agentes:** nenhum; `homologation` em `eb3b526` sem mudanças de outros agentes. PRs #72 e #40 (destino `main`) não foram tocados.
- **Pendências:** login individual no Railway (desenho em `docs/redesign/PLANO_REDESIGN.md`); parceiros logísticos; etapas 2–5 do redesign; cópia dos dados de produção para homologação (precisa do endereço do ChatGPT Sites de produção).
- **Status:** em andamento

## 2026-10-15 — Codex/Jarvis — Continuação do Claude: login individual Railway

- **ID:** CHG-20261015-008
- **Branch:** `codex/individual-login`
- **PR:** #88; continuação do #87 (integrado em homologation, commit `0bbaff14`).
- **Destino:** homologation apenas.
- **Tipo:** feature / security / migration aditiva.
- **Arquivos:** `server/railway/{auth,server,user-credentials}.mjs`, `app/ui/equipe-view.tsx`, `tests/railway-user-auth.test.mjs`, `docs/redesign/{PLANO_REDESIGN,LOGIN_INDIVIDUAL}.md`, registros de coordenação.
- **Motivo:** concluir a pendência de login individual descrita pelo Claude no plano.
- **O que mudou:** senhas individuais com scrypt; links privados de uso único por 72 h emitidos por administrador da empresa atual; proteção CSRF; troca de senha revoga sessões individuais; vínculo ativo revalidado em cada request; botão Gerar link de senha em Equipe somente no Railway.
- **Dados:** cria duas tabelas de autenticação no PostgreSQL durante o startup. Não apaga/substitui dados de negócio ou documentos; D1/R2 não alterados. Backups privados de PostgreSQL devem incluir as tabelas de credenciais.
- **Compatibilidade:** bootstrap mantido, app clássico preservado e autenticação Cloudflare inalterada.
- **Testes:** build Railway passou; 63/63 testes com PostgreSQL embarcado/PGlite (sem skips); smoke HTTP local 8 verificações; ESLint dos arquivos alterados sem erros; TypeScript 89 erros preexistentes, nenhum em `equipe-view.tsx`.
- **Riscos:** autenticação exige validação funcional no Railway. Rate limit continua por IP/processo; auditoria operacional de eventos de senha e modelo final de produção permanecem pendentes (detalhes no roteiro).
- **CI/deploy:** validação local concluída; publicar somente na homologação autorizada, conferir deploy e healthcheck. Testes autenticados reais ainda pendentes.
- **Autorização:** Ivam pediu em 2026-10-15 para deixar tudo em homologação e testar antes de produção; autorização não abrange `main`/produção.
- **Conflitos/coordenação:** branch criada do head exato do #87 (`b1ae21f`), por instrução do Ivam antes do merge. Não alterou a branch do Claude. Revisar/atualizar base antes da integração.
- **Rollback:** reverter só este PR, preservando as tabelas de autenticação e os dados.
- **Status:** em andamento — não homologado funcionalmente.

### 2026-10-15 — Codex/Jarvis — Publicação em homologação (CHG-20261015-008)

- **Autorização:** Ivam pediu publicar tudo em homologação para testar antes de produção.
- **PR #87:** merge `0bbaff14cc697b8b523a3b10824e48dd4d58dd3a`, preservando os commits do Claude.
- **PR #88:** merge `fd20afb3652e10b6426134e3409ccb77f00e0c49`.
- **Deploy Railway:** `f7ad5232-19ff-4b94-bd69-a24a10025d9d` SUCCESS, healthcheck `/api/health` aprovado às 12:38:47 UTC. Web/API, agente e PostgreSQL online; nenhum deploy pendente na conferência posterior.
- **Verificação pública:** `/api/health` 200, banco e armazenamento OK. Não executados resets de usuários reais nem criação de dados operacionais para teste.
- **Produção:** nenhuma alteração; Web/API e agente de produção continuam sem deploy. Não houve exportação/importação de dados ou documentos nesta entrega.
- **Estado:** publicado para testes, ainda **não homologado funcionalmente**. Validar acesso individual, permissões, cadastro, documentos e a cópia de dados antes de promover qualquer versão.

## 2026-10-15 — Codex/Jarvis — Entrar com Google para a equipe

- **ID:** CHG-20261015-009
- **Branch:** `codex/google-login`; destino exclusivo `homologation`.
- **PR:** #90.
- **Motivo:** Ivam solicitou login padrão usando contas Google já existentes.
- **Arquivos:** `server/railway/{auth,server,user-credentials,google-login}.mjs`, `package.json`/lock, testes de autenticação e documentação.
- **O que mudou:** OIDC com biblioteca oficial Google, PKCE/state/nonce, verificação de ID token e e-mail, vínculo por subject e checagem ativa de empresa/membro. Bootstrap opcional apenas para e-mail explicitamente escolhido na infraestrutura de homologação.
- **Dados:** tabela nova `railway_google_identities`; nenhuma alteração de dados de negócio, D1, R2 ou produção. Não reativa membros e não altera perfis existentes.
- **Limite de acesso:** qualquer pessoa pode usar sua conta Google no login, mas só membros autorizados acessam os dados. Sem autoinscrição pública.
- **Configuração pendente:** cliente OAuth Web Google (client ID/secret) ainda não disponível. Botão fica desativado e o login existente é preservado até configuração completa.
- **Validação:** build Railway passou; 68 testes locais com PGlite passaram; ESLint sem erros. OAuth real ainda pendente das credenciais Google. Roteiro em `docs/redesign/GOOGLE_LOGIN.md`.
- **Rollback:** reverter só o PR, preservar tabela/vínculos e variáveis para auditoria; não apagar usuários.
- **Status:** em andamento; não autorizado para produção.

## 2026-10-15 — Codex/Jarvis — Verificação de homologação e correção de 401 nos cadastros

- **ID:** CHG-20261015-010
- **Branch:** `fix/catalog-auth-homologation`; destino `homologation`.
- **PR:** #91.
- **Motivo:** Ivam pediu testar todas as abas antes de decidir produção.
- **Resultado inicial:** ambiente online; 15 verificações públicas, 13 esperadas e dois GETs (Clientes/Produtos) retornando 500 em vez de 401. Navegador sem sessão, Google ainda não configurado: testes internos autenticados bloqueados.
- **Correção:** capturar e devolver Response de autenticação nos dois GETs; preservar escopo por empresa e comportamento das consultas.
- **Arquivos:** `app/api/{importer-clients,master-products}/route.ts`, `tests/catalog-auth-response.test.mjs`, relatório em `docs/reviews/HOMOLOGATION_TESTS_2026-10-15.md` e registros de coordenação.
- **Dados:** nenhuma migração, exclusão ou escrita em dados de negócio/documentos. Produção não alterada.
- **Validação:** regressão comportamental contra os handlers compilados; build Railway, 69/69 testes com PGlite e ESLint passaram. Revalidar as duas rotas no Railway após deploy.
- **Risco/rollback:** baixo; reverter somente o PR. Falha real de banco continua respondendo 500 com mensagem de erro separada.
- **Estado:** verificação parcial; não homologado funcionalmente nem autorizado para produção.

## 2026-10-15 — Codex/Jarvis — Cadastro público de e-mail / primeiro acesso

- **ID:** CHG-20261015-011
- **Branch:** `codex/self-registration`; PR #92; destino exclusivo `homologation`.
- **Motivo:** Ivam observou que a tela de login não oferecia onde cadastrar o próprio e-mail.
- **Alteração:** link Cadastrar e-mail; formulário de solicitação com nome/e-mail/código da empresa; administrador revisa em Equipe, libera perfil e já recebe link privado para definição de senha. Sem envio automático de e-mail.
- **Arquivos:** `server/railway/{auth,server,user-credentials}.mjs`, `app/ui/equipe-view.tsx`, teste de autenticação e docs de coordenação/primeiro acesso.
- **Dados/risco:** tabela aditiva `railway_access_requests`, incluir no backup privado PostgreSQL. Nenhuma credencial, vínculo ou sessão é criada publicamente; não substitui senhas, não reativa membros, não expõe solicitações de outra empresa. Solicitações são dados declarados, exigem confirmação da identidade pelo administrador. Rate limit por IP/processo.
- **Dependências:** primeiro administrador ainda exige bootstrap ou Google verificado; OAuth Google permanece não configurado.
- **Validação:** build Railway, suíte PGlite e lint; teste manual autenticado pendente.
- **Coordenação:** base `homologation` @ `675e65d`; preservados trabalho de Claude, app clássico, dados/documentos e produção.
- **Rollback:** reverter somente o PR, preservar tabelas e dados.
- **Status:** preparado para homologação; produção não autorizada.

## 2026-10-15 — Codex/Jarvis — Empresa inicial por CNPJ e olho de senha

- **ID:** CHG-20261015-012
- **Branch:** `codex/cnpj-onboarding`; PR #93; destino exclusivo `homologation`.
- **Pedido:** Ivam quer CNPJ como código, criação inicial da estrutura da empresa e olho para conferir senha.
- **Alteração:** cadastro cria empresa vazia isolada + novo administrador + senha individual + sessão. Equipe solicita pelo CNPJ; não recria empresa nem substitui conta/senha existente. Mostrar/Ocultar em todos os campos de senha.
- **Arquivos:** runtime Railway, Equipe, testes e docs de primeiro acesso/coordenação.
- **Dados:** tabela aditiva railway_company_registrations, reserva única por CNPJ, sequência de organizations alinhada sem recuar sob lock. Transação integral; nenhum dado anterior apagado, movido ou copiado. D1/R2 e produção preservados.
- **Coordenação:** evolui #92 por mudança explícita do usuário; preserva convites, login individual/Google e clássico. Legado sem CNPJ não é associado automaticamente.
- **Validação:** build Railway, 72/72 testes PGlite (zero skips) e lint; cadastro manual real pelo Ivam pendente.
- **Riscos/limites:** CNPJ/e-mail declarados sem comprovação externa. Empresa nova não contém dados antigos. Google OAuth pendente. Reservas/auth no backup privado integral PostgreSQL.
- **Rollback:** reverter código, preservar dados/tabelas.
- **Status:** só homologação; sem autorização de produção.

## 2026-10-15 — Codex/Jarvis — Correção do envio dos formulários de autenticação

- **ID:** CHG-20261015-013
- **Branch:** `fix/auth-form-origin`; PR #94; destino exclusivo `homologation`.
- **Falha real:** Ivam enviou imagem de POST /__auth/cadastrar recusado com Origem da requisição não autorizada antes de gravar o cadastro.
- **Causa:** Referrer-Policy no-referrer nos HTMLs faz basic form POST enviar Origin:null; validador CSRF exige mesma origem. Testes anteriores por fetch não simulavam essa política do navegador.
- **Correção:** strict-origin nas respostas do runtime, preservando origem HTTPS e ocultando path/query/token do Referer. Validador CSRF permanece rejeitando Origin null/ausente/externo. Sem aceitar cabeçalhos de origem forjados ou desligar proteção.
- **Arquivos:** server/railway/server.mjs, tests/auth-form-origin.test.mjs e docs de coordenação/primeiro acesso.
- **Validação:** teste HTTP inicia servidor real isolado sem banco/contas; verifica headers nas três telas, POST mesma origem chega à validação de credencial (401), null/ausente/externo continua 403. Cadastro real depende da confirmação manual do Ivam; tentativa pelo browser remoto bloqueada pela política do navegador.
- **Dados/produção:** nenhuma migração ou alteração de empresa, usuário, senha ou documento real. Produção intocada.
- **Coordenação:** worktree próprio da homologation @85e99fa; alteração local não relacionada em docs/redesign/prototipo/EUDR.dc.html preservada no checkout original, fora deste PR.
- **Rollback:** reverter somente este PR; dados preservados.
- **Status:** correção preparada para homologação, validação manual pendente.


## 2026-10-15 — Claude — Importar fornecedores do app antigo

- **ID:** CHG-20261015-014
- **Branch:** `claude/importar-fornecedores`
- **PR:** #95
- **Destino:** homologation
- **Tipo:** feature / dados
- **Arquivos/módulos alterados:** `app/api/suppliers/import/route.ts` (novo), `lib/supplier-import.ts` (novo), `app/ui/importar-fornecedores.tsx` (novo), `app/ui/cadastros-view.tsx` (botão "Importar do app antigo…" em Fornecedores), `tests/supplier-import.test.mjs` (novo).
- **Motivo:** Ivam pediu todos os fornecedores do app antigo no app novo, com todas as informações e sem mexer na estrutura existente.
- **O que mudou:** em Cadastros → Fornecedores, tela que lê o JSON exportado do app antigo (exportação de dados / backup "Portable Export", exportação integral ou lista), mostra prévia calculada no servidor e só grava após confirmação, na empresa ativa.
  - Todos os campos do fornecedor são copiados (inclusive dados bancários, unidades produtivas, certificações, status e data de criação).
  - Formato novo: endereço digitado no campo cidade vai inteiro para Endereço e a cidade fica limpa; UF digitada com cidade ("PIRATINI – RS") vira "RS". Cada ajuste aparece na prévia e na auditoria.
  - Fornecedor já cadastrado (mesmo CNPJ ou razão social) não é duplicado: só campos vazios são completados; nada é sobrescrito ou apagado.
  - Auditoria por fornecedor (`SUPPLIER_IMPORTED`, `SUPPLIER_IMPORT_COMPLETED`) e resumo com o mapa id antigo → id novo (`SUPPLIERS_IMPORT_FINISHED`), para vincular processos em importações futuras.
- **Impacto esperado:** fornecedores do app antigo disponíveis no app novo sem redigitação.
- **Riscos:** baixo. Sem migration, sem mudança de schema, permissões (`write_supplier`) ou telas existentes.
- **Dados/migração:** nenhuma migration. Arquivo real usado no teste: backup automático de produção de 2026-09-29 (10 fornecedores), não versionado no repositório por conter dados bancários.
- **Compatibilidade:** ChatGPT Sites/Cloudflare e Railway.
- **Testes executados:** `node --test` 76/76 (+2 skips existentes; 5 novos de conversão); runtime Railway local em PostgreSQL 16 com o backup real via Playwright: 10 criados, 157/160 campos idênticos ao original e 3 diferenças = ajustes de formato previstos com texto original preservado em Endereço; segunda importação do mesmo arquivo: 0 novos, 10 já cadastrados (sem duplicação); sem erros de console; eslint sem erros; `tsc` 89 (baseline inalterado).
- **CI:** não configurado.
- **Railway homologation:** deploy automático após merge autorizado; a importação é feita pelo Ivam na tela.
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge; fornecedores já importados permanecem (sem exclusão automática).
- **Conflitos/coordenação com outros agentes:** nenhum; branch de `homologation` @ `8f03d34` (PRs #88–#94 do Codex preservados). Observação: o cadastro por CNPJ (#93) cria empresa nova e vazia; a importação grava na empresa em que o usuário está logado. A cópia integral (PR #86) recusa destino com mais de uma empresa e precisará de ajuste antes de ser usada.
- **Status:** em andamento


## 2026-10-15 — Claude — Importação automática de fornecedores na homologação

- **ID:** CHG-20261015-015
- **Branch:** `claude/importacao-automatica-fornecedores`
- **PR:** #96
- **Destino:** homologation
- **Tipo:** infra / dados
- **Arquivos/módulos alterados:** `server/railway/startup-import.mjs` (novo), `server/railway/server.mjs` (chama a importação após iniciar).
- **Motivo:** Ivam autorizou e pediu que o Claude fizesse a importação dos fornecedores sem ação manual; o ambiente do Claude não alcança a URL nem o banco da homologação.
- **O que mudou:** se a variável `EXPORTATRUST_SUPPLIER_IMPORT_B64` (JSON do app antigo em base64) estiver definida, o servidor chama internamente `POST /api/suppliers/import` (mesmas regras do PR #95: prévia, sem duplicar, sem sobrescrever, auditoria) em nome do administrador ativo da empresa de destino. Destino: `EXPORTATRUST_SUPPLIER_IMPORT_ORG_IDS` ou a única empresa criada pelo cadastro por CNPJ; com várias candidatas nada é importado. Ignorado em `APP_ENV=production`. Sem a variável, nada muda.
- **Dados:** os dados ficam só na variável do serviço (não no repositório) e a variável é removida após a importação.
- **Testes executados:** banco PostgreSQL novo + cadastro por CNPJ local → reinício com a variável: 10 fornecedores criados na empresa do cadastro, auditoria `SUPPLIER_IMPORTED` ×10 + `SUPPLIERS_IMPORT_FINISHED`, empresa 1 intacta; segundo reinício: "já estavam cadastrados; nada a fazer" (sem duplicação). `node --test` 76/76; eslint sem erros.
- **Railway homologation:** deploy após merge; variável definida, importação conferida nos logs e variável removida.
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge; fornecedores importados permanecem.
- **Conflitos/coordenação com outros agentes:** nenhum; base `homologation` @ `4dbb45b`.
- **Status:** em andamento


## 2026-10-15 — Claude — Importar clientes e produtos do app antigo

- **ID:** CHG-20261015-016
- **Branch:** `claude/importar-clientes-produtos`
- **PR:** #98
- **Destino:** homologation
- **Tipo:** feature / dados
- **Arquivos/módulos alterados:** `lib/registry-import.ts` (novo), `app/api/registry-import/route.ts` (novo), `app/ui/importar-fornecedores.tsx` (passa a servir fornecedores, clientes e produtos), `app/ui/cadastros-view.tsx` (botão "Importar do app antigo…" também em Clientes e Produtos), `server/railway/startup-import.mjs` e `server.mjs` (variável `EXPORTATRUST_REGISTRY_IMPORT_B64`: fornecedores → clientes → produtos), `tests/registry-import.test.mjs` (novo).
- **Motivo:** Ivam pediu clientes e produtos do app antigo no app novo, como foi feito com fornecedores; processos ficam para etapa posterior.
- **O que mudou:**
  - Mesmas regras da importação de fornecedores: prévia, sem duplicar, sem sobrescrever, auditoria (`REGISTRY_IMPORTED`, `REGISTRY_IMPORT_COMPLETED`, `REGISTRY_IMPORT_FINISHED` com mapa id antigo → novo).
  - Aceita a tabela completa (exportação integral `importer_clients` / `master_products`). Quando o arquivo não tem a tabela — caso do backup "Portable Export v2" de 2026-09-29, que não incluía esses cadastros —, reconstrói pelos processos: clientes com razão social oficial da auditoria, apelidos usados nos processos, país, EORI, porto, incoterm, moeda e contato do parceiro importador; produtos com NCM, espécie, matéria-prima, origem, unidade e fornecedores habilitados (mapeados para os fornecedores já importados). Registros reconstruídos ficam "Pendente".
  - Ao importar depois a exportação completa, o mesmo cadastro é reconhecido pelo id antigo, os campos vazios são completados e o status passa de "Pendente" para o do app antigo.
- **Riscos:** baixo. Sem migration nem mudança de schema; nenhuma rota existente alterada.
- **Dados:** cliente nº 5 do app antigo não aparece em nenhum processo do backup e só virá com a exportação completa. Pellets de madeira tem dois NCMs nos processos (4407.11.00 e 4401.031.00) — sinalizado para conferência.
- **Testes executados:** `node --test` 80/80 (+2 skips existentes; 4 novos); runtime Railway local em PostgreSQL 16 com o backup real: 10 clientes e 4 produtos criados na empresa do cadastro por CNPJ, fornecedores habilitados idênticos aos do app antigo; reinício sem duplicação; eslint sem erros; `tsc` 89 (baseline inalterado).
- **Railway homologation:** merge autorizado por Ivam; importação automática pela variável temporária, removida após o uso.
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge; cadastros importados permanecem.
- **Conflitos/coordenação com outros agentes:** nenhum; base `homologation` @ `463a89e`.
- **Status:** em andamento


## 2026-10-15 — Claude — Importar processos do app antigo (parte 1: dados)

- **ID:** CHG-20261015-017
- **Branch:** `claude/importar-processos`
- **PR:** #99
- **Destino:** homologation
- **Tipo:** feature / dados
- **Arquivos/módulos alterados:** `lib/process-import.ts` (novo), `app/api/process-import/route.ts` (novo), `server/railway/startup-import.mjs` e `server.mjs` (etapa "processos"; variável em partes `…_B64_1..n` e conteúdo comprimido `gz:`), `tests/process-import.test.mjs` (novo).
- **Motivo:** Ivam pediu os processos do app antigo no app novo (parte 1: dados; parte 2: arquivos).
- **O que mudou:** importação, na empresa ativa, de 19 processos com todos os campos, vinculados aos fornecedores/clientes/produtos já importados (mapa id antigo → novo da auditoria); 3 florestas CAR com geometria; parceiros, avisos de embarque e plano industrial. O backup não tinha as etapas (`export_milestones`): elas são recriadas pelo status antigo (anteriores "Concluído", atual "Em andamento", seguintes "Pendente"). Prévia (dryRun), sem duplicar nem sobrescrever; auditoria `PROCESS_IMPORTED`, `PROPERTY_IMPORTED`, `PROCESS_IMPORT_FINISHED`.
- **Riscos:** baixo/moderado. `operations.reference` e `rural_properties.car_code` são únicos no banco inteiro (não por empresa): a futura cópia integral da produção para a empresa 1 vai colidir com estes registros da empresa 2 e precisa tratar isso.
- **Dados:** documentos dos processos (400 registros + 451 arquivos) ficam para a parte 2. Avisos de embarque mantêm `documentIdsJson` com ids antigos até lá.
- **Testes executados:** `node --test` 84/84 (+2 skips; 4 novos); runtime local em PostgreSQL com o backup real: 19 processos, 266 etapas, 3 florestas, 2 parceiros, 10 avisos, 1 plano; vínculos conferidos processo a processo; reinício sem duplicação; tela Pedidos com fases corretas e sem erros; eslint sem erros; `tsc` 89 (baseline).
- **Railway homologation:** merge autorizado por Ivam; importação automática por variável temporária em 2 partes, esvaziada após o uso.
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge; processos importados permanecem.
- **Conflitos/coordenação com outros agentes:** nenhum; base `homologation` @ `b2939b7`.
- **Status:** em andamento


## 2026-10-15 — Claude — Importar arquivos e documentos do app antigo (parte 2)

- **ID:** CHG-20261015-018
- **Branch:** `claude/importar-documentos`
- **PR:** #100
- **Destino:** homologation
- **Tipo:** feature / dados
- **Arquivos/módulos alterados:** `app/api/document-import/route.ts` (novo), `server/railway/startup-import.mjs` (`runStartupFileImport`), `server/railway/server.mjs`.
- **Motivo:** Ivam pediu os arquivos do app antigo no app novo, ligados aos processos importados na parte 1.
- **O que mudou:** com `EXPORTATRUST_FILES_IMPORT_URL` (somente fora de produção), o servidor baixa o pacote "ExportaTrust Full R2 Export v1" (.tar), grava cada arquivo no storage com a mesma chave e metadados (pula os já existentes com mesmo tamanho) e usa o backup mais recente do próprio pacote para ligar os documentos aos processos já importados (`/api/document-import`): `operation_documents` e `forest_documents` na empresa ativa, avisos de embarque passam a apontar para os ids novos. Prévia (dryRun), sem duplicar (chave de arquivo única), sem apagar.
- **Dados:** fonte = release `phase5-r2-source` (pacote de 2026-09-29, 451 arquivos, 155.513.309 bytes). 1 documento (certificado fitossanitário 048-2026) já não tinha arquivo no pacote original.
- **Segurança:** o repositório é público e esse anexo do release contém documentos reais da produção; Ivam autorizou removê-lo após a importação.
- **Testes executados:** runtime local em PostgreSQL com o pacote real servido por HTTP: 451/451 arquivos gravados (155.513.309 bytes), 400 documentos ligados (108 no GBU002-26, 64 no PO0657…), 2 documentos de florestas, 8 avisos atualizados; download de PDF pela API idêntico ao original; `node --test` 84/84; eslint sem erros; `tsc` 89 (baseline).
- **Railway homologation:** importação automática pela variável temporária, removida após o uso.
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge; arquivos e registros importados permanecem.
- **Conflitos/coordenação com outros agentes:** nenhum; base `homologation` @ `71d3c7f`.
- **Status:** em andamento


## 2026-10-15 — Claude — Página do pedido na interface nova (redesign etapa 2, parte 1)

- **ID:** CHG-20261015-019
- **Branch:** `claude/pagina-pedido`
- **PR:** #101
- **Destino:** homologation
- **Tipo:** feature / frontend
- **Arquivos/módulos alterados:** `app/pedidos/[id]/page.tsx` (novo), `app/ui/pedido-view.tsx` (novo), `lib/document-phase.ts` (novo), `app/ui/format.ts` (`processHref` → `/pedidos/<id>`).
- **Motivo:** Ivam testou e não quer que o clique no pedido abra o app anterior; os dados devem aparecer no layout novo aprovado.
- **O que mudou:** clicar num pedido (Painel, Pedidos, Cadastros, Novo processo) abre `/pedidos/<id>`: cabeçalho com cliente/produto/destino, ETD, valor e EUDR; as 6 fases com etapas concluídas/total e fase atual; etapas da fase selecionada com situação, responsável, prazo e próxima ação editáveis (mesma API do app anterior, enviando a etapa completa); na fase Pedido, emissão de Sales Order, pedido de compra, invoice e packing list (visualizar/PDF e Word); arquivos da fase com visualizar, baixar e anexar; outros documentos; tarefas; todos os dados do pedido em grupos (comercial, produto e origem, logística, EUDR e responsáveis). Link discreto para a versão anterior mantido para EUDR/supply chain até a etapa 4.
- **Riscos:** baixo. Sem migration; APIs existentes.
- **Testes executados:** build Railway (rota `/pedidos/:id`); Playwright local com os 19 processos importados: clique em Pedidos abre a página nova, troca de fase, salvar etapa, sem erros de console; `node --test` 84/84; eslint sem erros; `tsc` 89 (baseline).
- **Railway homologation:** deploy automático após merge (autorizado por Ivam).
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge.
- **Conflitos/coordenação com outros agentes:** nenhum; base `homologation` @ `7f6998d`.
- **Status:** em andamento


## 2026-10-15 — Claude — Pedido colaborativo: tarefas estilo Asana, comentários, presença e conflitos

- **ID:** CHG-20261015-020
- **Branch:** `claude/pedido-colaborativo`
- **PR:** #102
- **Destino:** homologation
- **Tipo:** feature / frontend / migration aditiva
- **Arquivos/módulos alterados:** `app/ui/pedido-view.tsx`, `app/api/operation-activity/route.ts` (novo), `drizzle/0030_operation_collaboration.sql` (novo; tabelas `operation_comments` e `operation_presence`, também criadas sob demanda), `app/api/export-control/route.ts` (verificação opcional `expectedUpdatedAt` em etapa e tarefa).
- **Motivo:** Ivam quer manter o modelo combinado: checklist estilo Asana e várias pessoas alterando o mesmo pedido sem perda de dados.
- **O que mudou:** tarefas com checkbox (concluir/reabrir), adicionar tarefa, abrir para editar responsável (membros da empresa), prazo, situação e nota; comentários com @menções (destaque para quem foi mencionado) e histórico de alterações da equipe; "vendo agora" com quem está no pedido (presença a cada 20 s); aviso quando outra pessoa altera o pedido, com botão Atualizar; proteção contra edição simultânea: salvar etapa/tarefa sobre uma alteração mais recente de outra pessoa abre a escolha "usar a versão salva" ou "manter a minha alteração". O app anterior não envia `expectedUpdatedAt` e continua com o comportamento atual.
- **Riscos:** baixo. Migration só cria tabelas novas.
- **Testes executados:** Playwright local com duas sessões no mesmo pedido: criar e concluir tarefa, comentar com menção, conflito detectado e resolvido mantendo a alteração; migration 0030 aplicada no PostgreSQL; `node --test` 84/84; eslint sem erros; `tsc` 92 (+3 do tipo já existente `cloudflare:workers` sem declaração).
- **Railway homologation:** deploy automático após merge (autorizado por Ivam).
- **Railway production:** sem alteração.
- **Rollback:** reverter o merge; tabelas novas podem permanecer.
- **Conflitos/coordenação com outros agentes:** alteração aditiva em `export-control/route.ts` (código existente preservado); base `homologation` @ `9abed8b`.
- **Status:** em andamento

## 2026-10-15 — Claude — Página do pedido no layout aprovado (protótipo Processo.dc.html)

- **ID:** CHG-20261015-021
- **Branch:** `claude/pedido-layout-aprovado`
- **PR:** #103
- **Destino:** homologation
- **Tipo:** feature / frontend / migration aditiva
- **Arquivos/módulos alterados:** `app/ui/pedido-view.tsx`, `app/ui/et2.css`, `lib/document-phase.ts`, `app/api/export-control/route.ts`, `app/api/operation-activity/route.ts`, `drizzle/0031_operation_collaboration_targets.sql`
- **Motivo:** a página do pedido (PRs #101/#102) não seguia o layout aprovado em `docs/redesign/prototipo/Processo.dc.html`.
- **O que mudou:** cabeçalho com 6 dados-chave e botões (Seguir pedido, Enviar atualização ao cliente, Concluir etapa); fases em linha do tempo; na fase Pedido, emissão de documentos com abas (Sales Order, Pedido de compra, Invoice, Packing List) editáveis, com itens, totais, salvamento automático, Visualizar/PDF/Word e conflito campo a campo (Descartar/Manter/Combinar); etapas e tarefas em tabela com check redondo e gaveta lateral (responsável, prazo, situação, seguidores, comentários com @ e anexar arrastando); arquivos da fase com visualização em janela; lateral com Documentos do pedido, Atividade da equipe e Financeiro; aviso (toast) quando outra pessoa altera o pedido. API: snapshot inclui `orderDetails`; `order-commercial` aceita `expectedUpdatedAt` (409 com versão atual); `operation-activity` ganha comentário por etapa/tarefa (`target`), documento em edição na presença e seguidores (`action: follow`).
- **Impacto esperado:** a tela do pedido fica igual ao protótipo aprovado, com dados reais.
- **Riscos:** baixo; mudanças de API aditivas (sem `expectedUpdatedAt` o comportamento antigo é mantido).
- **Dados/migração:** 0031 aditiva (colunas `operation_comments.target_key`, `operation_presence.editing`; tabela `operation_followers`). Nada apagado.
- **Compatibilidade:** `/classico` e chamadas antigas inalteradas.
- **Testes executados:** tsc (sem erros novos), eslint, build Railway, Playwright local (autosave, conflito combinado gravando as duas alterações, visualizar, comentário com @, check de tarefa, seguir, toast de alteração de outro usuário).
- **CI:** pendente.
- **Railway homologation:** deploy automático após merge.
- **Railway production:** sem mudança.
- **Rollback:** reverter o PR; a migração 0031 pode permanecer (só adiciona).
- **Conflitos/coordenação com outros agentes:** nenhum conflito encontrado.
- **Status:** em andamento

## 2026-10-15 — Claude — Editar dados do pedido na página do pedido

- **ID:** CHG-20261015-023
- **Branch:** `claude/editar-dados-pedido`
- **PR:** #105
- **Destino:** homologation
- **Tipo:** feature / frontend / API aditiva
- **Arquivos/módulos alterados:** `app/ui/pedido-view.tsx`, `app/api/operations/route.ts`
- **Motivo / autorização de Ivam (conversa, 2026-10-15):** "Dentro de cada pedido, nós vamos ter que ter a opção de alterar dados do pedido. Porque, por exemplo, eu tenho o pedido 056-26, que o importador é diferente [...] eu vou ter que ter uma opção de entrar dentro da base do pedido para alterar as informações do pedido."
- **O que mudou:** a seção já existente "Todos os dados do pedido" ganhou o botão "Editar dados": os campos viram editáveis; cliente/importador e fornecedor são escolhidos dos Cadastros. `PATCH /api/operations` com `fields` grava só os campos alterados (lista permitida), com `original` para detectar alteração simultânea (409). Ao trocar o importador, o comprador dos documentos acompanha quando era o mesmo nome. Auditoria `OPERATION_UPDATED` com valores anteriores.
- **Layout:** nenhuma seção nova; o resto da página segue o protótipo aprovado.
- **Riscos:** baixo; o PUT existente (app clássico) não mudou.
- **Dados/migração:** nenhuma.
- **Testes executados:** eslint, tsc (sem erros novos), build Railway, Playwright local (troca de importador, booking; comprador do Sales Order acompanhou).
- **Railway homologation:** deploy automático após merge.
- **Railway production:** sem mudança.
- **Rollback:** reverter o PR.
- **Conflitos/coordenação com outros agentes:** nenhum.
- **Status:** em andamento

## 2026-10-15 — Claude — Novo processo: exportador/trading selecionável com CNPJ automático

- **ID:** CHG-20261015-024
- **Branch:** `claude/exportador-selecionar`
- **PR:** #106
- **Destino:** homologation
- **Tipo:** frontend
- **Arquivos/módulos alterados:** `app/ui/novo-processo-view.tsx`
- **Autorização de Ivam (conversa, 2026-10-15):** "essa fase da tela do novo processo ela pode ficar assim [...] ficou bem legal. Eu quero só fazer algumas alterações. No ponto 2 [...] o exportador, trading [...] esse campo também tem que ter um botão aqui de selecionar. O CNPJ do exportador, ele vai puxar automático dentro do cadastro [...] é só essa alteração por enquanto."
- **O que mudou:** na seção 2 (Empresas da cadeia), "Exportador / trading" virou seleção do cadastro ("O próprio fornecedor" ou uma trading/empresa cadastrada); o CNPJ do exportador é preenchido do cadastro ao selecionar o fornecedor ou o exportador. O exportador é quem aparece na documentação do pedido. Resto da tela igual ao protótipo aprovado (NovoProcesso.dc.html), que Ivam confirmou.
- **Riscos:** baixo; a API de criação do processo não mudou (continua recebendo exporterName/exporterTaxId).
- **Dados/migração:** nenhuma.
- **Testes executados:** eslint, tsc (sem erros novos), build Railway, Playwright local (próprio fornecedor e trading preenchem o CNPJ do cadastro).
- **Railway homologation:** deploy automático após merge.
- **Railway production:** sem mudança.
- **Rollback:** reverter o PR.
- **Conflitos/coordenação com outros agentes:** nenhum.
- **Status:** em andamento

## 2026-10-15 — Claude — Prévia dos custos logísticos (Novo processo e pedido)

- **ID:** CHG-20261015-025
- **Branch:** `claude/custos-logisticos`
- **PR:** #107
- **Destino:** homologation
- **Tipo:** feature / frontend / API / migration aditiva
- **Arquivos/módulos alterados:** `lib/logistics-costs.ts` (novo), `drizzle/0032_operation_logistics_costs.sql` (novo), `db/schema.ts`, `app/api/operations/route.ts`, `app/ui/novo-processo-view.tsx`, `app/ui/pedido-view.tsx`
- **Autorização de Ivam (conversa, 2026-10-15):** "No campo de logística, tu coloca um campo onde a gente pode colocar uma prévia dos custos logísticos. Isso vai ajudar nosso financeiro para saber a margem que a gente vai ter nesse pedido. Então, coloca essa opção dentro do ponto 5, que é a logística internacional."
- **O que mudou:** seção 5 (Logística internacional) do Novo processo ganhou "Prévia dos custos logísticos" (moeda, frete rodoviário, despesas portuárias/THC, despachante, frete marítimo, seguro, outros, observações, total). No pedido, o card Financeiro mostra "Logística (prévia)" e a margem passa a descontar a logística (quando venda, compra e custos estão na mesma moeda); os custos podem ser ajustados em "Todos os dados do pedido" → Editar dados. Corrigida a leitura de números com separador de milhar sem decimais ("4.500" era lido como 4,5) na edição de dados e no Novo processo.
- **Dados/migração:** 0032 aditiva — coluna `operations.logistics_costs_json` (padrão `{}`). O PUT do app anterior não apaga a prévia (só grava quando enviada).
- **Riscos:** baixo.
- **Testes executados:** eslint, tsc (sem erros novos), build Railway, Playwright local (criação com custos → total no pedido → edição do seguro somou corretamente).
- **Railway homologation:** deploy automático após merge (aplica a 0032).
- **Railway production:** sem mudança.
- **Rollback:** reverter o PR; a coluna pode permanecer.
- **Conflitos/coordenação com outros agentes:** nenhum.
- **Status:** em andamento

## 2026-10-16 — Claude — Primeira publicação em produção

- **ID:** CHG-20261016-001
- **Branch:** `homologation` → `main`
- **PR:** #108
- **Destino:** main / Railway produção
- **Tipo:** release / infraestrutura
- **Autorização de Ivam (conversa, 2026-10-16):** "Pode produzir".
- **O que mudou:** `homologation` promovida para `main` (merge sem squash). No projeto Railway "ExportaTrust" (produção): bucket `documents-production` criado; `web-api` ligado a `main` com build/start/healthcheck iguais à homologação; variáveis de storage, sessão, senha de acesso e e-mail autorizado definidas (segredos novos, só de produção); domínio https://web-api-production-e342.up.railway.app. Deploy `9f22f759` com sucesso: 33 migrações aplicadas, autoteste do storage OK.
- **Dados/migração:** banco de produção era vazio; nenhuma tabela/dado existente foi alterado. Dados do app antigo ainda não carregados (pendente de autorização).
- **Riscos:** baixo; app antigo (Cloudflare) não foi alterado.
- **Railway homologation:** sem mudança.
- **Rollback:** desligar a fonte do `web-api` de produção ou voltar `main` ao commit anterior (5a36e49).
- **Conflitos/coordenação com outros agentes:** nenhum.
- **Status:** em produção (sem dados)

## 2026-10-16 — Claude — Liberação única da carga inicial em produção

- **ID:** CHG-20261016-002
- **Branch:** `claude/importacao-producao`
- **PR:** #110, #111
- **Destino:** homologation → main
- **Tipo:** infraestrutura / dados
- **Autorização de Ivam (conversa, 2026-10-16):** "Ok entrei no app novo, pode liberar a importação em produção".
- **O que mudou:** `server/railway/startup-import.mjs` continua ignorando importações em produção, exceto com `EXPORTATRUST_IMPORT_IN_PRODUCTION=1`. Usado uma única vez para a carga inicial (fornecedores, clientes, produtos, processos e arquivos do app antigo, exportação de 29/09) na empresa cadastrada por Ivam; a variável e as de importação são removidas logo depois.
- **Dados/migração:** só inclui dados; nada é apagado nem sobrescrito.
- **Rollback:** remover a variável (a trava volta a valer).
- **Status:** concluído — carga feita (10 fornecedores, 10 clientes, 4 produtos, 19 processos, 451 arquivos; 1 arquivo ausente no pacote) e liberação desligada (`EXPORTATRUST_IMPORT_IN_PRODUCTION=0`)

## 2026-10-16 — Claude — Documentos de pedido na fase certa (pelo nome do arquivo)

- **ID:** CHG-20261016-003
- **Branch:** `claude/fase-por-nome-arquivo`
- **PR:** #113
- **Destino:** homologation → main
- **Tipo:** lógica (sem mudança de layout)
- **Pedido de Ivam (conversa, 2026-10-16):** "subir todos os cadastros [...] e tbm todo os processos e arquivos já organizados em cada fase".
- **O que mudou:** `documentPhaseIndex(category, fileName)` — na categoria genérica do app antigo "STAGE 08 · Documentos comerciais", arquivos de Sales Order / pedido de compra / contrato / proforma passam a aparecer na fase Pedido (antes caíam em Documentos). Conferido no backup de 29/09: os 400 documentos têm fase; 6 Sales Orders mudam para Pedido.
- **Dados/migração:** nenhuma (só a exibição por fase).
- **Testes:** eslint, tsc (sem erros novos), 84 testes unitários.
- **Status:** em andamento

## 2026-10-16 — Claude — Remoção das imagens de e-mail importadas do app antigo

- **ID:** CHG-20261016-004
- **Branch:** `claude/remover-imagens-email`
- **PR:** #115
- **Destino:** homologation → main
- **Tipo:** limpeza de dados (autorizada)
- **Autorização de Ivam (conversa, 2026-10-16):** "As imagens de e-mail você pode cancelar, pode eliminar, inclusive, tá? Não precisa trazer."
- **O que mudou:** `runStartupEmailImageCleanup` (server/railway/startup-import.mjs), ligada só com `EXPORTATRUST_REMOVE_EMAIL_IMAGES=1`: remove os documentos da categoria "STAGE 08 · Documentos comerciais" cujo nome é imagem colada em e-mail (`image001.png`, `image.jpg`, `Outlook-xxx.png`, `noname` do tipo imagem), usando a rota `DELETE /api/documents` (apaga arquivo do storage + registro, grava auditoria `DOCUMENT_DELETED`). Teste local na cópia dos dados: 143 removidas, 257 documentos mantidos.
- **Dados:** remove 143 imagens de e-mail em produção; nenhum outro documento é tocado.
- **Rollback:** as imagens continuam no pacote original do app antigo, se precisar reimportar.
- **Status:** em andamento
