import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "styles.module.css"),
  "utf8",
);

it("shows a crosshair cursor while cropping", () => {
  const cropMode = css.match(/&\[data-mode="crop"\]\s*\{(?<rules>[^}]*)\}/)
    ?.groups?.rules;
  expect(cropMode).toContain("cursor: crosshair");
});
