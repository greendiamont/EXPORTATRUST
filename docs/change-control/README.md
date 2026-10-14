# Change Control — ExportaTrust

Esta pasta é a base canônica de registro de alterações do ExportaTrust.

## Arquivos

- `CURRENT_STATE.md`: fotografia do estado arquitetural e dos ambientes.
- `CHANGELOG.md`: histórico append-only das mudanças.
- `CHANGE_TEMPLATE.md`: modelo obrigatório para cada nova entrada.
- `changes.jsonl`: índice machine-readable, uma linha JSON por alteração relevante.

## Política

O registro é obrigatório para mudanças feitas por qualquer agente ou desenvolvedor.

Nenhuma alteração deve ser considerada concluída enquanto a documentação correspondente não estiver registrada no mesmo PR.

O histórico é append-only: corrija uma entrada adicionando outra entrada de correção; não apague registros antigos.

## Fluxo

1. Ler o estado atual.
2. Ler as entradas mais recentes do changelog.
3. Criar branch a partir de `homologation`.
4. Implementar mudança localizada.
5. Atualizar changelog/estado.
6. PR para `homologation`.
7. Validar CI + homologação.
8. Promover para `main` somente após aprovação.
