import { requireSecurityContext } from "../../../lib/security";

// Dólar do dia para a emissão em reais (Financeiro): PTAX de venda do Banco Central, do último dia útil
// com cotação. Se o BCB não responder, o usuário informa a taxa à mão.

const BCB = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";
const usDate = (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;

export async function GET() {
  try {
    await requireSecurityContext("read");
    const end = new Date();
    const start = new Date(end.getTime() - 10 * 86_400_000);
    const url = `${BCB}?@dataInicial='${usDate(start)}'&@dataFinalCotacao='${usDate(end)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`BCB ${response.status}`);
    const data = await response.json() as { value?: Array<{ cotacaoVenda: number; dataHoraCotacao: string }> };
    const last = data.value?.at(-1);
    if (!last?.cotacaoVenda) throw new Error("sem cotação");
    return Response.json({ rate: last.cotacaoVenda, date: last.dataHoraCotacao.slice(0, 10), source: "PTAX venda · Banco Central do Brasil" });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Não foi possível consultar a PTAX do Banco Central agora. Informe a taxa do dia à mão." }, { status: 502 });
  }
}
