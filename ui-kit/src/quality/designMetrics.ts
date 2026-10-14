export interface DesignIssue { code: "horizontal-overflow" | "missing-name" | "small-target" | "low-contrast" | "covered-action"; selector: string; message: string; value?: number; minimum?: number }
export interface DesignMetrics { schemaVersion: 1; viewport: { width: number; height: number; dpr: number }; theme: string; measuredAt: string; scanned: { controls: number; contrast: number }; issues: DesignIssue[]; truncated: boolean; limitations: readonly string[] }
type RGBA = [number, number, number, number];
function rgba(value: string): RGBA | undefined {
  const match = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : undefined;
}
function over(front: RGBA, back: RGBA): RGBA { const alpha = front[3] + back[3] * (1 - front[3]); if (!alpha) return [0, 0, 0, 0]; return [0, 1, 2].map(i => (front[i]! * front[3] + back[i]! * back[3] * (1 - front[3])) / alpha).concat(alpha) as RGBA; }
function luminance(color: RGBA) { return color.slice(0, 3).map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i]!, 0); }
export function contrastRatio(first: RGBA, second: RGBA) { const a = luminance(first); const b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }
function location(element: Element) { if (element.id) return `#${CSS.escape(element.id)}`; const key = element.getAttribute("data-gc-key"); if (key) return `[data-gc-key=${JSON.stringify(key)}]`; return `${element.tagName.toLowerCase()}${element.classList.length ? `.${Array.from(element.classList).slice(0, 2).map(value => CSS.escape(value)).join(".")}` : ""}`; }
function shown(element: HTMLElement) { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.left < innerWidth && rect.top < innerHeight && style.visibility !== "hidden" && style.display !== "none" && !element.closest("[hidden], [inert], [aria-hidden=true]"); }
function accessibleName(element: HTMLElement) {
  const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  if (labelledBy || element.getAttribute("aria-label")?.trim()) return true;
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return Boolean(element.labels?.length || (element instanceof HTMLInputElement && ["submit", "button"].includes(element.type) && element.value.trim()));
  return Boolean(element.textContent?.trim() || element.getAttribute("title")?.trim());
}
/** Deterministic DOM evidence, deliberately not a substitute for screenshots or a full accessibility audit. */
export function collectDesignMetrics(root: HTMLElement = document.body, maxElements = 1000): DesignMetrics {
  const issues: DesignIssue[] = []; let contrast = 0; let controls = 0; let truncated = false;
  const cap = Number.isFinite(maxElements) ? Math.min(5000, Math.max(1, Math.floor(maxElements))) : 1000; const modal = document.querySelector("dialog:modal");
  const elements = Array.from(root.querySelectorAll<HTMLElement>("button, input, textarea, select, [role=tab], [role=treeitem], [role=separator], [data-gc-contrast], label, p, small, strong, td, th"));
  const canvasOverflow = document.documentElement.scrollWidth - innerWidth; if (canvasOverflow > 1) issues.push({ code: "horizontal-overflow", selector: "html", message: "Whole-window horizontal scroll", value: canvasOverflow, minimum: 0 });
  if (elements.length > cap) truncated = true;
  for (const element of elements.slice(0, cap)) {
    if (!shown(element) || (modal && !modal.contains(element))) continue;
    const style = getComputedStyle(element); const selector = location(element); const rect = element.getBoundingClientRect();
    const interactive = element.matches("button, input:not([type=hidden]), textarea, select, [role=tab], [role=treeitem], [role=separator]");
    const disabled = element.matches(":disabled, [aria-disabled=true]");
    if (interactive) {
      controls++; if (!accessibleName(element)) issues.push({ code: "missing-name", selector, message: "Control has no discoverable accessible name" });
      let targetRect = rect;
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) { const label = element.labels?.[0]; if (label) { const labelRect = label.getBoundingClientRect(); targetRect = { ...rect.toJSON(), width: Math.max(rect.right, labelRect.right) - Math.min(rect.left, labelRect.left), height: Math.max(rect.bottom, labelRect.bottom) - Math.min(rect.top, labelRect.top) } as DOMRect; } }
      if (!disabled && element.getAttribute("role") !== "separator" && (targetRect.width < 24 || targetRect.height < 24)) issues.push({ code: "small-target", selector, message: "Review desktop target; WCAG spacing/inline exception requires a separate check", value: Math.round(Math.min(targetRect.width, targetRect.height)), minimum: 24 });
      const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2; const hit = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
      if (!disabled && hit && !element.contains(hit) && !hit.contains(element) && getComputedStyle(element).pointerEvents !== "none") issues.push({ code: "covered-action", selector, message: "Center hit-test is covered or clipped; verify intended overlay/scroll region" });
    }
    if (disabled || !element.textContent?.trim() && !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) continue;
    if (element.matches("td, th") && element.querySelector("button, input")) continue;
    const fg = rgba(style.color); if (!fg) continue;
    const chain: HTMLElement[] = []; for (let current: HTMLElement | null = element; current; current = current.parentElement) chain.unshift(current);
    let bg: RGBA = [255, 255, 255, 1]; let opacity = 1; let complex = false;
    for (const parent of chain) { const computed = getComputedStyle(parent); if (computed.backgroundImage !== "none") complex = true; const color = rgba(computed.backgroundColor); if (color) bg = over(color, bg); opacity *= Number(computed.opacity); }
    if (complex) continue; // Gradients/images require pixel inspection; never invent a contrast pass.
    fg[3] *= opacity; const ratio = contrastRatio(over(fg, bg), bg); const size = parseFloat(style.fontSize); const bold = Number(style.fontWeight) >= 700; const minimum = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    contrast++; if (ratio + .005 < minimum) issues.push({ code: "low-contrast", selector, message: "Computed solid-color text contrast is below WCAG AA", value: Math.round(ratio * 100) / 100, minimum });
  }
  return { schemaVersion: 1, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, theme: document.documentElement.dataset.uiTheme ?? "unspecified", measuredAt: new Date().toISOString(), scanned: { controls, contrast }, issues: issues.slice(0, 200), truncated: truncated || issues.length > 200, limitations: ["Only current visible DOM; no screen-reader or native-window audit", "Complex/gradient backgrounds excluded from contrast; alpha/opacity approximation requires pixel review", "Small-target and covered-action results require spacing/scroll/overlay review", "A pass does not establish visual quality or visual bridge correctness"] };
}
