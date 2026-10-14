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
