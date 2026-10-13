/* Model tests for the prototype motion scheduler. No browser or RDP is used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourcePath = path.resolve(__dirname, '../suite-prototype-motion.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function fixture({ signal = true, savedMode, storageFails = false } = {}) {
  let now = 0, serial = 0, frames = 0;
  const timers = new Map(), listeners = new Map(), observers = [], nodes = [];
  const storage = new Map(savedMode ? [['suite.prototype.motion.v1', savedMode]] : []);
  const root = { dataset: {}, attributes: new Set(), toggleAttribute(name, on) { on ? this.attributes.add(name) : this.attributes.delete(name); }, removeAttribute(name) { this.attributes.delete(name); } };
  const body = { parentElement: null }, head = { append() {} };
  const notify = () => observers.forEach(o => o.fn([{ type: 'childList' }]));
  function element(kind = '') {
    const values = new Map(), priority = new Map();
    const style = new Proxy({
      setProperty(name, value, p = '') { values.set(name, String(value)); priority.set(name, p); },
      getPropertyValue(name) { return values.get(name) || ''; },
      getPropertyPriority(name) { return priority.get(name) || ''; },
      removeProperty(name) { values.delete(name); priority.delete(name); },
    }, {
      get(target, key) { return key in target ? target[key] : values.get(key) || ''; },
      set(target, key, value) { values.set(key, String(value)); return true; },
    });
    const n = {
      kind, style, dataset: {}, parentElement: body, isConnected: true, hidden: false,
      visibility: 'visible', rect: { left: 50, top: 50, width: 12, height: 12 },
      closest(query) { if (query === '[hidden]') return this.hidden ? this : null; return null; },
      matches(query) {
        return query.split(',').some(q => q.trim() === ({ spinner: '.spinner', sp: '.sp-pulse', pulse: '.pulse', dot: '.plan-item.current .plan-state', progress: '.bd-progress i' }[this.kind]));
      },
      getBoundingClientRect() {
        this.geometryReads = (this.geometryReads || 0) + 1;
        const left = Number.parseFloat(style.left) || this.rect.left, top = Number.parseFloat(style.top) || this.rect.top;
        return { ...this.rect, left, top, right: left + this.rect.width, bottom: top + this.rect.height };
      },
    };
    nodes.push(n); return n;
  }
  const document = {
    documentElement: root, body, head, hidden: false,
    querySelectorAll(query) { return nodes.filter(n => n.isConnected && n.matches(query)); },
    querySelector() { return null; },
    createElement() { return element(); },
    addEventListener(name, fn) { listeners.set(name, fn); },
  };
  const media = { matches: signal, addEventListener(name, fn) { this.change = fn; } };
  const context = {
    document, matchMedia: () => media,
    localStorage: { getItem: k => storage.get(k), setItem(k, v) { if (storageFails) throw new Error('fixture storage failure'); storage.set(k, v); } },
    performance: { now: () => now }, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: n => ({ visibility: n.visibility || 'visible', overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }),
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(target, options) { this.options = options; } },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: sourcePath });
  function advance(ms) {
    const until = now + ms; let guard = 0;
    while (timers.size) {
      const [id, job] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (job.at > until) break;
      assert.ok(++guard < 1000, 'bounded timer processing');
      now = job.at; timers.delete(id); frames++; job.fn();
    }
    now = until;
  }
  return {
    root, document, media, timers, observers, nodes, element, notify, advance, api: context.SuiteMotion,
    fire(name, event) { listeners.get(name)?.(event); },
    setSignal(value) { media.matches = value; media.change(); },
    frames: () => frames, storage,
  };
}

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'fail', error: error.message }); }
}

check('Default Always overrides the OS reduced-motion signal', () => {
  const f = fixture(); assert.equal(f.root.dataset.motion, 'always'); assert.equal(f.root.dataset.motionEffective, 'full'); assert.equal(f.root.dataset.motionRenderer, 'compat');
});
check('System follows changing OS preference; explicit Reduced always disables movement', () => {
  const f = fixture(); f.api.setMode('system'); assert.equal(f.root.dataset.motionEffective, 'reduced');
  f.setSignal(false); assert.equal(f.root.dataset.motionEffective, 'full');
  f.api.setMode('reduced'); assert.equal(f.root.dataset.motionEffective, 'reduced'); f.setSignal(true); assert.equal(f.root.dataset.motionEffective, 'reduced');
});
check('Direct spinner rotation changes despite animation:none and transition:none', () => {
  const f = fixture(); const spinner = f.element('spinner'); spinner.style.setProperty('animation', 'none', 'important'); spinner.style.setProperty('transition', 'none', 'important');
  f.advance(100); const first = spinner.style.transform; f.advance(100);
  assert.match(first, /^rotate\(/); assert.notEqual(spinner.style.transform, first); assert.equal(spinner.style.getPropertyPriority('transform'), 'important'); assert.equal(spinner.style.animation, 'none');
});
check('Completed indicator restores previous inline style and stops scheduling', () => {
  const f = fixture(); const spinner = f.element('spinner'); spinner.style.setProperty('transform', 'scale(.8)', 'important'); f.advance(100);
  spinner.kind = ''; f.notify(); f.advance(500);
  assert.equal(spinner.style.transform, 'scale(.8)'); assert.equal(spinner.style.getPropertyPriority('transform'), 'important'); assert.equal(spinner.dataset.motionKind, undefined); assert.equal(f.timers.size, 0);
});
check('Removed indicator releases owned styles and timer', () => {
  const f = fixture(); const spinner = f.element('spinner'); f.advance(100); spinner.isConnected = false; f.notify(); f.advance(500);
  assert.equal(spinner.style.transform, ''); assert.equal(spinner.dataset.motionKind, undefined); assert.equal(f.timers.size, 0);
});
check('Explicit Reduced cleans active inline rotation; Always resumes', () => {
  const f = fixture(); const spinner = f.element('spinner'); f.advance(100); f.api.setMode('reduced'); assert.equal(spinner.style.transform, ''); f.advance(100); assert.equal(f.timers.size, 0);
  f.api.setMode('always'); f.advance(100); assert.match(spinner.style.transform, /^rotate\(/);
});
check('Hidden document stops all timers; showing resumes current indicators', () => {
  const f = fixture(); const spinner = f.element('spinner'); f.advance(100);
  f.document.hidden = true; f.fire('visibilitychange'); assert.equal(f.timers.size, 0); assert.equal(spinner.style.transform, ''); const frames = f.frames(); f.advance(5000); assert.equal(f.frames(), frames);
  f.document.hidden = false; f.fire('visibilitychange'); f.advance(100); assert.match(spinner.style.transform, /^rotate\(/); assert.equal(f.root.attributes.has('data-motion-suspended'), false);
});
check('Interrupted cursor tween continues from its present position without old-target jump', () => {
  const f = fixture(); const cursor = f.element(); cursor.style.left = '10px'; cursor.style.top = '20px'; cursor.style.setProperty('transition', 'left .5s', 'important');
  f.api.moveTo(cursor, 500, 400, 600); f.advance(180); const beforeX = cursor.style.left, beforeY = cursor.style.top;
  f.api.moveTo(cursor, 300, 250, 600); assert.equal(cursor.style.left, beforeX); assert.equal(cursor.style.top, beforeY); assert.notEqual(cursor.style.left, '500px');
  f.advance(700); assert.equal(cursor.style.left, '300px'); assert.equal(cursor.style.top, '250px'); assert.equal(cursor.style.transition, 'left .5s'); assert.equal(cursor.style.getPropertyPriority('transition'), 'important'); assert.equal(f.timers.size, 0);
});
check('Removed cursor releases tween and restores transition', () => {
  const f = fixture(); const cursor = f.element(); cursor.style.left = '10px'; cursor.style.top = '20px'; cursor.style.transition = 'left .4s';
  f.api.moveTo(cursor, 300, 200, 600); f.advance(100); cursor.isConnected = false; f.notify(); f.advance(200);
  assert.equal(cursor.style.transition, 'left .4s'); assert.equal(f.timers.size, 0);
});
check('Idle document has no repeating timer after initial scan', () => {
  const f = fixture(); f.advance(100); const frames = f.frames(); assert.equal(f.timers.size, 0); f.advance(10000); assert.equal(f.frames(), frames);
});
check('One shared scheduler stays at or below 12 frames per second for many indicators', () => {
  const f = fixture(); for (let i = 0; i < 50; i++) f.element('spinner'); f.advance(1000); assert.ok(f.frames() <= 12); assert.equal(f.timers.size, 1);
  assert.equal(f.observers[0].options.attributeFilter.includes('style'), false); assert.equal(f.observers[0].options.characterData, undefined);
});
check('Discovery stops geometry checks after 64 visible targets', () => {
  const f = fixture(); for (let i = 0; i < 100; i++) f.element('spinner'); f.advance(100);
  assert.equal(f.nodes.filter(n => n.dataset.motionKind).length, 64); assert.equal(f.nodes.filter(n => n.geometryReads).length, 64);
});
check('Stored and cross-window modes apply; storage failure does not block current preference', () => {
  const f = fixture({ savedMode: 'reduced', storageFails: true }); assert.equal(f.root.dataset.motion, 'reduced');
  f.api.setMode('always'); assert.equal(f.root.dataset.motion, 'always');
  f.fire('storage', { key: 'suite.prototype.motion.v1', newValue: 'system' }); assert.equal(f.root.dataset.motion, 'system'); assert.equal(f.root.dataset.motionEffective, 'reduced');
});
check('Reduced-mode change finishes in-progress cursor promptly', () => {
  const f = fixture(); const cursor = f.element(); cursor.style.left = '10px'; cursor.style.top = '20px';
  f.api.moveTo(cursor, 300, 200, 600); f.advance(100); f.api.setMode('reduced');
  assert.equal(cursor.style.left, '300px'); assert.equal(cursor.style.top, '200px'); assert.equal(cursor.style.transition, ''); f.advance(100); assert.equal(f.timers.size, 0);
});

check('An absolute cursor interpolates in its parent coordinates, not viewport coordinates', () => {
  const f = fixture(); const cursor = f.element(); cursor.style.left = '10px'; cursor.style.top = '20px';
  cursor.getBoundingClientRect = () => ({left:610,top:420,width:20,height:24});
  f.api.moveTo(cursor,100,90,600); f.advance(100);
  assert.ok(parseFloat(cursor.style.left) >= 10 && parseFloat(cursor.style.left) <= 100);
  assert.ok(parseFloat(cursor.style.top) >= 20 && parseFloat(cursor.style.top) <= 90);
  f.advance(700); assert.equal(cursor.style.left,'100px'); assert.equal(cursor.style.top,'90px');
});

const report = {
  kind: 'prototype-model-audit', source: 'design/suite-prototype-motion.js', sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  passed: results.filter(r => r.status === 'pass').length, failed: results.filter(r => r.status === 'fail').length,
  limitation: 'VM with fake DOM, media signal and timers. Does not verify real browser painting, OS policies, RDP frame delivery, Electron or runtime app/.',
  results,
};
fs.writeFileSync(path.join(__dirname, 'motion-state-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
