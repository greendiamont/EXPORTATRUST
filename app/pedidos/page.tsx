import { guardedPage } from "../ui/page-guard";
import PedidosView from "../ui/pedidos-view";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PedidosPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const fase = typeof params.fase === "string" && /^[0-5]$/.test(params.fase) ? Number(params.fase) : null;
  return guardedPage("pedidos", "/pedidos", () => <PedidosView initialPhase={fase} />);
}
