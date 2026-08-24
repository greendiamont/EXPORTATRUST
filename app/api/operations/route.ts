import { and, desc, eq } from "drizzle-orm";
import { ensureBaseTables, getDb } from "../../../db";
import { exportControlSettings, exportMilestones, importerClients, industrialPlans, masterProducts, operationDocuments, operations, operationStageSettings, ruralProperties, suppliers } from "../../../db/schema";
import { addDays, EXPORT_ORDER_MILESTONES } from "../../../lib/export-control";
import { normalizeMasterName } from "../../../lib/master-data";
import { calculateReadiness, hasPolygonGeometry } from "../../../lib/readiness";
import { audit, requireSecurityContext } from "../../../lib/security";

function message(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error instanceof Response) return `HTTP ${error.status}`;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; cause?: unknown; stack?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (record.cause instanceof Error && record.cause.message) return record.cause.message;
    if (typeof record.cause === "string" && record.cause.trim()) return record.cause;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized.slice(0, 500);
    } catch {
      // Fall through to the generic fallback.
    }
  }
  return "Erro inesperado no servidor ao salvar a operação.";
}

function numeric(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

const requiredFields: Array<[string, string]> = [
  ["supplierId", "Fornecedor principal"],
  ["euImporter", "Importador / operador europeu"],
];

function missingRequiredFields(body: Record<string, unknown>) {
  return requiredFields.filter(([field]) => !String(body[field] ?? "").trim()).map(([, label]) => label);
}

async function ensureOperationMasterDataStorage() {
  const { env } = await import("cloudflare:workers");
  const database = env.DB;
  await database.batch([
    database.prepare("CREATE TABLE IF NOT EXISTS importer_clients (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, legal_name text NOT NULL, normalized_name text NOT NULL, aliases text DEFAULT '' NOT NULL, tax_id text DEFAULT '' NOT NULL, tax_id_type text DEFAULT 'VAT' NOT NULL, eori text DEFAULT '' NOT NULL, address text DEFAULT '' NOT NULL, city text DEFAULT '' NOT NULL, state text DEFAULT '' NOT NULL, postal_code text DEFAULT '' NOT NULL, country text NOT NULL, contact_name text DEFAULT '' NOT NULL, email text DEFAULT '' NOT NULL, phone text DEFAULT '' NOT NULL, preferred_port text DEFAULT '' NOT NULL, payment_terms text DEFAULT '' NOT NULL, document_requirements text DEFAULT '' NOT NULL, data_status text DEFAULT 'Pendente' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS importer_clients_org_normalized_idx ON importer_clients (organization_id, normalized_name)"),
    database.prepare("CREATE TABLE IF NOT EXISTS master_products (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, name text NOT NULL, normalized_name text NOT NULL, raw_material text DEFAULT '' NOT NULL, species text DEFAULT '' NOT NULL, scientific_name text DEFAULT '' NOT NULL, hs_code text DEFAULT '' NOT NULL, dimensional_specification text DEFAULT '' NOT NULL, grade text DEFAULT '' NOT NULL, kd integer DEFAULT 0 NOT NULL, ht integer DEFAULT 0 NOT NULL, moisture text DEFAULT '' NOT NULL, certifications text DEFAULT '' NOT NULL, origin_type text DEFAULT 'Reflorestamento' NOT NULL, eligible_supplier_ids text DEFAULT '[]' NOT NULL, data_status text DEFAULT 'Pendente' NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS master_products_org_normalized_idx ON master_products (organization_id, normalized_name)"),
    database.prepare("CREATE TABLE IF NOT EXISTS export_control_settings (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, operation_id integer NOT NULL UNIQUE, customer_name text DEFAULT '' NOT NULL, customer_email text DEFAULT '' NOT NULL, customer_reference text DEFAULT '' NOT NULL, notifications_enabled integer DEFAULT 1 NOT NULL, tracking_interval_days integer DEFAULT 10 NOT NULL, next_tracking_at text, email_provider_status text DEFAULT 'Simulação' NOT NULL, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL)"),
    database.prepare("CREATE TABLE IF NOT EXISTS export_milestones (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, organization_id integer DEFAULT 1 NOT NULL, operation_id integer NOT NULL, code text NOT NULL, sequence integer NOT NULL, title text NOT NULL, category text NOT NULL, status text DEFAULT 'Pendente' NOT NULL, quality_status text DEFAULT 'Não iniciado' NOT NULL, shipment_approval text DEFAULT 'Não aplicável' NOT NULL, responsible_name text DEFAULT '' NOT NULL, responsible_email text DEFAULT '' NOT NULL, due_date text DEFAULT '' NOT NULL, next_action text DEFAULT '' NOT NULL, note text DEFAULT '' NOT NULL, completed_at text, updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL, UNIQUE(operation_id, code))"),
    database.prepare(`CREATE TABLE IF NOT EXISTS operations (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      organization_id integer DEFAULT 1 NOT NULL,
      reference text DEFAULT '' NOT NULL UNIQUE,
      product text DEFAULT 'A classificar' NOT NULL,
      hs_code text DEFAULT '' NOT NULL,
      destination_country text DEFAULT '' NOT NULL,
      eu_importer text DEFAULT '' NOT NULL,
      importer_client_id integer,
      master_product_id integer,
      supplier_id integer,
      supplier_name text DEFAULT '' NOT NULL,
      shipment_date text DEFAULT '' NOT NULL,
      exporter_name text DEFAULT '' NOT NULL,
      exporter_tax_id text DEFAULT '' NOT NULL,
      internal_responsible text DEFAULT '' NOT NULL,
      responsible_email text DEFAULT '' NOT NULL,
      contract_number text DEFAULT '' NOT NULL,
      incoterm text DEFAULT 'FOB' NOT NULL,
      currency text DEFAULT 'USD' NOT NULL,
      commercial_value real DEFAULT 0 NOT NULL,
      quantity real DEFAULT 0 NOT NULL,
      quantity_unit text DEFAULT 'MT' NOT NULL,
      gross_weight_kg real DEFAULT 0 NOT NULL,
      net_weight_kg real DEFAULT 0 NOT NULL,
      volume_m3 real DEFAULT 0 NOT NULL,
      lot_codes text DEFAULT '' NOT NULL,
      raw_material text DEFAULT '' NOT NULL,
      species text DEFAULT '' NOT NULL,
      forest_origin_type text DEFAULT 'Plantação' NOT NULL,
      production_unit text DEFAULT '' NOT NULL,
      production_location text DEFAULT '' NOT NULL,
      property_ids text DEFAULT '[]' NOT NULL,
      transport_mode text DEFAULT 'Marítimo' NOT NULL,
      port_of_loading text DEFAULT '' NOT NULL,
      port_of_discharge text DEFAULT '' NOT NULL,
      carrier text DEFAULT '' NOT NULL,
      booking_number text DEFAULT '' NOT NULL,
      container_numbers text DEFAULT '' NOT NULL,
      vessel_voyage text DEFAULT '' NOT NULL,
      eu_operator_eori text DEFAULT '' NOT NULL,
      eudr_reference text DEFAULT '' NOT NULL,
      supply_chain_notes text DEFAULT '' NOT NULL,
      readiness integer DEFAULT 10 NOT NULL,
      status text DEFAULT 'Cadastro inicial' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`),
  ]);
  const ensureColumns = async (table: string, columns: Array<{ name: string; definition: string }>) => {
    const result = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const existing = new Set((result.results ?? []).map((column) => column.name));
    for (const column of columns) {
      if (!existing.has(column.name)) await database.prepare(`ALTER TABLE ${table} ADD ${column.definition}`).run();
    }
  };
  await ensureColumns("suppliers", [{ name: "organization_id", definition: "organization_id integer DEFAULT 1 NOT NULL" }]);
  await ensureColumns("rural_properties", [{ name: "organization_id", definition: "organization_id integer DEFAULT 1 NOT NULL" }]);
  await ensureColumns("industrial_plans", [{ name: "organization_id", definition: "organization_id integer DEFAULT 1 NOT NULL" }]);
  await ensureColumns("export_control_settings", [
    { name: "organization_id", definition: "organization_id integer DEFAULT 1 NOT NULL" },
    { name: "operation_id", definition: "operation_id integer DEFAULT 0 NOT NULL" },
    { name: "customer_name", definition: "customer_name text DEFAULT '' NOT NULL" },
    { name: "customer_email", definition: "customer_email text DEFAULT '' NOT NULL" },
    { name: "customer_reference", definition: "customer_reference text DEFAULT '' NOT NULL" },
    { name: "notifications_enabled", definition: "notifications_enabled integer DEFAULT 1 NOT NULL" },
    { name: "tracking_interval_days", definition: "tracking_interval_days integer DEFAULT 10 NOT NULL" },
    { name: "next_tracking_at", definition: "next_tracking_at text" },
    { name: "email_provider_status", definition: "email_provider_status text DEFAULT 'Simulação' NOT NULL" },
    { name: "updated_at", definition: "updated_at text DEFAULT '' NOT NULL" },
    { name: "created_at", definition: "created_at text DEFAULT '' NOT NULL" },
  ]);
  await ensureColumns("export_milestones", [
    { name: "organization_id", definition: "organization_id integer DEFAULT 1 NOT NULL" },
    { name: "operation_id", definition: "operation_id integer DEFAULT 0 NOT NULL" },
    { name: "code", definition: "code text DEFAULT '' NOT NULL" },
    { name: "sequence", definition: "sequence integer DEFAULT 0 NOT NULL" },
    { name: "title", definition: "title text DEFAULT '' NOT NULL" },
    { name: "category", definition: "category text DEFAULT '' NOT NULL" },
    { name: "status", definition: "status text DEFAULT 'Pendente' NOT NULL" },
    { name: "quality_status", definition: "quality_status text DEFAULT 'Não iniciado' NOT NULL" },
    { name: "shipment_approval", definition: "shipment_approval text DEFAULT 'Não aplicável' NOT NULL" },
    { name: "responsible_name", definition: "responsible_name text DEFAULT '' NOT NULL" },
    { name: "responsible_email", definition: "responsible_email text DEFAULT '' NOT NULL" },
    { name: "due_date", definition: "due_date text DEFAULT '' NOT NULL" },
    { name: "next_action", definition: "next_action text DEFAULT '' NOT NULL" },
    { name: "note", definition: "note text DEFAULT '' NOT NULL" },
    { name: "completed_at", definition: "completed_at text" },
    { name: "updated_at", definition: "updated_at text DEFAULT '' NOT NULL" },
    { name: "created_at", definition: "created_at text DEFAULT '' NOT NULL" },
  ]);
  await ensureColumns("operations", [
    { name: "organization_id", definition: "organization_id integer DEFAULT 1 NOT NULL" },
    { name: "reference", definition: "reference text DEFAULT '' NOT NULL" },
    { name: "product", definition: "product text DEFAULT 'A classificar' NOT NULL" },
    { name: "hs_code", definition: "hs_code text DEFAULT '' NOT NULL" },
    { name: "destination_country", definition: "destination_country text DEFAULT '' NOT NULL" },
    { name: "eu_importer", definition: "eu_importer text DEFAULT '' NOT NULL" },
    { name: "importer_client_id", definition: "importer_client_id integer" },
    { name: "master_product_id", definition: "master_product_id integer" },
    { name: "supplier_id", definition: "supplier_id integer" },
    { name: "supplier_name", definition: "supplier_name text DEFAULT '' NOT NULL" },
    { name: "shipment_date", definition: "shipment_date text DEFAULT '' NOT NULL" },
    { name: "exporter_name", definition: "exporter_name text DEFAULT '' NOT NULL" },
    { name: "exporter_tax_id", definition: "exporter_tax_id text DEFAULT '' NOT NULL" },
    { name: "internal_responsible", definition: "internal_responsible text DEFAULT '' NOT NULL" },
    { name: "responsible_email", definition: "responsible_email text DEFAULT '' NOT NULL" },
    { name: "contract_number", definition: "contract_number text DEFAULT '' NOT NULL" },
    { name: "incoterm", definition: "incoterm text DEFAULT 'FOB' NOT NULL" },
    { name: "currency", definition: "currency text DEFAULT 'USD' NOT NULL" },
    { name: "commercial_value", definition: "commercial_value real DEFAULT 0 NOT NULL" },
    { name: "quantity", definition: "quantity real DEFAULT 0 NOT NULL" },
    { name: "quantity_unit", definition: "quantity_unit text DEFAULT 'MT' NOT NULL" },
    { name: "gross_weight_kg", definition: "gross_weight_kg real DEFAULT 0 NOT NULL" },
    { name: "net_weight_kg", definition: "net_weight_kg real DEFAULT 0 NOT NULL" },
    { name: "volume_m3", definition: "volume_m3 real DEFAULT 0 NOT NULL" },
    { name: "lot_codes", definition: "lot_codes text DEFAULT '' NOT NULL" },
    { name: "raw_material", definition: "raw_material text DEFAULT '' NOT NULL" },
    { name: "species", definition: "species text DEFAULT '' NOT NULL" },
    { name: "forest_origin_type", definition: "forest_origin_type text DEFAULT 'Plantação' NOT NULL" },
    { name: "production_unit", definition: "production_unit text DEFAULT '' NOT NULL" },
    { name: "production_location", definition: "production_location text DEFAULT '' NOT NULL" },
    { name: "property_ids", definition: "property_ids text DEFAULT '[]' NOT NULL" },
    { name: "transport_mode", definition: "transport_mode text DEFAULT 'Marítimo' NOT NULL" },
    { name: "port_of_loading", definition: "port_of_loading text DEFAULT '' NOT NULL" },
    { name: "port_of_discharge", definition: "port_of_discharge text DEFAULT '' NOT NULL" },
    { name: "carrier", definition: "carrier text DEFAULT '' NOT NULL" },
    { name: "booking_number", definition: "booking_number text DEFAULT '' NOT NULL" },
    { name: "bill_of_lading_number", definition: "bill_of_lading_number text DEFAULT '' NOT NULL" },
    { name: "container_numbers", definition: "container_numbers text DEFAULT '' NOT NULL" },
    { name: "vessel_voyage", definition: "vessel_voyage text DEFAULT '' NOT NULL" },
    { name: "eu_operator_eori", definition: "eu_operator_eori text DEFAULT '' NOT NULL" },
    { name: "eudr_reference", definition: "eudr_reference text DEFAULT '' NOT NULL" },
    { name: "supply_chain_notes", definition: "supply_chain_notes text DEFAULT '' NOT NULL" },
    { name: "readiness", definition: "readiness integer DEFAULT 10 NOT NULL" },
    { name: "status", definition: "status text DEFAULT 'Cadastro inicial' NOT NULL" },
    { name: "created_at", definition: "created_at text DEFAULT '' NOT NULL" },
  ]);
}

async function ensureExportControlForOperation(db: Awaited<ReturnType<typeof getDb>>, operation: typeof operations.$inferSelect, organizationId: number) {
  const now = new Date();
  const [existingSettings] = await db.select({ id: exportControlSettings.id }).from(exportControlSettings).where(eq(exportControlSettings.operationId, operation.id)).limit(1);
  if (existingSettings) {
    await db.update(exportControlSettings).set({ organizationId, customerName: operation.euImporter || "" }).where(eq(exportControlSettings.id, existingSettings.id));
  } else {
    try {
      await db.insert(exportControlSettings).values({
        organizationId,
        operationId: operation.id,
        customerName: operation.euImporter,
        nextTrackingAt: addDays(now, 10),
      });
    } catch {
      const [settings] = await db.select({ id: exportControlSettings.id }).from(exportControlSettings).where(eq(exportControlSettings.operationId, operation.id)).limit(1);
      if (settings) await db.update(exportControlSettings).set({ organizationId, customerName: operation.euImporter || "" }).where(eq(exportControlSettings.id, settings.id));
    }
  }
  const existing = await db.select().from(exportMilestones).where(eq(exportMilestones.operationId, operation.id)).limit(100);
  for (const milestone of EXPORT_ORDER_MILESTONES) {
    const row = {
      organizationId,
      operationId: operation.id,
      code: milestone.code,
      sequence: milestone.sequence,
      title: milestone.title,
      category: milestone.category,
      status: milestone.sequence === 1 ? "Em andamento" : "Pendente",
      responsibleName: operation.internalResponsible,
      responsibleEmail: operation.responsibleEmail,
      dueDate: milestone.code === "BOOKING" || milestone.code === "SHIPPED" ? operation.shipmentDate : "",
      nextAction: milestone.description,
      shipmentApproval: milestone.code === "SHIPMENT_APPROVAL" ? "Pendente" : "Não aplicável",
    };
    const current = existing.find((item) => item.code === milestone.code);
    if (current) {
      await db.update(exportMilestones).set({ organizationId, sequence: row.sequence, title: row.title, category: row.category }).where(eq(exportMilestones.id, current.id));
      continue;
    }
    try {
      await db.insert(exportMilestones).values(row);
    } catch {
      const [conflicting] = await db.select().from(exportMilestones).where(and(eq(exportMilestones.operationId, operation.id), eq(exportMilestones.code, milestone.code))).limit(1);
      if (conflicting) await db.update(exportMilestones).set({ organizationId, sequence: row.sequence, title: row.title, category: row.category }).where(eq(exportMilestones.id, conflicting.id));
    }
  }
}

function values(body: Record<string, unknown>, supplier: { id: number; legalName: string; taxId: string; city: string; state: string; country: string }, master: { importerClientId: number | null; masterProductId: number | null }) {
  const exporterName = String(body.exporterName ?? "").trim() || supplier.legalName;
  const supplierIsExporter = exporterName.toLocaleLowerCase("pt-BR") === supplier.legalName.toLocaleLowerCase("pt-BR");
  const reference = String(body.reference ?? "").trim().toUpperCase() || `OP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  return {
    reference,
    product: String(body.product ?? "").trim() || "A classificar",
    hsCode: String(body.hsCode ?? "").trim(),
    destinationCountry: String(body.destinationCountry ?? "").trim(),
    euImporter: String(body.euImporter).trim(),
    importerClientId: master.importerClientId,
    masterProductId: master.masterProductId,
    supplierId: supplier.id,
    supplierName: supplier.legalName,
    shipmentDate: String(body.shipmentDate ?? "").trim(),
    exporterName,
    exporterTaxId: String(body.exporterTaxId ?? "").trim() || (supplierIsExporter ? supplier.taxId : ""),
    internalResponsible: String(body.internalResponsible ?? "").trim(),
    responsibleEmail: String(body.responsibleEmail ?? "").trim().toLowerCase(),
    contractNumber: String(body.contractNumber ?? "").trim(),
    incoterm: String(body.incoterm ?? "FOB").trim(),
    currency: String(body.currency ?? "USD").trim(),
    commercialValue: numeric(body.commercialValue),
    quantity: numeric(body.quantity),
    quantityUnit: String(body.quantityUnit ?? "MT").trim(),
    grossWeightKg: numeric(body.grossWeightKg),
    netWeightKg: numeric(body.netWeightKg),
    volumeM3: numeric(body.volumeM3),
    lotCodes: String(body.lotCodes ?? "").trim(),
    rawMaterial: String(body.rawMaterial ?? "").trim(),
    species: String(body.species ?? "").trim(),
    forestOriginType: String(body.forestOriginType ?? "Plantação").trim(),
    productionUnit: String(body.productionUnit ?? "").trim(),
    productionLocation: `${supplier.city}/${supplier.state} · ${supplier.country}`,
    propertyIds: JSON.stringify(Array.isArray(body.propertyIds) ? body.propertyIds.map(String).filter(Boolean) : []),
    transportMode: String(body.transportMode ?? "Marítimo").trim(),
    portOfLoading: String(body.portOfLoading ?? "").trim(),
    portOfDischarge: String(body.portOfDischarge ?? "").trim(),
    carrier: String(body.carrier ?? "").trim(),
    bookingNumber: String(body.bookingNumber ?? "").trim(),
    billOfLadingNumber: String(body.billOfLadingNumber ?? "").trim(),
    containerNumbers: String(body.containerNumbers ?? "").trim(),
    vesselVoyage: String(body.vesselVoyage ?? "").trim(),
    euOperatorEori: String(body.euOperatorEori ?? "").trim(),
    eudrReference: String(body.eudrReference ?? "").trim(),
    supplyChainNotes: String(body.supplyChainNotes ?? "").trim(),
  };
}

async function ensureMasterLinks(db: Awaited<ReturnType<typeof getDb>>, body: Record<string, unknown>, organizationId: number) {
  const clientName = String(body.euImporter ?? "").trim();
  const productName = String(body.product ?? "").trim() || "A classificar";
  const clientNormalized = normalizeMasterName(clientName);
  const productNormalized = normalizeMasterName(productName);
  const requestedClientId = Number(body.importerClientId ?? 0);
  let [client] = requestedClientId
    ? await db.select().from(importerClients).where(and(eq(importerClients.organizationId, organizationId), eq(importerClients.id, requestedClientId))).limit(1)
    : await db.select().from(importerClients).where(and(eq(importerClients.organizationId, organizationId), eq(importerClients.normalizedName, clientNormalized))).limit(1);
  if (requestedClientId && !client) throw new Error("Cliente importador não encontrado no Cadastro Mestre.");
  if (!client) [client] = await db.insert(importerClients).values({ organizationId, legalName: clientName, normalizedName: clientNormalized, country: String(body.destinationCountry ?? "").trim(), preferredPort: String(body.portOfDischarge ?? "").trim(), eori: String(body.euOperatorEori ?? "").trim(), dataStatus: "Importado" }).returning();
  let [product] = await db.select().from(masterProducts).where(and(eq(masterProducts.organizationId, organizationId), eq(masterProducts.normalizedName, productNormalized))).limit(1);
  if (!product) [product] = await db.insert(masterProducts).values({ organizationId, name: productName, normalizedName: productNormalized, rawMaterial: String(body.rawMaterial ?? "").trim(), species: String(body.species ?? "").trim(), hsCode: String(body.hsCode ?? "").trim(), originType: String(body.forestOriginType ?? "Reflorestamento").trim(), eligibleSupplierIds: JSON.stringify([Number(body.supplierId)]), dataStatus: "Importado" }).returning();
  return { importerClientId: client.id, masterProductId: product.id };
}

async function safeMasterLinks(db: Awaited<ReturnType<typeof getDb>>, body: Record<string, unknown>, organizationId: number) {
  try {
    return await ensureMasterLinks(db, body, organizationId);
  } catch (error) {
    console.error("OPERATION_MASTER_LINKS_FAILED", error);
    return { importerClientId: null, masterProductId: null };
  }
}

async function supplierFor(db: Awaited<ReturnType<typeof getDb>>, supplierId: number, organizationId: number) {
  return (await db.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId))).limit(1))[0];
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    await ensureBaseTables();
    await ensureOperationMasterDataStorage();
    const db = await getDb();
    const rows = await db.select().from(operations).where(eq(operations.organizationId, context.organizationId)).orderBy(desc(operations.id)).limit(250);
    const [documents, settings, properties, plans] = await Promise.all([
      db.select({ operationId: operationDocuments.operationId, category: operationDocuments.category }).from(operationDocuments).limit(5000).catch((error) => {
        console.error("OPERATIONS_DOCUMENTS_READ_FAILED", error);
        return [];
      }),
      db.select({ operationId: operationStageSettings.operationId, stageCategory: operationStageSettings.stageCategory, enabled: operationStageSettings.enabled }).from(operationStageSettings).limit(5000).catch((error) => {
        console.error("OPERATIONS_STAGE_SETTINGS_READ_FAILED", error);
        return [];
      }),
      db.select({ carCode: ruralProperties.carCode, geometryJson: ruralProperties.geometryJson }).from(ruralProperties).where(eq(ruralProperties.organizationId, context.organizationId)).limit(5000).catch((error) => {
        console.error("OPERATIONS_PROPERTIES_READ_FAILED", error);
        return [];
      }),
      db.select().from(industrialPlans).where(eq(industrialPlans.organizationId, context.organizationId)).limit(1000).catch((error) => {
        console.error("OPERATIONS_PLANS_READ_FAILED", error);
        return [];
      }),
    ]);
    const geolocatedCars = new Set(properties.filter((property) => hasPolygonGeometry(property.geometryJson)).map((property) => property.carCode));
    const calculated = rows.map((operation) => {
      let propertyIds: string[] = [];
      try {
        const parsed = JSON.parse(operation.propertyIds || "[]");
        propertyIds = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
      } catch {
        propertyIds = [];
      }
      const hasGeolocatedProperties = propertyIds.some((carCode) => geolocatedCars.has(carCode));
      const plan = plans.find((item) => item.operationId === operation.id);
      const completedSystemStages = plan?.periodStart && plan.periodEnd && plan.receivingLots && plan.productionLots ? ["Planta industrial · produção"] : [];
      return { ...operation, readiness: calculateReadiness(operation.id, documents, settings, hasGeolocatedProperties, completedSystemStages) };
    });
    await Promise.all(calculated.filter((operation, index) => operation.readiness !== rows[index].readiness).map((operation) =>
      db.update(operations).set({ readiness: operation.readiness }).where(eq(operations.id, operation.id))
    ));
    return Response.json({ operations: calculated });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    await ensureOperationMasterDataStorage();
    const body = await request.json() as Record<string, unknown>;
    const missing = missingRequiredFields(body);
    if (missing.length) {
      return Response.json({ error: `Preencha: ${missing.join(", ")}.` }, { status: 400 });
    }
    const reference = String(body.reference ?? "").trim().toUpperCase();
    const supplierId = Number(body.supplierId);
    const db = await getDb();
    if (reference) {
      const [existingOperation] = await db.select().from(operations).where(and(eq(operations.organizationId, context.organizationId), eq(operations.reference, reference))).limit(1);
      if (existingOperation) return Response.json({ operation: existingOperation, duplicate: true });
    }
    const supplier = await supplierFor(db, supplierId, context.organizationId);
    if (!supplier) return Response.json({ error: "Fornecedor não encontrado." }, { status: 404 });
    const master = await safeMasterLinks(db, body, context.organizationId);
    const [operation] = await db.insert(operations).values({ ...values(body, supplier, master), organizationId: context.organizationId }).returning();
    await ensureExportControlForOperation(db, operation, context.organizationId);
    try { await audit(context, "OPERATION_CREATED", "operation", String(operation.id), { reference: operation.reference }); } catch (auditError) { console.error("OPERATION_AUDIT_FAILED", auditError); }
    return Response.json({ operation }, { status: 201 });
  } catch (error) {
    console.error("OPERATION_CREATE_FAILED", error);
    if (error instanceof Response) return error;
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    await ensureOperationMasterDataStorage();
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    const supplierId = Number(body.supplierId);
    if (!id || !supplierId) return Response.json({ error: "Operação ou fornecedor inválido." }, { status: 400 });
    const missing = missingRequiredFields(body);
    if (missing.length) return Response.json({ error: `Preencha: ${missing.join(", ")}.` }, { status: 400 });
    const db = await getDb();
    const supplier = await supplierFor(db, supplierId, context.organizationId);
    if (!supplier) return Response.json({ error: "Fornecedor não encontrado." }, { status: 404 });
    const master = await safeMasterLinks(db, body, context.organizationId);
    const [operation] = await db.update(operations).set(values(body, supplier, master)).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId))).returning();
    if (!operation) return Response.json({ error: "Operação não encontrada." }, { status: 404 });
    await ensureExportControlForOperation(db, operation, context.organizationId);
    try { await audit(context, "OPERATION_UPDATED", "operation", String(id), { reference: operation.reference }); } catch (auditError) { console.error("OPERATION_AUDIT_FAILED", auditError); }
    return Response.json({ operation });
  } catch (error) {
    console.error("OPERATION_UPDATE_FAILED", error);
    if (error instanceof Response) return error;
    return Response.json({ error: message(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    await ensureBaseTables();
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!id) return Response.json({ error: "Processo inválido." }, { status: 400 });
    const db = await getDb();
    if (Array.isArray(body.propertyIds)) {
      const requested = [...new Set(body.propertyIds.map(String).map((value) => value.trim()).filter(Boolean))];
      const existingProperties = await db.select({ carCode: ruralProperties.carCode }).from(ruralProperties).where(eq(ruralProperties.organizationId, context.organizationId)).limit(5000);
      const existingCodes = new Set(existingProperties.map((property) => property.carCode));
      const invalid = requested.filter((carCode) => !existingCodes.has(carCode));
      if (invalid.length) return Response.json({ error: `Floresta/CAR não encontrada: ${invalid.join(", ")}.` }, { status: 404 });
      const [operation] = await db.update(operations).set({ propertyIds: JSON.stringify(requested) }).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId))).returning();
      if (!operation) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
      await audit(context, "OPERATION_FORESTS_UPDATED", "operation", String(id), { propertyIds: requested });
      return Response.json({ operation });
    }
    const readiness = Math.max(0, Math.min(100, Math.round(Number(body.readiness))));
    if (!Number.isFinite(readiness)) return Response.json({ error: "Prontidão inválida." }, { status: 400 });
    const [operation] = await db.update(operations).set({ readiness }).where(and(eq(operations.id, id), eq(operations.organizationId, context.organizationId))).returning();
    if (!operation) return Response.json({ error: "Processo não encontrado." }, { status: 404 });
    return Response.json({ operation });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 500 });
  }
}
