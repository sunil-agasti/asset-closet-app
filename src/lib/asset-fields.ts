import { sanitizeDigits, sanitizeString } from "./sanitize";
import { normalizeAssetStatus } from "./asset-status";

const FIELD_ALIASES: Record<string, string> = {
  "Assigned To": "Current User",
  "Model Year": "Year",
};

export const NON_EDITABLE_ASSET_FIELDS = new Set(["Reason", "Date", "Action By", "Status", "Location"]);

export function normalizeAssetFieldName(field: string) {
  return FIELD_ALIASES[field] || field;
}

export function normalizeAssetFieldValue(field: string, value: unknown) {
  const normalizedField = normalizeAssetFieldName(field);
  const stringValue = typeof value === "string" ? value : value == null ? "" : String(value);

  if (normalizedField === "Asset ID") return stringValue.trim().toUpperCase();
  if (normalizedField === "Serial Number") return stringValue.trim().toUpperCase();
  if (normalizedField === "Current User") return sanitizeString(stringValue).toUpperCase();
  if (normalizedField === "Emp ID" || normalizedField.startsWith("Prev Emp ID")) return sanitizeDigits(stringValue);
  if (normalizedField === "Status") return normalizeAssetStatus(sanitizeString(stringValue));

  return sanitizeString(stringValue);
}

export function normalizeAssetPayload(input: Record<string, unknown>) {
  const normalized: Record<string, string> = {};

  for (const [field, value] of Object.entries(input)) {
    if (field === "Custom Asset") continue;
    const normalizedField = normalizeAssetFieldName(field);
    normalized[normalizedField] = normalizeAssetFieldValue(normalizedField, value);
  }

  return normalized;
}
