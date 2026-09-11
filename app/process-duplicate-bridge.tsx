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

function suggestedReference(reference: string) {
  const match = reference.match(/^(.*?)(?:[-\s]?P(?:ART)?\s*)(\d+)$/i);
  if (match) return `${match[1].replace(/[-\s]+$/, "")}-P${Number(match[2]) + 1}`;
  return `${reference}-P2`;
}

function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null, value: unknown) {
  if (!element) return;
  const text = value === null || value === undefined ? "" : String(value);
  const prototype = element instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setChecked(element: HTMLInputElement, checked: boolean) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
  setter?.call(element, checked);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function fieldByLabel(root: HTMLElement, labelText: string) {
  const target = normalize(labelText);
  const labels = Array.from(root.querySelectorAll<HTMLLabelElement>("label"));
  const label = labels.find((item) => normalize(item.textContent ?? "").startsWith(target));
  return label?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea") ?? null;
}

function copyProperties(root: HTMLElement, propertyIds: unknown) {
  let ids: string[] = [];
  try {
    const parsed = typeof propertyIds === "string" ? JSON.parse(propertyIds) : propertyIds;
    if (Array.isArray(parsed)) ids = parsed.map(String);
  } catch {
    ids = [];
  }
  root.querySelectorAll<HTMLInputElement>(".property-options input[type='checkbox']").forEach((checkbox) => {
    const label = checkbox.closest("label");
    const text = label?.textContent ?? "";
    setChecked(checkbox, ids.some((id) => text.includes(id)));
  });
}

function fillNewProcessForm(root: HTMLElement, operation: OperationRow) {
  setValue(root.querySelector<HTMLInputElement>("[data-operation-field='reference']"), suggestedReference(String(operation.reference ?? "")));
  setValue(root.querySelector<HTMLInputElement>("[data-operation-field='product']"), operation.product);
  setValue(root.querySelector<HTMLInputElement>("[data-operation-field='hsCode']"), operation.hsCode);
  setValue(fieldByLabel(root, "Contrato / PO"), operation.contractNumber);
  setValue(fieldByLabel(root, "Responsável interno"), operation.internalResponsible);
  setValue(fieldByLabel(root, "E-mail do responsável"), operation.responsibleEmail);

  setValue(root.querySelector<HTMLSelectElement>("[data-operation-field='supplierId']"), operation.supplierId);
  setValue(fieldByLabel(root, "Exportador / trading"), operation.exporterName);
  setValue(fieldByLabel(root, "CNPJ do exportador"), operation.exporterTaxId);
  setValue(root.querySelector<HTMLInputElement>("[data-operation-field='euImporter']"), operation.euImporter);
  setValue(fieldByLabel(root, "Cliente cadastrado"), operation.importerClientId);
  setValue(fieldByLabel(root, "EORI do operador"), operation.euOperatorEori);
  setValue(fieldByLabel(root, "Referência DDS/EUDR"), "");

  setValue(fieldByLabel(root, "Matéria-prima"), operation.rawMaterial);
  setValue(fieldByLabel(root, "Espécie(s)"), operation.species);
  setValue(fieldByLabel(root, "Tipo de origem"), operation.forestOriginType);
  setValue(fieldByLabel(root, "Unidade produtiva"), operation.productionUnit);
  setValue(fieldByLabel(root, "Códigos dos lotes"), operation.lotCodes);
  copyProperties(root, operation.propertyIds);

  setValue(fieldByLabel(root, "Quantidade"), operation.quantity);
  setValue(fieldByLabel(root, "Unidade"), operation.quantityUnit);
  setValue(fieldByLabel(root, "Peso líquido (kg)"), operation.netWeightKg);
  setValue(fieldByLabel(root, "Peso bruto (kg)"), operation.grossWeightKg);
  setValue(fieldByLabel(root, "Volume (m³)"), operation.volumeM3);
  setValue(fieldByLabel(root, "Incoterm"), operation.incoterm);
  setValue(fieldByLabel(root, "Moeda"), operation.currency);
  setValue(fieldByLabel(root, "Valor comercial"), operation.commercialValue);

  setValue(fieldByLabel(root, "Modal"), operation.transportMode);
  setValue(fieldByLabel(root, "Data prevista de embarque"), "");
  setValue(fieldByLabel(root, "Porto/local de embarque"), operation.portOfLoading);
  setValue(fieldByLabel(root, "Porto/local de destino"), operation.portOfDischarge);
  setValue(root.querySelector<HTMLInputElement>("[data-operation-field='destinationCountry']"), operation.destinationCountry);
  setValue(fieldByLabel(root, "Armador / transportadora"), "");
  setValue(fieldByLabel(root, "Booking"), "");
  setValue(fieldByLabel(root, "BL / Bill of Lading"), "");
  setValue(fieldByLabel(root, "Contêiner(es)"), "");
  setValue(fieldByLabel(root, "Navio / viagem"), "");
  setValue(fieldByLabel(root, "Fluxo, particularidades e participantes ainda não cadastrados"), operation.supplyChainNotes);
}

export default function ProcessDuplicateBridge() {
  useEffect(() => {
    let operations: OperationRow[] = [];
    let disposed = false;

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

    const install = () => {
      // This feature belongs inside "Novo processo +". It is intentionally not rendered in the processes table.
      const referenceInput = document.querySelector<HTMLInputElement>("[data-operation-field='reference']");
      if (!referenceInput) return;
      const firstSection = referenceInput.closest("fieldset");
      const formRoot = firstSection?.parentElement as HTMLElement | null;
      if (!firstSection || !formRoot) return;

      // Existing-process edit forms must not show the copier. New-process forms start without a reference.
      if (referenceInput.value.trim() && !formRoot.querySelector(".process-copy-panel")) return;
      if (formRoot.querySelector(".process-copy-panel")) return;

      const panel = document.createElement("section");
      panel.className = "process-copy-panel operation-form-section";
      panel.style.marginBottom = "16px";
      panel.style.padding = "14px";
      panel.style.border = "1px solid var(--border, #d9dee7)";
      panel.style.borderRadius = "10px";
      panel.innerHTML = `
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          <label style="flex:1;min-width:280px"><strong>Copiar processo existente</strong><br><small>Ideal para embarque parcial ou próximo lote do mesmo pedido.</small><select class="process-copy-select" style="width:100%;margin-top:8px"><option value="">Selecione o processo original</option></select></label>
          <button type="button" class="process-copy-action">Copiar dados para este novo processo ⧉</button>
        </div>
        <small class="process-copy-note" style="display:block;margin-top:8px">Copia cliente, fornecedor, produto, origem, condições comerciais e portos. Booking, BL, contêineres, navio, data de embarque e referência EUDR ficam em branco.</small>
      `;
      const select = panel.querySelector<HTMLSelectElement>(".process-copy-select")!;
      [...operations]
        .sort((a, b) => String(b.reference ?? "").localeCompare(String(a.reference ?? ""), "pt-BR", { numeric: true }))
        .forEach((operation) => {
          const option = document.createElement("option");
          option.value = String(operation.id ?? "");
          option.textContent = `${String(operation.reference ?? "Sem referência")} · ${String(operation.euImporter ?? "Cliente não informado")} · ${String(operation.supplierName ?? "Fornecedor não informado")}`;
          select.appendChild(option);
        });
      panel.querySelector<HTMLButtonElement>(".process-copy-action")?.addEventListener("click", () => {
        const operation = operations.find((item) => String(item.id ?? "") === select.value);
        if (!operation) {
          window.alert("Selecione o processo que deseja copiar.");
          return;
        }
        const originalReference = String(operation.reference ?? "");
        if (!window.confirm(`Copiar os dados-base de ${originalReference} para o formulário do novo processo?\n\nVocê poderá revisar quantidade, volume, valor, datas e demais campos antes de salvar.`)) return;
        fillNewProcessForm(formRoot, operation);
        panel.querySelector<HTMLElement>(".process-copy-note")!.textContent = `Dados de ${originalReference} copiados. Revise o novo embarque antes de salvar.`;
        referenceInput.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      formRoot.insertBefore(panel, firstSection);
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
