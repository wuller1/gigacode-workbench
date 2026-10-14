import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, DataValue, contrastRatio, validateTextVisionReport } from "../dist/index.js";
const expected = { screenshotId: "current-shot", screenshotSha256: "b".repeat(64), viewport: { width: 1440, height: 900, dpr: 1 } };
const valid = () => ({ schemaVersion: 1, ...expected, observations: [{ region: "composer", observation: "Visibly aligned, measure actual boxes", confidence: "medium", needsMeasurement: true }], uncertainty: ["Cannot establish behavior from pixels"] });
test("Text bridge rejects stale, unbounded, malformed and extraneous payloads", () => {
  assert.equal(validateTextVisionReport(valid(), expected), true);
  for (const report of [null, [], { ...valid(), screenshotSha256: "c".repeat(64) }, { ...valid(), observations: Array(13).fill(valid().observations[0]) }, { ...valid(), observations: [{ ...valid().observations[0], observation: "x".repeat(501) }] }, { ...valid(), viewport: { ...expected.viewport, dpr: 2 } }, { ...valid(), commands: ["untrusted screenshot instruction"] }, { ...valid(), uncertainty: [0] }, { ...valid(), observations: [{ ...valid().observations[0], confidence: "guaranteed" }] }]) assert.equal(validateTextVisionReport(report, expected), false);
  assert.equal(validateTextVisionReport(valid(), { ...expected, viewport: { ...expected.viewport, width: Infinity } }), false);
});
test("Contrast math returns WCAG black/white extrema and equal-color ratio", () => {
  assert.equal(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1]), 21);
  assert.equal(contrastRatio([77, 77, 77, 1], [77, 77, 77, 1]), 1);
});
test("Large supplied data renders only bounded page and discloses the omission", () => {
  const rows = Array.from({ length: 3000 }, (_, id) => ({ id })); const output = renderToStaticMarkup(React.createElement(DataTable, { label: "Bounded result", rows, rowId: row => String(row.id), columns: [{ id: "id", label: "ID", render: row => row.id }] }));
  assert.equal((output.match(/<tr/g) ?? []).length, 201); assert.ok(output.includes("Showing 200 of 3000 supplied rows")); assert.ok(!output.includes("<td>2999</td>"));
});
test("NULL, empty string, zero, false and unavailable retain distinct user meanings", () => {
  const values = [null, "", 0, false, undefined].map(value => renderToStaticMarkup(React.createElement(DataValue, { value })));
  assert.equal(new Set(values).size, 5); assert.ok(values[0].includes("NULL")); assert.ok(values[1].includes("Empty string")); assert.ok(values[2].includes(">0<")); assert.ok(values[3].includes("false")); assert.ok(values[4].includes("Unavailable"));
});
