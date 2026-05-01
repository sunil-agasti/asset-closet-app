import fs from "fs";
import path from "path";

const APP_PACKAGE_NAME = "asset-closet-next";

export function resolveAppRoot() {
  const starts = [process.cwd(), __dirname];
  const checked = new Set<string>();

  for (const start of starts) {
    let current = path.resolve(start);

    while (!checked.has(current)) {
      checked.add(current);
      if (isAppRoot(current)) return current;

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return process.cwd();
}

export function resolveAppPath(...parts: string[]) {
  return path.join(resolveAppRoot(), ...parts);
}

function isAppRoot(dir: string) {
  const packageJsonPath = path.join(dir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return false;

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { name?: string };
    return pkg.name === APP_PACKAGE_NAME;
  } catch {
    return false;
  }
}
