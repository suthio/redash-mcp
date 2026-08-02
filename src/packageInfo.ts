import { createRequire } from "node:module";
import { resolve } from "node:path";

const PACKAGE_NAME = "@suthio/redash-mcp";

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

export const PACKAGE_VERSION = readPackageVersion();

function readPackageVersion(): string {
  const entrypoint = resolve(process.argv[1] ?? "package.json");
  const entrypointRequire = createRequire(entrypoint);
  const cwdRequire = createRequire(resolve(process.cwd(), "package.json"));
  const candidates: Array<readonly [NodeRequire, string]> = [
    [entrypointRequire, `${PACKAGE_NAME}/package.json`],
    [entrypointRequire, "../package.json"],
    [cwdRequire, "./package.json"],
  ];

  for (const [load, id] of candidates) {
    try {
      const manifest = load(id) as PackageManifest;
      if (
        manifest.name === PACKAGE_NAME
        && typeof manifest.version === "string"
        && manifest.version.trim() !== ""
      ) {
        return manifest.version;
      }
    } catch {
      // Try the next location. Embedders and globally installed CLIs resolve
      // the package from different entrypoints.
    }
  }

  // Bundlers may omit package.json. Keep the server usable, but do not report
  // a release version that may have drifted from the package being executed.
  return "unknown";
}
