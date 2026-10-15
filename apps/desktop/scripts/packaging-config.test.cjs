const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const desktopRoot = join(__dirname, "..");

test("lets each native macOS packaging command select exactly one architecture", () => {
  const config = readFileSync(
    join(desktopRoot, "electron-builder.yml"),
    "utf8",
  );
  const mac = config.match(/^mac:\r?\n([\s\S]*?)(?=^dmg:)/m)?.[1];
  assert.ok(mac, "macOS electron-builder configuration is missing");
  assert.match(mac, /^ {2}target:\r?$/m);
  assert.match(mac, /^ {4}- target: dmg\r?$/m);
  assert.match(mac, /^ {4}- target: zip\r?$/m);
  assert.doesNotMatch(
    mac,
    /^\s+arch:\r?$/m,
    "target-level architectures override electron-builder --arm64/--x64",
  );

  const packageJson = JSON.parse(
    readFileSync(join(desktopRoot, "package.json"), "utf8"),
  );
  assert.match(packageJson.scripts["dist:mac:arm64"], /--mac --arm64/);
  assert.match(packageJson.scripts["dist:mac:x64"], /--mac --x64/);
});
