# ExportaTrust — Regras para agentes

Este repositório é trabalhado por múltiplos agentes (ChatGPT/Jarvis, Codex, Claude e outros).

## REGRA DE LAYOUT APROVADO (obrigatória — definida por Ivam)

Leia `docs/change-control/LAYOUT_PROTOCOL.md` antes de qualquer trabalho de interface.

- Layout aprovado **não pode ser alterado, sobrescrito, substituído nem recriado**. Os protótipos em `docs/redesign/prototipo/` são a fonte da verdade e devem ser seguidos à risca.
- **Layout só muda quando Ivam solicitar**, por escrito, para aquela tela.
- Não criar telas, seções ou estruturas visuais novas por conta própria.
- Correção funcional não pode mudar o visual; se precisar, pare e peça autorização.
- PR que toca arquivos de layout protegidos é reprovado pelo GitHub sem a etiqueta `layout-autorizado-ivam`, que **só Ivam coloca**. Agentes nunca adicionam essa etiqueta nem alteram/desativam a trava.

## Antes de alterar qualquer coisa

Leia, nesta ordem:

1. `docs/change-control/CURRENT_STATE.md`
2. `docs/change-control/CHANGELOG.md`
3. `docs/AI_COLLABORATION_LOG.md`
4. `docs/change-control/LAYOUT_PROTOCOL.md` — layouts aprovados são travados
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
