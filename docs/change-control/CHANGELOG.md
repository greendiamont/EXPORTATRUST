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
