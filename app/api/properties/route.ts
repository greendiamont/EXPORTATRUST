import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { forestDocuments, operations, ruralProperties } from "../../../db/schema";
import { audit, requireSecurityContext } from "../../../lib/security";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

export async function GET() {
  try {
    const context = await requireSecurityContext("read");
    const db = await getDb();
    const rows = await db.select().from(ruralProperties).where(eq(ruralProperties.organizationId, context.organizationId)).orderBy(desc(ruralProperties.id)).limit(100);
    return Response.json({ properties: rows });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    const body = (await request.json()) as {
      carCode?: string;
      name?: string;
      city?: string;
      supplier?: string;
      areaHa?: number;
      nativeAreaHa?: number;
      geometry?: unknown;
      sourceFile?: string;
      status?: string;
      risk?: string;
    };

    const carCode = body.carCode?.trim().toUpperCase() ?? "";
    const name = body.name?.trim() ?? "";
    const city = body.city?.trim() ?? "";
    const supplier = body.supplier?.trim() ?? "";
    const areaHa = Number(body.areaHa);
    const nativeAreaHa = Number(body.nativeAreaHa ?? 0);
    const status = body.status?.trim() || "Em análise";
    const risk = body.risk?.trim() || "atenção";

    if (!carCode || !name || !city || !supplier || !Number.isFinite(areaHa) || areaHa <= 0 || !body.geometry) {
      return Response.json({ error: "Preencha os campos obrigatórios e envie uma geometria válida." }, { status: 400 });
    }

    const geometryJson = JSON.stringify(body.geometry);
    if (geometryJson.length > 1_500_000) {
      return Response.json({ error: "GeoJSON excede o limite de 1,5 MB desta versão." }, { status: 413 });
    }

    const db = await getDb();
    const existing = await db.select({ id: ruralProperties.id }).from(ruralProperties).where(and(eq(ruralProperties.organizationId, context.organizationId), eq(ruralProperties.carCode, carCode))).limit(1);
    if (existing.length) {
      return Response.json({ error: "Já existe um imóvel cadastrado com este código CAR." }, { status: 409 });
    }

    const [property] = await db.insert(ruralProperties).values({
      organizationId: context.organizationId,
      carCode,
      name,
      city,
      supplier,
      areaHa,
      nativeAreaHa: Number.isFinite(nativeAreaHa) ? nativeAreaHa : 0,
      status,
      risk,
      geometryJson,
      sourceFile: body.sourceFile?.trim() ?? "",
    }).returning();
    await audit(context, "PROPERTY_CREATED", "rural_property", carCode, { name, city, areaHa });
    return Response.json({ property }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireSecurityContext("write");
    const body = (await request.json()) as {
      carCode?: string; name?: string; city?: string; supplier?: string; areaHa?: number; nativeAreaHa?: number;
      status?: string; risk?: string; sourceFile?: string; geometry?: unknown;
    };
    const carCode = body.carCode?.trim().toUpperCase() ?? "";
    if (!carCode) return Response.json({ error: "Informe o código CAR do imóvel." }, { status: 400 });
    const areaHa = Number(body.areaHa);
    const nativeAreaHa = Number(body.nativeAreaHa ?? 0);
    if (!body.name?.trim() || !body.city?.trim() || !body.supplier?.trim() || !Number.isFinite(areaHa) || areaHa <= 0 || !Number.isFinite(nativeAreaHa) || nativeAreaHa < 0 || nativeAreaHa > areaHa) {
      return Response.json({ error: "Revise os dados obrigatórios e as áreas do imóvel." }, { status: 400 });
    }
    const updates: Record<string, unknown> = {
      name: body.name.trim(), city: body.city.trim(), supplier: body.supplier.trim(), areaHa, nativeAreaHa,
      status: body.status?.trim() || "Em análise", risk: body.risk?.trim() || "atenção", sourceFile: body.sourceFile?.trim() || "",
    };
    if (body.geometry) {
      const geometryJson = JSON.stringify(body.geometry);
      if (geometryJson.length > 1_500_000) return Response.json({ error: "GeoJSON excede o limite de 1,5 MB." }, { status: 413 });
      updates.geometryJson = geometryJson;
    }
    const db = await getDb();
    const [property] = await db.update(ruralProperties).set(updates).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId))).returning();
    if (!property) return Response.json({ error: "Imóvel CAR não encontrado." }, { status: 404 });
    await audit(context, "PROPERTY_UPDATED", "rural_property", carCode, { name: property.name, areaHa: property.areaHa });
    return Response.json({ property });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireSecurityContext("delete");
    const carCode = String(new URL(request.url).searchParams.get("carCode") ?? "").trim().toUpperCase();
    if (!carCode) return Response.json({ error: "Informe o código CAR do imóvel." }, { status: 400 });
    const db = await getDb();
    const [existing] = await db.select().from(ruralProperties).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId))).limit(1);
    if (!existing) return Response.json({ error: "Imóvel CAR não encontrado." }, { status: 404 });

    const documents = await db.select().from(forestDocuments).where(and(eq(forestDocuments.propertyCarCode, carCode), eq(forestDocuments.organizationId, context.organizationId)));
    if (documents.length) {
      try {
        const { env } = await import("cloudflare:workers");
        if (env.BUCKET) await Promise.all(documents.map((document) => env.BUCKET!.delete(document.objectKey)));
      } catch { /* metadata deletion below remains authoritative */ }
      await db.delete(forestDocuments).where(and(eq(forestDocuments.propertyCarCode, carCode), eq(forestDocuments.organizationId, context.organizationId)));
    }

    const operationRows = await db.select({ id: operations.id, propertyIds: operations.propertyIds }).from(operations).where(eq(operations.organizationId, context.organizationId));
    for (const operation of operationRows) {
      let ids: string[] = [];
      try { const parsed = JSON.parse(operation.propertyIds || "[]") as unknown; if (Array.isArray(parsed)) ids = parsed.map(String); } catch { ids = []; }
      if (ids.includes(carCode)) await db.update(operations).set({ propertyIds: JSON.stringify(ids.filter((id) => id !== carCode)) }).where(eq(operations.id, operation.id));
    }
    await db.delete(ruralProperties).where(and(eq(ruralProperties.carCode, carCode), eq(ruralProperties.organizationId, context.organizationId)));
    await audit(context, "PROPERTY_DELETED", "rural_property", carCode, { name: existing.name });
    return Response.json({ deleted: true, carCode });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
