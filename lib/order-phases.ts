// As 14 etapas do Export Control agrupadas nas 6 fases do pedido exibidas na
// interface (Pedido → Produção → Embarque → Documentos → Trânsito → Entregue).

export const ORDER_PHASES = [
  { key: "pedido", name: "Pedido", codes: ["ORDER_CONFIRMED"] },
  { key: "producao", name: "Produção", codes: ["ORIGIN_COMPLIANCE", "PRODUCTION_PLAN", "PRODUCTION", "QUALITY_CONTROL"] },
  { key: "embarque", name: "Embarque", codes: ["SHIPMENT_APPROVAL", "BOOKING", "STUFFING"] },
  { key: "documentos", name: "Documentos", codes: ["DOCUMENT_SET", "CUSTOMS_PORT"] },
  { key: "transito", name: "Trânsito", codes: ["SHIPPED", "IN_TRANSIT", "ARRIVAL"] },
  { key: "entregue", name: "Entregue", codes: ["DELIVERED"] },
] as const;

export type OrderPhase = (typeof ORDER_PHASES)[number];

/** Etapas que não travam o andamento (concluídas ou fora do escopo, ex.: EUDR não aplicável). */
const CLOSED_STATUSES = new Set(["Concluído", "Suspenso"]);

export function phaseIndexOfCode(code: string) {
  const index = ORDER_PHASES.findIndex((phase) => (phase.codes as readonly string[]).includes(code));
  return index === -1 ? 0 : index;
}

/**
 * Fase atual = fase da primeira etapa (na sequência) ainda aberta.
 * Sem etapas cadastradas o pedido está na fase Pedido; tudo concluído = Entregue.
 */
export function currentPhaseIndex(milestones: Array<{ code: string; sequence: number; status: string }>) {
  if (!milestones.length) return 0;
  const open = [...milestones].sort((a, b) => a.sequence - b.sequence).find((milestone) => !CLOSED_STATUSES.has(milestone.status));
  return open ? phaseIndexOfCode(open.code) : ORDER_PHASES.length - 1;
}

export function isClosedStatus(status: string) {
  return CLOSED_STATUSES.has(status);
}
