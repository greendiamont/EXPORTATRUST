# ExportaTrust — AI Collaboration Log

Este documento é o registro canônico de alterações realizadas por assistentes/agentes no projeto ExportaTrust.

## Regras obrigatórias

1. Antes de qualquer alteração, leia este arquivo e verifique as entradas mais recentes.
2. Toda alteração deve ser feita em branch própria e integrada por Pull Request.
3. Antes do merge, registre neste arquivo:
   - data;
   - agente responsável;
   - branch;
   - PR;
   - arquivos/módulos alterados;
   - motivo;
   - impacto esperado;
   - riscos;
   - migrações necessárias;
   - status de CI/deploy.
4. Nunca sobrescreva uma mudança recente sem registrar claramente o conflito e a decisão.
5. Mudanças de banco, autenticação, documentos, integrações, dados financeiros ou exclusão de dados exigem atenção especial.
6. Produção e homologação devem permanecer separadas.
7. O repositório GitHub é a fonte de verdade do código.
8. Backups e dados não devem ser apagados automaticamente.
9. Se houver dúvida sobre uma mudança feita por outro agente, preserve o comportamento existente e abra uma entrada de conflito antes de alterar.
10. Este arquivo deve ser atualizado no mesmo PR da alteração funcional.
11. Para qualquer alteração de frontend React/TypeScript, leia e siga `docs/skills/SENIOR_REACT_FRONTEND.md` antes de implementar.

## Convenção de ambientes

- `main` = produção
- `homologation` = homologação
- branches `feature/*`, `fix/*`, `migration/*`, `docs/*` = trabalho isolado

## Estado-base conhecido

- Repositório: `greendiamont/EXPORTATRUST`
- Produção de código: `main`
- Homologação: `homologation`
- Commit-base registrado em 2026-10-14: `a30a1421233cf898f02119004e1ec596c37656b8`
- Cloudflare continua sendo usado inicialmente para R2/documentos.
- Railway será preparado para runtime + PostgreSQL, mantendo homologação e produção separadas.

---

## Histórico

### 2026-10-14 — ChatGPT / Jarvis
- **Branch:** `docs/ai-collaboration-log`
- **PR:** a preencher após abertura
- **Tipo:** documentação / governança
- **Alteração:** criação deste registro canônico de colaboração entre ChatGPT, Codex, Claude e outros agentes.
- **Motivo:** evitar sobrescritas e garantir rastreabilidade entre agentes trabalhando no mesmo repositório.
- **Impacto:** nenhum impacto funcional no app.
- **Risco:** baixo.
- **Migração:** nenhuma.
- **CI/deploy:** pendente no momento da criação.

### 2026-10-14 — ChatGPT / Jarvis
- **Branch:** `homologation`
- **Tipo:** infraestrutura / fluxo de release
- **Alteração:** criação da branch `homologation` a partir de `main`.
- **Motivo:** separar homologação de produção.
- **Impacto:** prepara fluxo de deploy Railway com ambientes distintos.
- **Risco:** baixo; nenhuma alteração de produção aplicada.
- **Migração:** nenhuma.
- **CI/deploy:** não aplicável.

### 2026-10-14 — ChatGPT / Jarvis
- **Branch:** `docs/ai-collaboration-log`
- **PR:** #78
- **Tipo:** padrão técnico / frontend
- **Alteração:** inclusão da skill `docs/skills/SENIOR_REACT_FRONTEND.md` e vinculação obrigatória no fluxo de colaboração.
- **Motivo:** padronizar React/TypeScript, UX, acessibilidade, responsividade, APIs, segurança e critérios de conclusão entre ChatGPT, Codex e Claude.
- **Impacto:** passa a ser a referência obrigatória para mudanças de frontend.
- **Risco:** baixo.
- **Migração:** nenhuma.
- **CI/deploy:** documental.


