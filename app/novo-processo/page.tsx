import { guardedPage } from "../ui/page-guard";
import NovoProcessoView from "../ui/novo-processo-view";

export default async function NovoProcessoPage() {
  return guardedPage("pedidos", "/novo-processo", (security) => <NovoProcessoView userName={security.fullName} userEmail={security.email} />);
}
