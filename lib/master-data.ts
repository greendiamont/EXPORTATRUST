export function normalizeMasterName(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\b(ltda|limitada|eireli|s a|sa|inc|llc|gmbh|cia|e|and|the|of)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function similarity(a: string, b: string) {
  const left = new Set(normalizeMasterName(a).split(" ").filter(Boolean));
  const right = new Set(normalizeMasterName(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((token) => right.has(token)).length;
  return common / Math.max(left.size, right.size);
}