### 2026-10-14 — ChatGPT / Jarvis
- **Branch:** `docs/railway-infrastructure-log`
- **PR:** a preencher após abertura
- **Tipo:** infraestrutura / Railway
- **Alteração:** criação do projeto Railway `ExportaTrust` no workspace pessoal e provisionamento do serviço `Postgres` no ambiente `production`.
- **Railway Project ID:** `74645f02-a85d-4b9a-8244-148784d8b633`
- **Production Environment ID:** `2f662215-9a8e-41a2-9cc1-43d0720a384e`
- **Motivo:** iniciar a arquitetura alvo GitHub → Railway Web/API → PostgreSQL, mantendo Cloudflare R2 para documentos nesta fase.
- **Impacto:** novo ambiente de infraestrutura criado; nenhum dado de produção atual foi migrado ou removido.
- **Risco:** baixo/moderado; banco novo e vazio até a migração controlada.
- **Migração:** pendente D1/SQLite → PostgreSQL; ainda não executar cutover.
- **CI/deploy:** serviço PostgreSQL provisionado no Railway; app Web/API ainda não conectado para evitar deploy incompatível antes da adaptação do runtime.


### 2026-10-14 — ChatGPT / Jarvis
- **Branch:** `docs/railway-homologation-bootstrap`
- **PR:** a preencher após abertura
- **Tipo:** infraestrutura / Railway
- **Alteração:** criação de infraestrutura isolada para homologação usando projeto Railway dedicado `ExportaTrust Homologation`, com PostgreSQL próprio e serviço vazio `web-api`. Também foi criado `web-api` no projeto de produção.
- **Railway Production Project ID:** `74645f02-a85d-4b9a-8244-148784d8b633`
- **Railway Homologation Project ID:** `f1b37adf-57c3-4cad-9f52-786dd65357ad`
- **Production Web/API Service ID:** `0138e1a2-8d68-4df7-ab51-c240b1e78cc1`
- **Homologation Web/API Service ID:** `874bdc7f-fd50-47f8-8fd0-3277954ae9df`
- **Motivo:** manter isolamento máximo entre produção e homologação, já que a integração Railway disponível não expõe criação de novos environments dentro do mesmo projeto.
- **Impacto:** homologação passa a ter banco separado; produção e homologação não compartilham PostgreSQL.
- **Variáveis configuradas:** `APP_ENV` e `DATABASE_URL` por serviço, sem deploy.
- **Risco:** baixo; serviços Web/API ainda sem source e não publicados.
- **Migração:** pendente adaptação D1/SQLite → PostgreSQL e runtime Cloudflare Worker → Node/Railway.
- **CI/deploy:** PostgreSQL production ativo; PostgreSQL homologation provisionado; Web/API sem source para evitar deploy incompatível.


### 2026-10-14 — ChatGPT / Jarvis
- **Branch:** `docs/change-control-registry`
- **PR:** a preencher após abertura
- **Tipo:** governança / coordenação multiagente
- **Alteração:** criação de `AGENTS.md`, `CLAUDE.md` e da pasta `docs/change-control/` com estado atual, changelog append-only, template e índice JSONL.
- **Motivo:** garantir que ChatGPT, Codex e Claude leiam o mesmo estado antes de alterar o projeto e registrem toda mudança no mesmo PR.
- **Impacto:** estabelece o registro canônico de alterações para homologação e produção.
- **Risco:** baixo.
- **Migração:** nenhuma.
- **CI/deploy:** documental.

### 2026-10-14 — Claude
- **Branch:** `claude/railway-homologation-runtime`
- **PR:** #84
- **Tipo:** infraestrutura / migração / segurança
- **Alteração:** runtime Node para o `web-api` no Railway (`server/railway/`): API do D1 sobre PostgreSQL com tradução SQLite→PostgreSQL, migrações `drizzle/*.sql` no PostgreSQL, API do R2 sobre bucket S3, login de homologação e remoção de cabeçalhos de identidade falsificáveis. Bucket `documents-homologation` e variáveis configurados no projeto `ExportaTrust Homologation`.
- **Motivo:** o `web-api` de homologação respondia só a página; todas as APIs falhavam em Node e a autenticação dependia de cabeçalhos que, fora do ChatGPT Sites/Cloudflare Access, podem ser forjados.
- **Impacto:** homologação funcional de ponta a ponta. Código de `app/`, `lib/`, `db/` e `worker/` inalterado; build do ChatGPT Sites/Cloudflare inalterado.
- **Risco:** moderado (tradução SQL cobre os padrões atuais; ver `docs/RAILWAY_RUNTIME.md`).
- **Migração:** schema PostgreSQL de homologação criado vazio; nenhum dado de produção tocado.
- **CI/deploy:** testes locais em PostgreSQL 16; deploy e validação no Railway de homologação após merge em `homologation`.
- **Observação para outros agentes:** `docs/change-control/changes.jsonl` não tinha as entradas CHG-20261014-002 e -003; não foram adicionadas por mim para não reescrever registros de outro agente.

