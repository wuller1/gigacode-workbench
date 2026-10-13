/* Prototype-owned motion. No changes to Windows/RDP settings or external pages. */
(() => {
  'use strict';
  if (window.SuiteMotion) return;
  const root = document.documentElement;
  const key = 'suite.prototype.motion.v1';
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const modes = ['always', 'system', 'reduced'];
  let mode = 'always';
  try { const saved = localStorage.getItem(key); if (modes.includes(saved)) mode = saved; } catch {}
  let saveFailed = false;
  let timer = 0, dirty = true, lastScan = -Infinity, frame = 0, cssDisabled = false;
  const targets = new Map(), tweens = new Map();
  const selector = '.spinner,.sp-pulse,.pulse,.life-step.current .life-dot,.plan-item.current .plan-state,.bd-progress i';
  const reduced = () => mode === 'reduced' || (mode === 'system' && media.matches);
  const compat = () => mode === 'always';
  const visible = node => {
    if (!node.isConnected || node.closest('[hidden]')) return false;
    const modal = document.querySelector('dialog[open]');
    if (modal && !modal.contains(node)) return false;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    if (getComputedStyle(node).visibility !== 'visible') return false;
    for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip)/.test(s.overflow + s.overflowX + s.overflowY)) {
        const box = p.getBoundingClientRect();
        if (r.bottom <= box.top || r.top >= box.bottom || r.right <= box.left || r.left >= box.right) return false;
      }
    }
    return true;
  };
  function release(node, saved) {
    if (saved.value) node.style.setProperty(saved.property, saved.value, saved.priority);
    else node.style.removeProperty(saved.property);
    delete node.dataset.motionKind;
  }
  function clearTargets() { targets.forEach((s, n) => release(n, s)); targets.clear(); }
  function scan() {
    dirty = false; lastScan = performance.now();
    const next = new Set();
    if (compat()) for (const node of document.querySelectorAll(selector)) {
      if (visible(node)) next.add(node);
      if (next.size === 64) break;
    }
    targets.forEach((saved, node) => { if (!next.has(node)) { release(node, saved); targets.delete(node); } });
    next.forEach(node => {
      if (targets.has(node)) return;
      const kind = node.matches('.spinner,.sp-pulse') ? 'spin' : node.matches('.bd-progress i') ? 'progress' : node.matches('.pulse') ? 'pulse' : 'dot';
      const property = kind === 'dot' ? '--suite-motion-opacity' : kind === 'pulse' ? 'opacity' : 'transform';
      targets.set(node, {kind, property, value:node.style.getPropertyValue(property), priority:node.style.getPropertyPriority(property)});
      node.dataset.motionKind = kind;
    });
  }
  function finishTween(node, tween) {
    node.style.left = tween.x + 'px'; node.style.top = tween.y + 'px';
    if (tween.transition) node.style.setProperty('transition', tween.transition, tween.priority);
    else node.style.removeProperty('transition');
    tweens.delete(node);
  }
  function tick() {
    timer = 0;
    if (document.hidden) return;
    const now = performance.now();
    if (dirty && (now - lastScan >= 250 || targets.size === 0)) scan();
    if (compat()) targets.forEach((saved, node) => {
      // Class/state changes stop the decoration on this frame, before the next scan.
      if (!node.isConnected || !node.matches(selector) || node.closest('[hidden]')) {
        release(node, saved); targets.delete(node); return;
      }
      const phase = (now % 1600) / 1600;
      const level = .55 + .45 * (1 - Math.cos(phase * 2 * Math.PI)) / 2;
      const value = saved.kind === 'spin' ? `rotate(${((now % 1200) / 1200 * 360).toFixed(1)}deg)` : saved.kind === 'progress' ? `scaleX(${(.65 + .2 * Math.sin(phase * Math.PI)).toFixed(3)})` : level.toFixed(3);
      node.style.setProperty(saved.property, value, 'important');
    });
    tweens.forEach((tween, node) => {
      if (!node.isConnected || node.hidden) { finishTween(node, tween); return; }
      const fraction = reduced() ? 1 : Math.min(1, (now - tween.start) / tween.duration);
      const ease = 1 - Math.pow(1 - fraction, 3);
      node.style.left = (tween.fromX + (tween.x - tween.fromX) * ease) + 'px';
      node.style.top = (tween.fromY + (tween.y - tween.fromY) * ease) + 'px';
      if (fraction === 1) finishTween(node, tween);
    });
    frame++;
    if (frame % 6 === 0) document.querySelectorAll('[data-motion-frame]').forEach(node => {
      if (!node.closest('details[open]') || !visible(node)) return;
      const text = compat() ? `Резервная отрисовка · кадр ${frame}` : reduced() ? 'Движение выключено' : 'CSS-анимации';
      if (node.firstChild) node.firstChild.nodeValue = text;
    });
    if (targets.size || tweens.size || dirty) wake();
  }
  function wake() { if (!timer && !document.hidden) timer = setTimeout(tick, 1000 / 12); }
  function refresh() { dirty = true; wake(); }
  function syncSettings(scope = document) {
    scope.querySelectorAll('[data-motion-mode]').forEach(node => node.value = mode);
    scope.querySelectorAll('[data-motion-system]').forEach(node => node.textContent = `Система: ${media.matches ? 'движение уменьшено' : 'анимации разрешены'}. ${mode === 'always' ? 'Для приложения включено независимо от системы.' : reduced() ? 'Индикаторы неподвижны; статусы остаются видимыми.' : 'Приложение следует системной настройке.'}`);
    scope.querySelectorAll('[data-motion-frame]').forEach(node => node.textContent = compat() ? 'Резервная отрисовка · 12 кадров/с' : reduced() ? 'Движение выключено' : 'CSS-анимации');
    scope.querySelectorAll('[data-motion-save]').forEach(node => node.textContent = saveFailed ? 'Не удалось сохранить настройку. Она действует до закрытия страницы.' : 'Сохраняется автоматически');
  }
  function apply() {
    clearTargets();
    root.dataset.motion = mode;
    root.dataset.motionEffective = reduced() ? 'reduced' : 'full';
    root.dataset.motionRenderer = compat() ? 'compat' : 'css';
    syncSettings();
    if (reduced()) tweens.forEach((t, n) => finishTween(n, t));
    refresh();
  }
  function setMode(value) {
    if (!modes.includes(value)) return;
    mode = value;
    try { localStorage.setItem(key, value); saveFailed = false; } catch { saveFailed = true; }
    apply();
  }
  function moveTo(node, x, y, duration = 400) {
    if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (tweens.has(node)) { const previous = tweens.get(node); previous.x = parseFloat(node.style.left); previous.y = parseFloat(node.style.top); finishTween(node, previous); }
    if (!compat() || reduced() || document.hidden) {
      node.style.left = x + 'px'; node.style.top = y + 'px'; return;
    }
    const r = node.getBoundingClientRect();
    tweens.set(node, {x,y,fromX:Number.isFinite(parseFloat(node.style.left))?parseFloat(node.style.left):r.left,fromY:Number.isFinite(parseFloat(node.style.top))?parseFloat(node.style.top):r.top,start:performance.now(),duration:Math.max(1,duration),transition:node.style.getPropertyValue('transition'),priority:node.style.getPropertyPriority('transition')});
    node.style.setProperty('transition','none','important');
    wake();
  }
  function settings(container) {
    const block = document.createElement('section'); block.className = 'suite-motion-settings';
    block.innerHTML = `<label class="sp-field">Анимации<select aria-label="Анимации" data-motion-mode><option value="always">Всегда · для ВАРМ</option><option value="system">Как в системе</option><option value="reduced">Без анимации</option></select></label><p class="sp-note" data-motion-system></p><small class="sp-note" data-motion-save></small><div class="suite-motion-preview"><span class="spinner" aria-hidden="true"></span><div><b>Проверка индикатора</b><small>Демонстрация движения, не работа агента</small></div></div><details class="suite-motion-check"><summary>Проверить совместимость с ВАРМ</summary><label><input type="checkbox" data-motion-disable-css> Имитировать отключение CSS-анимаций</label><p class="sp-note">В режиме «Всегда» индикаторы и курсор обновляются отдельно. Эта проверка действует только в открытых настройках макета.</p><small data-motion-frame></small></details>`;
    container.append(block);
    block.querySelector('[data-motion-mode]').onchange = e => setMode(e.target.value);
    block.querySelector('[data-motion-disable-css]').onchange = e => {
      cssDisabled = e.target.checked;
      root.toggleAttribute('data-motion-test-css-off', cssDisabled);
    };
    syncSettings(block);
    apply();
  }
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'suite-prototype-motion.css'; document.head.append(link);
  const observer = new MutationObserver(() => {
    if (cssDisabled && !document.querySelector('[data-motion-disable-css]')) {
      cssDisabled = false; root.removeAttribute('data-motion-test-css-off');
    }
    refresh();
  });
  observer.observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open']});
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer); timer = 0;
    root.toggleAttribute('data-motion-suspended', document.hidden);
    if (document.hidden) clearTargets(); else { lastScan = -Infinity; refresh(); }
  });
  addEventListener('resize', refresh);
  document.addEventListener('scroll', refresh, true);
  media.addEventListener('change', apply);
  addEventListener('storage', event => { if (event.key === key && modes.includes(event.newValue)) { mode = event.newValue; saveFailed = false; apply(); } });
  window.SuiteMotion = {settings, setMode, moveTo};
  apply();
})();
