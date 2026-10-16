"use client";

import { useCallback, useEffect, useState } from "react";

// Participantes do processo e convite de colaborador (protótipo "3c · Convidar colaborador").
// O convidado recebe um e-mail para criar a senha e só enxerga os processos para os quais foi
// convidado (trava no servidor: server/railway/collaborators.mjs).

type Collaborator = { email: string; fullName: string; roleLabel: string; status: string };
type InviteResult = { email: string; guest: boolean; emailed: boolean; emailError?: string; link: string; expiresHours: number };

const ROLE_LABELS = ["Despachante", "Agente de carga", "Fornecedor", "Cliente / importador", "Outro"];
const initials = (value: string) => value.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");

async function request<T>(init?: RequestInit, query = "") {
  const response = await fetch(`/__auth/collaborators${query}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}

export function CollaboratorsPanel({ operationId, reference, followers }: { operationId: number; reference: string; followers: Array<{ email: string; name: string }> }) {
  const [list, setList] = useState<Collaborator[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", fullName: "", roleLabel: ROLE_LABELS[0], message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    request<{ collaborators: Collaborator[] }>(undefined, `?operationId=${operationId}`).then((data) => setList(data.collaborators)).catch(() => setList([]));
  }, [operationId]);
  useEffect(load, [load]);

  async function invite() {
    setBusy(true);
    setError("");
    try {
      const data = await request<InviteResult>({ method: "POST", body: JSON.stringify({ action: "invite", operationId, ...form }) });
      setResult(data);
      setOpen(false);
      setForm({ email: "", fullName: "", roleLabel: ROLE_LABELS[0], message: "" });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao convidar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(person: Collaborator) {
    if (!window.confirm(`Remover ${person.fullName || person.email} deste processo? A pessoa perde o acesso a ele.`)) return;
    try {
      await request({ method: "POST", body: JSON.stringify({ action: "remove", operationId, email: person.email }) });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao remover.");
    }
  }

  const team = followers.filter((member) => !list.some((person) => person.email === member.email));
  const count = team.length + list.length;

  return (
    <div className="cb-panel">
      <div className="cb-head">
        <span className="cb-label">Participantes · {count}</span>
        <button type="button" className="pd-btn pd-btn--xs" onClick={() => { setOpen(true); setResult(null); setError(""); }}>+ Convidar</button>
      </div>
      {team.map((member) => (
        <div key={member.email} className="cb-person">
          <span className="cb-avatar cb-avatar--team">{initials(member.name || member.email)}</span>
          <div className="cb-who"><b>{member.name || member.email}</b><div className="pd-sub">Equipe</div></div>
          <span className="cb-badge cb-badge--ok">Ativo</span>
        </div>
      ))}
      {list.map((person) => (
        <div key={person.email} className="cb-person">
          <span className="cb-avatar">{initials(person.fullName || person.email)}</span>
          <div className="cb-who"><b title={person.email}>{person.fullName || person.email}</b><div className="pd-sub">{[person.roleLabel, "só este processo"].filter(Boolean).join(" · ")}</div></div>
          <span className={`cb-badge${person.status === "Ativo" ? " cb-badge--ok" : ""}`}>{person.status}</span>
          <button type="button" className="cb-remove" aria-label={`Remover ${person.email}`} onClick={() => remove(person)}>×</button>
        </div>
      ))}
      {result && (
        <div className="cb-result" role="status">
          {result.emailed
            ? <>Convite enviado por e-mail para <b>{result.email}</b>.</>
            : <>
                <div>Convite criado para <b>{result.email}</b>. {result.emailError ? "O e-mail automático ainda não está ligado: " : ""}copie o link e envie para a pessoa{result.guest ? ` (vale ${result.expiresHours} horas)` : ""}:</div>
                <div className="cb-link"><input readOnly value={result.link} onFocus={(event) => event.target.select()} /><button type="button" className="pd-btn pd-btn--xs" onClick={() => { navigator.clipboard?.writeText(result.link).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copiado ✓" : "Copiar"}</button></div>
              </>}
        </div>
      )}
      {error && !open && <div className="cb-error" role="alert">{error}</div>}

      {open && (
        <div className="cb-modal" role="dialog" aria-modal="true" aria-labelledby="cb-title" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="cb-dialog">
            <div className="cb-dialog-head">
              <div>
                <h2 id="cb-title">Convidar colaborador</h2>
                <div className="pd-sub">A pessoa recebe um e-mail, cria a senha e entra só neste processo ({reference}).</div>
              </div>
              <button type="button" className="cb-remove" aria-label="Fechar" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="cb-grid">
              <label>E-mail *<input className="pd-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoFocus /></label>
              <label>Nome<input className="pd-input" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
              <label>Função no processo<select className="pd-input" value={form.roleLabel} onChange={(event) => setForm({ ...form, roleLabel: event.target.value })}>{ROLE_LABELS.map((label) => <option key={label}>{label}</option>)}</select></label>
              <label>Acesso<input className="pd-input" readOnly value="Só este processo" /></label>
              <label className="cb-wide">Mensagem (opcional)<textarea className="pd-input" rows={3} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder={`Segue o acesso ao processo ${reference} para acompanharmos juntos.`} /></label>
              <div className="cb-wide cb-info">
                <b>O que a pessoa poderá fazer:</b> ver as fases, etapas e documentos deste processo, comentar, ser mencionada com @ e anexar arquivos.<br />
                <b>Não verá:</b> outros processos, Painel, Cadastros, valores de compra e venda, financeiro e margem.
              </div>
              {error && <div className="cb-wide cb-error" role="alert">{error}</div>}
            </div>
            <div className="cb-dialog-foot">
              <button type="button" className="pd-btn" onClick={() => setOpen(false)}>Cancelar</button>
              <button type="button" className="pd-btn pd-btn--dark" disabled={busy || !form.email.trim()} onClick={invite}>{busy ? "Enviando…" : "Enviar convite por e-mail"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
