# Claude — instruções obrigatórias do ExportaTrust

## REGRA DE LAYOUT APROVADO (obrigatória — definida por Ivam)

Leia `docs/change-control/LAYOUT_PROTOCOL.md` antes de qualquer trabalho de interface.

- Layout aprovado **não pode ser alterado, sobrescrito, substituído nem recriado**. Os protótipos em `docs/redesign/prototipo/` são a fonte da verdade e devem ser seguidos à risca.
- **Layout só muda quando Ivam solicitar**, por escrito, para aquela tela.
- Não criar telas, seções ou estruturas visuais novas por conta própria.
- Correção funcional não pode mudar o visual; se precisar, pare e peça autorização.
- Quando Ivam disser na conversa **"layout aprovado"**, o agente trava o layout: registra no `LAYOUT_PROTOCOL.md` e no `CHANGELOG.md`. Ivam não faz nada manual.
- PR que toca arquivos de layout protegidos é reprovado pelo GitHub sem a etiqueta `layout-autorizado-ivam`. O agente só coloca essa etiqueta quando Ivam autorizou aquela mudança na conversa, e registra a frase dele no PR. Nunca por iniciativa própria; nunca alterar/desativar a trava.

Antes de qualquer alteração, leia obrigatoriamente:

- `docs/change-control/CURRENT_STATE.md`
- `docs/change-control/CHANGELOG.md`
- `docs/AI_COLLABORATION_LOG.md`
- `docs/change-control/LAYOUT_PROTOCOL.md` (sempre, antes de mexer em interface)
- `docs/skills/SENIOR_REACT_FRONTEND.md` para frontend

Trabalhe sempre a partir da branch `homologation` ou de uma branch criada a partir dela.

Não altere `main` diretamente.

Ao concluir uma alteração:
1. registre a mudança no `CHANGELOG.md`;
2. atualize `CURRENT_STATE.md` se houver mudança estrutural;
3. inclua no mesmo PR a atualização documental;
4. informe conflitos encontrados com alterações de outros agentes;
5. preserve dados e comportamento existentes salvo instrução explícita em contrário.

O objetivo deste arquivo é impedir sobrescritas e manter ChatGPT, Codex e Claude sincronizados.
