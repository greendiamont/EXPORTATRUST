"use client";

import { useEffect } from "react";

type OperationRow = Record<string, unknown> & {
  id?: number;
  reference?: string;
  product?: string;
  supplierId?: number;
  supplierName?: string;
  euImporter?: string;
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clonePayload(operation: OperationRow, reference: string) {
  return {
    reference,
    product: operation.product ?? "",
    hsCode: operation.hsCode ?? "",
    destinationCountry: operation.destinationCountry ?? "",
    euImporter: operation.euImporter ?? "",
    importerClientId: operation.importerClientId ?? null,
    masterProductId: operation.masterProductId ?? null,
    supplierId: operation.supplierId ?? null,
    supplierName: operation.supplierName ?? "",
    shipmentDate: "",
    exporterName: operation.exporterName ?? "",
    exporterTaxId: operation.exporterTaxId ?? "",
    internalResponsible: operation.internalResponsible ?? "",
    responsibleEmail: operation.responsibleEmail ?? "",
    contractNumber: operation.contractNumber ?? "",
    incoterm: operation.incoterm ?? "FOB",
    currency: operation.currency ?? "USD",
    commercialValue: operation.commercialValue ?? 0,
    quantity: operation.quantity ?? 0,
    quantityUnit: operation.quantityUnit ?? "MT",
    grossWeightKg: operation.grossWeightKg ?? 0,
    netWeightKg: operation.netWeightKg ?? 0,
    volumeM3: operation.volumeM3 ?? 0,
    lotCodes: operation.lotCodes ?? "",
    rawMaterial: operation.rawMaterial ?? "",
    species: operation.species ?? "",
    forestOriginType: operation.forestOriginType ?? "Plantação",
    productionUnit: operation.productionUnit ?? "",
    productionLocation: operation.productionLocation ?? "",
    propertyIds: operation.propertyIds ?? "[]",
    transportMode: operation.transportMode ?? "Marítimo",
    portOfLoading: operation.portOfLoading ?? "",
    portOfDischarge: operation.portOfDischarge ?? "",
    carrier: "",
    bookingNumber: "",
    billOfLadingNumber: "",
    containerNumbers: "",
    vesselVoyage: "",
    euOperatorEori: operation.euOperatorEori ?? "",
    eudrReference: "",
    supplyChainNotes: operation.supplyChainNotes ?? "",
    readiness: 10,
    status: "Cadastro inicial",
  };
}

function suggestedReference(reference: string) {
  const match = reference.match(/^(.*?)(?:[-\s]?P(?:ART)?\s*)(\d+)$/i);
  if (match) return `${match[1].replace(/[-\s]+$/, "")}-P${Number(match[2]) + 1}`;
  return `${reference}-P2`;
}

function makeButton(onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Duplicar processo ⧉";
  button.className = "duplicate-process-action";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  }, true);
  return button;
}

export default function ProcessDuplicateBridge() {
  useEffect(() => {
    let operations: OperationRow[] = [];
    let disposed = false;
    let busy = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/operations?t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (!response.ok) return;
        operations = ((await response.json()) as { operations?: OperationRow[] }).operations ?? [];
      } catch {
        return;
      }
      if (!disposed) install();
    };

    const duplicate = async (operation: OperationRow) => {
      if (busy) return;
      const current = String(operation.reference ?? "").trim();
      const nextReference = window.prompt(
        `Novo código do processo para o embarque parcial seguinte.\n\nO sistema copiará os dados-base de ${current}, mas zerará Booking, BL, contêineres, navio, tracking, EUDR reference e status de embarque.`,
        suggestedReference(current),
      )?.trim();
      if (!nextReference || nextReference === current) return;
      const confirmed = window.confirm(
        `Criar ${nextReference} como espelho de ${current}?\n\nSerão mantidos cliente, fornecedor, produto, origem/florestas, condições comerciais e portos. Documentos e dados específicos do embarque anterior não serão copiados.`,
      );
      if (!confirmed) return;
      busy = true;
      try {
        const response = await fetch("/api/operations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(clonePayload(operation, nextReference)),
        });
        const raw = await response.text();
        let payload: { operation?: OperationRow; error?: string } = {};
        try { payload = raw ? JSON.parse(raw) : {}; } catch { /* handled below */ }
        if (!response.ok || !payload.operation) throw new Error(payload.error || `Falha ao duplicar processo (HTTP ${response.status}).`);
        window.alert(`Processo ${nextReference} criado com sucesso. Revise quantidade, valor, datas e dados do novo embarque antes de avançar.`);
        window.location.reload();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Não foi possível duplicar o processo.");
      } finally {
        busy = false;
      }
    };

    const install = () => {
      document.querySelectorAll<HTMLTableRowElement>(".module-table tbody tr").forEach((row) => {
        const page = row.closest(".module-page");
        const heading = page?.querySelector("h2")?.textContent ?? "";
        if (!normalize(heading).includes("pedidos processos de exportacao")) return;
        const cells = row.querySelectorAll<HTMLTableCellElement>("td");
        if (cells.length < 2) return;
        const actionCell = cells[cells.length - 1];
        if (actionCell.querySelector(".duplicate-process-action")) return;
        const reference = cells[0].textContent?.trim() ?? "";
        const operation = operations.find((item) => normalize(String(item.reference ?? "")) === normalize(reference));
        if (!operation) return;
        actionCell.appendChild(makeButton(() => void duplicate(operation)));
      });
    };

    const observer = new MutationObserver(() => install());
    observer.observe(document.body, { childList: true, subtree: true });
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return null;
}
