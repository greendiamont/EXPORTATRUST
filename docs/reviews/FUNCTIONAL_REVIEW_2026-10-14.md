# Parecer funcional — ExportaTrust (2026-10-14)

Autor: Claude · Base: `homologation` @ `bdd2081` + correções do PR de 2026-10-14 (CHG-20261014-005).
Método: leitura do código (rotas, `lib/`, schema, `app/client-app.tsx`) e uso do app no runtime Railway local (PostgreSQL), com o fluxo de teste `tests/agent-e2e.mjs`.

Ótica da avaliação: controle de processo de exportação **do pedido ao embarque/entrega** — gerar pedido, packing list e invoice, acompanhar produção, booking, documentos, embarque e tracking.

## Parecer geral

O app já tem o **esqueleto certo** de uma torre de controle de exportação: um processo concentra cadastro, pedido, documentos, 14 etapas operacionais com responsável/prazo, aprovação humana de embarque, Shipment Advice, tracking e a camada EUDR (CAR, dossiê, relatório). O diferencial EUDR/rastreabilidade é forte e raro.

O ponto fraco está justamente no **núcleo comercial-documental**: os documentos são gerados "ao vivo" a partir dos dados atuais (sem emissão, número ou versão), a Commercial Invoice e a Proforma não são geradas, o preço só existe por m³ e não há conciliação entre pedido, packing list e invoice. Para uso diário com clientes, isso é o que mais gera retrabalho e risco.

Nota por área (0–5):

| Área | Nota | Comentário |
|---|---|---|
| Cadastros (fornecedor, cliente, produto, floresta) | 3,5 | Bons, com CNPJ validado e deduplicação; fornecedor sem endereço |
| Pedido (Sales Order / Pedido de compra) | 3 | Base única alimenta os documentos; só preço por m³ |
| Packing list | 2,5 | Formulário completo, mas totais manuais não conferem com os itens |
| Invoice | 2 | Só "Purchase Invoice"; Commercial/Proforma não são geradas |
| Etapas e controle operacional | 4 | 14 etapas, responsáveis, prazos, gate de embarque, tarefas padrão |
| Embarque, Shipment Advice e tracking | 3,5 | Fluxo com aprovação humana; depende de Gmail/ShipsGo configurados |
| EUDR / compliance | 4 | Forte; regra de aplicabilidade corrigida neste PR |
| Visão de carteira (lista de processos, relatórios) | 2,5 | Falta etapa atual, cliente, ETD/ETA e valor na lista |
| Base técnica | 2,5 | Interface num único arquivo de 4.225 linhas; 88 erros de TypeScript pré-existentes |

## O fluxo hoje, etapa por etapa

1. **Cadastros** — Fornecedores (CNPJ validado, dados bancários, certificações), Clientes importadores (EORI, porto preferido, termos de pagamento, exigências documentais), Produtos (NCM, espécie, KD/HT, umidade), Florestas/CAR (SICAR, mapa de satélite, triagem IBAMA) e fila de duplicidades.
2. **Processo** — criado com produto, NCM, destino, importador, fornecedor, exportador, responsável, incoterm, moeda, quantidade, pesos, portos, booking/BL/contêineres (texto).
3. **Etapa 01 · Pedido** — "Base comercial do processo": itens (espécie, qualidade, medida, volume m³, preço), payment terms, notas. Gera **Sales Order** e **Purchase Invoice** (HTML e Word). Camada separada para **Pedido de Compra ao fornecedor** (preço/incoterm/moeda próprios).
4. **Packing list** — formulário com itens (CBM, peças, pacotes, dimensões, pesos), marks, consignee, referência do contêiner; gera documento HTML/Word.
5. **Etapas 02–14** — Origem/EUDR → programação → produção → qualidade → **aprovação para embarque** (gate: etapas anteriores, qualidade aprovada e, se EUDR, prontidão 100% + compliance do país 100%) → booking → estufagem/fotos → set documental → despacho/porto → embarcado → trânsito → chegada → entrega. Cada etapa tem status, prazo, responsável, próxima ação, anexos e notificação ao cliente.
6. **Tarefas operacionais padrão** — emissão/conferência da S.O, adiantamento, pedido ao fornecedor, HT, frete, drafts, Shipment Advice.
7. **Shipment Advice** — reúne os documentos da etapa 09, rascunho de e-mail com cobrança de saldo, envio só após aprovação humana.
8. **Tracking** — ShipsGo (com chave) ou guia de rastreio manual; próxima checagem a cada N dias.
9. **EUDR** — dossiê florestal, relatório EUDR em PDF com registro de integridade (hash), ponte para DDS.

## Corrigido neste PR (CHG-20261014-005)

1. **Aplicabilidade EUDR (crítico de compliance).** A lista de países da UE só tinha nomes em português sem acento: destino "Italy", "Germany", "Netherlands" ou "IT"/"DE" marcava EUDR como **não aplicável**, punha a etapa "Origem e compliance EUDR" como *Suspenso* e liberava a aprovação de embarque sem DDS. A detecção de madeira usava `includes("44")` (qualquer código com "44", como cabos 8544) e ignorava as outras 6 commodities da EUDR. Agora: países da UE em PT/EN/ISO e commodities do Anexo I por prefixo do SH (bovinos, cacau, café, dendê, borracha, soja, madeira/celulose/papel/móveis). Processos existentes são reavaliados automaticamente ao abrir.
2. **Falso positivo na checagem documental.** A palavra-chave `ht` (NIMF 15) casava com "weight"/"freight", dando o requisito como cumprido. Termos curtos agora exigem palavra inteira.
3. **Erros de autenticação viravam 500.** 37 blocos `catch` em 19 rotas devolviam "Erro inesperado" (500) quando o usuário não estava logado ou não tinha permissão. Agora devolvem 401/403.
4. **Teste e2e do repositório** usava CNPJ inválido e falhava; agora gera CNPJ válido.

