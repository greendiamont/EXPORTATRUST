"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatDate } from "./format";

// Equipe: mesmas ações da versão anterior (/api/security inviteUser e updateMember).
// O link individual de senha (login próprio de cada pessoa no Railway) ainda está pendente.

type Member = { id: number; role: string; status: string; email: string; fullName: string; lastLoginAt: string | null };
const ROLES = ["administrador", "analista", "fornecedor", "auditor", "cliente"];

export default function EquipeView({ isAdmin, onCount }: { isAdmin: boolean; onCount: (count: number) => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState({ email: "", fullName: "", role: "analista" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ members: Member[] }>("/api/security").then((data) => {
    setMembers(data.members);
    onCount(data.members.length);
  }).catch((reason: Error) => setError(reason.message || "Falha ao carregar a equipe.")), [onCount]);

  useEffect(() => { load(); }, [load]);

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
    if (await post({ action: "inviteUser", ...invite }, `Acesso liberado para ${invite.email}.`)) setInvite({ email: "", fullName: "", role: "analista" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 18 }}>
      {error && <div className="et2-alert et2-alert--bad" role="alert">{error}</div>}
      {notice && <div className="et2-alert et2-alert--ok" role="status">{notice}</div>}
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
      <section className="et2-card et2-scroll" aria-label="Membros da equipe">
        <table className="et2-table">
          <thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação</th><th>Último acesso</th></tr></thead>
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
              </tr>
            ))}
          </tbody>
        </table>
        {!members && !error && <p className="et2-empty">Carregando…</p>}
      </section>
    </div>
  );
}
