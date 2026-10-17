import { guardedPage } from "../ui/page-guard";
import FinanceiroView from "../ui/financeiro-view";

export default async function FinanceiroPage() {
  return guardedPage("financeiro", "/financeiro", (security) => ["administrador", "analista", "auditor"].includes(security.role)
    ? <FinanceiroView />
    : <main className="et2-main"><div className="et2-alert et2-alert--bad" role="alert">O Financeiro é só para a equipe (administrador ou analista).</div></main>);
}
