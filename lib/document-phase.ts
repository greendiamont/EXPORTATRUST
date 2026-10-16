// Em qual das 6 fases do pedido cada documento aparece. Usa a categoria gravada no
// documento: "Export Control · <etapa>" segue a etapa; as categorias antigas
// ("STAGE 08 · Documentos comerciais", "Cadastro do fornecedor", "Floresta · …") são
// distribuídas por assunto. Sem correspondência, o documento fica só na lista geral.

const STAGE_PHASE: Array<[RegExp, number]> = [
  [/pedido confirmado|sales order|purchase order|contrato|cadastro do fornecedor/i, 0],
  [/origem|eudr|floresta|planta industrial|legalidade|dof|programa[çc][aã]o|produ[çc][aã]o|qualidade/i, 1],
  [/aprova[çc][aã]o de embarque|booking|estufagem|exporta[çc][aã]o \/ embarque|stage 1[01]/i, 2],
  [/set documental|despacho|porto|documentos comerciais|stage 0?8/i, 3],
  [/embarcado|tracking|chegada|tr[aâ]nsito/i, 4],
  [/entrega final|entregue/i, 5],
];

// Na categoria genérica do app antigo ("STAGE 08 · Documentos comerciais") caem também
// pedidos de venda/compra e contratos: pelo nome do arquivo eles vão para a fase Pedido.
const ORDER_FILE = /\bs\.?o\b|sales.?order|\bp\.?o\b|purchase.?order|pedido de (venda|compra)|contrato|contract|proforma/i;

export function documentPhaseIndex(category: string, fileName = ""): number | null {
  if (/documentos comerciais|stage 0?8/i.test(category) && ORDER_FILE.test(fileName)) return 0;
  for (const [pattern, phase] of STAGE_PHASE) if (pattern.test(category)) return phase;
  return null;
}

/** Categoria sugerida para um arquivo anexado numa fase da tela nova. */
export const PHASE_UPLOAD_CATEGORY = [
  "Export Control · Pedido confirmado",
  "Export Control · Produção",
  "Export Control · Booking",
  "Export Control · Set documental",
  "Export Control · Embarcado",
  "Export Control · Entrega final",
];

// Tarefas do checklist (estilo Asana) não têm fase gravada: a fase sai do texto. A ordem
// importa ("Confirmar frete com a trading" é Embarque, não Pedido). Sem correspondência,
// a tela mostra a tarefa na fase atual do pedido.
const TASK_PHASE: Array<[RegExp, number]> = [
  [/frete|booking|estufagem|cut.?off|cont[eê]iner|aprova[çc][aã]o de embarque/i, 2],
  [/draft|documentos|shipment advice|certificado|\bbl\b|despacho|du-?e/i, 3],
  [/tr[aâ]nsito|tracking|chegada|embarcad/i, 4],
  [/entreg|saldo|encerr/i, 5],
  [/produ[çc]|qualidade|laudo|origem|eudr|\bcar\b|inspe[çc]/i, 1],
  [/\bs\.?o\b|sales order|adiantamento|pedido|\bht\b|trading|contrato/i, 0],
];

export function taskPhaseIndex(description: string): number | null {
  for (const [pattern, phase] of TASK_PHASE) if (pattern.test(description)) return phase;
  return null;
}
