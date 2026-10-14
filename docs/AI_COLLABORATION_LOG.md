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
