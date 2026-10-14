# ExportaTrust — Regras para agentes

Este repositório é trabalhado por múltiplos agentes (ChatGPT/Jarvis, Codex, Claude e outros).

## Antes de alterar qualquer coisa

Leia, nesta ordem:

1. `docs/change-control/CURRENT_STATE.md`
2. `docs/change-control/CHANGELOG.md`
3. `docs/AI_COLLABORATION_LOG.md`
4. `docs/skills/SENIOR_REACT_FRONTEND.md` quando houver frontend React/TypeScript

## Regra de ambientes

- `homologation` = ambiente obrigatório para desenvolvimento, teste e validação.
- `main` = produção.
- Nenhuma mudança funcional deve ir direto para `main`.
- O fluxo padrão é: branch de trabalho → PR para `homologation` → validação → PR/promote para `main`.

## Registro obrigatório

Toda alteração deve:
- atualizar `docs/change-control/CHANGELOG.md`;
- atualizar `docs/change-control/CURRENT_STATE.md` quando alterar arquitetura, ambiente, banco, integrações ou comportamento relevante;
- registrar PR, branch, arquivos alterados, motivo, impacto, riscos e status;
- preservar alterações anteriores e nunca sobrescrever trabalho de outro agente sem registrar conflito e decisão.

## Dados

- Nunca apagar banco, documentos, R2, histórico ou auditoria automaticamente.
- Migrações devem ser feitas primeiro em homologação.
- Produção só recebe mudanças homologadas.
