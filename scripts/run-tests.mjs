import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const testFiles = [
  "test/liquid.test.js",
  "test/logic.test.js",
  "test/partials.test.js",
  "test/filters.test.js",
  "test/compatibility.test.js",
  "test/properties.test.js",
  "test/performance.test.js",
];

for (const testFile of testFiles) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-wasm-jspi", "--test", testFile],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
