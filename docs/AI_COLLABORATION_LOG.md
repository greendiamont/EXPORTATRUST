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
