const STATUS_ALIASES: Record<string, string> = {
  "Working with Warranty": "Working - Warranty",
  "Working no Warranty": "Working - No Warranty",
  "Not Working - Ship to Edison": "Broken - Send to Edison",
  "Inventory - Unallocated": "Unallocated",
};

export function normalizeAssetStatus(status: string) {
  const trimmed = status.trim();
  if (!trimmed) return "";
  return STATUS_ALIASES[trimmed] || trimmed;
}
