"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatDate } from "./format";

// Equipe: mesmas ações da versão anterior (/api/security inviteUser e updateMember).
// Links individuais só aparecem quando o runtime Railway anuncia suporte.

type Member = { id: number; role: string; status: string; email: string; fullName: string; lastLoginAt: string | null };
type AccessRequest = { id: number; email: string; fullName: string; createdAt: string };
const ROLES = ["administrador", "analista", "fornecedor", "auditor", "cliente"];

export default function EquipeView({ isAdmin, onCount }: { isAdmin: boolean; onCount: (count: number) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState({ email: "", fullName: "", role: "analista" });
  const [busy, setBusy] = useState(false);
  const [passwordLinksAvailable, setPasswordLinksAvailable] = useState(false);
  const [passwordLink, setPasswordLink] = useState<{ email: string; url: string; expiresAt: string } | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [companyCode, setCompanyCode] = useState("");

  const loadRequests = useCallback(async () => {
    const data = await api<{ requests: AccessRequest[]; companyCode: string }>("/__auth/access-requests");
    setRequests(data.requests);
    setCompanyCode(data.companyCode);
  }, []);

  const load = useCallback(() => api<{ members: Member[] }>("/api/security").then((data) => {
    setMembers(data.members);
    onCount(data.members.length);
  }).catch((reason: Error) => setError(reason.message || "Falha ao carregar a equipe.")), [onCount]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    api<{ individualPasswords: boolean }>("/__auth/capabilities")
      .then(async (data) => {
        if (active) {
          setPasswordLinksAvailable(data.individualPasswords === true);
          if (data.individualPasswords) await loadRequests();
        }
      })
      .catch(() => { if (active) setPasswordLinksAvailable(false); });
    return () => { active = false; };
  }, [isAdmin, loadRequests]);

  async function generatePasswordLink(email: string) {
    setBusy(true); setError(""); setNotice(""); setPasswordLink(null);
    try {
      const link = await api<{ url: string; expiresAt: string }>("/__auth/invite-link", { method: "POST", body: JSON.stringify({ email }) });
      setPasswordLink({ email, ...link });
      setNotice("Link gerado. Entregue somente à pessoa indicada. Os links anteriores foram invalidados.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao gerar link de senha.");
    } finally { setBusy(false); }
  }

  async function copyPasswordLink() {
    if (!passwordLink) return;
    try {
      await navigator.clipboard.writeText(passwordLink.url);
      setNotice("Link copiado. Entregue somente à pessoa indicada.");
    } catch { setError("Não foi possível copiar automaticamente. Selecione e copie o link abaixo."); }
  }

  async function post(body: Record<string, unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/security", { method: "POST", body: JSON.stringify(body) });
      setNotice(message);
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    const email = invite.email;
    if (await post({ action: "inviteUser", ...invite }, `Acesso liberado para ${email}.`)) {
      setInvite({ email: "", fullName: "", role: "analista" });
      if (passwordLinksAvailable) {
        await generatePasswordLink(email);
        await loadRequests().catch(() => setError("Acesso liberado; atualize a página para recarregar as solicitações."));
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 18 }}>
      {error && <div className="et2-alert et2-alert--bad" role="alert">{error}</div>}
      {notice && <div className="et2-alert et2-alert--ok" role="status">{notice}</div>}
      {passwordLink && isAdmin && (
        <section className="et2-card" aria-label="Link individual de senha">
          <div className="et2-card-body">
            <p>Definição de senha para <strong>{passwordLink.email}</strong>. Válido por 72 horas, até {formatDate(passwordLink.expiresAt)}; uso único.</p>
            <label className="et2-field"><span>Link privado — não publique nem registre no histórico</span><input readOnly value={passwordLink.url} onFocus={(event) => event.target.select()} /></label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button className="et2-btn" onClick={copyPasswordLink}>Copiar link</button>
              <button className="et2-btn" onClick={() => setPasswordLink(null)}>Ocultar link</button>
            </div>
          </div>
        </section>
      )}
      {isAdmin && (
        <section className="et2-card" aria-labelledby="convidar">
          <div className="et2-card-head"><h2 id="convidar">Liberar acesso</h2></div>
          <div className="et2-card-body et2-grid">
            <label className="et2-field"><span>E-mail<span className="et2-req"> *</span></span><input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label>
            <label className="et2-field"><span>Nome</span><input value={invite.fullName} onChange={(event) => setInvite({ ...invite, fullName: event.target.value })} /></label>
            <label className="et2-field"><span>Perfil</span><select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}>{ROLES.map((role) => <option key={role}>{role}</option>)}</select></label>
          </div>
          <div className="et2-card-body" style={{ display: "flex", justifyContent: "flex-end", paddingTop: 0 }}>
            <button className="et2-btn et2-btn--primary" disabled={busy || !invite.email.trim()} onClick={sendInvite}>Liberar acesso</button>
          </div>
        </section>
      )}
      {isAdmin && passwordLinksAvailable && (
        <section className="et2-card" aria-labelledby="solicitacoes">
          <div className="et2-card-head"><h2 id="solicitacoes">Solicitações de primeiro acesso</h2></div>
          <div className="et2-card-body">
            <p>CNPJ da empresa: <strong>{companyCode || "Não informado no cadastro da empresa"}</strong>. A equipe solicita acesso usando esse CNPJ na tela de entrada.</p>
            <p>Confira a identidade da pessoa, escolha o perfil em “Liberar acesso” e entregue o link de senha somente ao destinatário confirmado. Não há envio automático de e-mail.</p>
            {requests.length === 0 ? <p>Nenhuma solicitação pendente.</p> : requests.map((request) => (
              <p key={request.id}>{request.fullName} — {request.email} · {formatDate(request.createdAt)}{" "}
                <button className="et2-btn" disabled={busy} onClick={() => {
                  setInvite({ email: request.email, fullName: request.fullName, role: "analista" });
                  document.getElementById("convidar")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setNotice("Solicitação selecionada. Confira a pessoa e o perfil antes de liberar o acesso.");
                }}>Revisar cadastro</button>
              </p>
            ))}
          </div>
        </section>
      )}
      <section className="et2-card et2-scroll" aria-label="Membros da equipe">
        <table className="et2-table">
          <thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação</th><th>Último acesso</th>{isAdmin && passwordLinksAvailable && <th>Senha individual</th>}</tr></thead>
          <tbody>
            {(members ?? []).map((member) => (
              <tr key={member.id}>
                <td>{member.fullName || member.email}<span className="et2-sub">{member.email}</span></td>
                <td>{isAdmin
                  ? <select className="et2-input" style={{ width: 170 }} value={member.role} disabled={busy} onChange={(event) => post({ action: "updateMember", membershipId: member.id, role: event.target.value, status: member.status }, "Perfil atualizado.")}>{ROLES.map((role) => <option key={role}>{role}</option>)}</select>
                  : member.role}</td>
                <td>{isAdmin
                  ? <select className="et2-input" style={{ width: 120 }} value={member.status} disabled={busy} onChange={(event) => post({ action: "updateMember", membershipId: member.id, role: member.role, status: event.target.value }, "Situação atualizada.")}><option>Ativo</option><option>Inativo</option></select>
                  : <span className={`et2-badge et2-badge--${member.status === "Ativo" ? "ok" : "todo"}`}>{member.status}</span>}</td>
                <td>{formatDate(member.lastLoginAt)}</td>
                {isAdmin && passwordLinksAvailable && <td><button className="et2-btn" disabled={busy || member.status !== "Ativo"} onClick={() => generatePasswordLink(member.email)}>Gerar link de senha</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!members && !error && <p className="et2-empty">Carregando…</p>}
        {members?.length === 0 && <p className="et2-empty">Nenhum membro encontrado.</p>}
      </section>
    </div>
  );
}
