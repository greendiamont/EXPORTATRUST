# ExportaTrust — Redesign da interface (plano e passagem de trabalho)

Atualizado em: 2026-10-15 · Autor: Claude · Branch: `claude/redesign-etapa1` → `homologation`

Este documento permite que qualquer agente (ChatGPT, Codex, Claude) continue o redesign sem refazer decisões já tomadas com o Ivam.

## Decisões aprovadas pelo Ivam

- **Visual profissional:** barra superior escura e menu único `Painel · Pedidos · Cadastros · EUDR · Relatórios`. O protótipo aprovado está em `docs/redesign/prototipo/`, com 6 telas em HTML de desenho. Ele usa IBM Plex; o app usa Geist para não depender de novas fontes no build offline.
- **"+ Novo pedido" passa a se chamar "+ Novo processo"** e abre o formulário de 6 seções do app antigo, que trata de identificação, empresas, origem, quantidades, logística e supply chain.
- **O pedido tem 6 fases:** Pedido → Produção → Embarque → Documentos → Trânsito → Entregue. O mapeamento das 13 etapas existentes (`EXPORT_ORDER_MILESTONES`) para as fases fica em `lib/order-phases.ts`.
- **A fase 1 (Pedido) contém a emissão de documentos:** Sales Order, Pedido de compra, Invoice e Packing List, com visualizar, PDF, Word e emitir.
- **Cada fase tem seus arquivos,** com Visualizar e Baixar.
- **Supply chain fica na aba EUDR**, exclusiva dos processos EUDR, e não como fase.
- **Cadastros replicam os do app antigo, com melhorias e sem perder dados:**
  - percentual de completude;
  - aviso de duplicidade;
  - processos relacionados;
  - campos novos marcados como NOVO;
  - parceiros logísticos (etapa posterior).
- **Uso simultâneo, no estilo Asana:** todos acessam e editam todos os processos.
  - Tarefas com responsável, comentários e @menções.
  - Presença ("quem está vendo") e trava de edição.
  - Tela de conflito ao salvar sobre a alteração de outra pessoa.
  - Feed de atividade e versões.
  - Login individual para cada pessoa.

## Etapas (cada uma é um PR para `homologation`)

| Etapa | Conteúdo | Estado |
|---|---|---|
| 1 | Novo visual, menu, Painel, Pedidos, Novo processo, Cadastros + Equipe, login individual | **Telas prontas neste PR; login individual pendente** |
| 2 | Página do pedido com as 6 fases, tarefas estilo Asana, comentários, arquivos por fase, proteção contra conflito | a fazer |
| 3 | Emissão de documentos com numeração, revisão, PDF/Word e conciliação pedido × PL × invoice | a fazer |
| 4 | Aba EUDR (supply chain, dossiê, DDS) | a fazer |
| 5 | Financeiro e margem | a fazer |

## O que a etapa 1 entrega (este PR)

| Rota | Arquivo | O que faz |
|---|---|---|
| `/` | `app/page.tsx` → `app/ui/painel-view.tsx` | Contagem por fase (clique abre Pedidos filtrado), pendências com prazo (Todas/Minhas), próximos embarques |
| `/pedidos` | `app/pedidos/page.tsx` → `app/ui/pedidos-view.tsx` | Filtro por fase (`?fase=0..5`), busca, andamento em 6 segmentos, próximo passo, ETD, valor, selo EUDR |
| `/novo-processo` | `app/novo-processo/page.tsx` → `app/ui/novo-processo-view.tsx` | Assistente de 6 seções com os campos do formulário antigo. Preenche dados a partir do cliente e do produto, filtra CAR pelo fornecedor, guarda rascunho no navegador e envia `POST /api/operations` |
| `/cadastros` | `app/cadastros/page.tsx` → `app/ui/cadastros-view.tsx`, `app/ui/equipe-view.tsx` | Abas Clientes, Fornecedores, Produtos, Florestas (CAR) e Equipe (`?tab=`, `?id=`). Lista com busca e filtro "Incompletos", ficha por seção, completude, aviso de duplicidade, processos relacionados, edição e criação |
| `/classico` | `app/classico/page.tsx` | **App anterior completo, sem mudanças.** Aceita `?processo=<id>` (abre o processo) e `?module=Florestas`/`Clientes`/… |

Peças de apoio:

