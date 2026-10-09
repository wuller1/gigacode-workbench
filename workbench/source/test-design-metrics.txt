#requires -Version 5.1
[CmdletBinding()]
param([string]$BundleRoot, [switch]$RequireNode)
$ErrorActionPreference = 'Stop'
# Resolve automatic script paths after parameter binding on Windows PowerShell 5.1.
if (-not $BundleRoot) { $BundleRoot = Split-Path -Parent $PSScriptRoot }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('gigacode-design-' + [Guid]::NewGuid().ToString('N'))
$oldVariable = [Environment]::GetEnvironmentVariable('GIGACODE_METRICS_TEST_SCRIPT', 'Process')
try {
    [void][IO.Directory]::CreateDirectory($temp)
    . (Join-Path $BundleRoot 'tools/design-metrics.ps1') -LibraryOnly
    $source = Get-DesignMetricsScript
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($source)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
    if ($digest -cne 'b16483eac5fea57e2993c62c95b8209d5f47d7f8d363af63ef09d8bf9e553898') { throw 'Browser payload changed from the tested reference' }
    $scriptPath = Join-Path $temp 'design-metrics.js'
    [IO.File]::WriteAllBytes($scriptPath, $bytes)
    $node = Get-Command node -ErrorAction SilentlyContinue
    $nodeCases = 0
    $nodeStatus = 'not_run_node_unavailable'
    if ($null -ne $node) {
        $suite = @'
"use strict";

// Run: node --test tests/test_design_metrics.cjs
// Pure-function/module checks; these tests do not validate browser DOM behavior.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const metricsPath = process.env.GIGACODE_METRICS_TEST_SCRIPT;
const { contrastRgb, textContrastThreshold, collect } = require(metricsPath);

test("black/white and equal-color contrast are exact and symmetric", () => {
  assert.equal(contrastRgb([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrastRgb([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(contrastRgb([53, 125, 200], [53, 125, 200]), 1);
});

test("known sRGB examples exercise channel weights and linearization", () => {
  assert.ok(Math.abs(contrastRgb([255, 0, 0], [255, 255, 255]) - 3.9984767707539985) < 1e-12);
  assert.ok(Math.abs(contrastRgb([119, 119, 119], [255, 255, 255]) - 4.478089453577214) < 1e-12);
  assert.ok(contrastRgb([10, 10, 10], [0, 0, 0]) < contrastRgb([11, 11, 11], [0, 0, 0]));
});

test("explicit RGB arrays reject coercion, invalid lengths and out-of-range channels", () => {
  const invalid = [
    null, "rgb(0,0,0)", {}, [], [0, 0], [0, 0, 0, 1], new Uint8Array([0, 0, 0]),
    ["0", 0, 0], [false, 0, 0], [null, 0, 0], [undefined, 0, 0],
    [NaN, 0, 0], [Infinity, 0, 0], [-0.1, 0, 0], [255.01, 0, 0], new Array(3)
  ];
  for (const value of invalid) {
    assert.throws(() => contrastRgb(value, [255, 255, 255]), { name: /TypeError|RangeError/ });
    assert.throws(() => contrastRgb([255, 255, 255], value), { name: /TypeError|RangeError/ });
  }
  assert.ok(contrastRgb([0.5, 1.25, 254.9], [255, 255, 255]) > 1);
});

test("large-text boundary uses unrounded 14pt converted to CSS pixels", () => {
  const boldBoundary = 14 * 96 / 72;
  assert.equal(textContrastThreshold(24, 400), 3);
  assert.equal(textContrastThreshold(23.999999, 400), 4.5);
  assert.equal(textContrastThreshold(boldBoundary, 700), 3);
  assert.equal(textContrastThreshold(18.666, 700), 4.5);
  assert.equal(textContrastThreshold(boldBoundary - 1e-10, 700), 4.5);
  assert.equal(textContrastThreshold(boldBoundary, 699), 4.5);
  assert.equal(textContrastThreshold(boldBoundary, 900), 3);
  assert.equal(textContrastThreshold(16, 1000), 4.5);
});

test("a 4.499 ratio fails the 4.5 threshold without rounding", () => {
  const intendedRatio = 4.499;
  const luminanceAgainstWhite = 1.05 / intendedRatio - 0.05;
  const channel = 255 * (1.055 * Math.pow(luminanceAgainstWhite, 1 / 2.4) - 0.055);
  const ratio = contrastRgb([channel, channel, channel], [255, 255, 255]);
  assert.ok(Math.abs(ratio - intendedRatio) < 1e-12);
  assert.ok(ratio < textContrastThreshold(16, 400));
  assert.equal(Number(ratio.toFixed(2)), 4.5); // Display rounding must not govern acceptance.
});

test("font classification rejects invalid numeric inputs", () => {
  for (const size of [0, -1, NaN, Infinity, "24", null]) {
    assert.throws(() => textContrastThreshold(size, 400), { name: /TypeError|RangeError/ });
  }
  for (const weight of [0, -1, 1001, NaN, Infinity, "bold", "700", null]) {
    assert.throws(() => textContrastThreshold(24, weight), { name: /TypeError|RangeError/ });
  }
});

test("collector rejects a missing or non-browser document", () => {
  for (const document of [undefined, null, {}, { nodeType: 9 }, { documentElement: {} }]) {
    assert.throws(() => collect(document), /live browser Document/);
  }
});

test("the same script exports the browser global without CommonJS", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(metricsPath, "utf8"), context, { filename: metricsPath });
  assert.equal(typeof context.DesignMetrics.collect, "function");
  assert.equal(context.DesignMetrics.contrastRgb([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(context.DesignMetrics.textContrastThreshold(16, 400), 4.5);
});
'@
        $testPath = Join-Path $temp 'test.cjs'
        [IO.File]::WriteAllText($testPath, $suite, (New-Object Text.UTF8Encoding($false)))
        $env:GIGACODE_METRICS_TEST_SCRIPT = $scriptPath
        & $node.Source --test $testPath
        if ($LASTEXITCODE -ne 0) { throw "Node checks failed: $LASTEXITCODE" }
        $nodeCases = 8
        $nodeStatus = 'passed'
    } elseif ($RequireNode) { throw 'Node is required for the requested JavaScript checks but is unavailable' }
    @{suite='design-metrics'; export_integrity='passed'; javascript_tests=$nodeCases; javascript_status=$nodeStatus; browser_dom='not_run'} | ConvertTo-Json
} catch { Write-Error $_; exit 1 }
finally {
    [Environment]::SetEnvironmentVariable('GIGACODE_METRICS_TEST_SCRIPT', $oldVariable, 'Process')
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
