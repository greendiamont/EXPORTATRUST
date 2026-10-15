// Utilitários das telas novas (lado do navegador).

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text.slice(0, 200) }; }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function relativeDue(value: string | null | undefined, today: string) {
  if (!value) return { label: "Sem prazo", tone: "todo" as const };
  const due = value.slice(0, 10);
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  if (Number.isNaN(days)) return { label: value, tone: "todo" as const };
  if (days < 0) return { label: days === -1 ? "Atrasado 1 dia" : `Atrasado ${-days} dias`, tone: "bad" as const };
  if (days === 0) return { label: "Hoje", tone: "warn" as const };
  if (days === 1) return { label: "Amanhã", tone: "warn" as const };
  if (days <= 7) return { label: `Em ${days} dias`, tone: "todo" as const };
  return { label: formatDate(due), tone: "todo" as const };
}

export function money(value: number | null | undefined, currency = "USD") {
  if (!value) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("pt-BR")}`;
  }
}

export function processHref(id: number) {
  return `/pedidos/${id}`;
}

export function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
