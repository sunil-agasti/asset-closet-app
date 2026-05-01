export function sanitizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[<>]/g, "").trim();
}

export function sanitizeDigits(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "").trim();
}
