import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const template = fs.readFileSync(new URL("../app/template.tsx", import.meta.url), "utf8");

test("task board is visually ordered after the other Supply Chain overview blocks", () => {
  assert.match(template, /\.operation-overview\s*>\s*\.operation-task-board\s*\{\s*order:\s*999;/);
});
