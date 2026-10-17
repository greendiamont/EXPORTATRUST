import { guardedPage } from "../ui/page-guard";
import EudrView from "../ui/eudr-view";

export default async function EudrPage() {
  return guardedPage("eudr", "/eudr", (security) => ["administrador", "analista", "auditor"].includes(security.role)
    ? <EudrView />
    : <main className="et2-main"><div className="et2-alert et2-alert--bad" role="alert">A EUDR é só para a equipe (administrador ou analista).</div></main>);
}
