"use client";

import { useEffect } from "react";
import { buildClientDossierFields, buildSupplierDossierFields, openDossierPrint } from "../lib/master-data-dossier";

type ClientRow = Record<string, unknown> & { legalName?: string };
type SupplierRow = Record<string, unknown> & { legalName?: string };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function makeAction(label: string, onClick: () => void) {
  const element = document.createElement("span");
  element.textContent = label;
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.className = "dossier-inline-action";
  const activate = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };
  element.addEventListener("click", activate, true);
  element.addEventListener("keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === "Enter" || keyboard.key === " ") activate(event);
  }, true);
  return element;
}

export default function DossierActionsBridge() {
  useEffect(() => {
    let clients: ClientRow[] = [];
    let suppliers: SupplierRow[] = [];
    let disposed = false;

    const loadData = async () => {
      try {
        const [clientResponse, supplierResponse] = await Promise.all([
          fetch(`/api/importer-clients?t=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/suppliers?t=${Date.now()}`, { cache: "no-store" }),
        ]);
        if (clientResponse.ok) clients = ((await clientResponse.json()) as { clients?: ClientRow[] }).clients ?? [];
        if (supplierResponse.ok) suppliers = ((await supplierResponse.json()) as { suppliers?: SupplierRow[] }).suppliers ?? [];
      } catch {
        // O cadastro continua funcional mesmo se o atalho do dossiê não conseguir atualizar a base.
      }
      if (!disposed) installActions();
    };

    const installClientActions = () => {
      document.querySelectorAll<HTMLElement>(".master-data-page").forEach((page) => {
        const heading = page.querySelector("h2")?.textContent ?? "";
        if (!normalize(heading).includes("clientes importadores")) return;
        page.querySelectorAll<HTMLElement>(".master-list > button").forEach((entry) => {
          if (entry.querySelector(".dossier-inline-action")) return;
          const name = entry.querySelector("b")?.textContent?.trim() ?? "";
          const client = clients.find((item) => normalize(String(item.legalName ?? "")) === normalize(name));
          if (!client) return;
          entry.appendChild(makeAction("Dossiê ↗", () => openDossierPrint(`Dossiê do Cliente · ${name}`, buildClientDossierFields(client))));
        });
      });
    };

    const installSupplierActions = () => {
      document.querySelectorAll<HTMLTableRowElement>(".module-table tbody tr").forEach((row) => {
        const page = row.closest(".module-page");
        const heading = page?.querySelector("h2")?.textContent ?? "";
        if (!normalize(heading).includes("fornecedores")) return;
        const cells = row.querySelectorAll<HTMLTableCellElement>("td");
        if (cells.length < 2) return;
        const actionCell = cells[cells.length - 1];
        if (actionCell.querySelector(".dossier-inline-action")) return;
        const name = cells[0].textContent?.trim() ?? "";
        const supplier = suppliers.find((item) => normalize(String(item.legalName ?? "")) === normalize(name));
        if (!supplier) return;
        actionCell.appendChild(makeAction("Dossiê ↗", () => openDossierPrint(`Dossiê do Fornecedor · ${name}`, buildSupplierDossierFields(supplier))));
      });
    };

    const installActions = () => {
      installClientActions();
      installSupplierActions();
    };

    const observer = new MutationObserver(() => installActions());
    observer.observe(document.body, { childList: true, subtree: true });
    void loadData();

    const refreshOnFocus = () => { void loadData(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  return null;
}
