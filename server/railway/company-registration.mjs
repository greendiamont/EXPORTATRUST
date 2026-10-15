// Identificador de entrada da empresa. Não é segredo nem prova de propriedade.
export function normalizeCnpj(value) {
  return String(value ?? "").trim().replace(/[.\/\-\s]/g, "");
}

export function validCnpj(value) {
  const digits = normalizeCnpj(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  for (const length of [12, 13]) {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(digits[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    if (Number(digits[length]) !== (remainder < 2 ? 0 : 11 - remainder)) return false;
  }
  return true;
}
