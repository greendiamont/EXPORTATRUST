/** One explicit recipient; reject header injection, lists and display-name ambiguity. */
export function invoiceRecipient(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 160 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) throw new Error("Informe um e-mail de destinatário válido (um endereço).");
  return email;
}
