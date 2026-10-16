import { guardedPage } from "../ui/page-guard";
import CadastrosView from "../ui/cadastros-view";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function CadastrosPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const tab = typeof params.tab === "string" ? params.tab : "";
  const id = Number(typeof params.id === "string" ? params.id : 0) || null;
  return guardedPage("cadastros", "/cadastros", (security) => <CadastrosView isAdmin={security.role === "administrador"} initialTab={tab} initialId={id} />);
}
