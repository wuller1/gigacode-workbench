/* Prototype-only terminal docking. No terminal processes, windows or remote calls. */
(() => {
  'use strict';
  const work = document.querySelector('#workArea');
  const workspace = work?.querySelector(':scope > .workspace');
  const dock = work?.querySelector(':scope > .dock');
  const head = dock?.querySelector('.dock-head');
  const toggle = document.querySelector('#dockToggle');
  if (!work || !workspace || !dock || !head || !toggle) return;
  const key = 'suite.prototype.terminal-layout.v1';
  const positions = {bottom:'Снизу', right:'Справа', left:'Слева', top:'Сверху'};
  const defaults = {preferred:'bottom', horizontal:340, vertical:190, collapsed:true};
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
  const state = {...defaults, ...(saved && typeof saved === 'object' ? saved : {})};
  if (!(state.preferred in positions)) state.preferred = defaults.preferred;
  for (const field of ['horizontal','vertical']) if (!Number.isFinite(state[field])) state[field] = defaults[field];
  state.collapsed=typeof state.collapsed==='boolean'?state.collapsed:true;
  work.classList.toggle('collapsed',state.collapsed);
  let effective = 'bottom', narrow = false, dragging = false, resizing = null, returnFocus = null, lastDrag = 0;
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {} };
  const element = (tag, className, text) => { const node = document.createElement(tag); if(className)node.className=className;if(text)node.textContent=text;return node; };
  const icon = path => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const gripIcon = icon('<circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>');
  const layoutIcon = position => icon('<rect x="3" y="3" width="18" height="18" rx="2"/>'+({bottom:'<path d="M3 15h18"/>',top:'<path d="M3 9h18"/>',left:'<path d="M9 3v18"/>',right:'<path d="M15 3v18"/>'}[position]));
  const style = element('style');
  style.textContent = `
  #workArea.sd-docking{min-width:0;min-height:0;position:relative;gap:0}
  #workArea.sd-docking[data-dock-position=bottom]{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) 6px var(--sd-size)}
  #workArea.sd-docking[data-dock-position=top]{grid-template-columns:minmax(0,1fr);grid-template-rows:var(--sd-size) 6px minmax(0,1fr)}
  #workArea.sd-docking[data-dock-position=left]{grid-template-columns:var(--sd-size) 6px minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
  #workArea.sd-docking[data-dock-position=right]{grid-template-columns:minmax(0,1fr) 6px var(--sd-size);grid-template-rows:minmax(0,1fr)}
  #workArea.sd-docking[data-dock-position=bottom]>.workspace{grid-column:1;grid-row:1}
  #workArea.sd-docking[data-dock-position=bottom]>.dock{grid-column:1;grid-row:3}
  #workArea.sd-docking[data-dock-position=top]>.workspace{grid-column:1;grid-row:3}
  #workArea.sd-docking[data-dock-position=top]>.dock{grid-column:1;grid-row:1}
  #workArea.sd-docking[data-dock-position=left]>.workspace{grid-column:3;grid-row:1}
  #workArea.sd-docking[data-dock-position=left]>.dock{grid-column:1;grid-row:1}
  #workArea.sd-docking[data-dock-position=right]>.workspace{grid-column:1;grid-row:1}
  #workArea.sd-docking[data-dock-position=right]>.dock{grid-column:3;grid-row:1}
  #workArea.sd-docking>.sd-dock-divider{grid-column:1;grid-row:2;min-width:0;min-height:0;background:var(--line);cursor:row-resize;touch-action:none;z-index:2}
  #workArea.sd-docking[data-dock-position=left]>.sd-dock-divider,#workArea.sd-docking[data-dock-position=right]>.sd-dock-divider{grid-column:2;grid-row:1;cursor:col-resize}
  #workArea.sd-docking>.sd-dock-divider:hover,#workArea.sd-docking>.sd-dock-divider:focus-visible{background:var(--blue);outline:none}
  #workArea.sd-docking.collapsed{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) 34px}
  #workArea.sd-docking.collapsed>.workspace{grid-column:1;grid-row:1}
  #workArea.sd-docking.collapsed>.dock{grid-column:1;grid-row:2}
  #workArea.sd-docking.collapsed>.sd-dock-divider,#workArea.sd-docking.collapsed .dock>.sp-terminal{display:none!important}
  #workArea.sd-docking .dock{overflow:hidden;border:1px solid var(--line);border-width:1px 0 0;min-height:0}
  #workArea.sd-docking .dock>.sp-terminal{max-height:none!important;min-height:0;flex:1}
  #workArea.sd-docking .dock-head{height:34px;min-height:34px;flex:none;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
  #workArea.sd-docking .dock-head>button{flex-shrink:0}
  .sd-dock-grip{position:sticky;left:0;z-index:2;background:var(--chrome)!important;cursor:grab!important;touch-action:none}
  .sd-dock-grip:active{cursor:grabbing!important}
  #workArea.sd-docking #dockToggle{position:sticky;right:0;z-index:2;background:var(--chrome)}
  .sd-layout-button{position:sticky;right:28px;z-index:2;background:var(--chrome)!important}
  .sd-drop-overlay{position:fixed;z-index:1400;pointer-events:none;padding:12px;display:grid;grid-template-columns:minmax(76px,22%) minmax(0,1fr) minmax(76px,22%);grid-template-rows:minmax(64px,22%) minmax(0,1fr) minmax(64px,22%);gap:12px;background:color-mix(in srgb,var(--bg) 65%,transparent)}
  .sd-drop-overlay[hidden]{display:none}
  .sd-drop-target{pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:8px;border:1px dashed var(--blue);border-radius:12px;background:var(--panel);color:var(--text);font:12px var(--ui);box-shadow:var(--shadow)}
  .sd-drop-target[data-position=top]{grid-row:1;grid-column:2}.sd-drop-target[data-position=bottom]{grid-row:3;grid-column:2}.sd-drop-target[data-position=left]{grid-row:2;grid-column:1}.sd-drop-target[data-position=right]{grid-row:2;grid-column:3}
  .sd-drop-target.sd-drop-active{background:var(--sel);outline:2px solid var(--mint);border-color:transparent}
  .sd-drop-caption{grid-row:2;grid-column:2;display:grid;place-content:center;text-align:center;gap:8px;color:var(--text);font:13px/1.5 var(--ui);text-shadow:0 1px var(--bg)}
  .sd-drop-caption small{font-size:11px;color:var(--muted)}
  .sd-layout-dialog{width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:0;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);box-shadow:var(--shadow)}
  .sd-layout-dialog::backdrop{background:#0007}.sd-layout-dialog header,.sd-layout-dialog footer{display:flex;align-items:center;gap:10px;padding:14px 18px}.sd-layout-dialog header{border-bottom:1px solid var(--line)}.sd-layout-dialog header h2{margin:0;font-size:16px;flex:1}.sd-layout-dialog footer{justify-content:flex-end;border-top:1px solid var(--line);flex-wrap:wrap}.sd-layout-options{border:0;padding:14px 18px;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:8px}.sd-layout-options legend{padding-top:16px;font-size:12px;color:var(--muted)}.sd-layout-options label{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:8px;padding:12px;cursor:pointer;font-size:13px}.sd-layout-options label:has(input:checked){border-color:var(--mint);background:var(--sel)}.sd-layout-options input{accent-color:var(--mint)}.sd-layout-note{font-size:12px;line-height:1.6;color:var(--muted);margin:0;padding:0 18px 16px}.sd-layout-status{position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  `;
  document.head.append(style);
  work.classList.add('sd-docking');
  const separator = element('div','sd-dock-divider');
  separator.tabIndex=0;separator.setAttribute('role','separator');separator.setAttribute('aria-label','Размер панели терминала');
  separator.title='Перетащите границу; стрелки меняют размер, Home — стандартный размер';
  work.append(separator);
  const grip = element('button','icon-button sd-dock-grip');
  grip.type='button';grip.draggable=true;grip.innerHTML=gripIcon;
  grip.setAttribute('aria-label','Переместить терминал');grip.setAttribute('aria-haspopup','dialog');
  grip.title='Перетащите терминал к краю рабочей области · Enter — расположение';head.prepend(grip);
  const layoutButton = element('button','icon-button sd-layout-button');
  layoutButton.type='button';layoutButton.setAttribute('aria-haspopup','dialog');toggle.before(layoutButton);
  const status = element('div','sd-layout-status');status.setAttribute('role','status');document.body.append(status);
  const overlay=element('div','sd-drop-overlay');overlay.hidden=true;overlay.setAttribute('aria-hidden','true');
  Object.entries(positions).forEach(([position,label])=>{const target=element('div','sd-drop-target');target.dataset.position=position;target.innerHTML=layoutIcon(position);target.append(document.createTextNode(label));overlay.append(target)});
  const caption=element('div','sd-drop-caption');caption.append(element('b','', 'Переместите терминал к краю'),element('small','','Escape — отмена'));overlay.append(caption);document.body.append(overlay);
  const dialog=element('dialog','sd-layout-dialog');dialog.id='suiteDockLayout';dialog.setAttribute('aria-labelledby','sdLayoutTitle');
  dialog.innerHTML='<header><h2 id="sdLayoutTitle">Расположение терминала</h2><button class="icon-button" type="button" aria-label="Закрыть настройку расположения">×</button></header><form method="dialog"><fieldset class="sd-layout-options"><legend>Относительно рабочей области</legend></fieldset><p class="sd-layout-note"></p><footer><button class="btn ghost" type="button" data-reset>Сбросить</button><button class="btn soft" value="cancel">Отмена</button><button class="btn primary" value="apply">Применить</button></footer></form>';
  Object.entries(positions).forEach(([position,label])=>{const option=element('label');const input=element('input');input.type='radio';input.name='terminal-position';input.value=position;option.append(input);const picture=element('span');picture.innerHTML=layoutIcon(position);option.append(picture,document.createTextNode(label));dialog.querySelector('fieldset').append(option)});
  document.body.append(dialog);
  function limits(position=effective){
    const rect=work.getBoundingClientRect(),side=position==='left'||position==='right';
    const available=side?rect.width:rect.height;
    const minWorkspace=side?(window.SuiteWorkspaceLayout?320:728):(innerWidth<=820&&workspace.classList.contains('paired')&&!workspace.classList.contains('chat-hidden')?368:200);
    const max=Math.max(72,Math.min(available*.55,available-minWorkspace-6));
    return {min:Math.min(side?270:120,max),max:Math.floor(max),side};
  }
  function render(){
    const rect=work.getBoundingClientRect();narrow=window.SuiteWorkspaceLayout?rect.width<640:rect.width<1060||innerWidth<=900;
    const collapsed=work.classList.contains('collapsed');effective=collapsed||narrow?'bottom':state.preferred;
    const {min,max,side}=limits();const value=Math.round(Math.max(min,Math.min(max,state[side?'horizontal':'vertical'])));
    work.dataset.dockPosition=effective;work.style.setProperty('--sd-size',value+'px');
    separator.setAttribute('aria-orientation',side?'vertical':'horizontal');separator.setAttribute('aria-valuemin',Math.round(min));separator.setAttribute('aria-valuemax',max);separator.setAttribute('aria-valuenow',value);separator.setAttribute('aria-valuetext',value+' пикселей');
    separator.tabIndex=collapsed?-1:0;separator.setAttribute('aria-hidden',String(collapsed));
    layoutButton.innerHTML=layoutIcon(effective);layoutButton.title='Расположение терминала · '+positions[effective]+(state.preferred!==effective?' · сохранено: '+positions[state.preferred]:'');layoutButton.setAttribute('aria-label',layoutButton.title);
    toggle.setAttribute('aria-label',collapsed?'Развернуть терминал':'Свернуть терминал');toggle.title=collapsed?'Развернуть терминал':'Свернуть терминал';toggle.setAttribute('aria-expanded',String(!collapsed));
  }
  function announce(text){status.textContent='';requestAnimationFrame(()=>{status.textContent=text});}
  function choose(position){state.preferred=position;work.classList.remove('collapsed');persist();render();announce('Терминал: '+positions[effective]+(effective!==position?'. '+positions[position]+' сохранено для широкого окна.':''));document.dispatchEvent(new CustomEvent('suite:terminal-layout',{detail:{preferred:state.preferred,effective}}));}
  function openLayout(){
    if(dragging||Date.now()-lastDrag<250)return;
    returnFocus=document.activeElement;
    dialog.querySelectorAll('input').forEach(input=>{input.checked=input.value===state.preferred});
    dialog.querySelector('.sd-layout-note').textContent='Перетаскивайте за значок с точками или выберите край здесь. В узком окне и при сворачивании терминал располагается снизу; выбранный край сохраняется. Это локальная компоновка макета, команды не выполняются.';
    dialog.showModal();dialog.querySelector('input:checked').focus();
  }
  grip.onclick=openLayout;layoutButton.onclick=openLayout;
  dialog.querySelector('header button').onclick=()=>dialog.close('cancel');
  dialog.querySelector('form').addEventListener('submit',event=>{if(event.submitter?.value==='apply')choose(dialog.querySelector('input:checked').value)});
  dialog.querySelector('[data-reset]').onclick=()=>{Object.assign(state,defaults);choose('bottom');dialog.close('reset');announce('Стандартное расположение терминала восстановлено: снизу.');};
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close('cancel')});
  dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus()});
  function placeOverlay(){const r=work.getBoundingClientRect();Object.assign(overlay.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});caption.querySelector('small').textContent=narrow?'Узкое окно: выбранный край сохранится; сейчас панель останется снизу. Escape — отмена.':'Escape — отмена';}
  function endDrag(){if(!dragging)return;dragging=false;lastDrag=Date.now();overlay.hidden=true;overlay.querySelectorAll('.sd-drop-active').forEach(x=>x.classList.remove('sd-drop-active'));}
  grip.addEventListener('dragstart',event=>{event.stopPropagation();dragging=true;event.dataTransfer.setData('application/x-suite-terminal-panel','terminal');event.dataTransfer.effectAllowed='move';placeOverlay();overlay.hidden=false;});
  grip.addEventListener('dragend',endDrag);
  overlay.addEventListener('dragover',event=>{if(!dragging)return;const target=event.target.closest('.sd-drop-target');if(!target)return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';overlay.querySelectorAll('.sd-drop-active').forEach(x=>x.classList.toggle('sd-drop-active',x===target));target.classList.add('sd-drop-active');});
  overlay.addEventListener('dragleave',event=>{const target=event.target.closest('.sd-drop-target');if(target&&!target.contains(event.relatedTarget))target.classList.remove('sd-drop-active')});
  overlay.addEventListener('drop',event=>{if(!dragging)return;event.preventDefault();event.stopPropagation();const target=event.target.closest('.sd-drop-target');if(target)choose(target.dataset.position);endDrag();grip.focus();});
  document.addEventListener('dragend',endDrag);
  document.addEventListener('drop',()=>{if(dragging)endDrag()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dragging){event.preventDefault();event.stopPropagation();endDrag();grip.focus()}},true);
  separator.addEventListener('pointerdown',event=>{if(event.button!==0||work.classList.contains('collapsed'))return;event.preventDefault();const field=limits().side?'horizontal':'vertical';resizing={field,start:state[field],pointer:event.pointerId};separator.setPointerCapture(event.pointerId);});
  separator.addEventListener('pointermove',event=>{if(!resizing)return;const r=work.getBoundingClientRect(),value=effective==='left'?event.clientX-r.left:effective==='right'?r.right-event.clientX:effective==='top'?event.clientY-r.top:r.bottom-event.clientY;const {min,max}=limits();state[resizing.field]=Math.max(min,Math.min(max,value));render();});
  separator.addEventListener('pointerup',()=>{if(resizing){resizing=null;persist()}});
  separator.addEventListener('pointercancel',()=>{if(resizing){state[resizing.field]=resizing.start;resizing=null;render()}});
  separator.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();const {min,max,side}=limits(),field=side?'horizontal':'vertical';let delta=0;if(effective==='left')delta=event.key==='ArrowRight'?16:event.key==='ArrowLeft'?-16:0;if(effective==='right')delta=event.key==='ArrowLeft'?16:event.key==='ArrowRight'?-16:0;if(effective==='top')delta=event.key==='ArrowDown'?16:event.key==='ArrowUp'?-16:0;if(effective==='bottom')delta=event.key==='ArrowUp'?16:event.key==='ArrowDown'?-16:0;state[field]=Math.max(min,Math.min(max,event.key==='Home'?defaults[field]:+separator.getAttribute('aria-valuenow')+delta));persist();render()});
  new ResizeObserver(()=>{render();if(dragging)placeOverlay()}).observe(work);
  new MutationObserver(()=>{state.collapsed=work.classList.contains('collapsed');persist();render()}).observe(work,{attributes:true,attributeFilter:['class']});
  head.addEventListener('click',event=>{if(event.target.closest('.dock-tab:not([hidden]),[aria-label="Новый терминал"]')){work.classList.remove('collapsed');state.collapsed=false;persist();render()}});
  new MutationObserver(render).observe(workspace,{attributes:true,attributeFilter:['class']});
  window.addEventListener('blur',endDrag);
  render();
})();
