import { guardedPage } from "./ui/page-guard";
import PainelView from "./ui/painel-view";

// Interface nova: Painel. O app anterior continua completo em /classico.
export default async function Page() {
  return guardedPage("painel", "/", (security) => <PainelView userName={security.fullName} userEmail={security.email} />);
}
