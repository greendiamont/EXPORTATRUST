// Envio automático do Shipment Report: de hora em hora, para cada empresa com clientes de envio
// automático ligado, chama a ação "run-scheduled" do app (que decide quem está no prazo de N dias ou
// teve mudança de fase). Roda só em produção; em homologação só com SHIPMENT_REPORT_SCHEDULER=1, para
// não mandar e-mail a clientes reais a partir de dados de teste.

const HOUR = 60 * 60 * 1000;

export function startShipmentReportScheduler({ pool, worker, env, ctx, appEnv }) {
  const flag = process.env.SHIPMENT_REPORT_SCHEDULER;
  const enabled = flag === "1" || (flag !== "0" && appEnv === "production");
  if (!enabled) {
    console.log("[shipment-report] envio automático desligado neste ambiente.");
    return () => {};
  }
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { rows } = await pool.query(`
        SELECT o.id,
          (SELECT u.email FROM organization_memberships m JOIN app_users u ON u.id = m.user_id
            WHERE m.organization_id = o.id AND m.role = 'administrador' AND m.status = 'Ativo' AND u.status = 'Ativo'
            ORDER BY m.id LIMIT 1) AS admin_email
        FROM organizations o
        WHERE o.id IN (SELECT organization_id FROM shipment_report_settings WHERE auto <> 0)`);
      for (const organization of rows) {
        if (!organization.admin_email) continue;
        const request = new Request("http://railway.invalid/api/shipment-report", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-exportatrust-authenticated-user-email": organization.admin_email,
            "x-exportatrust-authenticated-user-name": organization.admin_email,
            "x-exportatrust-auth-provider": "railway-scheduler",
            cookie: `exportatrust_org=${organization.id}`,
          },
          body: JSON.stringify({ action: "run-scheduled" }),
        });
        const response = await worker.fetch(request, env, ctx);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) console.error(`[shipment-report] empresa ${organization.id}: HTTP ${response.status}`, result.error ?? "");
        else if (result.sent?.length) console.log(`[shipment-report] empresa ${organization.id}: ${result.sent.length} relatório(s) enviado(s)`);
      }
    } catch (error) {
      console.error("[shipment-report] falha no envio automático:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  }
  const first = setTimeout(tick, 2 * 60 * 1000);
  const timer = setInterval(tick, HOUR);
  console.log("[shipment-report] envio automático ligado (verificação de hora em hora).");
  return () => { clearTimeout(first); clearInterval(timer); };
}
