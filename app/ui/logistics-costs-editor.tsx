"use client";

import { costsFromDraft, emptyDraftItem, parseAmount, itemTotal, logisticsByCurrency, logisticsTotalIn, sumByCurrency, type LogisticsCosts, type LogisticsDraft } from "../../lib/logistics-costs";

// Prévia dos custos logísticos por serviço, como a cotação do agente/armador
// (protótipo "5b · Custos logísticos", aprovado por Ivam em 2026-10-16).

const two = (value: number) => value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number, code: string) => `${code === "USD" ? "US$" : "R$"} ${two(value)}`;
const byCurrencyText = (sums: Record<string, number>) => Object.entries(sums).map(([code, value]) => `${code} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function LogisticsCostsEditor({ value, onChange }: { value: LogisticsDraft; onChange: (next: LogisticsDraft) => void }) {
  const costs = costsFromDraft(value);
  const set = (patch: Partial<LogisticsDraft>) => onChange({ ...value, ...patch });
  const setGroup = (index: number, group: LogisticsDraft["groups"][number]) => set({ groups: value.groups.map((item, at) => at === index ? group : item) });
  const totals = byCurrencyText(logisticsByCurrency(costs));
  const usd = logisticsTotalIn(costs, "USD");
  const brl = logisticsTotalIn(costs, "BRL");
  const header: Array<[keyof LogisticsDraft, string, string]> = [["exchangeRate", "Câmbio (R$ por US$ 1)", "Ex.: 5,40"], ["agent", "Agente / armador", "Ex.: HMM"], ["equipment", "Equipamento", "Ex.: 1 × 40 HIGH CUBE"], ["validUntil", "Validade da cotação", "Ex.: 31/10/2026"]];

  return (
    <div className="lc-box">
      <div className="lc-head">
        {header.map(([key, label, placeholder]) => (
          <label key={key}>{label}
            <input className="pd-input" placeholder={placeholder} inputMode={key === "exchangeRate" ? "decimal" : undefined} value={String(value[key])} onChange={(event) => set({ [key]: event.target.value })} />
          </label>
        ))}
      </div>

      {value.groups.map((group, groupIndex) => {
        const parsed = costs.groups.find((item) => item.name === group.name.trim());
        return (
          <div className="lc-group" key={groupIndex}>
            <div className="lc-group-head">
              <input className="lc-group-name" aria-label="Nome do grupo" placeholder="Nome do grupo (ex.: Custos de destino)" value={group.name} onChange={(event) => setGroup(groupIndex, { ...group, name: event.target.value })} />
              <span className="mono">{byCurrencyText(sumByCurrency(parsed?.items ?? [])).join(" · ")}</span>
            </div>
            <div className="lc-table-wrap">
              <table className="lc-table">
                <thead>
                  <tr><th>Serviço</th><th style={{ width: 90 }}>Moeda</th><th className="num" style={{ width: 120 }}>Tarifa</th><th className="num" style={{ width: 70 }}>Qtd</th><th style={{ width: 170 }}>Unidade</th><th className="num" style={{ width: 140 }}>Total</th><th style={{ width: 36 }}><span className="sr-only">Remover</span></th></tr>
                </thead>
                <tbody>
                  {group.items.map((item, itemIndex) => {
                    const setItem = (patch: Partial<typeof item>) => setGroup(groupIndex, { ...group, items: group.items.map((row, at) => at === itemIndex ? { ...row, ...patch } : row) });
                    const total = itemTotal({ ...item, rate: parseAmount(item.rate), quantity: parseAmount(item.quantity) || 1 });
                    return (
                      <tr key={itemIndex}>
                        <td><input className="pd-input" aria-label="Serviço" placeholder="Ex.: FRETE MARÍTIMO - FCL" value={item.service} onChange={(event) => setItem({ service: event.target.value })} /></td>
                        <td><select className="pd-input" aria-label="Moeda" value={item.currency} onChange={(event) => setItem({ currency: event.target.value })}><option value="USD">USD</option><option value="BRL">BRL</option></select></td>
                        <td><input className="pd-input num" aria-label="Tarifa" inputMode="decimal" placeholder="0,00" value={item.rate} onChange={(event) => setItem({ rate: event.target.value })} /></td>
                        <td><input className="pd-input num" aria-label="Quantidade" inputMode="decimal" value={item.quantity} onChange={(event) => setItem({ quantity: event.target.value })} /></td>
                        <td><input className="pd-input" aria-label="Unidade" placeholder="Ex.: por CNTR" value={item.unit} onChange={(event) => setItem({ unit: event.target.value })} /></td>
                        <td className="num mono">{total ? `${item.currency} ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
                        <td style={{ textAlign: "center" }}><button type="button" className="lc-remove" aria-label="Remover serviço" onClick={() => setGroup(groupIndex, { ...group, items: group.items.filter((_, at) => at !== itemIndex) })}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="lc-add-row">
                <button type="button" className="lc-add" onClick={() => setGroup(groupIndex, { ...group, items: [...group.items, emptyDraftItem(group.items.at(-1)?.currency ?? "USD")] })}>+ Adicionar serviço</button>
                {!group.items.length && <button type="button" className="lc-add" onClick={() => set({ groups: value.groups.filter((_, at) => at !== groupIndex) })}>Remover grupo</button>}
              </div>
            </div>
          </div>
        );
      })}
      <div className="lc-pad"><button type="button" className="lc-add" onClick={() => set({ groups: [...value.groups, { name: "", items: [emptyDraftItem("BRL")] }] })}>+ Adicionar grupo (ex.: Custos de destino, Frete rodoviário)</button></div>

      <div className="lc-totals">
        <div>
          <div className="lc-label">Total por moeda</div>
          {totals.length ? totals.map((line) => <div key={line} className="mono" style={{ marginTop: 4 }}>{line}</div>) : <div className="mono" style={{ marginTop: 4 }}>—</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="lc-label">Total convertido{costs.exchangeRate ? ` (câmbio ${costs.exchangeRate.toLocaleString("pt-BR", { maximumFractionDigits: 4 })})` : ""}</div>
          {usd !== null && brl !== null
            ? <><div className="lc-big mono">{money(usd, "USD")}</div><div className="lc-big mono">{money(brl, "BRL")}</div></>
            : <div style={{ marginTop: 4, color: "var(--et2-muted)" }}>informe o câmbio para somar reais e dólares</div>}
        </div>
      </div>
      <div className="lc-pad">
        <label className="lc-notes">Observações da cotação
          <input className="pd-input" placeholder="Ex.: transit time 43 dias via Singapore, free time 14 dias origem/destino" value={value.notes} onChange={(event) => set({ notes: event.target.value })} />
        </label>
      </div>
    </div>
  );
}