### 2026-10-14 — Claude
- **Branch:** `claude/fixes-eudr-auth-review`
- **PR:** #85
- **Tipo:** correção / compliance / documentação
- **Alteração:** regra de aplicabilidade EUDR (países UE em PT/EN/ISO, commodities do Anexo I por SH), palavras-chave documentais por palavra inteira, 401/403 em vez de 500 nas APIs, e2e com CNPJ válido e parecer funcional em `docs/reviews/FUNCTIONAL_REVIEW_2026-10-14.md`.
- **Motivo:** varredura funcional do fluxo pedido → packing list → invoice → embarque.
- **Impacto:** processos para a UE voltam a exigir EUDR; ver lacunas priorizadas no parecer antes de planejar novas features.
- **Risco:** baixo/moderado (regra mais restritiva, intencional).
- **Migração:** nenhuma.
- **CI/deploy:** testes locais; deploy em homologação após merge.
- **Para outros agentes:** o parecer lista as lacunas por prioridade (emissão numerada de documentos, Commercial/Proforma Invoice, unidade por item, conciliação PL × pedido × invoice, endereço do fornecedor). Recomendo dividir `app/client-app.tsx` antes de features grandes para evitar conflitos.

### 2026-10-14 — Claude
- **Branch:** `claude/data-migration-homologation`
- **PR:** #86
- **Tipo:** migração de dados / segurança
- **Alteração:** importação integral (banco + arquivos) liberada em homologação, com ajuste registrado de valores incompatíveis com PostgreSQL, operador mantido como administrador e correção do filtro de cabeçalhos do runtime Railway. Roteiro em `docs/MIGRATION_PRODUCTION_TO_HOMOLOGATION.md`.
- **Motivo:** trazer todos os dados de produção para homologação.
- **Impacto:** a cópia depende das exportações feitas na produção (ChatGPT Sites) por um usuário com permissão de exportação.
- **Risco:** baixo; produção somente leitura.
- **Migração:** ver roteiro.
- **CI/deploy:** testes locais em PostgreSQL; deploy em homologação após merge.
- **Para outros agentes:** não cadastrar dados em homologação antes da importação inicial (a importação do banco exige destino vazio).

### 2026-10-15 — Claude
- **Branch:** `claude/redesign-etapa1`
- **PR:** #87
- **Tipo:** feature / frontend / migração aditiva
- **Alteração:** etapa 1 do redesign — Painel, Pedidos, Novo processo e Cadastros (+ Equipe) com o novo visual; app anterior preservado em `/classico`.
- **Motivo:** redesign aprovado pelo Ivam.
- **Impacto:** nova página inicial; funções antigas acessíveis por "Versão anterior".
- **Risco:** baixo/moderado.
- **Migração:** `0029` (6 colunas texto, aditiva).
- **CI/deploy:** testes locais em PostgreSQL; deploy em homologação após merge autorizado.
- **Para outros agentes (passagem para o ChatGPT):** leia `docs/redesign/PLANO_REDESIGN.md` antes de continuar. Ele traz as decisões aprovadas, as etapas 2–5 e o desenho do login individual (pendente). Telas novas ficam em `app/ui/` com CSS escopado em `.et2`; evite editar `app/client-app.tsx`.

