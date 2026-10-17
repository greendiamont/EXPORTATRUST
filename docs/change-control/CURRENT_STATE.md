# ExportaTrust — Estado Atual

Atualizado em: 2026-10-15

## Regra de layout aprovado (obrigatória)

Layouts aprovados por Ivam estão travados: ver `docs/change-control/LAYOUT_PROTOCOL.md`. Só mudam quando Ivam solicitar; o GitHub reprova PRs que alteram arquivos de layout sem a etiqueta `layout-autorizado-ivam`, que o agente só coloca quando Ivam autorizou na conversa. Ivam aprova/trava layouts apenas falando na conversa ("layout aprovado").

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
- Branch: `main` (autodeploy). Primeiro deploy em 2026-10-16 (deploy `9f22f759`, commit `aea61b6`, PR #108), autorizado por Ivam ("Pode produzir").
- URL: https://exportatrust.up.railway.app
- Bucket: `documents-production` (sjc), referenciado nas variáveis `STORAGE_S3_*`.
- Login: cadastro por CNPJ + senha individual (segredos próprios de produção, diferentes da homologação). Login Google não configurado em produção.
- Carga inicial concluída em 2026-10-16 (autorizada por Ivam) na empresa #2 Hub Das Americas: 10 fornecedores, 10 clientes, 4 produtos, 19 processos, 451 arquivos (155.513.309 bytes), 400 documentos e 2 documentos de floresta ligados; 1 arquivo ausente no pacote (048-2026 CERTIFICADO FITOSSANITARIO.pdf). Variáveis de importação esvaziadas e `EXPORTATRUST_IMPORT_IN_PRODUCTION=0` (trava ativa).

### Homologação
- Projeto: `ExportaTrust Homologation`
- Project ID: `f1b37adf-57c3-4cad-9f52-786dd65357ad`
- Serviço DB: PostgreSQL próprio e isolado
- Serviço app: `web-api`
- Source: `greendiamont/EXPORTATRUST`
- Branch: `homologation`
- APP_ENV: `homologation`
- URL: https://web-api-production-a92f.up.railway.app
- Runtime: Node (`npm run build:railway` / `npm run start:railway`, healthcheck `/api/health`) — ver `docs/RAILWAY_RUNTIME.md`. Validado em 2026-10-14 (deploy `deea28ef`, commit `bdd2081`).
- Storage de documentos: bucket Railway `documents-homologation` (S3, isolado)
- Dados: cópia integral da produção via `docs/MIGRATION_PRODUCTION_TO_HOMOLOGATION.md` (pendente de execução em 2026-10-14).
- Acesso: login de homologação (e-mails em `EXPORTATRUST_ALLOWED_EMAILS` + `EXPORTATRUST_ACCESS_PASSWORD`, definidos nas variáveis do serviço)
- Redesign #87 e login individual #88 integrados **somente em `homologation`** com autorização do Ivam. Commit funcional `fd20afb3652e10b6426134e3409ccb77f00e0c49`; deploy Railway `f7ad5232-19ff-4b94-bd69-a24a10025d9d` SUCCESS em 2026-10-15, healthcheck aprovado. Web/API, agente e PostgreSQL online, sem trabalho pendente na conferência.
- Senhas individuais e link de definição por administrador da empresa: duas tabelas próprias no PostgreSQL e revogação de sessão por versão. Testes locais concluídos; **testes reais autenticados com a equipe e validação dos dados ainda pendentes**. Ver `docs/redesign/LOGIN_INDIVIDUAL.md`. Bootstrap continua disponível; não tratar como autenticação final homologada de produção.

## Storage

- Cloudflare R2 permanece como storage de documentos de produção nesta fase.
- Homologação no Railway usa bucket S3 próprio (`documents-homologation`), acessado pela mesma API do R2 (`server/railway/r2-s3.mjs`).
- Não migrar/remover documentos sem validação e backup.

## Banco atual / migração

- O código do app continua escrito para D1/SQLite e `cloudflare:workers` (sem alteração).
- No Railway, `server/railway/` fornece `cloudflare:workers` em Node: `env.DB` com API do D1 sobre PostgreSQL (tradução SQLite→PostgreSQL) e `env.BUCKET` com API do R2 sobre S3.
- Schema PostgreSQL: criado a partir de `drizzle/*.sql` na inicialização do serviço (tabela de controle `_exportatrust_pg_migrations`). Validado em homologação com banco vazio (29 migrações, 43 tabelas).
- SQL novo deve evitar recursos exclusivos do SQLite (`INSERT OR REPLACE`, funções de data do SQLite, `GROUP BY` com colunas não agregadas) ou ajustar `server/railway/sql-translate.mjs`.
- A migração alvo é PostgreSQL no Railway.
- Nenhum cutover de produção deve ocorrer até:
  - schema PostgreSQL validado;
  - dados migrados e comparados;
  - autenticação validada (o login de homologação não é o modelo final de produção);
  - documentos R2 testados;
  - homologação aprovada.

## Interface (redesign em andamento)

- Primeiro acesso por CNPJ (`codex/cnpj-onboarding`, evolução de #92): empresa
  nova cria organização vazia isolada, novo administrador, senha e sessão. Equipe
  solicita pelo mesmo CNPJ, com aprovação e link de senha. Olho em todos os campos
  de senha. Tabela aditiva `railway_company_registrations`, sem mover dados antigos
  nem substituir contas/senhas existentes. CNPJ/e-mail são declarados, sem validação
  de titularidade externa. Ver `docs/redesign/PRIMEIRO_ACESSO_CNPJ.md`; só homologação.

- Login Google no PR #90 (`codex/google-login`): botão padrão, conta Google
  verificada + vínculo ativo. **Ainda falta criar/configurar cliente OAuth Google**
  (`GOOGLE_LOGIN_CLIENT_ID` e `GOOGLE_LOGIN_CLIENT_SECRET`); botão desativado até
  configurar. O primeiro e-mail de homologação será parametrizado na infraestrutura,
  sem expor o endereço ou credenciais no código. Ver `docs/redesign/GOOGLE_LOGIN.md`.

- Plano, decisões aprovadas e pendências: `docs/redesign/PLANO_REDESIGN.md`; protótipo em `docs/redesign/prototipo/`.
- Etapa 1 (branch `claude/redesign-etapa1`): `/` Painel, `/pedidos`, `/novo-processo`, `/cadastros`; o app anterior inteiro fica em `/classico`.
- Painel (`/`) em formato de dashboard (2026-10-16, protótipo `Dashboard.dc.html`); contas em `lib/dashboard.ts`.
- Financeiro (`/financeiro`, 2026-10-17): comissões e margens por processo; contas em `lib/finance.ts`; controle em `supply_chain_notes.finance`; emitentes em `finance_issuers` (migração 0033).
- Pedido em 6 fases (`lib/order-phases.ts`): Pedido → Produção → Embarque → Documentos → Trânsito → Entregue.
- Migration `0029` (aditiva): campos novos de cadastro (endereço do fornecedor, notify party/incoterm/moeda do cliente, unidade de venda/embalagem do produto).

- Importação de fornecedores do app antigo (CHG-20261015-014): Cadastros → Fornecedores → "Importar do app antigo…", JSON de exportação/backup, prévia e confirmação; grava na empresa ativa sem duplicar nem sobrescrever.

- Importação de clientes e produtos (CHG-20261015-016): mesma tela em Clientes/Produtos; sem tabela no arquivo, reconstrói pelos processos e marca "Pendente".

- Importação de processos (CHG-20261015-017): 19 processos do backup de 2026-09-29 com etapas recriadas, florestas CAR, parceiros, avisos e plano industrial; documentos/arquivos pendentes (parte 2).

- Importação de arquivos (CHG-20261015-018): 451 arquivos do pacote de 2026-09-29 no storage de homologação e 400 documentos ligados aos processos importados.

- Página do pedido `/pedidos/<id>` (CHG-019/020): 6 fases, etapas editáveis, emissão de documentos, arquivos por fase, tarefas estilo Asana, comentários com @menções, presença e proteção contra edição simultânea (migration 0030).
- Prévia dos custos logísticos por processo (`operations.logistics_costs_json`, migration 0032, `lib/logistics-costs.ts`): lançada na seção 5 do Novo processo, editável no pedido, usada na margem do card Financeiro. Desde 2026-10-16 no formato da cotação do agente/armador: grupos com linhas por serviço (moeda, tarifa, qtd, unidade), câmbio e total por moeda/convertido (`app/ui/logistics-costs-editor.tsx`); registros antigos de campos fixos são convertidos na leitura.
- Margem estimada do processo (`lib/margin.ts`): venda − compra − prévia logística, em US$ e R$ pelo câmbio da prévia logística. Preço indicativo de compra em `supply_chain_notes.purchasePrice` (`lib/order-terms.ts`); seção 4 do Novo processo e card Financeiro do pedido usam a mesma conta.
- Layout da página do pedido = protótipo aprovado `docs/redesign/prototipo/Processo.dc.html` (CHG-021): emissão de documentos editável na fase Pedido, etapas/tarefas em tabela com gaveta de comentários, seguidores e conflito campo a campo (migration 0031). Tarefas do checklist são distribuídas nas fases pelo texto (`taskPhaseIndex`).

## Correção do primeiro acesso

- `fix/auth-form-origin`: formulário era recusado por Origin:null sob no-referrer.
  Runtime usa strict-origin, mantendo paths/tokens fora do Referer e validação CSRF
  estrita. Sem alterações de dados. Cadastro manual real ainda precisa ser repetido
  pelo Ivam após deploy; produção continua sem aprovação.

## Avaliação funcional

- Parecer e lacunas priorizadas: `docs/reviews/FUNCTIONAL_REVIEW_2026-10-14.md`.
- Verificação real de acesso às abas em 2026-10-15: `docs/reviews/HOMOLOGATION_TESTS_2026-10-15.md`. Infraestrutura online, navegação autenticada bloqueada por falta de sessão/OAuth Google. PR #91 corrige os dois GETs de cadastro que devolviam 500 em vez de 401 (build e 69 testes locais passaram); não tratar as abas como aprovadas nem promover produção.

## Governança

Toda mudança deve passar por:
`work branch → homologation → validação → main`

Arquivos obrigatórios de coordenação:
- `AGENTS.md`
- `CLAUDE.md`
- `docs/change-control/CHANGELOG.md`
- `docs/AI_COLLABORATION_LOG.md`


## Agentes Railway

### Homologação
- Serviço: `agent-homologation`
- Service ID: `8a919e00-9f91-4596-b388-3409dff5f4d1`
- Branch alvo: `homologation`

### Produção
- Serviço: `agent-production`
- Service ID: `ee03364b-be25-452a-a862-a3b71eccc957`
- Branch alvo: `main`
- Aprovação humana obrigatória para ações críticas.
- Mudanças diretas em produção bloqueadas por política.

- Colaboradores convidados por processo (2026-10-16): perfil `convidado` só acessa os processos em `operation_collaborators` (trava em `server/railway/collaborators.mjs` → `guestGate` e em `lib/security.ts` → `assertOperationAccess`); sem dados financeiros. Toda rota nova usada pela tela do pedido precisa ser liberada explicitamente para convidados.

- Produção: endereço do app passou a ser https://exportatrust.up.railway.app (renomeado em 2026-10-16 a pedido de Ivam; o antigo web-api-production-e342.up.railway.app deixou de responder). E-mail automático (Resend, remetente `operacoes@greendiamont.com`, domínio verificado) configurado em produção e homologação via `RESEND_API_KEY`/`EMAIL_FROM`.
