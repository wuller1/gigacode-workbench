import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recipes = JSON.parse(await readFile(path.join(root, "recipes/desktop-recipes.json"), "utf8"));
const components = JSON.parse(await readFile(path.join(root, "registry/components.json"), "utf8"));
const id = process.argv[2];
if (!id || id === "--list") console.log(JSON.stringify(recipes.recipes.map(recipe => ({ id: recipe.id, componentCount: recipe.componentIds.length })), null, 2));
else {
  const recipe = recipes.recipes.find(recipe => recipe.id === id);
  if (!recipe) { console.error("Unknown recipe. Run --list; no arbitrary path is accepted."); process.exitCode = 1; }
  else console.log(JSON.stringify({ ...recipe, components: recipe.componentIds.map(id => { const component = components.components.find(item => item.id === id); return { id, exportName: component.exportName, sourceRefs: component.sourceRefs, notes: component.notes }; }), guide: "../../docs/suite/FLASH-DESIGN-GUIDE.md" }, null, 2));
}