### 2026-10-15 — Codex / Jarvis
- **Branch:** `codex/individual-login` (base: head do PR #87, `b1ae21f`).
- **PR:** #88; destino `homologation`; #87 já integrado no commit `0bbaff14`.
- **Alteração:** continuação da etapa 1 com login individual, link de senha por administrador da mesma empresa, transação de uso único, scrypt, CSRF e revogação imediata das sessões individuais após reset/inativação.
- **Arquivos:** runtime `server/railway/`, `app/ui/equipe-view.tsx`, testes e docs de redesign/change control.
- **Motivo:** executar a pendência documentada pelo Claude sem refazer as telas aprovadas.
- **Dados/riscos:** duas tabelas novas no PostgreSQL (credenciais/tokens); sem escrita em produção, D1/R2 ou documentos. Backups integrais privados precisam incluir credenciais. Teste real de login de usuário permanece pendente até validação na homologação.
- **Testes:** build Railway, 63 testes com PGlite, smoke HTTP local e ESLint passaram; TypeScript mantém 89 erros (nenhum no componente alterado).
- **Autorização:** Ivam autorizou deixar as alterações em homologação para testes em 2026-10-15. Não autorizou produção.
- **Para Claude/outros agentes:** leia `docs/redesign/LOGIN_INDIVIDUAL.md`; não há novo provedor externo nem envio de e-mail automático; não registrar links/tokens. Branch de origem do Claude preservada.

### 2026-10-15 — Codex / Jarvis — Resultado de publicação dos PRs #87 e #88
- Integrados somente em `homologation` com autorização do Ivam; commit funcional `fd20afb3`.
- Railway de homologação: deploy `f7ad5232-19ff-4b94-bd69-a24a10025d9d` SUCCESS; healthcheck passou, serviços online sem pendências na conferência.
- Código do Claude preservado; `main`, banco e serviços de produção não alterados. Não importamos dados/documentos nesta entrega.
- Publicado para os testes da equipe, **não aprovado funcionalmente nem autorizado para produção**. Teste autenticado real, conferência dos dados e validações do roteiro seguem pendentes.

### 2026-10-15 — Codex/Jarvis — Login padrão com Google
- **Branch:** `codex/google-login` → `homologation`; PR #90.
- **Motivo:** Ivam confirmou uso de Gmail e pediu a mesma forma de login para todos.
- **Alteração:** Google OIDC via biblioteca oficial, PKCE/state/nonce e vínculo por subject; contas sem acesso ativo recusadas. Bootstrap de homologação parametrizado apenas para o e-mail escolhido pelo proprietário; sem reativar membros ou alterar perfis existentes.
- **Arquivos/dados:** runtime Railway, dependência `google-auth-library`, testes; uma tabela de identidades Google. Sem mudança em produção ou documentos.
- **Bloqueio real:** cliente OAuth Google ainda precisa ser criado/configurado por administrador; não há ID/secret no serviço. Botão indisponível até configuração, sem quebrar login atual.
- **Próximo agente:** ler `docs/redesign/GOOGLE_LOGIN.md`; não usar credenciais de Gmail automaticamente nem publicar secrets. Não confundir autenticação Google com acesso público aos dados.

### 2026-10-15 — Codex/Jarvis — Teste inicial das abas de homologação
- **Branch:** `fix/catalog-auth-homologation` → `homologation`; PR #91.
- **Escopo:** 15 verificações HTTP reais + observação da tela de login. Sem sessão, conteúdo das abas não foi validado; não declarar teste funcional aprovado.
- **Falhas reais:** GETs de Clientes/Produtos retornam 500 por Response de autenticação não capturada. Correção localizada preserva 401/403, consultas e permissões; regressão testa os handlers compilados.
- **Relatório:** `docs/reviews/HOMOLOGATION_TESTS_2026-10-15.md`, com matriz e roteiro dos testes autenticados.
- **Dados/produção:** sem alterações em banco, documentos, R2 ou produção. Sem acesso ao Google Cloud, conforme preferência do Ivam.

### 2026-10-15 — Codex/Jarvis — Primeiro acesso visível no login
- **Branch:** `codex/self-registration` → `homologation`; PR #92.
- **Pedido:** Ivam precisa que o destinatário possa cadastrar o próprio e-mail na entrada.
- **Entrega:** formulário público de solicitação por empresa, revisão em Equipe e geração do link de senha ao liberar acesso. Google permanece dependente do cliente OAuth.
- **Dados:** só tabela aditiva de solicitações; sem autoaprovação, mudança de credenciais existentes, escrita em produção ou documentos.
- **Validação:** build, testes PGlite e lint; validação manual autenticada ainda pendente.
- **Passagem:** ler `docs/redesign/PRIMEIRO_ACESSO.md`. Cadastro público não equivale a administrador criado nem prova de propriedade do e-mail. Link de senha deve ser entregue ao destinatário confirmado; não há envio automático.

### 2026-10-15 — Codex/Jarvis — Cadastro inicial por CNPJ
- **Branch:** `codex/cnpj-onboarding` → `homologation`; PR #93.
- **Pedido explícito:** Ivam quer CNPJ como identificador, criar empresa/estrutura no primeiro cadastro e olho para conferir senha.
- **Entrega:** empresa nova isolada + administrador com senha/sessão; equipe solicita pelo CNPJ. Duplicidade de CNPJ/e-mail não permite tomada de conta ou reset público. Olho acessível em todas as senhas.
- **Dados:** reserva aditiva por CNPJ e transação organização/usuário/vínculo/credencial; alinhamento da sequência protege seed organização 1. Sem movimentação de documentos/dados existentes ou mudança de produção.
- **Validação:** build, 72 testes PGlite e lint; teste manual real pendente.
- **Passagem:** docs/redesign/PRIMEIRO_ACESSO_CNPJ.md substitui o desenho por slug de #92 conforme instrução do Ivam. Titularidade CNPJ/e-mail não verificada externamente; Google OAuth ainda pendente.

### 2026-10-15 — Codex/Jarvis — Falha real no POST de cadastro
- **Branch:** `fix/auth-form-origin` → `homologation`; PR #94.
- **Evidência:** imagem do Ivam: Origem da requisição não autorizada após cadastro.
- **Correção:** Referrer-Policy strict-origin em vez de no-referrer; origem preservada em basic form POST sem expor query/token. CSRF continua recusando null/ausente/externo.
- **Teste:** servidor Node real isolado, sem banco nem conta; headers nas telas e diferença 401 mesma origem / 403 origem inválida. Fetch anterior não cobria o comportamento de Origin em form POST no browser.
- **Limites:** browser remoto bloqueou ação de teste por política, sem contorno. Teste manual do cadastro permanece necessário após deploy.
- **Dados:** nenhum dado real modificado; checkout próprio preserva edição local alheia em EUDR.dc.html. Produção não alterada.

### 2026-10-15 — Claude — Importar fornecedores do app antigo
- **Branch:** `claude/importar-fornecedores` → `homologation`; PR #95; CHG-20261015-014.
- **Conferência antes de alterar:** PRs #88–#94 (Codex/Jarvis) lidos e preservados; deploy `811b11cf` (commit `8f03d34`) SUCCESS; logs mostram cadastro por CNPJ concluído e telas novas respondendo 200.
- **Alteração:** importação de fornecedores por JSON do app antigo em Cadastros → Fornecedores, com prévia e confirmação; sem schema novo.
- **Dados:** grava só na empresa ativa; nunca sobrescreve nem apaga. Arquivo real de teste (backup 2026-09-29) fica fora do repositório.
- **Para outros agentes:** a empresa criada pelo cadastro por CNPJ começa vazia; a cópia integral do PR #86 recusa destino com mais de uma empresa/usuário e precisa de ajuste antes de ser usada. Para importar processos depois, use o mapa id antigo → novo registrado em `SUPPLIERS_IMPORT_FINISHED`.

### 2026-10-15 — Claude — Importação automática dos fornecedores
- **Branch:** `claude/importacao-automatica-fornecedores` → `homologation`; CHG-20261015-015. Ivam autorizou todos os merges necessários e a importação sem nova confirmação.
- **Alteração:** `server/railway/startup-import.mjs` executa, na inicialização, a importação do PR #95 quando `EXPORTATRUST_SUPPLIER_IMPORT_B64` existe.
- **Para outros agentes:** a variável é temporária e deve ser removida após o uso; não versionar dados de fornecedores. Para outra empresa, use `EXPORTATRUST_SUPPLIER_IMPORT_ORG_IDS`.

### 2026-10-15 — Claude — Importar clientes e produtos do app antigo
- **Branch:** `claude/importar-clientes-produtos` → `homologation`; PR #98; CHG-20261015-016.
- **Alteração:** `/api/registry-import` (clientes/produtos) e botão de importação em Clientes e Produtos; importação automática por `EXPORTATRUST_REGISTRY_IMPORT_B64`.
- **Para outros agentes:** o backup de 2026-09-29 não tinha as tabelas de clientes/produtos; os cadastros foram reconstruídos pelos processos e estão "Pendente". Quando houver a exportação integral do app antigo, importe-a pela mesma tela: ela completa os campos vazios pelo id antigo, sem duplicar. Processos ainda não foram importados (próxima etapa).

### 2026-10-15 — Claude — Importar processos do app antigo (parte 1)
- **Branch:** `claude/importar-processos` → `homologation`; PR #99; CHG-20261015-017.
- **Alteração:** `/api/process-import` e etapa "processos" na importação automática.
- **Para outros agentes:** referência de processo e código CAR são únicos no banco inteiro; a cópia integral da produção (PR #86) para a empresa 1 precisa tratar a colisão com os dados já importados na empresa 2 (HUB DAS AMÉRICAS). Parte 2 (arquivos) pendente: mapear `operation_documents`/`forest_documents` para os novos ids e enviar os 451 arquivos ao storage.

### 2026-10-15 — Claude — Importar arquivos e documentos do app antigo (parte 2)
- **Branch:** `claude/importar-documentos` → `homologation`; PR #100; CHG-20261015-018.
- **Alteração:** `/api/document-import` e importação do pacote de arquivos na inicialização (`EXPORTATRUST_FILES_IMPORT_URL`).
- **Para outros agentes:** arquivos de dados e documentos ficam no storage (bucket) e no banco do Railway, nunca no repositório. O anexo `exportatrust-full-r2-2026-09-29.tar` do release público deve ser removido após a importação (autorizado por Ivam).

### 2026-10-15 — Claude — Página do pedido na interface nova
- **Branch:** `claude/pagina-pedido` → `homologation`; PR #101; CHG-20261015-019.
- **Alteração:** `/pedidos/<id>` substitui a abertura do app anterior ao clicar num pedido.
- **Para outros agentes:** próximos passos da etapa 2 ainda pendentes: comentários/@menções, criar/concluir tarefas na tela nova, presença e proteção contra edição simultânea; etapa 4 (aba EUDR) substitui o link para a versão anterior.

### 2026-10-15 — Claude — Pedido colaborativo (estilo Asana)
- **Branch:** `claude/pedido-colaborativo` → `homologation`; PR #102; CHG-20261015-020.
- **Alteração:** tarefas interativas, comentários com @menções, presença, aviso de alterações e conflito de edição na página do pedido; migration 0030 (tabelas novas).
- **Para outros agentes:** ao salvar etapa/tarefa pela tela nova, envie `expectedUpdatedAt`; a API devolve 409 `{conflict, current}` quando outra pessoa salvou antes.

### 2026-10-15 — Claude — Página do pedido no layout aprovado
- **Branch:** `claude/pedido-layout-aprovado` → `homologation`; CHG-20261015-021.
- **Alteração:** `app/ui/pedido-view.tsx` refeito seguindo `docs/redesign/prototipo/Processo.dc.html`; migration 0031 aditiva.
- **Para outros agentes:** o protótipo é a referência visual da página do pedido; não voltar ao layout de cartões dos PRs #101/#102. Ao salvar dados comerciais pela tela nova, envie `expectedUpdatedAt` = `settings.updatedAt`.

### 2026-10-15 — Claude — Editar dados do pedido
- **Branch:** `claude/editar-dados-pedido` → `homologation`; CHG-20261015-023 (pedido de Ivam na conversa).
- **Para outros agentes:** para alterar dados do pedido pela tela nova use `PATCH /api/operations` com `{ id, fields, original }` (só campos alterados). Não use o PUT, que regrava todos os campos.

### 2026-10-15 — Claude — Novo processo: exportador selecionável
- **Branch:** `claude/exportador-selecionar` → `homologation`; CHG-20261015-024 (pedido de Ivam na conversa).
- **Para outros agentes:** Ivam confirmou o layout da tela Novo processo como está; a única mudança autorizada foi o exportador/trading selecionável com CNPJ do cadastro. O exportador (fornecedor ou trading) é o que aparece nos documentos do pedido.

### 2026-10-15 — Claude — Prévia dos custos logísticos
- **Branch:** `claude/custos-logisticos` → `homologation`; CHG-20261015-025 (pedido de Ivam na conversa); migration 0032.
- **Para outros agentes:** custos logísticos ficam em `operations.logistics_costs_json`; use `lib/logistics-costs.ts` (sanitize/parse/total). Enviar `logisticsCosts` no POST/PUT de `/api/operations` ou em `fields.logisticsCosts` no PATCH.

### 2026-10-16 — Claude — Produção publicada
- **PR #108** (homologation → main), autorizado por Ivam ("Pode produzir"); CHG-20261016-001.
- **Para outros agentes:** produção em https://web-api-production-e342.up.railway.app (projeto Railway "ExportaTrust", `web-api` segue `main`). Banco de produção ainda sem os dados do app antigo; não carregar dados em produção sem autorização de Ivam.
### 2026-10-15 — Claude — Protocolo de layout aprovado
- **Branch:** `claude/protocolo-layout` → `homologation`; CHG-20261015-022.
- **Para outros agentes (OBRIGATÓRIO):** leia `docs/change-control/LAYOUT_PROTOCOL.md`. Layout aprovado não muda, não é sobrescrito nem recriado; só muda quando Ivam pedir. PR que toca arquivos de layout é reprovado sem a etiqueta `layout-autorizado-ivam`, que o agente só coloca quando Ivam autorizou na conversa (registrando a frase dele). Ivam não faz nada manual: "layout aprovado" na conversa = travar.

### 2026-10-16 — Claude — Painel: Processos · negociação
- **Branch:** `claude/painel-processos`; CHG-20261016-006; layout aprovado por Ivam.
- **Para outros agentes:** termos negociados (pagamento, medidas, preço) ficam no JSON do pedido em `operations.supply_chain_notes`; leia e grave só por `lib/order-terms.ts` (preserva texto livre antigo). Edição do processo: `/novo-processo?processo=<id>` + `PATCH /api/operations` com `fields.terms`.

### 2026-10-16 — Claude — Custos logísticos por serviço
- **Branch:** `claude/custos-por-servico`; CHG-20261016-009; aprovado por Ivam ("alteração aprovada PODE PRODUZIR").
- **Para outros agentes:** `operations.logistics_costs_json` agora guarda `groups[{name, items[{service, currency, rate, quantity, unit}]}]` + `exchangeRate`, `agent`, `equipment`, `validUntil`, `notes`. Leia e grave só por `lib/logistics-costs.ts` (converte o formato antigo de campos fixos). Tela: `app/ui/logistics-costs-editor.tsx` (layout aprovado, travado).

### 2026-10-16 — Claude — Preço de compra e margem
- **Branch:** `claude/preco-compra-venda`; CHG-20261016-011; aprovado por Ivam ("alteração aprovada PODE SUBIR PRA PRODUÇÃO").
- **Para outros agentes:** margem = `lib/margin.ts` (`estimateMargin`), usada no Novo processo e no Financeiro do pedido — não duplicar a conta. Preço indicativo de compra fica em `supply_chain_notes.purchasePrice` (via `lib/order-terms.ts`); a emissão do pedido preserva chaves extras desse JSON.

### 2026-10-16 — Claude — Margem por m³
- **Branch:** `claude/margem-por-m3`; CHG-20261016-013.
- **Para outros agentes:** `applyOrderTerms` com `purchaseUnitPrice` também atualiza `supplierOrder.items[0]` quando o pedido de compra tem um item; `readOrderTerms` devolve `supplierItemCount`.

### 2026-10-16 — Claude — Shipment Advice no pedido novo
- **Branch:** `claude/shipment-advice`; CHG-20261016-016.
- **Para outros agentes:** a fase 4 do pedido usa `app/ui/shipment-advice-card.tsx` sobre `/api/shipment-advice` (mesmas regras do app antigo). `POST /api/documents` aceita `documentType` e, na categoria do set, grava tipo + "Candidato"/"Revisão pendente". Envio real depende de `RESEND_API_KEY`/`EMAIL_FROM` no Railway.

### 2026-10-16 — Claude — Convidado por processo (SEGURANÇA)
- **Branch:** `claude/convidar-colaborador`; CHG-20261016-022.
- **Para outros agentes (OBRIGATÓRIO):** o perfil `convidado` passa pela trava `guestGate` (server/railway/collaborators.mjs): APIs não listadas lá respondem 403 para convidados. Ao criar rota usada pela tela do pedido, decida se o convidado pode usar; se sim, libere no `guestGate` E chame `assertOperationAccess` na rota, sem devolver dados financeiros.

### 2026-10-16 — Claude — Painel dashboard
- **Branch:** `claude/painel-dashboard`; CHG-20261016-029; layout aprovado por Ivam ("alteração aprovada", quadro "1b").
- **Para outros agentes:** as contas do Painel (exportado, câmbio, séries mês/ano, embarques por mês) ficam em `lib/dashboard.ts` — não duplicar. `/api/overview` ganhou `volume`, `exchangeRate`, `containers`, `completedAt`, `blockedStep`.

### 2026-10-17 — Claude — Aba Financeiro
- **Branch:** `claude/financeiro`; CHG-20261017-031.
- **Para outros agentes:** o JSON do pedido (`supply_chain_notes`) ganhou a chave `finance` (quem paga, situação, documentos emitidos) — preserve-a ao gravar o JSON. Contas de comissão/margem por processo em `lib/finance.ts` (`processGain`). Nova tabela `finance_issuers` (migração 0033). `/api/finance` não é liberada a convidados.

### 2026-10-17 — Claude — Invoice do Financeiro no modelo de Ivam
- **Branch:** `claude/financeiro-invoice-modelo`; CHG-20261017-032.
- **Para outros agentes:** documentos de `supply_chain_notes.finance.documents` podem cobrir vários processos (`references`, `share` = parte do processo). `finance_issuers` guarda emitentes e pagadores (`kind`) com os campos completos em `details_json` (migração 0034).

### 2026-10-17 — Claude — EUDR fase 1
- **Branch:** `claude/eudr-fase1`; CHG-20261017-034.
- **Para outros agentes:** o JSON do pedido ganhou a chave `eudr` (origens, documentos da cadeia, rendimento, envio) — preserve-a. `rural_properties.eudr_json` guarda tipo de origem, produtor, espécie, documentos com validade e verificações. Regras e listas de documentos só em `lib/eudr.ts`. `/api/eudr` não é liberada a convidados.

### 2026-10-17 — Claude — Financeiro do pedido
- **Branch:** `claude/financeiro-pedido`; CHG-20261017-036.
- **Para outros agentes:** o JSON do pedido ganhou a chave `payments` (parcelas e recebimentos do cliente) — preserve-a. Rota nova `/api/order-payments` (não confundir com `/api/payments`, que é a integração x402). `buildShipmentAdvice` aceita um 5º parâmetro com os recebimentos; sem ele, mantém a conta antiga.

### 2026-10-17 — Claude — Shipment Report
- **Branch:** `claude/shipment-report`; CHG-20261017-037.
- **Para outros agentes:** o servidor Railway agora tem um agendador de hora em hora (`shipment-report-scheduler.mjs`), ligado só em produção. O relatório ao cliente nunca deve incluir dados financeiros internos (margem, compra, comissão): ao mexer em `lib/shipment-report.ts`, mantenha isso.

### 2026-10-17 — Claude — Comissão em reais, idioma e assinatura
- **Branch:** `claude/comissao-reais`; CHG-20261017-038.
- **Para outros agentes:** `FinanceIssuer.signature` (PNG/JPEG em data URL, validado em `cleanIssuer`) sai no bloco de assinatura do documento. `FinanceDocument.language` ("pt" | "en") escolhe o idioma (nota fiscal sempre "pt"; documentos antigos sem o campo continuam em inglês). Rota nova `/api/exchange-rate` (PTAX de venda do BCB; não liberada a convidados).

### 2026-10-17 — Codex — Cadastro do fornecedor + e-mail da comissão
- **Branch:** `fix/commission-supplier-details`; [PR #175](https://github.com/greendiamont/EXPORTATRUST/pull/175); CHG-20261017-039; base `homologation` em `561d6931`. Somente homologação, sem autorização nova para produção.
- **Pedido:** Ivam pediu trazer o cadastro completo do fornecedor ao pagador e, depois, campo de e-mail e ações Emitir fatura / Enviar por e-mail / Cancelar. Frases exatas e escopo da etiqueta de layout no CHANGELOG.
- **Para outros agentes:** `supplierPayers` no snapshot financeiro é tenant-scoped; `findSupplierPayer` prefere ID e exige nome/alias único. `FinancePayer.phone/contactName` opcionais preservam snapshots antigos. Banco do emitente nunca é substituído pelo banco do pagador.
- **Envio explícito:** `/api/finance/email`, só admin/analista. Fatura HTML no corpo/anexo pelo renderizador compartilhado `lib/finance-document.ts` (mesmo modelo de impressão A4, não PDF gerado automaticamente). Usa Resend configurado, idempotência e histórico privado em `audit_logs`, entidade `finance_document`; não colocar valores de comissão em `client_notifications`. Não incluir este envio no scheduler do Shipment Report.
- **Preservação:** dados existentes e documentos emitidos não são regravados; sem migração. Falha de envio não apaga nem reemite fatura. Testes sem envio real; Chromium indisponível para verificação visual local. Ivam deve conferir fornecedor real, destinatário, prévia e recebimento em homologação antes de aprovar.

