"use client";

import { useEffect } from "react";

function isTaskBoard(element: Element | null) {
  return Boolean(element?.closest(".operation-task-board"));
}

function hideManualSaveButtons(root: ParentNode = document) {
  root.querySelectorAll<HTMLButtonElement>(".operation-task-board button").forEach((button) => {
    const label = button.textContent?.trim().toLowerCase();
    if (label === "salvar" || label === "gravar") {
      button.style.display = "none";
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    }
  });
}

export default function TaskAutoSaveBridge() {
  useEffect(() => {
    hideManualSaveButtons();

    const observer = new MutationObserver(() => hideManualSaveButtons());
    observer.observe(document.body, { childList: true, subtree: true });

    const handleChange = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.type !== "date" || input.getAttribute("aria-label") !== "Data da tarefa") return;
      if (!isTaskBoard(input)) return;

      // Aguarda o React aplicar a nova data ao estado local antes de acionar a persistência existente.
      window.setTimeout(() => {
        const row = input.closest(".operation-task-row");
        if (!row) return;
        const saveButton = Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
          const label = button.textContent?.trim().toLowerCase();
          return label === "salvar" || label === "gravar";
        });
        if (saveButton && !saveButton.disabled) saveButton.click();
      }, 0);
    };

    document.addEventListener("change", handleChange, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", handleChange, true);
    };
  }, []);

  return null;
}
