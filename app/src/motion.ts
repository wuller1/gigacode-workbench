/** Activity must stay visible on remote Windows desktops that disable CSS animation.
 * One timer for all mounted indicators; it stops completely when no work is visible.
 * The app's own explicit reduced-motion setting is still respected.
 */
export function installWorkingMotion(document: Document): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let indicators: HTMLElement[] = [];
  const update = () => {
    const reduced = document.documentElement.dataset.motion === "reduced";
    indicators = Array.from(
      document.querySelectorAll<HTMLElement>(".working-arc"),
    );
    for (const element of indicators) element.dataset.frameClock = "true";
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!reduced && indicators.length) {
      const tick = () => {
        const angle = ((Date.now() % 900) / 900) * 360;
        for (const element of indicators)
          element.style.setProperty("--workbench-angle", angle + "deg");
      };
      tick();
      timer = setInterval(tick, 50);
    }
  };
  const observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (m) => m.type === "childList" || m.attributeName === "data-motion",
      )
    )
      update();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  update();
  return () => {
    observer.disconnect();
    if (timer) clearInterval(timer);
    for (const element of indicators) {
      delete element.dataset.frameClock;
      element.style.removeProperty("--workbench-angle");
    }
  };
}
