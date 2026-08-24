export function normalizeTaxId(value: unknown) {
  return String(value ?? "").replace(/[^\dA-Za-z]/g, "").toUpperCase();
}

export function isValidBrazilianCnpj(value: unknown) {
  const digits = normalizeTaxId(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const digit = (length: number) => {
    let factor = length - 7;
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * factor--;
      if (factor < 2) factor = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(12) === Number(digits[12]) && digit(13) === Number(digits[13]);
}

export function isBrazil(country: unknown) {
  return /^brasil$/i.test(String(country ?? "").trim());
}
