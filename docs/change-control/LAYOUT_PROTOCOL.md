# ExportaTrust — Protocolo de layout aprovado (REGRA OBRIGATÓRIA)

> Regra definida por Ivam em 2026-10-15. Vale para todos os agentes (ChatGPT/Jarvis, Codex, Claude e outros) e para qualquer pessoa que altere o repositório.

## Regra

1. **Layout aprovado não muda.** Depois que um layout é aprovado por Ivam, ele é a referência definitiva da tela. Não pode ser alterado, sobrescrito, "melhorado", reinterpretado nem substituído por um layout novo.
2. **Só Ivam autoriza mudança de layout.** Layout só muda quando Ivam pedir, por escrito, naquela conversa, para aquela tela. Autorização para uma tela não vale para outra; autorização antiga não vale para pedido novo.
3. **Não criar layout novo por conta própria.** Nenhum agente cria tela, versão alternativa, cartão, seção ou estrutura visual que não esteja no layout aprovado sem pedido explícito de Ivam.
4. **Implementar = copiar o aprovado.** Ao construir ou corrigir uma tela, o agente abre o protótipo aprovado (tabela abaixo) e reproduz exatamente a estrutura, a ordem das seções, os textos, os componentes e as cores. Dados e funções reais entram *dentro* dessa estrutura, sem mudá-la.
5. **Correção funcional não mexe no visual.** Corrigir bug, ligar API ou ajustar dado é permitido somente sem alterar a estrutura visual. Se a correção exigir mudar o visual, o agente para e pede autorização a Ivam antes.
6. **Na dúvida, perguntar.** Se algo do protótipo não tiver dado real correspondente, o agente mantém o elemento do protótipo (com "—" ou o dado mais próximo) e informa Ivam; não remove nem redesenha.
7. **Sem gastar crédito com refação.** Retrabalho de layout por não seguir o aprovado é falha do agente e deve ser evitado lendo este protocolo antes de qualquer trabalho de interface.

## Fluxo de aprovação (Ivam só fala na conversa — nada manual)

Ivam não precisa entrar no GitHub, no Railway nem em lugar nenhum. A palavra dele na conversa é a autorização; o agente executa o resto.

1. Ivam pede uma tela nova ou uma mudança de layout na conversa.
2. O agente faz a proposta **somente** em `docs/redesign/prototipo/` (protótipo navegável) e mostra a Ivam.
3. Ivam diz na conversa **"layout aprovado"** (ou equivalente claro).
4. O agente **trava** o layout: registra na tabela "Layouts aprovados" e no histórico abaixo (data, tela, protótipo e a frase de Ivam) e no `CHANGELOG.md`.
5. A implementação segue o protótipo aprovado à risca (regra 4).
6. A partir daí a tela fica **travada**: só muda se Ivam pedir de novo, na conversa, para aquela tela.

## Trava automática no GitHub

O workflow `.github/workflows/layout-guard.yml` reprova todo PR que altere arquivos de layout protegidos (lista abaixo) sem a etiqueta **`layout-autorizado-ivam`**.

- **A etiqueta só é colocada quando Ivam autorizou na conversa.** O agente coloca a etiqueta no PR em nome de Ivam e registra, no PR e no `CHANGELOG.md`, a frase exata de Ivam que autorizou. Sem frase de Ivam pedindo aquela mudança de layout, a etiqueta não é colocada.
- Nenhum agente coloca a etiqueta por iniciativa própria, altera/desativa o workflow ou contorna a trava (por exemplo, movendo código de layout para outro arquivo).
- Correções funcionais em arquivos protegidos também precisam da autorização de Ivam na conversa: o agente explica o que muda e pergunta antes.

### Arquivos protegidos

- `docs/redesign/prototipo/**` — protótipos aprovados (fonte da verdade)
- `docs/change-control/LAYOUT_PROTOCOL.md` — este protocolo
- `.github/workflows/layout-guard.yml` — a trava
- `app/ui/et2.css` — estilos da interface nova
- `app/ui/shell.tsx` — barra superior e navegação
- `app/ui/*-view.tsx` — telas da interface nova (painel, pedidos, pedido, novo processo, cadastros, equipe)

## Layouts aprovados

| Tela | Protótipo aprovado (fonte da verdade) | Implementação | Situação |
|---|---|---|---|
| 1 · Painel | `docs/redesign/prototipo/Main.dc.html` | `app/ui/painel-view.tsx` | Aprovado — travado |
| 2 · Pedidos (lista) | `docs/redesign/prototipo/Processos.dc.html` | `app/ui/pedidos-view.tsx` | Aprovado — travado |
| 3 · Pedido (todas as fases, emissão de documentos na fase Pedido) | `docs/redesign/prototipo/Processo.dc.html` | `app/ui/pedido-view.tsx` (PR #103) | Aprovado — travado; implementação aguardando conferência de Ivam em homologação |
| 4 · EUDR | `docs/redesign/prototipo/EUDR.dc.html` | ainda não implementada | Aprovado — implementar exatamente como o protótipo |
| 5 · Novo processo | `docs/redesign/prototipo/NovoProcesso.dc.html` | `app/ui/novo-processo-view.tsx` | Aprovado — travado |
| 6 · Cadastros | `docs/redesign/prototipo/Cadastros.dc.html` | `app/ui/cadastros-view.tsx` | Aprovado — travado |

Telas fora desta tabela (login, primeiro acesso, `/classico`) não têm layout novo aprovado; não redesenhar sem pedido de Ivam.

## Histórico de aprovações e autorizações

| Data | Quem | O quê |
|---|---|---|
| 2026-10-14 | Ivam | Aprovou o redesign (protótipos 1 a 6) — `docs/redesign/PLANO_REDESIGN.md` |
| 2026-10-15 | Ivam | Reafirmou o layout aprovado do Pedido (fases e emissão de documentos) e criou esta regra |
| 2026-10-15 | Ivam | Definiu que a autorização é dada só na conversa: "eu posso dizer assim, ó, a layout aprovado, aí vocês travam o layout que foi aprovado" — sem passos manuais |
