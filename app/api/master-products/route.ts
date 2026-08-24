import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { masterProducts } from "../../../db/schema";
import { normalizeMasterName } from "../../../lib/master-data";
import { audit, requireSecurityContext } from "../../../lib/security";

const normalizeHsCode = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; cause?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (record.cause instanceof Error && record.cause.message) return record.cause.message;
    if (typeof record.cause === "string" && record.cause.trim()) return record.cause;
  }
  return fallback;
};

const clean = (b: Record<string, unknown>) => ({
  name: String(b.name ?? "").trim(),
  normalizedName: normalizeMasterName(b.name),
  rawMaterial: String(b.rawMaterial ?? "").trim(),
  species: String(b.species ?? "").trim(),
  scientificName: String(b.scientificName ?? "").trim(),
  hsCode: normalizeHsCode(b.hsCode),
  dimensionalSpecification: String(b.dimensionalSpecification ?? "").trim(),
  grade: String(b.grade ?? "").trim(),
  kd: Boolean(b.kd),
  ht: Boolean(b.ht),
  moisture: String(b.moisture ?? "").trim(),
  certifications: String(b.certifications ?? "").trim(),
  originType: String(b.originType ?? "Reflorestamento").trim(),
  eligibleSupplierIds: JSON.stringify(Array.isArray(b.eligibleSupplierIds) ? b.eligibleSupplierIds.map(Number).filter(Boolean) : []),
  dataStatus: String(b.dataStatus ?? "Verificado").trim(),
  updatedAt: new Date().toISOString(),
});

export async function GET() { const c=await requireSecurityContext("read"); const db=await getDb(); return Response.json({ products: await db.select().from(masterProducts).where(eq(masterProducts.organizationId,c.organizationId)).orderBy(desc(masterProducts.id)).limit(500) }); }
export async function POST(request:Request){try{const c=await requireSecurityContext("write_supplier");const b=await request.json() as Record<string,unknown>;const v=clean(b);if(!v.name||!v.rawMaterial||!v.hsCode)return Response.json({error:"Informe Produto, matéria-prima e NCM/HS."},{status:400});const db=await getDb();const [sameName]=await db.select().from(masterProducts).where(and(eq(masterProducts.organizationId,c.organizationId),eq(masterProducts.normalizedName,v.normalizedName))).limit(1);if(sameName){const completed=Object.fromEntries(Object.entries(v).map(([key,value])=>[key,typeof value==="string"&&!value.trim()?sameName[key as keyof typeof sameName]??value:value])) as typeof v;await db.update(masterProducts).set(completed).where(and(eq(masterProducts.id,sameName.id),eq(masterProducts.organizationId,c.organizationId)));const [product]=await db.select().from(masterProducts).where(and(eq(masterProducts.id,sameName.id),eq(masterProducts.organizationId,c.organizationId))).limit(1);if(!product)return Response.json({error:"O produto foi atualizado, mas não pôde ser relido para confirmação."},{status:500});try{await audit(c,"MASTER_PRODUCT_COMPLETED","master_product",String(product.id),{name:product.name});}catch(auditError){console.error("MASTER_PRODUCT_AUDIT_FAILED",auditError);}return Response.json({product,action:"updated_existing"});}const [product]=await db.insert(masterProducts).values({...v,organizationId:c.organizationId}).returning();if(!product)return Response.json({error:"O produto não foi confirmado pelo banco de dados."},{status:500});try{await audit(c,"MASTER_PRODUCT_CREATED","master_product",String(product.id),{name:product.name});}catch(auditError){console.error("MASTER_PRODUCT_AUDIT_FAILED",auditError);}return Response.json({product},{status:201});}catch(e){console.error("MASTER_PRODUCT_CREATE_FAILED",e);if(e instanceof Response)return e;return Response.json({error:errorMessage(e,"Falha ao salvar produto no banco de dados.")},{status:500});}}
export async function PUT(request:Request){try{const c=await requireSecurityContext("write_supplier");const b=await request.json() as Record<string,unknown>;const id=Number(b.id);const v=clean(b);if(!id||!v.name||!v.rawMaterial||!v.hsCode)return Response.json({error:"Produto, matéria-prima e NCM/HS são obrigatórios."},{status:400});const db=await getDb();const duplicate=await db.select({id:masterProducts.id}).from(masterProducts).where(and(eq(masterProducts.organizationId,c.organizationId),eq(masterProducts.normalizedName,v.normalizedName))).limit(20);if(duplicate[0]&&duplicate[0].id!==id)return Response.json({error:"Outro produto já usa este nome normalizado."},{status:409});const [existing]=await db.select({id:masterProducts.id}).from(masterProducts).where(and(eq(masterProducts.id,id),eq(masterProducts.organizationId,c.organizationId))).limit(1);if(!existing)return Response.json({error:"Produto não encontrado."},{status:404});await db.update(masterProducts).set(v).where(and(eq(masterProducts.id,id),eq(masterProducts.organizationId,c.organizationId)));const [product]=await db.select().from(masterProducts).where(and(eq(masterProducts.id,id),eq(masterProducts.organizationId,c.organizationId))).limit(1);if(!product)return Response.json({error:"O produto foi atualizado, mas não pôde ser relido para confirmação."},{status:500});try{await audit(c,"MASTER_PRODUCT_UPDATED","master_product",String(id),{name:product.name});}catch(auditError){console.error("MASTER_PRODUCT_AUDIT_FAILED",auditError);}return Response.json({product});}catch(e){console.error("MASTER_PRODUCT_UPDATE_FAILED",e);if(e instanceof Response)return e;return Response.json({error:errorMessage(e,"Falha ao atualizar produto no banco de dados.")},{status:500});}}