## Lacunas, por prioridade

### Alta — núcleo pedido → packing list → invoice

1. **Emissão de documentos com número, versão e cópia congelada.** Hoje Sales Order, Purchase Invoice, Pedido de Compra e Packing List são renderizados com os dados *atuais* do processo: se o pedido for editado depois de enviado ao cliente, o "mesmo" documento muda retroativamente, sem número sequencial, data de emissão nem histórico. Proposta: ação "Emitir" que grava o PDF/DOCX no storage com número (`INV-2026-0001`), revisão (`rev. 2`), hash e quem emitiu — o padrão já existe para o relatório EUDR (`pdf_integrity_records`).
2. **Commercial Invoice e Proforma Invoice não são geradas.** São os documentos centrais da exportação, e hoje só entram por upload na etapa 09. O app já tem todos os dados (itens, preços, incoterm, portos, pesos do packing list); falta o modelo.
3. **Preço só por m³.** Itens do pedido têm "Volume m³ / Preço por CBM" fixo. Pellets e muitos produtos são vendidos por tonelada (MT), peça ou kg — o processo até tem "Unidade", mas os itens não usam. Proposta: unidade por item (m³, MT, kg, pç) e totais por unidade.
4. **Sem conciliação pedido × packing list × invoice.** Não há aviso quando o volume do packing list difere do pedido, e os pesos totais digitados no packing list **substituem** a soma dos itens sem alerta. Proposta: painel de conferência com divergências bloqueando a emissão final.
5. **Fornecedor sem endereço.** O cadastro não tem endereço; Sales Order/Invoice saem só com cidade/UF/país do exportador/fornecedor (o código já tenta usar `supplier.address`, que não existe).
6. **Dados do pedido guardados como JSON dentro de `supply_chain_notes`.** Itens do pedido, pedido de compra e packing list ficam num texto JSON num campo de "observações". Funciona, mas impede relatórios (volume vendido por cliente/produto), histórico e validações. Proposta: tabelas `order_items`, `packing_list_items` e `issued_documents`.

### Média — operação e gestão

7. **Lista de Processos pouco operacional.** Mostra referência, produto/destino, fornecedor, prontidão e um "status" de cadastro. Falta: cliente, **etapa atual do Export Control**, ETD/ETA, valor e alerta de atraso. Hoje há dois "status" paralelos (status do processo × etapa do Export Control) que confundem.
8. **Datas logísticas.** Só existe "data de embarque" no processo (ETA só nos eventos de tracking). Faltam ETD/ETA, cut-off de carga e de documentos (draft BL/VGM), deadline de free time no destino — com alertas.
9. **Financeiro do processo.** Adiantamento e saldo são só tarefas. O app já tem preço de venda (Sales Order) e de compra (Pedido ao fornecedor): **margem por processo** sai quase de graça. Depois: recebíveis (adiantamento/saldo, vencimento, comprovante SWIFT), câmbio e comissões.
10. **Embarques parciais e múltiplos contêineres.** Um processo = um embarque; contêineres são texto livre. Contratos com vários embarques ou vários contêineres com pesos/lacres próprios não se modelam bem.
11. **Checagem documental por nome de arquivo.** O "compliance do país" confere documentos por palavras-chave no nome/categoria: "Freight invoice" conta como Commercial Invoice. Proposta: usar o tipo de documento escolhido no upload (o campo `document_type` já existe) e a análise por IA quando configurada.
12. **Documentos não gerados:** Shipping Instructions / draft de BL, Certificado de Origem (dados para a entidade emissora), instruções para despacho (DU-E).

### Baixa — técnica e configuração

13. **Interface em um único arquivo** (`app/client-app.tsx`, 4.225 linhas / 370 KB). Dificulta manutenção e gera conflitos quando vários agentes editam ao mesmo tempo. Dividir por módulo (cadastros, processo, export control, relatórios) antes das próximas features grandes.
14. **88 erros de TypeScript pré-existentes**; o build não checa tipos. Zerar e ativar `tsc --noEmit` na validação evita regressões silenciosas (um desses erros revelou o `supplier.address` inexistente).
15. **Integrações sem configuração em homologação:** e-mail ao cliente (Gmail/Resend), tracking (ShipsGo), IA (OpenAI), Gmail OAuth. Sem elas, notificações e Shipment Advice ficam bloqueados (comportamento seguro, mas precisa estar claro para quem testa).

## Roteiro sugerido

| Sprint | Entrega | Por quê |
|---|---|---|
| 1 | Endereço do fornecedor · unidade por item (m³/MT/kg/pç) · Commercial Invoice e Proforma geradas | Fecha o ciclo documental básico |
| 2 | Emissão com número/revisão/cópia congelada · conciliação pedido × PL × invoice | Elimina retrabalho e risco com cliente |
| 3 | Lista de processos com etapa atual, ETD/ETA, valor e atrasos · datas logísticas com alertas | Gestão da carteira no dia a dia |
| 4 | Margem por processo · recebíveis (adiantamento/saldo) | Visão financeira |
| contínuo | Quebrar `client-app.tsx` · zerar erros de TypeScript | Base para crescer com vários agentes |