- `app/api/overview/route.ts`: `GET` com permissão `read`. Devolve fase atual, próximo passo, pendências e contagens por fase.
- `app/ui/et2.css`: o design system novo, com tudo escopado em `.et2`, para não afetar o app clássico.
- `app/ui/shell.tsx`: barra superior e menu.
- `app/ui/page-guard.tsx`: a mesma regra de acesso da página antiga.
- `app/ui/format.ts`: utilitários. `processHref(id)` aponta para `/classico?processo=id` até a etapa 2 criar a página nova do pedido.
- `lib/order-phases.ts` e `tests/order-phases.test.mjs`: as fases e seus testes.

### Banco de dados

A migration `drizzle/0029_redesign_registration_fields.sql` só adiciona colunas, todas `text DEFAULT '' NOT NULL`:

- `suppliers.address`;
- `importer_clients.notify_party`, `preferred_incoterm`, `preferred_currency`;
- `master_products.sales_unit`, `packaging`.

Proteções para os dados existentes:

- **D1 sem a migration aplicada:** `lib/registration-columns.ts` cria as colunas sob demanda.
- **Clientes que não enviam os campos novos:** `presentText()` só grava os campos novos quando vêm no corpo da requisição. Assim, o app clássico não apaga esses valores.

**Bug corrigido:** os dados bancários do cliente (`bankDetails`) eram descartados ao salvar, porque o campo não estava no `clean()` de `/api/importer-clients`.

## Pendências da etapa 1

1. **Login individual no Railway**: implementação no PR #88 (`codex/individual-login`), continuação do PR #87; **ainda não validada funcionalmente no Railway**. Detalhes e roteiro: `docs/redesign/LOGIN_INDIVIDUAL.md`. Desenho combinado:
   - **Tabelas**, criadas no start do servidor:
     - `railway_user_credentials (email PK, password_hash, updated_at)`;
     - `railway_password_tokens (token_hash PK, email, expires_at, used_at, created_by, created_at)`.
   - **Senhas:** hash com `scrypt`.
   - **Login aceita dois caminhos:**
     - o bootstrap atual (`EXPORTATRUST_ALLOWED_EMAILS` + `EXPORTATRUST_ACCESS_PASSWORD`);
     - e-mail + senha própria, desde que exista vínculo `Ativo` em `organization_memberships`.
   - **Sessão:** revalida o vínculo, com cache de 60 s.
   - **Link de senha:** `POST /__auth/invite-link`, só para administrador, gera um link de uso único com validade de 72 h para `/__auth/definir-senha?token=…`. Senha mínima de 10 caracteres.
   - **Tela Equipe:** adicionar o botão "Gerar link de senha".
   - **Arquivos:** `server/railway/auth.mjs`, `server/railway/server.mjs`, `app/ui/equipe-view.tsx`.
2. **Parceiros logísticos** (despachante, transportadora, armador, agente de carga) e **validade de licenças/certificações** nos cadastros ficam para uma etapa seguinte.
3. **`/api/properties` devolve no máximo 100 florestas.** Se a produção tiver mais, aumentar o limite ou paginar antes de usar a aba Florestas como lista completa.
4. **Ao editar um produto, a API normaliza o NCM** (`4401.31` → `440131`). Esse comportamento já existia no app antigo e não foi alterado.

## Como testar localmente (Railway runtime + PostgreSQL)

```bash
service postgresql start
bash scripts/railway-build.sh
# variáveis: DATABASE_URL, STORAGE_DRIVER=memory, EXPORTATRUST_ALLOWED_EMAILS, EXPORTATRUST_ACCESS_PASSWORD, EXPORTATRUST_SESSION_SECRET, APP_ENV=homologation
node server/railway/server.mjs
node --experimental-strip-types --test tests/*.test.mjs
```

## Regras para quem continuar

- **Branches:** trabalhar em branch própria a partir de `homologation` e abrir PR para `homologation`. O merge só acontece com autorização explícita do Ivam para aquele PR.
- **Produção:** `main` e o Railway de produção só mudam quando o Ivam disser "pode produzir".
- **Separação do app clássico:** não alterar `app/classico/` nem `app/client-app.tsx` além do necessário. As telas novas ficam em `app/ui/` e usam as mesmas APIs.
- **Edição de cadastro:** o `PUT` das APIs de cadastro regrava todos os campos. Sempre envie o registro completo, mesclado com o que foi editado.
