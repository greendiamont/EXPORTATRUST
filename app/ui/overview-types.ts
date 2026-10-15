export type OverviewOperation = {
  id: number;
  reference: string;
  product: string;
  hsCode: string;
  client: string;
  importerClientId: number | null;
  country: string;
  supplierName: string;
  supplierId: number | null;
  masterProductId: number | null;
  propertyIds: string;
  status: string;
  phaseIndex: number;
  phaseName: string;
  phaseSteps: Array<{ total: number; done: number }>;
  blocked: boolean;
  next: { what: string; detail: string; due: string; who: string; late: boolean } | null;
  etd: string;
  route: string;
  value: number;
  currency: string;
  quantity: number;
  quantityUnit: string;
  eudrRequired: boolean;
  readiness: number;
  createdAt: string;
};

export type OverviewPending = {
  operationId: number;
  reference: string;
  kind: "etapa" | "tarefa";
  what: string;
  detail: string;
  due: string;
  who: string;
  late: boolean;
};

export type Overview = {
  operations: OverviewOperation[];
  pending: OverviewPending[];
  phaseCounts: Array<{ name: string; count: number; blocked: number }>;
  today: string;
};

export const PHASE_NAMES = ["Pedido", "Produção", "Embarque", "Documentos", "Trânsito", "Entregue"];