/** Leitura (página do pedido): a cotação por grupo, com total por moeda e convertido. */
export function LogisticsCostsSummary({ costs }: { costs: LogisticsCosts }) {
  const usd = logisticsTotalIn(costs, "USD");
  const brl = logisticsTotalIn(costs, "BRL");
  const totals = byCurrencyText(logisticsByCurrency(costs));
  const info = [["Câmbio (R$ por US$ 1)", costs.exchangeRate ? `R$ ${costs.exchangeRate.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}` : ""], ["Agente / armador", costs.agent], ["Equipamento", costs.equipment], ["Validade da cotação", costs.validUntil]];
  if (!costs.groups.length && !costs.notes) return <p className="muted" style={{ margin: 0 }}>Nenhum custo lançado. Use “Editar dados” para lançar a cotação.</p>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <dl className="et2-dl" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
        {info.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text || <span className="muted">—</span>}</dd></div>)}
      </dl>
      {costs.groups.map((group, index) => (
        <div key={index}>
          <div className="lc-group-head"><b>{group.name || "Sem grupo"}</b><span className="mono">{byCurrencyText(sumByCurrency(group.items)).join(" · ")}</span></div>
          <div className="lc-table-wrap">
            <table className="lc-table">
              <thead><tr><th>Serviço</th><th style={{ width: 70 }}>Moeda</th><th className="num" style={{ width: 110 }}>Tarifa</th><th className="num" style={{ width: 60 }}>Qtd</th><th style={{ width: 150 }}>Unidade</th><th className="num" style={{ width: 130 }}>Total</th></tr></thead>
              <tbody>
                {group.items.map((item, at) => (
                  <tr key={at}>
                    <td>{item.service}</td><td>{item.currency}</td>
                    <td className="num mono">{item.rate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="num mono">{(item.quantity || 1).toLocaleString("pt-BR")}</td>
                    <td>{item.unit}</td>
                    <td className="num mono">{item.currency} {itemTotal(item).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="lc-totals" style={{ borderTop: 0, padding: 0 }}>
        <div><div className="lc-label">Total por moeda</div>{totals.map((line) => <div key={line} className="mono" style={{ marginTop: 4 }}>{line}</div>)}</div>
        <div style={{ textAlign: "right" }}>
          <div className="lc-label">Total convertido</div>
          {usd !== null && brl !== null ? <><div className="lc-big mono">{money(usd, "USD")}</div><div className="lc-big mono">{money(brl, "BRL")}</div></> : <div style={{ marginTop: 4, color: "var(--et2-muted)" }}>informe o câmbio para somar reais e dólares</div>}
        </div>
      </div>
      {costs.notes && <div><div className="lc-label">Observações da cotação</div><div style={{ marginTop: 4 }}>{costs.notes}</div></div>}
    </div>
  );
}
