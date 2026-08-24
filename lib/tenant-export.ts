import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  appUsers,
  auditLogs,
  forestDocuments,
  industrialPlans,
  operationDocuments,
  shipmentAdvices,
  operationPartners,
  operations,
  organizationMemberships,
  organizations,
  paymentTransactions,
  pdfIntegrityRecords,
  ruralProperties,
  suppliers,
} from "../db/schema";

export async function tenantExport(organizationId: number) {
  const db = await getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const [members, supplierRows, operationRows, propertyRows, operationDocumentRows, shipmentAdviceRows, forestDocumentRows, partnerRows, planRows, paymentRows, integrityRows, auditRows] = await Promise.all([
    db.select({ id: organizationMemberships.id, role: organizationMemberships.role, status: organizationMemberships.status, email: appUsers.email, fullName: appUsers.fullName }).from(organizationMemberships).innerJoin(appUsers, eq(organizationMemberships.userId, appUsers.id)).where(eq(organizationMemberships.organizationId, organizationId)),
    db.select().from(suppliers).where(eq(suppliers.organizationId, organizationId)),
    db.select().from(operations).where(eq(operations.organizationId, organizationId)),
    db.select().from(ruralProperties).where(eq(ruralProperties.organizationId, organizationId)),
    db.select().from(operationDocuments).where(eq(operationDocuments.organizationId, organizationId)),
    db.select().from(shipmentAdvices).where(eq(shipmentAdvices.organizationId, organizationId)),
    db.select().from(forestDocuments).where(eq(forestDocuments.organizationId, organizationId)),
    db.select().from(operationPartners).where(eq(operationPartners.organizationId, organizationId)),
    db.select().from(industrialPlans).where(eq(industrialPlans.organizationId, organizationId)),
    db.select().from(paymentTransactions).where(eq(paymentTransactions.organizationId, organizationId)),
    db.select().from(pdfIntegrityRecords).where(eq(pdfIntegrityRecords.organizationId, organizationId)),
    db.select().from(auditLogs).where(eq(auditLogs.organizationId, organizationId)).orderBy(auditLogs.id).limit(10000),
  ]);
  return {
    format: "ExportaTrust Portable Export v2",
    generatedAt: new Date().toISOString(),
    organization,
    members,
    data: {
      suppliers: supplierRows,
      operations: operationRows,
      properties: propertyRows,
      operationDocuments: operationDocumentRows,
      shipmentAdvices: shipmentAdviceRows,
      forestDocuments: forestDocumentRows,
      partners: partnerRows,
      industrialPlans: planRows,
      payments: paymentRows,
      pdfIntegrity: integrityRows,
      auditTrail: auditRows,
    },
    restoration: {
      schemaVersion: 2,
      objectKeysIncluded: true,
      note: "Os objectKey identificam os arquivos originais preservados no armazenamento privado.",
    },
  };
}
