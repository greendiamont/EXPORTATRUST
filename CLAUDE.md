# Claude — instruções obrigatórias do ExportaTrust

Antes de qualquer alteração, leia obrigatoriamente:

- `docs/change-control/CURRENT_STATE.md`
- `docs/change-control/CHANGELOG.md`
- `docs/AI_COLLABORATION_LOG.md`
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
