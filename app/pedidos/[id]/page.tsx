import { guardedPage } from "../../ui/page-guard";
import PedidoView from "../../ui/pedido-view";

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operationId = Number(id);
  return guardedPage("pedidos", `/pedidos/${operationId || ""}`, () => <PedidoView operationId={operationId} />);
}
