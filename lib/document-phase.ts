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

export function documentPhaseIndex(category: string): number | null {
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
