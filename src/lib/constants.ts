export const STATUS_COLORS: Record<string, string> = {
  "Working - Warranty": "#34c759",
  "Working with Warranty": "#34c759",
  "Working - No Warranty": "#30d158",
  "Working no Warranty": "#30d158",
  "Not Working - Repair": "#ff3b30",
  "Broken - Send to Edison": "#ff2d55",
  "Not Working - Ship to Edison": "#ff2d55",
  "Sent to Edison": "#8e8e93",
  "Loaner": "#007aff",
  "Inventory - Unallocated": "#ff9500",
  "Unallocated": "#ff9500",
  "Special Case": "#5856d6",
  "In Use": "#34c759",
  "In Use - 2024": "#34c759",
  "In Use - 2025": "#34c759",
  "Returned": "#8e8e93",
  "Handeded Over": "#8e8e93",
};

export const STATUS_OPTIONS = [
  "Working - Warranty",
  "Working - No Warranty",
  "Not Working - Repair",
  "Broken - Send to Edison",
  "Loaner",
  "Inventory - Unallocated",
  "Special Case",
];

export const ASSET_TYPES = ["Laptop", "Monitor", "Keyboard", "Mouse", "iPad", "Phone", "Other"];

export const LOW_INVENTORY_THRESHOLD = 10;
export const LOW_INVENTORY_ALERT_INTERVAL_DAYS = 7;
export const LOW_INVENTORY_RECIPIENTS = ["bagasti@apple.com"];
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export const ASSET_ID_PATTERN = /02HW[0O]\d{5,6}/i;
export const SERIAL_PATTERN = /\b[0-9A-Z]{5,15}\b/;

export const OCR_CHAR_MAP: Record<string, string> = {
  O: "0", Q: "0", I: "1", L: "1", Z: "2",
  S: "5", G: "6", T: "7", B: "8",
};

export const ROLES = { ADMIN: "admin", EDITOR: "editor", VIEWER: "viewer" } as const;
export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export interface User {
  Emp_ID: string;
  Name: string;
  Role: UserRole;
  PIN: string;
  Last_PIN_Set: string;
  Security_Question: string;
  Security_Answer: string;
}

export interface Asset {
  "Asset ID": string;
  "Serial Number": string;
  "Asset Type": string;
  Chip: string;
  Year: string;
  "Current User": string;
  "Emp ID": string;
  Email: string;
  Location: string;
  Status: string;
  Reason: string;
  Date: string;
  "Action By": string;
  Configuration: string;
  [key: string]: string;
}

export interface LoginAuditEntry {
  "Emp ID": string;
  Name: string;
  "Login Time": string;
  "Logout Time": string;
  "Total Seconds": string;
  "Total Minutes": string;
  "Logout Method": string;
  "Login Failure": string;
  "Logged In Device": string;
}
