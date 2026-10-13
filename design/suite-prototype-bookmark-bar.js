/* Shared bookmark bar for the two independent prototype browsers. No external navigation here. */
(() => {
  'use strict';
  const href = new URL('suite-prototype-bookmark-bar.css', document.currentScript.src).href;
  if (!document.querySelector(`link[href="${href}"]`)) Object.assign(document.head.appendChild(document.createElement('link')), {rel:'stylesheet', href});
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    mark:'<path d="M7 4h10v16l-5-3-5 3z"/>', folder:'<path d="M3 7V5h6l2 2h10v12H3z"/>',
    add:'<path d="M7 4h10v16l-5-3-5 3zM12 7v6m-3-3h6"/>',
    more:'<path d="m6 7 5 5-5 5m7-10 5 5-5 5"/>', dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    edit:'<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
    hide:'<path d="M3 5h18v14H3zM3 9h18m-7 5h4"/>', trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    manage:'<path d="M3 5h18v14H3zM3 10h18M8 10v9"/>', back:'<path d="m14 6-6 6 6 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.mark}</svg>`;
  const validURL = value => {try { const u = new URL(String(value).trim()); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }};
  let sequence = 0;
  function create(api) {
    const instance = ++sequence;
    let container = null, row = null, observer = null, popup = null, popupAnchor = null, popupScope = '', hiddenEntries = [], entries = [], frame = 0;
    let dialog = null, dialogScope = '', dialogReturn = null, lastNotice = '';
    const scope = () => String(api.scopeKey());
    const state = () => {const s=api.state(); if(!Array.isArray(s.bookmarks))s.bookmarks=[];if(!Array.isArray(s.folders))s.folders=[];if(!s.settings||typeof s.settings!=='object')s.settings={};return s;};
    const canNavigate = () => api.canNavigate?.() !== false;
    const find = id => state().bookmarks.find(b => String(b.id) === String(id));
    const notify = message => {lastNotice=message;if(row)row.querySelector('.sbm-status').textContent=message;};
    function persist() {const result=api.save();notify(result===false?'Изменение не удалось сохранить. Оно доступно только до перезагрузки.':'');return result;}
    function close(restoreFocus=true) {const target=popupAnchor, original=popupScope;popup?.remove();popup=null;popupAnchor=null;popupScope='';if(target?.isConnected){target.setAttribute('aria-expanded','false');if(restoreFocus&&scope()===original)target.focus();}}
    function closeDialog(restore=true) {if(!dialog)return;const target=dialogReturn,original=dialogScope;dialog.close();dialog.remove();dialog=null;dialogReturn=null;if(restore&&original===scope()){const returnTo=target?.isConnected?target:row?.querySelector('[data-sbm-action="menu"]');returnTo?.focus();}}
    function guard(original) {if(original===scope())return true;close(false);closeDialog(false);return false;}
    function goto(id, original) {if(!guard(original)||!canNavigate())return;const b=find(id),url=validURL(b?.url);if(!url)return;close(false);closeDialog(false);api.navigate(url);}
    function itemLabel(b) {return `<span class="sbm-symbol">${icon('mark')}</span><span class="sbm-label">${esc(b.title||b.url)}</span>`;}
    function button(entry) {const b=document.createElement('button');b.type='button';b.className='sbm-item';b.dataset.sbmKey=entry.key;if(entry.kind==='folder'){b.title=entry.name;b.innerHTML=icon('folder')+`<span class="sbm-label">${esc(entry.name)}</span>`;b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');b.onclick=()=>folderMenu(entry.name,b);}else{b.innerHTML=itemLabel(entry.bookmark);b.title=entry.bookmark.title+'\n'+entry.bookmark.url;b.disabled=!canNavigate();if(b.disabled)b.title+='\nСначала возьмите управление браузером агента';const original=scope();b.onclick=()=>goto(entry.bookmark.id,original);b.oncontextmenu=e=>{e.preventDefault();bookmarkMenu(entry.bookmark.id,b)};}return b;}
    function mount(next) {close(false);if(dialog&&dialogScope!==scope())closeDialog(false);observer?.disconnect();if(frame)cancelAnimationFrame(frame);container=next;refresh();if(container&&window.ResizeObserver){observer=new ResizeObserver(()=>{if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(layout)});observer.observe(container);}return apiPublic;}
    function refresh() {
      if(!container?.isConnected)return;
      if(popup&&popupScope!==scope())close(false);if(dialog&&dialogScope!==scope())closeDialog(false);
      const active=document.activeElement,focusKey=row?.contains(active)?active.dataset.sbmKey:null;
      const s=state();container.hidden=s.settings.bookmarkBar===false;container.classList.add('sbm-host');
      container.innerHTML='<div class="sbm-bar" role="toolbar" aria-label="Панель закладок"><div class="sbm-items"></div><span class="sbm-empty">Сохраните нужные страницы здесь</span><div class="sbm-actions"><button type="button" class="sbm-icon sbm-overflow" aria-label="Другие закладки" title="Другие закладки" aria-haspopup="menu" aria-expanded="false" data-sbm-key="overflow" hidden>'+icon('more')+'</button><button type="button" class="sbm-icon" data-sbm-action="add" data-sbm-key="add" title="Добавить текущую страницу в закладки" aria-label="Добавить текущую страницу в закладки">'+icon('add')+'</button><button type="button" class="sbm-icon" data-sbm-action="menu" data-sbm-key="menu" title="Панель закладок" aria-label="Настроить панель закладок" aria-haspopup="menu" aria-expanded="false">'+icon('dots')+'</button></div><span class="sbm-status" role="status" aria-live="polite"></span></div>';
      row=container.firstElementChild;row.querySelector('.sbm-status').textContent=lastNotice;
      const all=s.bookmarks.filter(b=>b&&b.id!=null&&validURL(b.url));
      const direct=all.filter(b=>!b.folder||b.folder==='Рабочие');
      const folders=[...new Set([...s.folders,...all.map(b=>b.folder)].filter(f=>typeof f==='string'&&f&&f!=='Рабочие'))];
      entries=[...direct.map(b=>({kind:'bookmark',bookmark:b,key:'bookmark:'+b.id})),...folders.map(name=>({kind:'folder',name,key:'folder:'+name}))];
      const host=row.querySelector('.sbm-items');entries.forEach(entry=>host.append(button(entry)));
      row.querySelector('[data-sbm-action="add"]').onclick=()=>edit();
      row.querySelector('[data-sbm-action="menu"]').onclick=e=>openMenu(e.currentTarget);
      row.querySelector('.sbm-overflow').onclick=e=>overflowMenu(e.currentTarget);
      row.querySelector('.sbm-empty').hidden=entries.length>0;
      row.querySelector('[data-sbm-action="add"]').disabled=!validURL(api.currentTab()?.url);
      row.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||e.target.tagName!=='BUTTON')return;const list=[...row.querySelectorAll('button')].filter(b=>!b.disabled&&!b.hidden);let at=list.indexOf(e.target);if(at<0)return;e.preventDefault();at=e.key==='Home'?0:e.key==='End'?list.length-1:(at+(e.key==='ArrowRight'?1:-1)+list.length)%list.length;list[at]?.focus();};
      layout();if(focusKey){[...row.querySelectorAll('button')].find(b=>b.dataset.sbmKey===focusKey&&!b.hidden)?.focus();}
    }
    function layout() {
      frame=0;if(!row?.isConnected||container.hidden)return;
      const host=row.querySelector('.sbm-items'), buttons=[...host.children],overflow=row.querySelector('.sbm-overflow'),actions=row.querySelector('.sbm-actions');
      buttons.forEach(b=>b.hidden=false);overflow.hidden=true;hiddenEntries=[];
      if(!buttons.length)return;
      const widths=buttons.map(b=>b.getBoundingClientRect().width),total=widths.reduce((a,b)=>a+b,0)+Math.max(0,buttons.length-1)*3;
      let available=Math.max(0,row.clientWidth-actions.getBoundingClientRect().width-24);
      if(total>available){overflow.hidden=false;available=Math.max(0,row.clientWidth-actions.getBoundingClientRect().width-24);let used=0,overflowed=false;buttons.forEach((b,i)=>{const needed=widths[i]+(i?3:0);if(overflowed||used+needed>available){b.hidden=true;hiddenEntries.push(entries[i]);overflowed=true;}else used+=needed;});}
      if(popup&&!popupAnchor?.isConnected)close(false);
    }
    function show(anchor, title, content, bind) {
      close(false);popupScope=scope();popupAnchor=anchor;
      popup=document.createElement('div');popup.className='sbm-popup';popup.setAttribute('role','menu');popup.setAttribute('aria-label',title);popup.innerHTML=content;
      document.body.append(popup);anchor?.setAttribute('aria-expanded','true');
      const r=anchor?.getBoundingClientRect()||{left:16,right:16,bottom:40,top:40},width=popup.getBoundingClientRect().width;
      popup.style.left=Math.max(8,Math.min(r.left,window.innerWidth-width-8))+'px';
      popup.style.top=(r.bottom+5)+'px';const height=popup.getBoundingClientRect().height;if(r.bottom+height+12>window.innerHeight)popup.style.top=Math.max(8,r.top-height-5)+'px';
      bind?.(popup,popupScope);
      popup.onkeydown=e=>{const list=[...popup.querySelectorAll('button:not(:disabled)')];let at=list.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();at=e.key==='Home'?0:e.key==='End'?list.length-1:(at+(e.key==='ArrowDown'?1:-1)+list.length)%list.length;list[at]?.focus();}else if(e.key==='Tab')close(false);};
      popup.querySelector('button:not(:disabled)')?.focus();return popup;
    }
    const menuButton=(action,label,symbol,extra='')=>`<button type="button" role="menuitem" data-sbm-menu="${action}" ${extra}>${icon(symbol)}<span>${esc(label)}</span></button>`;
    function bookmarkItems(list){return list.map(b=>`<button type="button" role="menuitem" data-sbm-bookmark="${esc(b.id)}" title="${esc(b.url)}${canNavigate()?'':' · Сначала возьмите управление браузером агента'}" ${canNavigate()?'':'disabled'}>${itemLabel(b)}</button>`).join('')||'<div class="sbm-popup-empty">В этой папке пока нет закладок</div>';}
    function bindLinks(el,original){el.querySelectorAll('[data-sbm-bookmark]').forEach(b=>{b.onclick=()=>goto(b.dataset.sbmBookmark,original);b.oncontextmenu=e=>{e.preventDefault();if(guard(original))bookmarkMenu(b.dataset.sbmBookmark,popupAnchor)}});}
    function folderMenu(name,anchor) {const original=scope();show(anchor,'Папка '+name,`<div class="sbm-popup-heading">${esc(name)}</div>${bookmarkItems(state().bookmarks.filter(b=>b.folder===name))}`,el=>bindLinks(el,original));}
    function overflowMenu(anchor) {const list=[...hiddenEntries];show(anchor,'Другие закладки',list.map((entry,i)=>entry.kind==='folder'?menuButton('folder-'+i,entry.name,'folder'):bookmarkItems([entry.bookmark])).join(''),(el,original)=>{bindLinks(el,original);el.querySelectorAll('[data-sbm-menu]').forEach(b=>b.onclick=()=>{if(!guard(original))return;folderMenu(list[+b.dataset.sbmMenu.slice(7)].name,anchor)});});}
    function openMenu(anchor) {
      show(anchor,'Панель закладок',menuButton('add','Добавить текущую страницу','add',validURL(api.currentTab()?.url)?'':'disabled')+menuButton('manage','Управлять закладками','manage')+'<div class="sbm-separator"></div>'+menuButton('toggle',state().settings.bookmarkBar===false?'Показать панель закладок':'Скрыть панель закладок','hide'),(el,original)=>{el.querySelectorAll('[data-sbm-menu]').forEach(b=>b.onclick=()=>{if(!guard(original))return;const action=b.dataset.sbmMenu;close(false);if(action==='add')edit();else if(action==='manage')manage();else toggle();});});
    }
    function bookmarkMenu(id,anchor) {
      const item=find(id);if(!item)return;
      show(anchor,item.title,`<div class="sbm-popup-heading">${esc(item.title)}</div>`+menuButton('edit','Изменить закладку','edit')+menuButton('remove','Удалить закладку','trash'),(el,original)=>{el.querySelector('[data-sbm-menu="edit"]').onclick=()=>{if(guard(original)){close(false);edit(find(id))}};el.querySelector('[data-sbm-menu="remove"]').onclick=()=>{if(!guard(original))return;state().bookmarks=state().bookmarks.filter(b=>String(b.id)!==String(id));close(false);persist();refresh();};});
    }
    function toggle(value) {close(false);const s=state();s.settings.bookmarkBar=typeof value==='boolean'?value:s.settings.bookmarkBar===false;persist();refresh();return s.settings.bookmarkBar;}
    function modal(title,body,bind) {
      close(false);closeDialog(false);dialogScope=scope();dialogReturn=document.activeElement;dialog=document.createElement('dialog');dialog.className='sbm-dialog';dialog.setAttribute('aria-label',title);dialog.innerHTML=`<header><h2>${esc(title)}</h2><button type="button" class="sbm-icon" data-sbm-close aria-label="Закрыть">${icon('close')}</button></header>${body}`;document.body.append(dialog);dialog.querySelector('[data-sbm-close]').onclick=()=>closeDialog();dialog.oncancel=e=>{e.preventDefault();closeDialog()};dialog.onclick=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}};dialog.showModal();bind?.(dialog,dialogScope);return dialog;
    }
    function edit(item,forceNew=false) {
      close(false);if(api.editBookmark){api.editBookmark(item);return;}
      const current=api.currentTab(),existing=item||(!forceNew&&state().bookmarks.find(b=>b.url===validURL(current?.url)));
      const seed=existing||{title:forceNew?'':current?.title||'',url:forceNew?'':current?.url||'',folder:'Рабочие'};let id=existing?.id;
      modal(existing?'Изменить закладку':'Добавить закладку',`<form><label>Название<input name="title" maxlength="120" required value="${esc(seed.title)}" autocomplete="off"></label><label>Адрес<input name="url" type="url" required value="${esc(seed.url)}" placeholder="https://" autocomplete="off"></label><label>Папка<input name="folder" maxlength="60" value="${esc(seed.folder||'Рабочие')}" list="sbm-folders-${instance}"><datalist id="sbm-folders-${instance}">${[...new Set(['Рабочие',...state().folders])].map(f=>`<option value="${esc(f)}">`).join('')}</datalist></label><p class="sbm-error" role="alert"></p><footer><button type="button" data-sbm-cancel>Отмена</button><button class="sbm-primary" type="submit">Сохранить</button></footer></form>`,(d,original)=>{
        d.querySelector('[data-sbm-cancel]').onclick=()=>closeDialog();d.querySelector('form').onsubmit=e=>{e.preventDefault();if(!guard(original))return;const form=e.currentTarget,title=form.elements.title.value.trim(),url=validURL(form.elements.url.value),folder=form.elements.folder.value.trim()||'Рабочие',error=d.querySelector('.sbm-error');if(!title||!url){error.textContent='Укажите название и HTTP/HTTPS-адрес без логина и пароля.';return;}const s=state();if(s.bookmarks.some(b=>b.url===url&&b.id!==id)){error.textContent='Этот адрес уже сохранён. Измените существующую закладку.';return;}if(id&&!find(id)){error.textContent='Эта закладка уже удалена. Закройте окно и добавьте её заново.';return;}const value={id:id||crypto.randomUUID(),title,url,folder};if(id)Object.assign(find(id),value);else s.bookmarks.push(value);id=value.id;if(!s.folders.includes(folder))s.folders.push(folder);const saved=persist();refresh();if(saved===false){error.textContent='Сохранено только на время текущего сеанса: хранилище недоступно.';return;}closeDialog();};d.querySelector('[name="title"]').focus();
      });
    }
    function manage() {
      close(false);if(api.manageBookmarks){api.manageBookmarks();return;}
      modal('Закладки',`<div class="sbm-manager-tools"><input type="search" aria-label="Поиск закладок" placeholder="Название или адрес"><button type="button" data-sbm-add>${icon('add')}Добавить</button></div><div class="sbm-manager-list"></div><p class="sbm-manager-hint">Сохранены отдельно в браузере агента. Папку можно задать при добавлении или изменении закладки.</p>`,(d,original)=>{
        const list=d.querySelector('.sbm-manager-list'),search=d.querySelector('input');
        function renderList(){if(!guard(original))return;const term=search.value.toLowerCase(),items=state().bookmarks.filter(b=>`${b.title} ${b.url} ${b.folder}`.toLowerCase().includes(term));list.innerHTML=items.map(b=>`<div class="sbm-manager-row"><button type="button" class="sbm-manager-link" data-sbm-open="${esc(b.id)}" ${canNavigate()?'':'disabled'} title="${canNavigate()?esc(b.url):'Сначала возьмите управление браузером агента'}"><b>${esc(b.title)}</b><small>${esc(b.url)}</small></button><span class="sbm-folder-label">${esc(b.folder||'Рабочие')}</span><button type="button" class="sbm-icon" data-sbm-edit="${esc(b.id)}" title="Изменить" aria-label="Изменить закладку ${esc(b.title)}">${icon('edit')}</button><button type="button" class="sbm-icon" data-sbm-remove="${esc(b.id)}" title="Удалить" aria-label="Удалить закладку ${esc(b.title)}">${icon('trash')}</button></div>`).join('')||'<div class="sbm-manager-empty">'+(state().bookmarks.length?'Ничего не найдено':'Пока нет закладок. Добавьте текущую страницу или укажите адрес.')+'</div>';list.querySelectorAll('[data-sbm-open]').forEach(b=>b.onclick=()=>goto(b.dataset.sbmOpen,original));list.querySelectorAll('[data-sbm-edit]').forEach(b=>b.onclick=()=>{if(guard(original))edit(find(b.dataset.sbmEdit))});list.querySelectorAll('[data-sbm-remove]').forEach(b=>b.onclick=()=>{if(!guard(original))return;const at=state().bookmarks.findIndex(x=>String(x.id)===b.dataset.sbmRemove);if(at>=0)state().bookmarks.splice(at,1);persist();refresh();renderList();list.querySelector('[data-sbm-remove]')?.focus();});}
        search.oninput=renderList;d.querySelector('[data-sbm-add]').onclick=()=>{if(guard(original))edit(undefined,true)};renderList();search.focus();
      });
    }
    const onOutside=e=>{if(popup&&!popup.contains(e.target)&&!popupAnchor?.contains(e.target))close(false);};
    const onScope=()=>{close(false);if(dialog&&dialogScope!==scope())closeDialog(false);};
    const onScroll=e=>{if(popup&&!popup.contains(e.target))close(false);};
    document.addEventListener('pointerdown',onOutside,true);document.addEventListener('suite:scope-change',onScope);window.addEventListener('resize',()=>close(false));document.addEventListener('scroll',onScroll,true);
    const apiPublic={mount,refresh,close,toggle,openMenu,editBookmark:edit,manageBookmarks:manage};return apiPublic;
  }
  window.SuiteBookmarkBar={create};
})();
