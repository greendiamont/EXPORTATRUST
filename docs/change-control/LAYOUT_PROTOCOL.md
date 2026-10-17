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

**Toda alteração (de layout ou de funcionamento) passa por aprovação de Ivam:**

1. Ivam pede a alteração na conversa.
2. O agente faz a alteração em homologação (ou, para layout novo, primeiro no protótipo em `docs/redesign/prototipo/`) e **envia para Ivam na conversa** o que mudou e onde conferir.
3. Ivam confere e responde **"alteração aprovada"**. Sem essa frase, a alteração não é considerada aprovada.
4. Com layout novo, Ivam diz **"layout aprovado"**; o agente trava o layout: registra na tabela "Layouts aprovados" e no histórico abaixo (data, tela, protótipo e a frase de Ivam) e no `CHANGELOG.md`.
5. Produção só recebe a alteração quando Ivam disser **"pode produzir"**.
6. Tela travada só muda se Ivam pedir de novo, na conversa, para aquela tela.

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
| 1 · Painel | `docs/redesign/prototipo/Main.dc.html` (com "Processos · negociação", aprovado em 2026-10-16) | `app/ui/painel-view.tsx` | Aprovado — travado |
| 1b · Painel dashboard (substitui o topo do Painel; "Processos · negociação" fica recolhido no fim) | `docs/redesign/prototipo/Dashboard.dc.html` (aprovado em 2026-10-16) | `app/ui/painel-view.tsx` | Aprovado — travado |
| 7 · Financeiro (aba nova, última do menu) | `docs/redesign/prototipo/Financeiro.dc.html` (aceito para teste em 2026-10-17) | `app/ui/financeiro-view.tsx`, `app/ui/shell.tsx` | Aprovado — travado |
| 4b · EUDR rastreabilidade (substitui a implementação do "4 · EUDR") | `docs/redesign/prototipo/EUDRRastreio.dc.html` (aprovado em 2026-10-17) | `app/ui/eudr-view.tsx`, `app/ui/shell.tsx` (link EUDR) | Aprovado — em homologação |
| 2 · Pedidos (lista) | `docs/redesign/prototipo/Processos.dc.html` | `app/ui/pedidos-view.tsx` | Aprovado — travado |
| 3 · Pedido (todas as fases, emissão de documentos na fase Pedido) | `docs/redesign/prototipo/Processo.dc.html` | `app/ui/pedido-view.tsx` (PR #103) | Aprovado — travado; implementação aguardando conferência de Ivam em homologação |
| 4 · EUDR | `docs/redesign/prototipo/EUDR.dc.html` | ainda não implementada | Aprovado — implementar exatamente como o protótipo |
| 5 · Novo processo | `docs/redesign/prototipo/NovoProcesso.dc.html` | `app/ui/novo-processo-view.tsx` (também abre em modo "Editar negociação"; seção 4 com medidas, preço unitário e condição de pagamento) | Aprovado — travado |
| 5b · Custos logísticos (seção 5 do Novo processo e "Todos os dados do pedido") | `docs/redesign/prototipo/CustosLogisticos.dc.html` (aprovado em 2026-10-16) | `app/ui/logistics-costs-editor.tsx` | Aprovado — travado |
| 5c · Preços e margem (seção 4 do Novo processo; card Financeiro do pedido) | `docs/redesign/prototipo/PrecosMargem.dc.html` (aprovado em 2026-10-16) | `app/ui/novo-processo-view.tsx` (`PricesAndMargin`), `lib/margin.ts` | Aprovado — travado |
| 3b · Shipment Advice (fase Documentos do pedido) | `docs/redesign/prototipo/ShipmentAdvice.dc.html` (aprovado em 2026-10-16) | `app/ui/shipment-advice-card.tsx` | Aprovado — travado |
| 3c · Convidar colaborador (painel de atividade do pedido) | `docs/redesign/prototipo/ConvidarColaborador.dc.html` (aprovado em 2026-10-16) | `app/ui/collaborators-panel.tsx` | Aprovado — travado |
| 6 · Cadastros | `docs/redesign/prototipo/Cadastros.dc.html` | `app/ui/cadastros-view.tsx` | Aprovado — travado |

Telas fora desta tabela (login, primeiro acesso, `/classico`) não têm layout novo aprovado; não redesenhar sem pedido de Ivam.

## Histórico de aprovações e autorizações

| Data | Quem | O quê |
|---|---|---|
| 2026-10-14 | Ivam | Aprovou o redesign (protótipos 1 a 6) — `docs/redesign/PLANO_REDESIGN.md` |
| 2026-10-15 | Ivam | Reafirmou o layout aprovado do Pedido (fases e emissão de documentos) e criou esta regra |
| 2026-10-17 | Ivam | Pediu a invoice de comissão no padrão dos documentos do pedido e autorizou produção: "Esse é um modelo de uma invoice de comissão que eu tenho, mas você pode pegar também o modelo do layout como se fosse seguindo o padrão da emissão de pedidos ou emissão de invoice [...] para ficar dentro de um padrão, todos os documentos dentro de um padrão." / "Para a parte do financeiro, questão de emissão, de comissão, tudo ok, tá? Pode subir para produção." |
| 2026-10-17 | Ivam | Enviou o modelo da invoice de comissão (001/2026) para o documento do Financeiro seguir (Ivam enviou na conversa a imagem da invoice de comissão que já usa, nº 001/2026: Issuer / Bill to, Volume (m³) × Rate, Total due, Bank details, Notes e assinatura; cobrança de USD 3,00 por m³ sobre dois pedidos) |
| 2026-10-17 | Ivam | Aprovou o protótipo "4b · EUDR rastreabilidade" (plantio e nativa, pellets): "Alteração aprovada" |
| 2026-10-17 | Ivam | Aprovou a aba Financeiro para produção: "E pode seguir para homologação e produção. Produção aprovada." |
| 2026-10-17 | Ivam | Aceitou para teste a aba Financeiro (quadro "7"), por último no menu: "Tá ok, vamos testar isso. Eu só quero que você coloque pro final, não coloque entre pedido e cadastro. Coloque por último, depois de cadastro, tá?" |
| 2026-10-16 | Ivam | Aprovou para produção "Embarques por mês" em contêineres ou m³: "pode produzir" |
| 2026-10-16 | Ivam | Pediu "Embarques por mês" em contêineres ou m³ (seletor no gráfico): "No dashboard, eu quero, na verdade, o volume por containers, não por pedido, tá? Quero por containers. Ou por metro cúbico." |
| 2026-10-16 | Ivam | Aprovou para produção o Painel em formato de dashboard ("1b"): "pode produzir" |
| 2026-10-16 | Ivam | Aprovou o Painel em formato de dashboard (quadro "1b · Painel dashboard": exportado em US$/R$, m³, preço médio, volume e valor mês a mês/ano a ano, embarques por mês): "alteração aprovada" |
| 2026-10-16 | Ivam | Aprovou para produção comissão, cancelar pedido, convite de colaborador ("3c") e operação concluída: "pode produzir" |
| 2026-10-16 | Ivam | Aprovou para produção o Shipment Advice da fase Documentos ("3b"), os botões "Editar" e a tabela de itens com "+ Adicionar item": "pode produzir TUDO O QUE ALTERAMOS E AS CORREÇÕES" |
| 2026-10-16 | Ivam | Aprovou o botão "Editar processo" no topo do pedido: "homologação é parte do botão e tá aprovada a sessão"; "pode produzir" |
| 2026-10-16 | Ivam | Aprovou a margem por m³: "alteração aprovada PODE PRODUZIR" |
| 2026-10-16 | Ivam | Aprovou preço de compra, preço indicativo de venda e margem (quadro "5c · Preços e margem"): "alteração aprovada PODE SUBIR PRA PRODUÇÃO" |
| 2026-10-16 | Ivam | Aprovou os custos logísticos por serviço (quadro "5b · Custos logísticos", a partir da cotação HMM): "alteração aprovada PODE PRODUZIR" |
| 2026-10-16 | Ivam | Aprovou a seção "Processos · negociação" no Painel e o "Editar negociação" pelo formulário do Novo processo: "Boa, Claude, é exatamente isso que eu preciso, tá? Pode subir para homologação e produção. Produção, layout aprovado. E alteração" |
| 2026-10-16 | Ivam | Escolheu a trava automática ("aprovar uma permissão quando ela aparecer") e definiu: "Quando tiver qualquer alteração, você vai enviar para mim aqui e eu preciso dar o ok. Eu preciso falar alteração aprovada." |
| 2026-10-15 | Ivam | Definiu que a autorização é dada só na conversa: "eu posso dizer assim, ó, a layout aprovado, aí vocês travam o layout que foi aprovado" — sem passos manuais |
