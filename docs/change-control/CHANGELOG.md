# ExportaTrust — Change Log

> Registro append-only. Não apagar entradas anteriores.

## 2026-10-14 — ChatGPT / Jarvis — Base de controle multiagente

- **ID:** CHG-20261014-001
- **Branch:** `docs/change-control-registry`
- **PR:** #96
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
- **PR:** a preencher
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
