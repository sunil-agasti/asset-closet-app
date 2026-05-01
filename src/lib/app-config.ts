// Shared app-level switches that affect both server APIs and the client UI.
export const APP_CONFIG = {
  enableScvLocation: false,
} as const;

export function isScvLocationEnabled() {
  return APP_CONFIG.enableScvLocation;
}

export function getVisibleAssetLocations<T extends string>(locations: T[]) {
  if (isScvLocationEnabled()) return locations;
  return locations.filter((location) => location.trim().toUpperCase() !== "SCV");
}
