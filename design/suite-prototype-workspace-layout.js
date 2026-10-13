/* Local, persistent split-tree prototype. Existing surface nodes remain mounted. */
(() => {
  'use strict';
  if(window.SuiteWorkspaceLayout)return;
  const workspace=document.querySelector('#workArea > .workspace'),work=document.querySelector('#workArea'),app=document.querySelector('.app');
  if(!workspace||!work||!app)return;
  const names={chat:'Чат',code:'IDE',browser:'Браузер','agent-browser':'Браузер агента',tasks:'Задачи',design:'Дизайн и материалы',ops:'Operations',data:'Базы данных',scm:'Git и Review'};
  const views=new Map(Object.keys(names).map(id=>[id,workspace.querySelector(`[data-panel="${id}"]`)]).filter(([,view])=>view));
  const initialFocus=document.activeElement,initialSelection=initialFocus&&'selectionStart' in initialFocus?{start:initialFocus.selectionStart,end:initialFocus.selectionEnd}:null;
  const ids=[...views.keys()],valid=new Set(ids),storageKey='suite.prototype.workspace-layout.v1';
  const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
  const leaf=id=>({kind:'leaf',id});
  const split=(axis,a,b,ratio=.5)=>({kind:'split',id:uid(),axis,ratio,a,b});
  const group=(tabs,id=uid())=>tabs.length===1?leaf(tabs[0]):{kind:'group',id,tabs:[...tabs]};
  const leaves=tree=>!tree?[]:tree.kind==='leaf'?[tree.id]:tree.kind==='group'?[...tree.tabs]:[...leaves(tree.a),...leaves(tree.b)];
  const copy=value=>JSON.parse(JSON.stringify(value));
  function normalize(tree,seen=new Set(),depth=0,nodeIds=new Set()){
    if(!tree||typeof tree!=='object'||depth>20)return null;
    if(tree.kind==='leaf'){if(!valid.has(tree.id)||seen.has(tree.id))return null;seen.add(tree.id);return leaf(tree.id)}
    if(!['split','group'].includes(tree.kind))return null;
    const nodeId=()=>{const id=typeof tree.id==='string'&&tree.id&&!nodeIds.has(tree.id)?tree.id:uid();nodeIds.add(id);return id;};
    if(tree.kind==='group'){const tabs=(Array.isArray(tree.tabs)?tree.tabs:[]).filter(id=>{if(!valid.has(id)||seen.has(id))return false;seen.add(id);return true;});return tabs.length?group(tabs,nodeId()):null;}
    const a=normalize(tree.a,seen,depth+1,nodeIds),b=normalize(tree.b,seen,depth+1,nodeIds);if(!a||!b)return a||b;
    return {kind:'split',id:nodeId(),axis:tree.axis==='y'?'y':'x',ratio:Number.isFinite(tree.ratio)?Math.min(.9,Math.max(.1,tree.ratio)):.5,a,b};
  }
  function remove(tree,id){if(!tree)return null;if(tree.kind==='leaf')return tree.id===id?null:tree;if(tree.kind==='group'){const tabs=tree.tabs.filter(x=>x!==id);return tabs.length?group(tabs,tree.id):null;}const a=remove(tree.a,id),b=remove(tree.b,id);return !a||!b?a||b:{...tree,a,b};}
  function insert(tree,id,target,edge='right'){
    if(!tree)return leaf(id);
    if(tree.kind==='leaf'||tree.kind==='group'){
      const tabs=leaves(tree);if(!tabs.includes(target))return tree;
      if(edge==='center')return group([...tabs.filter(x=>x!==id),id],tree.kind==='group'?tree.id:uid());
      const axis=['left','right'].includes(edge)?'x':'y';return ['left','top'].includes(edge)?split(axis,leaf(id),tree):split(axis,tree,leaf(id));
    }
    return {...tree,a:insert(tree.a,id,target,edge),b:insert(tree.b,id,target,edge)};
  }
  function exchange(tree,a,b){if(!tree)return null;if(tree.kind==='leaf')return leaf(tree.id===a?b:tree.id===b?a:tree.id);if(tree.kind==='group')return {...tree,tabs:tree.tabs.map(id=>id===a?b:id===b?a:id)};return {...tree,a:exchange(tree.a,a,b),b:exchange(tree.b,a,b)};}
  function move(tree,id,target,edge){if(id===target||!leaves(tree).includes(id)||!leaves(tree).includes(target))return tree;return insert(remove(tree,id),id,target,edge);}
  function dock(tree,id,target,edge){if(!valid.has(id)||!leaves(tree).includes(target)||!['left','right','top','bottom','center'].includes(edge))return tree;return leaves(tree).includes(id)?move(tree,id,target,edge):insert(tree,id,target,edge);}
  function panelGroup(tree,id){if(!tree)return null;if(tree.kind!=='split')return leaves(tree).includes(id)?tree:null;return panelGroup(tree.a,id)||panelGroup(tree.b,id);}
  function balanced(list,axis='x'){if(!list.length)return null;if(list.length===1)return leaf(list[0]);const middle=Math.ceil(list.length/2);return split(axis,balanced(list.slice(0,middle),axis==='x'?'y':'x'),balanced(list.slice(middle),axis==='x'?'y':'x'));}
  // A split is an explicit user decision. Small viewports scroll; they never change it to tabs.
  function minimum(tree){if(!tree)return {w:280,h:220};if(tree.kind==='leaf')return {w:tree.id==='chat'?300:320,h:220};if(tree.kind==='group'){const sizes=tree.tabs.map(id=>minimum(leaf(id)));return {w:Math.max(...sizes.map(x=>x.w)),h:Math.max(...sizes.map(x=>x.h))+32};}const a=minimum(tree.a),b=minimum(tree.b);return tree.axis==='x'?{w:a.w+b.w+7,h:Math.max(a.h,b.h)}:{w:Math.max(a.w,b.w),h:a.h+b.h+7};}
  // Materialize only legacy auto-collapsed groups once, preserving the previous visible layout.
  function legacyMinimum(tree){if(tree.kind==='group'){const values=tree.tabs.map(id=>legacyMinimum(leaf(id)));return {w:Math.max(...values.map(v=>v.w)),h:Math.max(...values.map(v=>v.h))+32};}if(tree.kind==='leaf'){const sizes={chat:[390,340],code:[500,400],data:[500,410],browser:[420,360],'agent-browser':[420,360],ops:[460,400],tasks:[460,380],design:[460,400],scm:[460,400]},[w,h]=sizes[tree.id]||[420,360];return {w,h};}const a=legacyMinimum(tree.a),b=legacyMinimum(tree.b);return tree.axis==='x'?{w:a.w+b.w+7,h:Math.max(a.h,b.h)}:{w:Math.max(a.w,b.w),h:a.h+b.h+7};}
  function migrateLayout(tree,w,h){if(!tree||tree.kind!=='split')return tree;const a=legacyMinimum(tree.a),b=legacyMinimum(tree.b),isX=tree.axis==='x',total=(isX?w:h)-7;if(total<(isX?a.w+b.w:a.h+b.h))return group(leaves(tree),tree.id);const first=Math.max(isX?a.w:a.h,Math.min(total-(isX?b.w:b.h),total*tree.ratio));return {...tree,a:migrateLayout(tree.a,isX?first:w,isX?h:first),b:migrateLayout(tree.b,isX?total-first:w,isX?h:total-first)};}
  function updateRatio(tree,id,ratio){if(!tree||tree.kind!=='split')return tree;if(tree.id===id)return {...tree,ratio};return {...tree,a:updateRatio(tree.a,id,ratio),b:updateRatio(tree.b,id,ratio)}}
  function locationOf(tree,id){const node=panelGroup(tree,id);if(node?.kind==='group')return {target:node.tabs.find(x=>x!==id),edge:'center'};if(!tree||tree.kind!=='split')return null;if(leaves(tree.a).includes(id)){if(tree.a.kind!=='split')return {target:leaves(tree.b)[0],edge:tree.axis==='x'?'left':'top'};return locationOf(tree.a,id);}if(leaves(tree.b).includes(id)){if(tree.b.kind!=='split')return {target:leaves(tree.a)[0],edge:tree.axis==='x'?'right':'bottom'};return locationOf(tree.b,id);}return null;}
  function defaults(){return {layoutVersion:2,tree:split('x',leaf('chat'),leaf('browser'),.44),active:'chat',maximized:null,locations:{},groupActive:{}}}
  function checked(value){const s=value&&typeof value==='object'?value:defaults(),tree=normalize(s.tree),open=leaves(tree);return {layoutVersion:2,tree,active:open.includes(s.active)?s.active:open[0]||null,maximized:open.includes(s.maximized)?s.maximized:null,locations:s.locations&&typeof s.locations==='object'?s.locations:{},groupActive:s.groupActive&&typeof s.groupActive==='object'?s.groupActive:{}}}
  let bank={};try{const parsed=JSON.parse(localStorage.getItem(storageKey)||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))bank=parsed}catch(_){}
  let project=window.SuitePrototype?.project?.()||'Atlas Platform',needsMigration=!!bank[project]&&bank[project].layoutVersion!==2,state=checked(bank[project]||defaults());
  const persist=()=>{bank[project]={...copy(state),layoutVersion:2};try{localStorage.setItem(storageKey,JSON.stringify(bank))}catch(_){}};
  const create=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e};
  const icon=path=>`<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="${path}"/></svg>`;
  const icons={close:'m6 6 12 12M18 6 6 18',expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',restore:'M7 3v4H3M21 7h-4V3M3 17h4v4M17 21v-4h4',menu:'M5 12h.01M12 12h.01M19 12h.01',grip:'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01'};
  const button=(label,path,fn,cls='icon-button')=>{const b=create('button',cls);b.type='button';b.innerHTML=icon(path);b.title=label;b.setAttribute('aria-label',label);b.onclick=fn;return b};
  const status=create('div','sw-status');status.setAttribute('role','status');document.body.append(status);
  const announce=text=>{status.textContent='';requestAnimationFrame(()=>status.textContent=text)};
  app.classList.add('sw-enabled');app.classList.remove('paired','design-workspace');workspace.classList.add('sw-workspace');workspace.classList.remove('paired','chat-hidden','reversed');
  const scroller=create('div','sw-scroll'),canvas=create('div','sw-canvas');scroller.append(canvas);workspace.append(scroller);
  const containers=new Map(),headers=new Map(),dividers=new Map(),groups=new Map(),geometry=new Map(),splitGeometry=new Map();
  const toolbarSelectors={chat:'.view-toolbar',code:'#di-ide .di-bar',data:'#di-data .d2-topbar',browser:'#bdBrowser .bd-tabs','agent-browser':'#suiteAgentBrowserRoot .ab-ownerbar',tasks:'.sto-panel .sto-toolbar',scm:'.sto-panel .sto-toolbar',design:'#bdDesign .bd-designbar',ops:'.sto-ops-shell .sto-tabs'};
  function mountChrome(view,id,head){
    const toolbar=view.querySelector(toolbarSelectors[id]);if(!toolbar)return;
    let row=toolbar.parentElement;
    if(!row.classList.contains('sw-toolbar-row')){row=create('div','sw-toolbar-row');toolbar.before(row);row.append(toolbar);toolbar.classList.add('sw-native-toolbar');}
    if(head.parentElement!==row)row.append(head);
    view.classList.add('sw-integrated');
    // Preserve native context actions instead of showing a second agent button.
    head.classList.toggle('sw-native-agent',!!view.querySelector('[data-di="db-agent"],[data-bd="design-agent"],[data-bd="browser-agent"],.ab-ownerbar'));
    if(!row.dataset.swDrag){row.dataset.swDrag=id;bindPanelDrag(row,id,head);}
  }
  function bindPanelDrag(surface,id,owner){
    surface.addEventListener('pointerdown',e=>{
      if(e.button!==0||drag||resize)return;
      const grip=e.target.closest('.sw-panel-grip');
      if(!grip&&e.target.closest('button,input,select,textarea,a,summary,label,[role="tab"]'))return;
      const capture=grip||owner;delete capture.dataset.swDragged;e.preventDefault();capture.setPointerCapture(e.pointerId);drag={id,x:e.clientX,y:e.clientY,pointer:e.pointerId,owner:capture,started:false,target:null,edge:null};
    });
    surface.addEventListener('dblclick',e=>{if(!e.target.closest('button,input,select,textarea,a,summary,label,[role="tab"]'))maximize(id)});
  }
  let drag=null,resize=null,frame=0,menuReturn=null;
  const empty=create('div','sw-empty');empty.append(create('h2','','Откройте рабочую панель'),create('p','','Откройте инструмент слева. Панели располагаются рядом, а при нехватке места — вкладками. Их содержимое сохраняется.'));
  const emptyActions=create('div','sw-empty-actions');ids.forEach(id=>{const b=create('button','btn soft',names[id]);b.onclick=()=>open(id);emptyActions.append(b)});empty.append(emptyActions);canvas.append(empty);
  const modal=create('dialog','sw-layout-dialog');modal.setAttribute('aria-labelledby','swMenuTitle');document.body.append(modal);
  modal.addEventListener('click',e=>{if(e.target!==modal)return;const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close()});
  modal.addEventListener('close',()=>{if(menuReturn?.isConnected&&!menuReturn.closest('[hidden]'))menuReturn.focus()});
  function showLayoutMenu(){
    modal.setAttribute('aria-modal','false');modal.show();const rect=menuReturn?.getBoundingClientRect?.(),width=Math.min(460,window.innerWidth-24),height=Math.min(modal.scrollHeight,window.innerHeight-24);
    modal.style.width=width+'px';modal.style.left=Math.max(12,Math.min(window.innerWidth-width-12,rect?.left||12))+'px';modal.style.top=Math.max(12,Math.min(window.innerHeight-height-12,(rect?.bottom||12)+6))+'px';
  }
  document.addEventListener('pointerdown',e=>{if(modal.open&&!modal.contains(e.target)&&e.target!==menuReturn){menuReturn=null;modal.close();}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.open){e.preventDefault();modal.close();}},true);
  function menu(id,anchor){
    menuReturn=anchor||document.activeElement;modal.classList.remove('sw-group-dialog');modal.replaceChildren();const header=create('header');header.append(create('h2','','Панель · '+names[id]));header.firstChild.id='swMenuTitle';header.append(button('Закрыть меню панели',icons.close,()=>modal.close()));modal.append(header);
    const body=create('div','sw-layout-body');modal.append(body);const context=containers.get(id)?.querySelector('.sw-panel-context')?.textContent?.trim();if(context)body.append(create('p','sw-layout-note',context));const row=create('div','sw-menu-actions');
    const action=(text,fn)=>{const b=create('button','btn soft',text);b.onclick=()=>{menuReturn=null;modal.close();fn()};return b};
    row.append(action(state.maximized===id?'Вернуть раскладку':'Развернуть панель',()=>maximize(id)),action(id==='chat'?'Скрыть чат':'Закрыть панель',()=>close(id)));body.append(row);
    const agentActions=containers.get(id)?.querySelectorAll('.sw-panel-head > .sw-agent-action');if(agentActions?.length){const agents=create('div','sw-menu-actions');agentActions.forEach(b=>agents.append(action(b.dataset.swLabel||b.title,()=>b.click())));body.append(agents)}
    const others=leaves(state.tree).filter(x=>x!==id);
    if(others.length){const form=create('form','sw-menu-move'),targetLabel=create('label','','Относительно панели'),target=create('select'),edgeLabel=create('label','','Расположение'),edge=create('select');target.setAttribute('aria-label','Относительно панели');edge.setAttribute('aria-label','Расположение панели');others.forEach(x=>{const o=create('option','',names[x]);o.value=x;target.append(o)});Object.entries({left:'Слева',right:'Справа',top:'Сверху',bottom:'Снизу',center:'Вкладкой в эту группу'}).forEach(([value,text])=>{const o=create('option','',text);o.value=value;edge.append(o)});targetLabel.append(target);edgeLabel.append(edge);const apply=create('button','btn soft','Переместить');apply.type='submit';form.append(targetLabel,edgeLabel,apply);form.onsubmit=e=>{e.preventDefault();state.tree=dock(state.tree,id,target.value,edge.value);state.active=id;state.maximized=null;menuReturn=null;modal.close();commit();focusPanel(id)};body.append(form)}
    body.append(create('h3','','Открытые панели'));const list=create('div','sw-panel-list');leaves(state.tree).forEach(x=>{const b=action(names[x]+(x===state.active?' · текущая':''),()=>open(x));list.append(b)});body.append(list);
    const foot=create('footer');foot.append(action('Открыть все панели',openAll),action('Упорядочить',arrange),action('Сбросить раскладку',reset));modal.append(foot);body.append(create('p','sw-layout-note','Перетаскивайте вкладку, ручку панели или значок слева. Край создаёт сплит, центр объединяет вкладки. Выбранная раскладка сохраняется при изменении размеров; границы регулируются мышью и стрелками.'));showLayoutMenu();header.querySelector('button').focus();
  }
  views.forEach((view,id)=>{
    const wrap=create('section','sw-leaf');wrap.id='sw-panel-'+id;wrap.dataset.swPanel=id;wrap.setAttribute('aria-label',names[id]);wrap.append(view);canvas.append(wrap);containers.set(id,wrap);
    let head=view.querySelector(':scope > .panel-drag-hint');if(!head){head=create('div','panel-drag-hint');view.prepend(head)}
    head.classList.add('sw-panel-head');headers.set(id,head);head.draggable=false;head.ondragstart=e=>e.preventDefault();head.setAttribute('role','group');head.setAttribute('aria-label','Управление панелью '+names[id]);head.title='';
    [...head.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.remove());
    const label=create('strong','sw-panel-title',names[id]);head.prepend(label);head.querySelectorAll(':scope > span').forEach(n=>{n.classList.add('sw-panel-context');n.title=n.textContent.trim()});
    let actions=head.querySelector(':scope > .icon-button:not([data-close-tool-panel])');if(!actions){actions=button('Меню панели '+names[id],icons.grip,()=>{});head.append(actions)}actions.classList.add('sw-panel-menu','sw-panel-grip');actions.innerHTML=icon(icons.grip);actions.title='Перетащите панель · нажмите для выбора расположения';actions.setAttribute('aria-label','Расположение панели '+names[id]);actions.onclick=e=>{e.stopPropagation();if(actions.dataset.swDragged){delete actions.dataset.swDragged;return}menu(id,actions)};
    const expand=button('Развернуть панель '+names[id],icons.expand,e=>{e.stopPropagation();maximize(id)});expand.classList.add('sw-panel-expand');head.insertBefore(expand,actions);
    let closeButton=head.querySelector('[data-close-tool-panel]');if(!closeButton){closeButton=button('Закрыть панель '+names[id],icons.close,()=>{});head.append(closeButton)}closeButton.classList.add('sw-panel-close');closeButton.title=id==='chat'?'Скрыть чат':'Закрыть панель '+names[id];closeButton.setAttribute('aria-label',closeButton.title);closeButton.onclick=e=>{e.stopPropagation();close(id)};
    bindPanelDrag(head,id,head);head.addEventListener('contextmenu',e=>{e.preventDefault();menu(id,head);});
    wrap.addEventListener('pointerdown',()=>activate(id),true);wrap.addEventListener('focusin',()=>activate(id));
    // Disable the old pair-only drop handler; terminal dragging uses its own MIME type.
    view.ondragover=null;view.ondrop=null;
    function compactAgentActions(){head.querySelectorAll(':scope > span').forEach(n=>{n.classList.add('sw-panel-context');n.title=n.textContent.trim()});head.querySelectorAll(':scope > .btn:not(.sw-agent-action)').forEach(b=>{const text=b.textContent.trim();if(!/^(Разговор|Обсудить)/.test(text))return;b.dataset.swLabel=text;b.classList.add('sw-agent-action');if(text.startsWith('Разговор'))b.classList.add('sw-session-action');b.title=text;b.setAttribute('aria-label',text);b.innerHTML=icon(text.startsWith('Разговор')?'M5 5h14v12H9l-4 3V5zM8 9h8M8 13h5':'M12 3l2 6 6 3-6 2-2 7-2-7-7-2 7-3z')})}
    compactAgentActions();mountChrome(view,id,head);
    // Tool renderers replace their own markup. Reattach the same controls, never a clone.
    new MutationObserver(()=>{compactAgentActions();mountChrome(view,id,head)}).observe(view,{childList:true,subtree:true});
  });
  function activate(id){if(!leaves(state.tree).includes(id)||state.active===id)return;state.active=id;syncControls();persist()}
  function syncControls(){
    const openIds=leaves(state.tree),chatVisible=openIds.includes('chat')&&!containers.get('chat')?.hidden;
    containers.forEach((wrap,id)=>{wrap.classList.toggle('sw-focused',state.active===id);const expand=headers.get(id)?.querySelector('.sw-panel-expand');if(!expand)return;const pressed=String(state.maximized===id);if(expand.getAttribute('aria-pressed')!==pressed)expand.innerHTML=icon(state.maximized===id?icons.restore:icons.expand);expand.title=state.maximized===id?'Вернуть раскладку':'Развернуть панель '+names[id];expand.setAttribute('aria-label',expand.title);expand.setAttribute('aria-pressed',pressed)});
  document.querySelectorAll('.rail-button[data-view]').forEach(b=>{const id=b.dataset.view;b.classList.toggle('active',state.active===id);b.dataset.open=String(openIds.includes(id));b.setAttribute('aria-pressed',String(openIds.includes(id)));b.setAttribute('aria-label',names[id]+(openIds.includes(id)?' · открыто':' · открыть'))});
    const toggle=document.querySelector('#chatVisibility');if(toggle){toggle.hidden=false;toggle.classList.toggle('active',chatVisible);toggle.setAttribute('aria-pressed',String(chatVisible));toggle.title=chatVisible?'Скрыть чат':'Показать чат';toggle.setAttribute('aria-label',toggle.title)}
  }
  workspace.addEventListener('dragstart',e=>{if(e.target.closest('.bd-tabs,.panel-drag-hint')){e.preventDefault();e.stopImmediatePropagation()}},true);
  function commit(){persist();render();document.dispatchEvent(new CustomEvent('suite:workspace-layout',{detail:{project,open:leaves(state.tree),active:state.active,maximized:state.maximized}}))}
  function focusPanel(id,keyboard=true){const wrap=containers.get(id);if(!wrap||wrap.hidden)return;const head=headers.get(id);mountChrome(views.get(id),id,head);head.scrollIntoView({block:'nearest',inline:'nearest'});if(keyboard)head.querySelector('.sw-panel-grip')?.focus({preventScroll:true})}
  function openingTree(id){
    const openIds=leaves(state.tree),location=state.locations[id];if(!openIds.length)return leaf(id);
    if(location&&openIds.includes(location.target))return insert(state.tree,id,location.target,location.edge);
    const tools=openIds.filter(x=>x!=='chat'),target=state.active!=='chat'&&openIds.includes(state.active)?state.active:tools[0]||openIds[0];
    // New tools join the active tool group. Only the first tool opens beside chat.
    return insert(state.tree,id,target,id==='chat'?'left':tools.length?'center':'right');
  }
  function open(id,options={}){if(!valid.has(id))return false;const keepMaximized=state.maximized===id;
    if(!leaves(state.tree).includes(id))state.tree=openingTree(id);
    if(options.activate!==false||!state.active)state.active=id;state.maximized=keepMaximized?id:null;commit();if(options.focus!==false)focusPanel(id);return true;
  }
  // An agent presentation reveals another surface, never transfers keyboard ownership.
  function reveal(id){
    if(!valid.has(id))return false;
    if(leaves(state.tree).includes(id))return !containers.get(id)?.hidden;
    const focused=document.activeElement;
    if(document.querySelector('dialog[open]')||focused?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')||drag||resize||(state.maximized&&state.maximized!==id))return false;
    if(scroller.clientWidth<900&&scroller.clientHeight<590)return false;
    const target=state.active||leaves(state.tree)[0],candidate=insert(state.tree,id,target,'right'),min=legacyMinimum(candidate);if(min.w>scroller.clientWidth||min.h>scroller.clientHeight)return false;
    const scroll={x:scroller.scrollLeft,y:scroller.scrollTop};
    state.tree=candidate;commit();const result=true;
    scroller.scrollLeft=scroll.x;scroller.scrollTop=scroll.y;
    return result;
  }
  function close(id=state.active){if(!valid.has(id)||!leaves(state.tree).includes(id))return false;state.locations[id]=locationOf(state.tree,id);const group=[...groups.values()].find(node=>!node.hidden&&node.dataset.members?.split('|').includes(id)),members=group?.dataset.members.split('|')||[],index=members.indexOf(id),next=members[index+1]||members[index-1]||state.locations[id]?.target;state.tree=remove(state.tree,id);if(state.maximized===id)state.maximized=null;if(state.active===id)state.active=leaves(state.tree).includes(next)?next:leaves(state.tree)[0]||null;commit();announce(id==='chat'?'Чат скрыт. Кнопка над IDE возвращает чат.':'Панель «'+names[id]+'» закрыта. Данные сохранены.');if(state.active)focusPanel(state.active);else document.querySelector('#chatVisibility')?.focus();return true}
  function showChat(){return open('chat')}
  function toggleChat(){const shown=leaves(state.tree).includes('chat')&&!containers.get('chat')?.hidden;return shown?close('chat'):showChat()}
  function maximize(id=state.active){if(!valid.has(id))return false;if(!leaves(state.tree).includes(id))open(id);state.maximized=state.maximized===id?null:id;state.active=id;commit();focusPanel(id);return true}
  function swap(id=state.active){const target=leaves(state.tree).find(x=>x!==id);if(!target)return false;state.tree=exchange(state.tree,id,target);state.maximized=null;commit();focusPanel(id);return true}
  function arrange(){state.tree=balanced(leaves(state.tree));state.maximized=null;commit();if(state.active)focusPanel(state.active)}
  function openAll(){state.tree=ids.includes('chat')?split('x',leaf('chat'),group(ids.filter(id=>id!=='chat')),.35):group(ids);state.maximized=null;state.active=state.active||'chat';commit();focusPanel(state.active);announce('Открыты все панели: чат слева, инструменты вкладками справа. Перетащите вкладку к краю для сплита.')}
  function reset(){state=defaults();commit();focusPanel('chat');announce('Начальная раскладка восстановлена: чат и браузер. Данные закрытых панелей сохранены.')}
  function makeDivider(node){let bar=dividers.get(node.id);if(bar)return bar;bar=create('div','sw-separator');bar.tabIndex=0;bar.setAttribute('role','separator');bar.setAttribute('aria-label','Размер соседних панелей');bar.title='Изменить размер: перетащите или используйте стрелки; Home — поровну';canvas.append(bar);dividers.set(node.id,bar);bar.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();if(drag||resize)return;bar.setPointerCapture(e.pointerId);resize={id:node.id,start:copy(state.tree),x:e.clientX,y:e.clientY,pointer:e.pointerId,owner:bar};document.body.classList.add('sw-resizing')});bar.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;const g=splitGeometry.get(node.id);if(!g)return;const positive=g.axis==='x'?'ArrowRight':'ArrowDown',negative=g.axis==='x'?'ArrowLeft':'ArrowUp';if(e.key!=='Home'&&e.key!==positive&&e.key!==negative)return;e.preventDefault();const ratio=e.key==='Home'?.5:g.ratio+(e.key===positive?.03:-.03);state.tree=updateRatio(state.tree,node.id,Math.max(.05,Math.min(.95,ratio)));commit()});return bar}
  function groupMenu(members,selected,anchor){
    menuReturn=anchor;modal.replaceChildren();modal.classList.add('sw-group-dialog');const header=create('header');header.append(create('h2','','Панели группы'));header.firstChild.id='swMenuTitle';header.append(button('Закрыть список панелей',icons.close,()=>modal.close()));modal.append(header);
    const body=create('div','sw-group-list');members.forEach(id=>{const row=create('button',id===selected?'selected':'',names[id]);row.type='button';row.setAttribute('aria-current',String(id===selected));row.onclick=()=>{menuReturn=null;modal.close();open(id)};body.append(row)});modal.append(body);showLayoutMenu();body.querySelector('[aria-current=true]')?.focus();
  }
  function groupPanel(tree,x,y,w,h){
    const members=leaves(tree),saved=state.groupActive?.[tree.id],selected=members.includes(state.active)?state.active:members.includes(saved)?saved:members[0];
    state.groupActive||={};state.groupActive[tree.id]=selected;
    let tabs=groups.get(tree.id);if(!tabs){tabs=create('nav','sw-group-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Панели рабочей группы');canvas.append(tabs);groups.set(tree.id,tabs)}
    tabs.dataset.visible='true';if(tabs.hidden)tabs.hidden=false;Object.assign(tabs.style,{left:x+'px',top:y+'px',width:w+'px',height:'32px'});
    const signature=members.join('|');
    if(tabs.dataset.members!==signature){
      tabs.replaceChildren();
      members.forEach(id=>{
        const item=create('div','sw-group-tab-item');item.setAttribute('role','presentation');
        const tab=create('button','sw-group-tab',names[id]);tab.type='button';tab.dataset.swTab=id;
        tab.setAttribute('role','tab');tab.setAttribute('aria-controls','sw-panel-'+id);
        tab.title=names[id]+' · перетащите для перемещения';tab.draggable=false;
        tab.onpointerdown=e=>{if(e.button!==0||drag||resize)return;tab.setPointerCapture(e.pointerId);drag={id,x:e.clientX,y:e.clientY,pointer:e.pointerId,owner:tab,started:false,target:null,edge:null}};
        tab.onclick=()=>{if(tab.dataset.skipClick){delete tab.dataset.skipClick;return}open(id)};
        tab.ondblclick=()=>maximize(id);tab.oncontextmenu=e=>{e.preventDefault();menu(id,tab);};
        const closeTab=()=>{
          close(id);
          // Closing a background tab must not activate it. Keep keyboard access on the survivor.
          for(const group of groups.values()){
            if(group.hidden)continue;
            const selectedTab=group.querySelector('[data-sw-tab="'+state.active+'"]');
            if(selectedTab){selectedTab.focus({preventScroll:true});break}
          }
        };
        tab.onkeydown=e=>{
          if(e.key==='Delete'){e.preventDefault();e.stopPropagation();closeTab();return}
          if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
          e.preventDefault();const index=members.indexOf(id),next=e.key==='Home'?members[0]:e.key==='End'?members.at(-1):members[(index+(e.key==='ArrowRight'?1:-1)+members.length)%members.length];
          open(next,{focus:false});tabs.querySelector('[data-sw-tab="'+next+'"]')?.focus();
        };
        const dismiss=button('Закрыть вкладку '+names[id],icons.close,e=>{e.stopPropagation();closeTab()},'sw-group-tab-close');
        dismiss.dataset.swClose=id;
        dismiss.onpointerdown=e=>e.stopPropagation();
        dismiss.ondblclick=e=>e.stopPropagation();
        item.append(tab,dismiss);tabs.append(item);
      });
      const overflow=button('Все панели группы · '+members.length,'m7 10 5 5 5-5',()=>groupMenu(members,tabs.querySelector('[aria-selected=true]')?.dataset.swTab||selected,overflow),'sw-group-overflow');
      overflow.setAttribute('aria-haspopup','dialog');tabs.append(overflow);tabs.dataset.members=signature;
    }
    tabs.querySelectorAll('[role=tab]').forEach(tab=>{const active=tab.dataset.swTab===selected;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1});
    // Keep the active tool and its close button visible when a long group gets narrower.
    const selectedItem=tabs.querySelector('[aria-selected=true]')?.parentElement;if(selectedItem){const item=selectedItem.getBoundingClientRect(),bounds=tabs.getBoundingClientRect();if(item.left<bounds.left)tabs.scrollLeft-=bounds.left-item.left;else if(item.right>bounds.right-28)tabs.scrollLeft+=item.right-bounds.right+28;}
    const wrap=containers.get(selected);wrap.classList.add('sw-tabbed');placeLeaf(selected,x,y+32,w,Math.max(1,h-32));
  }
  function placeLeaf(id,x,y,w,h){const wrap=containers.get(id);wrap.hidden=false;Object.assign(wrap.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});geometry.set(id,{x,y,w,h})}
  function place(tree,x,y,w,h){
    if(!tree)return;
    if(tree.kind==='leaf'){placeLeaf(tree.id,x,y,w,h);return}
    if(tree.kind==='group'){groupPanel(tree,x,y,w,h);return;}
    const a=minimum(tree.a),b=minimum(tree.b),isX=tree.axis==='x',total=(isX?w:h)-7;
    const first=Math.max(isX?a.w:a.h,Math.min(total-(isX?b.w:b.h),total*tree.ratio)),ratio=total>0?first/total:.5;
    place(tree.a,x,y,isX?first:w,isX?h:first);place(tree.b,isX?x+first+7:x,isX?y:y+first+7,isX?total-first:w,isX?h:total-first);
    const bar=makeDivider(tree);bar.hidden=false;bar.dataset.axis=tree.axis;Object.assign(bar.style,{left:(isX?x+first:x)+'px',top:(isX?y:y+first)+'px',width:(isX?7:w)+'px',height:(isX?h:7)+'px'});bar.setAttribute('aria-orientation',isX?'vertical':'horizontal');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',Math.round(ratio*100));bar.setAttribute('aria-valuetext',Math.round(ratio*100)+'% · первая панель');splitGeometry.set(tree.id,{x,y,w,h,axis:tree.axis,ratio});
  }
  function render(){
    geometry.clear();splitGeometry.clear();const display=state.maximized?leaf(state.maximized):state.tree;
    // Build visible geometry first: keeping an editor visible must not blur it on resize.
    containers.forEach(node=>node.classList.remove('sw-tabbed'));
    groups.forEach(node=>node.dataset.visible='false');
    const splitIds=new Set();const collect=tree=>{if(tree?.kind==='split'){splitIds.add(tree.id);collect(tree.a);collect(tree.b)}else if(tree?.kind==='group')splitIds.add(tree.id)};collect(state.tree);
    for(const map of [dividers,groups])map.forEach((node,id)=>{if(!splitIds.has(id)){node.remove();map.delete(id)}});empty.hidden=!!state.tree;
    const min=minimum(display),w=Math.max(scroller.clientWidth,min.w),h=Math.max(scroller.clientHeight,min.h);canvas.style.width=w+'px';canvas.style.height=h+'px';place(display,0,0,w,h);
    containers.forEach((node,id)=>{const hidden=!geometry.has(id);if(node.hidden!==hidden)node.hidden=hidden});dividers.forEach((node,id)=>{const hidden=!splitGeometry.has(id);if(node.hidden!==hidden)node.hidden=hidden});groups.forEach(node=>{const hidden=node.dataset.visible!=='true';if(node.hidden!==hidden)node.hidden=hidden});syncControls();
  }
  const dragLayer=create('div','sw-drag-layer');dragLayer.hidden=true;document.body.append(dragLayer);
  const preview=create('div','sw-drop-preview');dragLayer.append(preview);
  const targets=create('div','sw-drop-targets');['left','right','top','bottom','center'].forEach(edge=>{const label=create('span','sw-target',({left:'Слева',right:'Справа',top:'Сверху',bottom:'Снизу',center:'Вкладка'})[edge]);label.dataset.edge=edge;targets.append(label)});dragLayer.append(targets);
  const dragNote=create('div','sw-drag-note','Край — сплит · центр — вкладка · Escape — отмена');dragLayer.append(dragNote);
  function dropEdge(rect,x,y){const distances={left:(x-rect.left)/rect.width,right:(rect.right-x)/rect.width,top:(y-rect.top)/rect.height,bottom:(rect.bottom-y)/rect.height},nearest=Object.keys(distances).sort((a,b)=>distances[a]-distances[b])[0];return distances[nearest]<.24?nearest:'center';}
  function dragAt(e){
    if(!drag.started&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<7)return;
    drag.started=true;document.body.classList.add('sw-dragging');dragLayer.hidden=false;let target=null,rect=null;
    containers.forEach((wrap,id)=>{
      if(wrap.hidden)return;const node=panelGroup(state.tree,id),members=leaves(node),other=id===drag.id?members.find(x=>x!==drag.id):id;if(!other)return;
      const r=wrap.getBoundingClientRect(),tabs=node?.kind==='group'?groups.get(node.id)?.getBoundingClientRect():null,top=tabs?Math.min(r.top,tabs.top):r.top;
      const area={left:r.left,right:r.right,top,bottom:r.bottom,width:r.width,height:r.bottom-top};
      if(e.clientX>=area.left&&e.clientX<=area.right&&e.clientY>=area.top&&e.clientY<=area.bottom){target=other;rect=area;}
    });
    if(!target){drag.target=null;preview.hidden=true;targets.hidden=true;dragNote.textContent='Наведите на панель: край — сплит, центр — вкладка · Escape — отмена';return;}
    const edge=dropEdge(rect,e.clientX,e.clientY);drag.target=target;drag.edge=edge;preview.hidden=false;targets.hidden=false;
    Object.assign(targets.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});targets.querySelectorAll('[data-edge]').forEach(n=>n.classList.toggle('active',n.dataset.edge===edge));
    const r={x:rect.left,y:rect.top,w:rect.width,h:rect.height};if(edge==='left'||edge==='right'){r.w/=2;if(edge==='right')r.x+=r.w;}if(edge==='top'||edge==='bottom'){r.h/=2;if(edge==='bottom')r.y+=r.h;}
    Object.assign(preview.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});
    const descriptions={left:'Сплит слева',right:'Сплит справа',top:'Сплит сверху',bottom:'Сплит снизу',center:'Добавить вкладкой'};dragNote.textContent=names[drag.id]+' → '+descriptions[edge]+' · '+names[target]+' · Escape — отмена';
  }
  function endPointer(cancel=false){if(drag){const previous=drag;if(previous.started&&(previous.owner.classList.contains('sw-group-tab')||previous.owner.classList.contains('rail-button')))previous.owner.dataset.skipClick='true';if(previous.started&&(previous.owner.classList.contains('sw-panel-head')||previous.owner.classList.contains('sw-panel-grip')))previous.owner.dataset.swDragged='true';drag=null;try{previous.owner.releasePointerCapture(previous.pointer)}catch(_){}dragLayer.hidden=true;document.body.classList.remove('sw-dragging');if(!cancel&&previous.started&&previous.target){state.tree=dock(state.tree,previous.id,previous.target,previous.edge);state.maximized=null;state.active=previous.id;commit();focusPanel(previous.id);announce(names[previous.id]+' перемещена.')}else if(previous.started)announce('Перемещение отменено.')}
    if(resize){const previous=resize;if(cancel)state.tree=resize.start;resize=null;try{previous.owner.releasePointerCapture(previous.pointer)}catch(_){}document.body.classList.remove('sw-resizing');commit()}}
  document.addEventListener('pointermove',e=>{if(drag){if(e.pointerId===drag.pointer)dragAt(e);return}if(!resize||e.pointerId!==resize.pointer)return;const g=splitGeometry.get(resize.id);if(!g)return;const r=canvas.getBoundingClientRect(),size=(g.axis==='x'?g.w:g.h)-7,value=g.axis==='x'?e.clientX-r.left-g.x:e.clientY-r.top-g.y;state.tree=updateRatio(state.tree,resize.id,Math.min(.95,Math.max(.05,value/size)));render()});
  document.addEventListener('pointerup',e=>{if(e.pointerId===(drag?.pointer??resize?.pointer))endPointer(false)});document.addEventListener('pointercancel',e=>{if(e.pointerId===(drag?.pointer??resize?.pointer))endPointer(true)});document.addEventListener('lostpointercapture',e=>{if(e.pointerId===(drag?.pointer??resize?.pointer))endPointer(true)});window.addEventListener('blur',()=>endPointer(true));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(drag||resize)){e.preventDefault();e.stopPropagation();endPointer(true)}},true);
  document.querySelectorAll('.rail-button[data-view],#chatVisibility').forEach(b=>{
    const id=b.dataset.view||'chat';b.addEventListener('pointerdown',e=>{if(e.button!==0||drag||resize)return;e.preventDefault();b.setPointerCapture(e.pointerId);drag={id,x:e.clientX,y:e.clientY,pointer:e.pointerId,owner:b,started:false,target:null,edge:null};});
    b.addEventListener('contextmenu',e=>{e.preventDefault();menu(id,b);});
    b.onclick=()=>{if(b.dataset.skipClick){delete b.dataset.skipClick;return;}if(id==='chat')toggleChat();else open(id);};
  });
  new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(render)}).observe(workspace);
  function changeScope(event){const detail=event.detail||{},next=detail.project||window.SuitePrototype?.project?.()||project,previous=detail.previousProject;if(previous&&previous!==next&&bank[previous]){bank[next]=bank[previous];delete bank[previous]}if(next===project){if(previous)persist();return}endPointer(true);if(modal.open){menuReturn=null;modal.close();}bank[project]=copy(state);if(previous===project){bank[next]=bank[project];delete bank[project]}project=next;state=checked(bank[project]||defaults());if(bank[project]&&bank[project].layoutVersion!==2)state.tree=migrateLayout(state.tree,scroller.clientWidth,scroller.clientHeight);render();persist()}
  document.addEventListener('suite:scope-change',changeScope);
  document.addEventListener('suite:project-renamed',event=>{const {previousProject:previous,project:next}=event.detail||{};if(!previous||!next||previous===next)return;if(previous===project){changeScope(event);return}if(bank[previous]){bank[next]=bank[previous];delete bank[previous];persist()}});
  const api={open,reveal,close,showChat,toggleChat,maximize,swap,arrange,openAll,reset,isOpen:id=>leaves(state.tree).includes(id),snapshot:()=>({project,...copy(state)}),_test:{normalize,leaves,remove,insert,move,dock,panelGroup,balanced,minimum,updateRatio,dropEdge}};
  window.SuiteWorkspaceLayout=api;window.SuitePanelPrototype={closeTool:close,openTool:open,swap};
  if(needsMigration)state.tree=migrateLayout(state.tree,scroller.clientWidth,scroller.clientHeight);
  render();persist();
  const requested=new URLSearchParams(location.search).get('surface');if(valid.has(requested))open(requested);else if(initialFocus?.isConnected&&!initialFocus.closest('[hidden]')){initialFocus.focus({preventScroll:true});if(initialSelection&&initialSelection.start!==null)initialFocus.setSelectionRange(initialSelection.start,initialSelection.end)}
})();
