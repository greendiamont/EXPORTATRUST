"use client";

import { useState } from "react";
import { api } from "./format";

// Importação dos fornecedores do app antigo: lê o JSON exportado, mostra a prévia
// calculada pelo servidor (sem gravar) e só grava depois da confirmação.

type Outcome = {
  sourceId: number | null;
  legalName: string;
  taxId: string;
  action: "criar" | "completar" | "já existe" | "ignorado";
  targetId: number | null;
  completed: string[];
  adjustments: string[];
  warnings: string[];
};
type Result = { dryRun: boolean; organization: string; summary: { total: number; criar: number; completar: number; existentes: number; ignorados: number }; outcomes: Outcome[] };

const TONE: Record<Outcome["action"], string> = { criar: "ok", completar: "warn", "já existe": "todo", ignorado: "bad" };
const FIELD_LABEL: Record<string, string> = {
  tradeName: "nome fantasia", address: "endereço", contactName: "contato", email: "e-mail", phone: "telefone", aliases: "apelidos",
  products: "produtos", productionUnits: "unidades produtivas", bankDetails: "dados bancários", state: "UF", city: "cidade", country: "país", certifications: "certificações",
};

export default function ImportarFornecedores({ onCancel, onImported }: { onCancel: () => void; onImported: (message: string) => void }) {
  const [payload, setPayload] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function readFile(file: File | undefined) {
    setError(""); setPreview(null); setPayload(null);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      setPayload(parsed);
      setPreview(await api<Result>("/api/suppliers/import", { method: "POST", body: JSON.stringify({ payload: parsed, dryRun: true }) }));
    } catch (reason) {
      setError(reason instanceof SyntaxError ? "O arquivo não é um JSON válido." : reason instanceof Error ? reason.message : "Falha ao ler o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true); setError("");
    try {
      const result = await api<Result>("/api/suppliers/import", { method: "POST", body: JSON.stringify({ payload, dryRun: false }) });
      const { criar, completar, existentes } = result.summary;
      onImported(`Importação concluída: ${criar} fornecedor(es) criado(s), ${completar} completado(s), ${existentes} já estavam iguais. Tudo registrado na auditoria.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao importar.");
    } finally {
      setBusy(false);
    }
  }

  const changes = preview ? preview.summary.criar + preview.summary.completar : 0;

  return (
    <>
      <div className="et2-card-head">
        <h2 style={{ fontSize: 18 }}>Importar fornecedores do app antigo</h2>
      </div>
      <div className="et2-card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Use o arquivo JSON exportado do app antigo (exportação de dados ou backup). Nada é apagado ou sobrescrito:
          fornecedor com o mesmo CNPJ ou razão social só tem os campos vazios completados. Primeiro aparece a prévia; a gravação só acontece ao confirmar.
        </p>
        <label className="et2-field">
          <span>Arquivo de exportação (.json)</span>
          <input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => readFile(event.target.files?.[0])} style={{ paddingTop: 6 }} />
        </label>
        {error && <div className="et2-alert et2-alert--bad" role="alert">{error}</div>}
        {busy && !preview && <p className="muted" style={{ margin: 0 }}>Lendo {fileName}…</p>}

        {preview && (
          <>
            <div className="et2-alert et2-alert--info" role="status">
              {preview.summary.total} fornecedor(es) no arquivo para a empresa <strong>{preview.organization}</strong>:{" "}
              <strong>{preview.summary.criar}</strong> novo(s), <strong>{preview.summary.completar}</strong> a completar, {preview.summary.existentes} já cadastrado(s) sem mudança
              {preview.summary.ignorados ? `, ${preview.summary.ignorados} ignorado(s)` : ""}.
            </div>
            <div className="et2-scroll" style={{ border: "1px solid var(--et2-line)", borderRadius: 6 }}>
              <table className="et2-table">
                <thead><tr><th>Fornecedor</th><th>Ação</th><th>Detalhes</th></tr></thead>
                <tbody>
                  {preview.outcomes.map((item, index) => (
                    <tr key={`${item.sourceId ?? "x"}-${index}`}>
                      <td>{item.legalName || "(sem nome)"}<span className="et2-sub mono">{item.taxId || "sem CNPJ"}</span></td>
                      <td><span className={`et2-badge et2-badge--${TONE[item.action]}`}>{item.action}</span></td>
                      <td style={{ fontSize: 13 }}>
                        {item.completed.length > 0 && <div>Completa: {item.completed.map((key) => FIELD_LABEL[key] ?? key).join(", ")}</div>}
                        {item.adjustments.map((text) => <div key={text}>{text}</div>)}
                        {item.warnings.map((text) => <div key={text} style={{ color: "var(--et2-warn)" }}>{text}</div>)}
                        {!item.completed.length && !item.adjustments.length && !item.warnings.length && <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div className="et2-card-body" style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--et2-line)" }}>
        <button className="et2-btn" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="et2-btn et2-btn--ok" onClick={confirm} disabled={busy || !preview || !changes}>
          {busy && preview ? "Importando…" : `Importar ${changes || ""} fornecedor(es)`}
        </button>
      </div>
    </>
  );
}
