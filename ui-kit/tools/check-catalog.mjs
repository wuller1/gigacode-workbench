import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const failures = [];
const themeFiles = ["light", "dark", "high-contrast"].map((name) => `tokens/themes/${name}.tokens.json`);

for (const file of [
  "tokens/core.tokens.json",
  ...themeFiles,
  "registry/components.json",
  "registry/icons.json",
  "registry/assets.json",
  "registry/templates.json",
  "registry/design-guardrails.json",
  "recipes/desktop-recipes.json",
  "governance/ci-contract.json",
  "governance/repository-policy.example.json",
]) {
  try { await readJson(file); } catch (error) { failures.push(`${file}: ${error.message}`); }
}

const tokenLeaves = (value, prefix = [], leaves = new Map()) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return leaves;
  if (Object.hasOwn(value, "$value")) {
    leaves.set(prefix.join("."), value.$value);
    return leaves;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key.startsWith("$")) tokenLeaves(child, [...prefix, key], leaves);
  }
  return leaves;
};

const coreDocument = await readJson("tokens/core.tokens.json");
const coreTokens = tokenLeaves(coreDocument);
const semanticSets = [];
for (const file of themeFiles) {
  const document = await readJson(file);
  const tokens = tokenLeaves(document.semantic, ["semantic"]);
  semanticSets.push({ file, tokens });
  for (const [tokenPath, value] of tokens) {
    if (typeof value !== "string") continue;
    const alias = /^\{([^}]+)\}$/.exec(value);
    if (alias && !coreTokens.has(alias[1])) failures.push(`${file}: ${tokenPath} has unresolved alias ${value}`);
  }
}

const expectedSemanticPaths = [...semanticSets[0].tokens.keys()].sort();
for (const { file, tokens } of semanticSets.slice(1)) {
  const paths = [...tokens.keys()].sort();
  const missing = expectedSemanticPaths.filter((name) => !tokens.has(name));
  const extra = paths.filter((name) => !semanticSets[0].tokens.has(name));
  if (missing.length || extra.length) failures.push(`${file}: semantic path mismatch; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
}

const icons = await readJson("registry/icons.json");
const registeredIcons = new Set();
for (const icon of icons.icons) {
  if (registeredIcons.has(icon.source)) failures.push(`${icon.id}: duplicate source ${icon.source}`);
  registeredIcons.add(icon.source);
  try {
    const source = await readFile(path.join(root, icon.source));
    if (icon.origin !== "original") failures.push(`${icon.id}: non-original origin is not allowed in the starter`);
    if (icon.sha256 !== sha256(source)) failures.push(`${icon.id}: sha256 mismatch`);
    if (!source.toString("utf8").includes('viewBox="0 0 24 24"')) failures.push(`${icon.id}: unexpected viewBox`);
  } catch (error) { failures.push(`${icon.id}: ${error.message}`); }
}
for (const name of (await readdir(path.join(root, "icons"))).filter((name) => name.endsWith(".svg"))) {
  const source = `icons/${name}`;
  if (!registeredIcons.has(source)) failures.push(`${source}: unregistered icon asset`);
}

const assets = await readJson("registry/assets.json");
const registeredAssets = new Set();
for (const asset of assets.assets) {
  if (registeredAssets.has(asset.source)) failures.push(`${asset.id}: duplicate source ${asset.source}`);
  registeredAssets.add(asset.source);
  try {
    const source = await readFile(path.join(root, asset.source));
    if (asset.origin !== "original") failures.push(`${asset.id}: starter brand assets must be original`);
    if (!asset.licenseSpdx || !asset.authoringContext) failures.push(`${asset.id}: missing license or authoring context`);
    if (asset.sha256 !== sha256(source)) failures.push(`${asset.id}: sha256 mismatch`);
  } catch (error) { failures.push(`${asset.id}: ${error.message}`); }
}
for (const name of (await readdir(path.join(root, "brand"))).filter((name) => name.endsWith(".svg"))) {
  const source = `brand/${name}`;
  if (!registeredAssets.has(source)) failures.push(`${source}: unregistered brand asset`);
}

const components = await readJson("registry/components.json");
const componentIds = new Set();
for (const component of components.components) {
  if (componentIds.has(component.id)) failures.push(`${component.id}: duplicate component id`);
  componentIds.add(component.id);
  for (const source of component.sourceRefs ?? []) {
    try { await access(path.join(root, source)); } catch { failures.push(`${component.id}: missing ${source}`); }
  }
  if (component.implementationStatus === "reference-source" && component.exportName) {
    const source = (await Promise.all(component.sourceRefs.filter(name => name.endsWith(".tsx")).map(name => readFile(path.join(root, name), "utf8")))).join("\n");
    if (!new RegExp(`export (?:const|function) ${component.exportName}\\b`).test(source)) failures.push(`${component.id}: exported implementation ${component.exportName} not found`);
  }
  if (!component.states.includes("focus-visible") && component.kind === "interactive") failures.push(`${component.id}: missing focus-visible state`);
}

const recipes = await readJson("recipes/desktop-recipes.json");
const recipeIds = new Set();
for (const recipe of recipes.recipes) {
  if (recipeIds.has(recipe.id)) failures.push(`${recipe.id}: duplicate recipe`);
  recipeIds.add(recipe.id);
  if (!recipe.rules?.length || !recipe.requiredEvidence?.length) failures.push(`${recipe.id}: missing usage/evidence rules`);
  for (const id of recipe.componentIds) if (!componentIds.has(id)) failures.push(`${recipe.id}: unknown component ${id}`);
}
const guardrails = await readJson("registry/design-guardrails.json");
for (const file of [guardrails.qualityCollector, guardrails.visionContract, recipes.exampleRef, recipes.rulesRef]) {
  try { await access(path.join(root, file)); } catch { failures.push(`missing design protocol source ${file}`); }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    coreTokens: coreTokens.size,
    semanticTokensPerTheme: expectedSemanticPaths.length,
    themes: semanticSets.length,
    icons: icons.icons.length,
    brandAssets: assets.assets.length,
    components: components.components.length,
    recipes: recipes.recipes.length,
  }, null, 2));
}
