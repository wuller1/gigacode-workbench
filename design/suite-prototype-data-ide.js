/* Review-only Data / IDE interaction model. No database, file system or language server access. */
(() => {
  'use strict';
  const dataPanel = document.querySelector('[data-panel="data"]');
  const codePanel = document.querySelector('[data-panel="code"]');
  if (!dataPanel || !codePanel || document.getElementById('di-styles')) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ownIcons = {download:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',upload:'<path d="M12 15V3m-4 4 4-4 4 4M4 15v5h16v-5"/>',trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',extensions:'<path d="M3 3h7v7H3zM3 14h7v7H3zM14 14h7v7h-7zM15 2l7 3-3 7-7-3Z"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',bug:'<rect x="8" y="7" width="8" height="12" rx="4"/><path d="m9 4 3 3 3-3M4 10h4m8 0h4M4 15h4m8 0h4M7 21l2-3m6 0 2 3M12 8v10"/>',panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1M5.5 11h1M5.5 14h1"/>'};
  const icon = name => ownIcons[name] ? `<svg class="icon sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ownIcons[name]}</svg>` : `<svg class="icon sm" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const button = (action, label, extra = '') => { let classes='di-button'; extra=extra.replace(/\bclass="([^"]*)"/,(_,value)=>{classes=value;return '';}); return `<button type="button" class="${classes}" data-di="${action}" ${extra}>${label}</button>`; };
  const style = document.createElement('style'); style.id = 'di-styles';
  style.textContent = `
  .di-studio{container-type:inline-size;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:var(--bg);font-size:12px;line-height:1.5}
  .di-studio *{box-sizing:border-box}.di-studio button,.di-dialog button{cursor:pointer}.di-studio button:disabled,.di-dialog button:disabled{cursor:not-allowed;opacity:.45}
  .di-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 9px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--muted);font:inherit;white-space:nowrap}
  .di-button:hover,.di-button[aria-pressed=true]{background:var(--hover);color:var(--text)}.di-button.primary{background:var(--mint);color:var(--on-accent);font-weight:600}.di-button.outline{border-color:var(--line)}
  .di-icon{width:30px;padding:5px;flex-shrink:0}.di-bar{display:flex;align-items:center;gap:5px;min-height:41px;padding:5px 10px;border-bottom:1px solid var(--line);flex-shrink:0;flex-wrap:wrap}.di-bar strong{font-weight:580}.di-spacer{flex:1}.di-caption{font-size:11px;color:var(--muted)}.di-demo{color:var(--muted);font-size:10px;letter-spacing:.03em;padding:2px 6px;border:1px solid var(--line);border-radius:4px;white-space:nowrap}
  .di-studio select,.di-studio input,.di-dialog select,.di-dialog input,.di-dialog textarea{background:var(--panel);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:6px 8px;min-width:0;font:inherit}.di-studio select{max-width:210px}.di-body{display:flex;flex:1;min-height:0;position:relative}.di-explorer{width:190px;flex-shrink:0;overflow:auto;background:var(--panel);border-right:1px solid var(--line);padding:10px 8px}.di-explorer[hidden]{display:none}.di-explorer input{width:100%;margin-bottom:12px}.di-explorer details{margin-bottom:8px}.di-explorer summary{padding:6px;color:var(--muted);cursor:pointer}.di-tree{display:flex;width:100%;align-items:center;gap:7px;text-align:left;background:transparent;padding:6px 9px 6px 16px;border-radius:5px;color:var(--muted);font:inherit;overflow:hidden}.di-tree:hover,.di-tree[aria-current=true]{background:var(--hover);color:var(--text)}.di-tree span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.di-tree small{font-size:10px;color:var(--faint);margin-left:auto}.di-main{display:flex;flex-direction:column;min-width:0;min-height:0;flex:1}.di-tabbar{display:flex;gap:2px;overflow:auto;border-bottom:1px solid var(--line);padding:5px 6px 0;background:var(--chrome);flex-shrink:0}.di-tabwrap{display:flex;align-items:center;border-radius:7px 7px 0 0;background:transparent;color:var(--muted);flex-shrink:0}.di-tabwrap.active{background:var(--bg);color:var(--text)}.di-tabwrap>button{background:transparent;color:inherit;border:0;height:32px;padding:5px 9px;font:inherit}.di-tabwrap>button:last-child{padding:4px;width:24px}.di-tabwrap>button:hover{background:var(--hover)}
  .di-editor{display:flex;min-height:125px;max-height:260px;height:175px;border-bottom:1px solid var(--line);flex-shrink:0}.di-gutter{width:37px;padding:10px 8px;text-align:right;color:var(--faint);font:12px/1.65 var(--mono);overflow:hidden;background:var(--bg);white-space:pre;user-select:none}.di-editor textarea{resize:none;flex:1;width:0;border:0;outline:none;background:var(--bg);color:var(--text);font:12px/1.65 var(--mono);padding:10px 12px 12px 2px;tab-size:2;white-space:pre;overflow:auto}.di-editor:focus-within{box-shadow:inset 0 0 0 1px var(--line2)}.di-notice{display:flex;align-items:flex-start;gap:8px;padding:4px 8px;border-bottom:1px solid var(--line);font-size:11px;color:var(--muted);background:var(--panel2);flex-shrink:0}.di-notice:empty,.di-notice[hidden]{display:none}.di-notice-message{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;padding:4px 2px}.di-notice .di-button{width:26px;min-height:26px;padding:4px;flex:none}.di-notice.error{color:var(--red)}
  .di-results{flex:1;min-height:100px;overflow:auto}.di-grid{border-collapse:collapse;width:100%;font:11px/1.5 var(--mono)}.di-grid th,.di-grid td{padding:7px 10px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);white-space:nowrap;text-align:left;font-weight:400}.di-grid th{position:sticky;top:0;background:var(--panel2);color:var(--muted);z-index:1}.di-grid th button{font:inherit;background:transparent;color:inherit;padding:0}.di-grid td{color:var(--text)}.di-grid td.edited{background:var(--mintbg)}.di-grid td button{color:inherit;font:inherit;background:transparent;text-align:left;min-width:45px;padding:0}.di-grid input{width:120px;padding:3px}.di-grid .null{font-style:italic;color:var(--faint)}.di-empty{padding:26px 20px;color:var(--muted);line-height:1.7;text-align:center}.di-empty b{display:block;color:var(--text);font-size:14px;font-weight:550;margin-bottom:6px}.di-content{padding:16px;overflow:auto;flex:1;min-height:0}.di-content h3{font-size:14px;font-weight:560;margin:0 0 12px}.di-subnav{display:flex;gap:2px;overflow:auto;padding:3px 8px;border-bottom:1px solid var(--line);flex-shrink:0}.di-subnav .active{color:var(--text);background:var(--hover);border-radius:6px}.di-actions{display:flex;gap:5px;flex-wrap:wrap}.di-card{padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);margin-bottom:10px}.di-card b{font-weight:550}.di-card p{color:var(--muted);font-size:12px;line-height:1.6;margin:6px 0}.di-mono{font:11px/1.7 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}.di-treeplan{padding:10px 13px;margin:9px 0;border-left:2px solid var(--mint);background:var(--panel)}.di-treeplan.indent{margin-left:20px}.di-txn{color:var(--amber);font-size:11px}.di-card-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.di-success{color:var(--green)}.di-error{color:var(--red)}
  .di-dialog{width:min(610px,calc(100vw - 32px));max-height:calc(100vh - 40px);padding:0;border:1px solid var(--line2);border-radius:14px;background:var(--panel);color:var(--text);box-shadow:var(--shadow);font:13px/1.6 var(--ui);overflow:auto}.di-dialog::backdrop{background:#0007;backdrop-filter:blur(2px)}.di-dialog header{display:flex;align-items:center;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line)}.di-dialog h2{font-size:17px;font-weight:580;margin:0;flex:1}.di-dialog main{padding:18px 20px}.di-dialog footer{display:flex;justify-content:flex-end;gap:8px;padding:13px 20px;border-top:1px solid var(--line);flex-wrap:wrap}.di-dialog label{display:grid;gap:6px;margin:0 0 14px}.di-dialog label.di-check{display:flex;align-items:center;gap:8px}.di-dialog .di-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}.di-dialog textarea{width:100%;min-height:180px;font:12px/1.7 var(--mono);resize:vertical}.di-dialog p{color:var(--muted);font-size:12px}.di-dialog table{width:100%}.di-dialog progress{width:100%;accent-color:var(--mint);height:9px}.di-step{color:var(--muted);font-size:11px;margin-bottom:15px}.di-selected{border-color:var(--mint)!important;background:var(--mintbg)!important}.di-code-editor{flex:1;min-height:150px;display:flex}.di-code-editor .di-editor{height:100%;max-height:none;flex:1}.di-bottom{height:180px;min-height:110px;max-height:40%;display:flex;flex-direction:column;border-top:1px solid var(--line)}.di-bottom .di-content{padding:10px 13px}.di-diagnostic{display:flex;gap:9px;text-align:left;width:100%;padding:9px;background:transparent;border-bottom:1px solid var(--line);color:var(--muted);font:inherit}.di-diagnostic:hover{background:var(--hover)}.di-debug-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.di-code-status{max-width:100%;overflow:hidden;text-overflow:ellipsis}.di-breakpoint{color:var(--red)}.di-bp-button{display:block;width:24px;height:20px;padding:0;color:var(--faint);background:transparent;font:inherit;line-height:20px}.di-bp-button.on{color:var(--red)}
  .di-schema-tools{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:6px}.di-schema-tools strong{font-size:11px;font-weight:560}.di-schema-tools .di-button{font-size:10px;padding:3px 5px;min-height:28px}.di-schema-tools .icon{width:13px;height:13px}.di-schema-entry>summary{font-family:var(--mono);font-size:11px;color:var(--text)}.di-schema-entry>details{margin-left:7px}.di-schema-entry>p{padding:0 7px}.di-schema-picker-list{max-height:280px;overflow:auto;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:10px;padding:5px 0}.di-dialog label.di-schema-choice{display:flex;align-items:center;gap:10px;min-height:39px;margin:0;padding:6px 8px;border-radius:5px;cursor:pointer}.di-schema-choice:hover{background:var(--hover)}.di-schema-choice input{width:15px;height:15px;accent-color:var(--mint);flex:none}.di-schema-choice span{font-family:var(--mono);font-size:12px;overflow-wrap:anywhere}.di-schema-choice small{margin-left:auto;font-size:10px;color:var(--muted)}
  .di-studio textarea::-webkit-scrollbar-corner,.di-dialog textarea::-webkit-scrollbar-corner{background:var(--bg)}
  .di-service-capabilities{display:grid;grid-template-columns:1fr 1fr;gap:7px}.di-service-capabilities span{padding:7px 9px;border:1px solid var(--line);border-radius:6px;font-size:12px}.di-change-tabs{display:flex;gap:4px;overflow:auto;margin:12px 0}.di-change-tabs button{flex-shrink:0}.di-before-after{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:9px}.di-before-after section{min-width:0;border:1px solid var(--line);border-radius:7px;overflow:hidden}.di-before-after h3{font-size:12px;font-weight:550;padding:8px 10px;margin:0;border-bottom:1px solid var(--line);background:var(--panel2)}.di-before-after pre{margin:0;max-height:310px;overflow:auto;padding:10px;font:11px/1.65 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}.di-line-removed{background:color-mix(in srgb,var(--red) 11%,transparent);color:var(--text)}.di-line-added{background:var(--mintbg);color:var(--text)}.di-timeline{display:flex;gap:4px;align-items:end;height:96px;border-bottom:1px solid var(--line);padding:8px 0}.di-timeline button{flex:1;min-width:0;height:var(--sample-height);min-height:20px;border:1px solid var(--line2);border-radius:4px 4px 0 0;background:var(--hover);color:var(--text);font-size:10px}.di-timeline button[aria-pressed=true]{background:var(--mint);color:var(--on-accent);border-color:var(--mint)}.di-flame-row{display:flex;gap:3px;margin:3px 0;min-height:28px}.di-flame-row button{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;padding:4px 7px;border:1px solid var(--line);border-radius:4px;background:var(--mintbg);color:var(--text);font:11px var(--mono)}.di-flame-row button[aria-pressed=true]{border-color:var(--mint);background:var(--hover)}.di-profiler-hotspot{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:9px;border-bottom:1px solid var(--line);background:transparent;color:var(--text);font:inherit}.di-profiler-hotspot[aria-pressed=true]{background:var(--hover)}.di-profiler-hotspot span:first-child{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis}.di-profiler-hotspot small{color:var(--muted)}
  @media(max-width:600px){.di-before-after{grid-template-columns:1fr}.di-service-capabilities{grid-template-columns:1fr}.di-before-after pre{max-height:190px}}
  @container(max-width:650px){#di-ide [data-di="ide-agent"]{display:none}#di-data .di-explorer{position:absolute;z-index:5;top:0;bottom:0;left:0;width:220px;box-shadow:6px 0 18px #0003}#di-ide .di-explorer{width:150px}.di-studio .di-long{display:none}.di-bar{padding-left:7px;padding-right:7px}.di-studio select{max-width:165px}.di-button{padding:5px 7px}.di-editor{height:155px}.di-demo{font-size:9px}.di-content{padding:12px}}
  @container(max-width:430px){#di-ide .di-explorer{width:124px;padding:8px 4px}.di-tree{padding-left:8px}.di-studio select{max-width:145px}}
  @media(max-width:600px){.di-dialog .di-columns,.di-debug-grid{grid-template-columns:1fr}.di-dialog header,.di-dialog main,.di-dialog footer{padding:14px}.di-dialog{max-height:calc(100vh - 20px)}}
  `;
  document.head.append(style);
  const dialog = document.createElement('dialog'); dialog.className = 'di-dialog'; dialog.id = 'di-dialog';
  document.body.append(dialog);
  let dialogCleanup = null;
  dialog.addEventListener('close', () => { if (dialogCleanup) dialogCleanup(); dialogCleanup = null; });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  function openDialog(title, content, actions = '', onAction = null) {
    if (dialog.open) dialog.close();
    delete dialog.dataset.diView;
    dialog.innerHTML = `<header><h2 id="di-dialog-title">${esc(title)}</h2>${button('dismiss', icon('x'), 'class="di-button di-icon" aria-label="Закрыть"')}</header><main>${content}</main><footer>${button('dismiss','Отмена')}${actions}</footer>`;
    dialog.setAttribute('aria-labelledby','di-dialog-title');
    dialog.onclick = event => {
      const action = event.target.closest('[data-di]');
      if (!action) return;
      if (action.dataset.di === 'dismiss') dialog.close();
      else if (onAction) onAction(action.dataset.di, action, event);
    };
    dialog.showModal();
  }
  function replacePanel(panel) {
    [...panel.children].forEach(child => { if (!child.classList.contains('panel-drag-hint')) child.remove(); });
    const node = document.createElement('section'); node.className = 'di-studio'; panel.append(node); return node;
  }
  const dataRoot = replacePanel(dataPanel); dataRoot.id = 'di-data'; dataRoot.setAttribute('aria-label','Рабочая область PostgreSQL');
  const ideRoot = replacePanel(codePanel); ideRoot.id = 'di-ide'; ideRoot.setAttribute('aria-label','Редактор проекта');
  let ideGitController = null, languageWorkbench = null, explorerWorkbench = null, extensionWorkbench = null;
  function refreshGitMount(){
    explorerWorkbench?.refreshGit?.();
    if(!ideGitController)return;
    const bar=ideRoot.querySelector(':scope > .di-bar, :scope > .sw-toolbar-row > .di-bar'),body=ideRoot.querySelector(':scope > .di-body');
    if(!bar||!body)return;
    let modes=bar.querySelector('.di-git-modes');
    if(!modes){
      modes=document.createElement('div');modes.className='di-git-modes';modes.setAttribute('aria-label','Режим IDE');
      modes.innerHTML='<button type="button" data-ide-mode="editor">Редактор</button><button type="button" data-ide-mode="git">Git</button>';
      bar.querySelector('strong')?.replaceWith(modes);
      modes.querySelector('[data-ide-mode="editor"]').onclick=()=>ideGitController.close();
      modes.querySelector('[data-ide-mode="git"]').onclick=()=>ideGitController.open();
    }
    let mount=ideRoot.querySelector('#igIDEHost');
    if(!mount){mount=document.createElement('div');mount.id='igIDEHost';body.after(mount);}
    const visible=ideGitController.isOpen();body.hidden=visible;mount.hidden=!visible;
    modes.querySelectorAll('button').forEach(n=>n.setAttribute('aria-pressed',String((n.dataset.ideMode==='git')===visible)));
    bar.querySelectorAll('[data-di="file-tree"],[data-di="ide-search"]').forEach(n=>n.hidden=visible);
    if(visible)ideGitController.render(mount);
  }
  function editorFocus(root,buffer){
    const active=root.querySelector(root.id==='di-data'?'#di-sql':'#di-code-input');if(!active||root.dataset.buffer!==String(buffer))return ()=>{root.dataset.buffer=String(buffer);};
    const state={id:active.id,start:active.selectionStart,end:active.selectionEnd,top:active.scrollTop,left:active.scrollLeft,focused:document.activeElement===active};
    return ()=>{root.dataset.buffer=String(buffer);const field=root.querySelector('#'+state.id);if(field){if(state.focused)field.focus({preventScroll:true});field.setSelectionRange(state.start,state.end);field.scrollTop=state.top;field.scrollLeft=state.left;}};
  }
  function sendToAgent(text, announce) {
    if (window.SuitePrototype?.ask) { window.SuitePrototype.ask(text); announce('Контекст добавлен в выбранный разговор.'); return; }
    const field = document.querySelector('.composer textarea');
    if (field) { field.value = [field.value.trim(),text].filter(Boolean).join('\n\n'); field.dispatchEvent(new Event('input',{bubbles:true})); announce('Контекст добавлен в черновик выбранного разговора. Отправка — из чата.'); }
    else announce('В этой версии макета поле разговора недоступно.');
  }

  /* DATA — state is deliberately local; SQL is never executed. */
  const initialRows = [
    {id:101,order_id:'ord_91c2',attempt:2,status_code:200,response_kind:'json'},
    {id:102,order_id:'ord_91c2',attempt:1,status_code:429,response_kind:'html'},
    {id:103,order_id:'ord_8e31',attempt:1,status_code:200,response_kind:'json'},
    {id:104,order_id:'ord_4a88',attempt:3,status_code:200,response_kind:'json'},
    {id:105,order_id:'ord_4a88',attempt:2,status_code:413,response_kind:'html'}
  ];
  const clone = object => JSON.parse(JSON.stringify(object));
  const schemaFixtures={
    checkout_retry:{rows:initialRows,columns:[['id','bigint','NOT NULL','identity · PK'],['order_id','varchar(40)','NOT NULL','FK → orders.order_key'],['attempt','integer','NOT NULL','1'],['status_code','integer','NULL','NULL'],['response_kind','text','NULL','NULL']]},
    orders:{rows:[{id:201,order_key:'ord_91c2',customer_id:301,amount:'1250.00',currency:'RUB',status:'paid'},{id:202,order_key:'ord_8e31',customer_id:302,amount:'890.50',currency:'RUB',status:'pending'}],columns:[['id','bigint','NOT NULL','identity · PK'],['order_key','varchar(40)','NOT NULL','UNIQUE'],['customer_id','bigint','NOT NULL','FK → customers.id'],['amount','numeric(18,2)','NOT NULL','0'],['currency','varchar(3)','NOT NULL',"'RUB'"],['status','text','NOT NULL',"'pending'"]]},
    customers:{rows:[{id:301,name:'Atlas demo',email:'atlas@example.invalid',region:'Москва'},{id:302,name:'Nova demo',email:'nova@example.invalid',region:'Владивосток'}],columns:[['id','bigint','NOT NULL','identity · PK'],['name','text','NOT NULL','—'],['email','text','NULL','NULL'],['region','text','NULL','NULL']]},
    retry_summary:{rows:[{id:1,status_code:200,attempts:3},{id:2,status_code:429,attempts:1},{id:3,status_code:413,attempts:1}],columns:[['id','bigint','—','—'],['status_code','integer','—','—'],['attempts','bigint','—','count(*)']]},
    orders_id_seq:{rows:[{id:1,last_value:203,increment_by:1,cache_size:1}],columns:[['last_value','bigint','NOT NULL','203'],['increment_by','bigint','NOT NULL','1'],['cache_size','bigint','NOT NULL','1']]}
  };
  let data = {
    connection:'payments-dev',connectionMeta:null,catalogAvailable:true, explorer:true, explorerWidth:210, editorHeight:174, object:'checkout_retry', section:'results',
    tabs:[{id:1,kind:'console',title:'Retries.sql',sql:'SELECT id, order_id, attempt, status_code, response_kind\nFROM public.checkout_retry\nORDER BY id\nLIMIT 100;',dirty:false}], active:1,next:2,
    rows:clone(initialRows),committed:clone(initialRows),pending:{},transaction:false,transactionDirty:false,queryFilter:'',schemaFilter:'',sort:'id',asc:true,
    running:false,status:'',error:false,history:[],jobs:[],queryToken:0,previewRows:5,page:1,pageSize:50,queryParams:{},large:false,readOnly:false,tableRows:{checkout_retry:clone(initialRows)},tableCommitted:{checkout_retry:clone(initialRows)},diagramZoom:100,connectionSnapshots:{}
  };
  const dbObjects = {Таблицы:['checkout_retry','orders','customers'],Представления:['retry_summary'],Процедуры:['reconcile_payments'],Функции:['retry_delay'],Последовательности:['orders_id_seq']};
  const schemaVisibility=window.SuiteSchemaFilter?.create();
  // Catalog names are fixtures until the connection's MCP catalog is available.
  function databaseSchemas(){return data.catalogAvailable?[{name:'public',system:false},{name:'audit',system:false},{name:'reporting',system:false},{name:'information_schema',system:true},{name:'pg_catalog',system:true}]:[];}
  function visibleSchemaNames(){const catalog=databaseSchemas();return schemaVisibility?.get(data.connection,catalog)||catalog.filter(s=>!s.system).map(s=>s.name);}
  function schemaFilterControl(){const total=databaseSchemas().length,selected=visibleSchemaNames().length;return `<div class="di-schema-tools"><strong>Схемы</strong>${button('schema-visibility',`${selected} / ${total} ${icon('settings')}`,`aria-label="Выбрать видимые схемы" title="Выбрать видимые схемы" ${total?'':'disabled'}`)}</div>`;}
  function selectVisibleSchemas(){
    const owner=data,connection=data.connection,catalog=databaseSchemas(),draft=new Set(visibleSchemaNames());
    if(!catalog.length){dataNotice('Сначала загрузите каталог схем выбранного подключения.');return;}
    openDialog('Видимые схемы',`<p>${esc(dbTarget())}</p><label>Найти схему<input id="di-schema-picker-search" type="search" placeholder="Название схемы" autocomplete="off"></label><div class="di-actions">${button('schema-select-found','Выбрать найденные')}${button('schema-clear-found','Снять выбор')}</div><div id="di-schema-picker-list" class="di-schema-picker-list"></div><p id="di-schema-picker-count" role="status"></p><p class="di-caption">Фильтр меняет только дерево объектов. SQL, открытые консоли и задания сохраняются. Выбор запоминается для этого подключения. Список схем в макете демонстрационный.</p>`,button('schema-apply','Применить','class="di-button primary"'),action=>{
      if(action==='schema-select-found'||action==='schema-clear-found'){
        matching().forEach(item=>action==='schema-select-found'?draft.add(item.name):draft.delete(item.name));draw();return;
      }
      if(action!=='schema-apply')return;
      if(data!==owner||data.connection!==connection){dialog.querySelector('#di-schema-picker-count').textContent='Подключение изменилось. Откройте выбор схем заново.';return;}
      schemaVisibility?.set(connection,[...draft],catalog);dialog.close();renderData();
      dataRoot.querySelector('[data-di="schema-visibility"]')?.focus();
    });
    const search=dialog.querySelector('#di-schema-picker-search'),list=dialog.querySelector('#di-schema-picker-list');
    const matching=()=>catalog.filter(item=>item.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()));
    const draw=()=>{const items=matching();list.innerHTML=items.map(item=>`<label class="di-schema-choice"><input type="checkbox" data-schema-name="${esc(item.name)}" ${draft.has(item.name)?'checked':''}><span>${esc(item.name)}</span>${item.system?'<small>Системная</small>':''}</label>`).join('')||'<p class="di-caption">Схемы не найдены. Измените поиск.</p>';dialog.querySelector('#di-schema-picker-count').textContent='Выбрано '+draft.size+' из '+catalog.length;};
    search.oninput=draw;list.onchange=event=>{const name=event.target.dataset.schemaName;if(!name||!catalog.some(item=>item.name===name))return;event.target.checked?draft.add(name):draft.delete(name);dialog.querySelector('#di-schema-picker-count').textContent='Выбрано '+draft.size+' из '+catalog.length;};
    draw();search.focus();
  }
  const currentQuery = () => data.tabs.find(tab => tab.id === data.active);
  // Each document owns a pinned target, transaction, drafts, query lifecycle and result.
  // Accessors retain the existing Data actions without sharing mutable state across tabs.
  const documentStateKeys = ['connection','connectionMeta','catalogAvailable','object','section','rows','committed','pending','transaction','transactionDirty','queryFilter','sort','asc','running','status','error','history','queryToken','previewRows','page','pageSize','queryParams','queryParamTypes','large','readOnly','tableRows','tableCommitted','diagramZoom','connectionSnapshots','executionMode','plan','hiddenColumns','selectedRows','limits','addedRows','deletedRows','resultSnapshot','lastAttemptSQL','cellEdit','activeCell'];
  function installDocumentState(workspace){
    const first=workspace.tabs.find(tab=>tab.id===workspace.active)||workspace.tabs[0];
    if(first){
      if(!first.state){first.state={};documentStateKeys.forEach(key=>{if(workspace[key]!==undefined)first.state[key]=workspace[key]});}
      first.kind ||= 'console';
      for(const tab of workspace.tabs){
        tab.kind ||= 'console';tab.state ||= freshDocumentState(first.state);
        tab.state.queryParamTypes ||= {};tab.state.executionMode ||= 'current';tab.state.hiddenColumns ||= [];tab.state.selectedRows ||= [];tab.state.addedRows ||= [];tab.state.deletedRows ||= [];tab.state.limits ||= {rows:1000,timeout:30};
      }
      workspace.emptyState ||= freshDocumentState(first.state);
    }else{
      workspace.active=null;workspace.emptyState ||= freshDocumentState({connection:workspace.connection||'',connectionMeta:workspace.connectionMeta||null,catalogAvailable:Boolean(workspace.catalogAvailable)});
    }
    documentStateKeys.forEach(key=>Object.defineProperty(workspace,key,{configurable:true,enumerable:false,get(){return (workspace.tabs.find(tab=>tab.id===workspace.active)?.state||workspace.emptyState)[key]},set(value){(workspace.tabs.find(tab=>tab.id===workspace.active)?.state||workspace.emptyState)[key]=value}}));
    return workspace;
  }
  const currentDocumentState=()=>currentQuery()?.state||data.emptyState;
  function freshDocumentState(source){
    return {connection:source.connection,connectionMeta:clone(source.connectionMeta),catalogAvailable:source.catalogAvailable,object:'',section:'results',rows:[],committed:[],pending:{},transaction:false,transactionDirty:false,queryFilter:'',sort:'id',asc:true,running:false,status:'',error:false,history:[],queryToken:0,previewRows:0,page:1,pageSize:50,queryParams:{},queryParamTypes:{},large:false,readOnly:true,tableRows:{},tableCommitted:{},diagramZoom:100,connectionSnapshots:{},executionMode:'current',plan:null,hiddenColumns:[],selectedRows:[],addedRows:[],deletedRows:[],limits:{rows:1000,timeout:30}};
  }
  function captureDataEditor(){
    const field=dataRoot.querySelector('#di-sql');if(field&&currentQuery())currentQuery().editorView={start:field.selectionStart,end:field.selectionEnd,top:field.scrollTop,left:field.scrollLeft};
  }
  function activateDataDocument(id){captureDataEditor();if(data.tabs.some(tab=>tab.id===id)){data.active=id;renderData();}}
  function openDatabaseObject(name,group){
    if(!data.catalogAvailable)return;
    const identity=JSON.stringify([data.connection,data.connectionMeta?.address,data.connectionMeta?.env,data.connectionMeta?.namespace||'',name,group]),existing=data.tabs.find(tab=>tab.objectKey===identity);
    if(existing){activateDataDocument(existing.id);return;}
    captureDataEditor();const state=freshDocumentState(currentDocumentState()),routine=group==='Процедуры'||group==='Функции';
    state.object=name;state.section=routine?'dependencies':group==='Последовательности'?'structure':'results';state.status='';state.readOnly=group!=='Таблицы';
    state.rows=clone(schemaFixtures[name]?.rows||[]);state.committed=clone(state.rows);
    const id=data.next++,sql=routine?routineDefinition(name):'';
    data.tabs.push({id,title:name,kind:routine?'routine':'table',group,objectKey:identity,sql,originalSQL:sql,dirty:false,state});data.active=id;renderData();
  }
  function routineDefinition(name){return name==='retry_delay'?`CREATE OR REPLACE FUNCTION public.${name}(attempt integer)\nRETURNS integer LANGUAGE sql IMMUTABLE\nAS $body$\n  SELECT LEAST(30000, 250 * power(2, GREATEST(attempt - 1, 0)))::integer;\n$body$;`:`CREATE OR REPLACE PROCEDURE public.${name}(p_order_key text)\nLANGUAGE plpgsql\nAS $body$\nBEGIN\n  UPDATE public.orders\n  SET status = 'reconciled'\n  WHERE order_key = p_order_key;\nEND;\n$body$;`;}
  function documentDirty(tab){return Boolean(tab.state.cellEdit)||tab.dirty||Object.keys(tab.state.pending).length>0||tab.state.addedRows.length>0||tab.state.deletedRows.length>0||tab.state.transactionDirty;}
  function closeDataDocument(id){
    const tab=data.tabs.find(item=>item.id===id);if(!tab)return;
    if(tab.state.running){dataNotice('Этот запрос ещё выполняется. Остановите его во вкладке перед закрытием.',true);return;}
    const finish=()=>{const index=data.tabs.indexOf(tab);data.tabs.splice(index,1);if(!data.tabs.length){data.emptyState=freshDocumentState(tab.state);data.emptyState.object='';data.emptyState.status='';data.active=null;}else if(data.active===id)data.active=data.tabs[Math.min(index,data.tabs.length-1)].id;renderData();};
    if(documentDirty(tab))openDialog('Закрыть документ?',`<p>${esc(tab.title)} содержит ${tab.state.transactionDirty?'незавершённую транзакцию':Object.keys(tab.state.pending).length?'неприменённые правки':'изменённый SQL'}. Содержимое других вкладок сохранится.</p><p>В макете закрытие удалит только его локальный черновик и откатит его учебную транзакцию.</p>`,button('discard-document','Отменить изменения и закрыть','class="di-button outline"'),action=>{if(action==='discard-document'){dialog.close();finish();}});else finish();
  }
  function databaseDDL(name){
    const fixture=schemaFixtures[name];if(!fixture)return '-- Определение не загружено';
    if(name==='retry_summary')return 'CREATE VIEW public.retry_summary AS\nSELECT status_code, count(*) AS attempts\nFROM public.checkout_retry\nGROUP BY status_code;';
    if(name==='orders_id_seq')return 'CREATE SEQUENCE public.orders_id_seq AS bigint\nSTART WITH 203 INCREMENT BY 1 CACHE 1;';
    const columns=fixture.columns.map(([column,type,nullable,extra])=>'  '+column+' '+type+(extra.includes('identity')?' GENERATED ALWAYS AS IDENTITY':nullable==='NOT NULL'?' NOT NULL':'')+(column==='id'?' PRIMARY KEY':''));
    if(name==='checkout_retry')columns.push('  FOREIGN KEY (order_id) REFERENCES public.orders(order_key)','  CHECK (attempt > 0)');
    if(name==='orders')columns.push('  UNIQUE (order_key)','  FOREIGN KEY (customer_id) REFERENCES public.customers(id)');
    return `CREATE TABLE public.${name} (\n${columns.join(',\n')}\n);`;
  }
  function databaseSeparator(kind){const vertical=kind==='explorer',value=vertical?(data.explorerWidth||210):(data.editorHeight||174);return `<div class="d2-separator d2-${kind}-separator" role="separator" tabindex="0" aria-label="${vertical?'Ширина дерева объектов':'Высота SQL редактора'}" aria-orientation="${vertical?'vertical':'horizontal'}" aria-valuemin="${vertical?150:90}" aria-valuemax="${vertical?360:500}" aria-valuenow="${value}" data-d2-resize="${kind}" title="Перетащите для изменения размера · стрелки с клавиатуры"></div>`;}
  function registeredDBs(){const records=window.SuitePrototype?.connections?.('PostgreSQL');return Array.isArray(records)?records:[{id:'payments-dev',name:'payments',env:'ДЕВ',address:'demo://payments-dev'},{id:'payments-ift',name:'payments',env:'ИФТ',address:'demo://payments-ift'}];}
  function dbBinding(){const current=registeredDBs().find(item=>item.id===data.connection),captured=data.connectionMeta;return {current,missing:!current,changed:Boolean(current&&captured&&(current.address!==captured.address||current.env!==captured.env||(current.namespace||'')!==(captured.namespace||'')))};}
  const dbTarget = () => data.connectionMeta?`${data.connectionMeta.env} · ${data.connectionMeta.name} · ${data.connectionMeta.namespace||'public'}`:'Нет выбранного подключения';
  function dbOptions(){const records=registeredDBs(),available=records.some(record=>record.id===data.connection);return `${available?'':`<option value="${esc(data.connection)}" selected disabled>${esc(data.connectionMeta?data.connectionMeta.name+' · отвязано':'Нет подключений')}</option>`}${records.map(record=>`<option value="${esc(record.id)}" ${record.id===data.connection?'selected':''}>${esc(record.env+' · '+record.name)}</option>`).join('')}`;}
  function chooseInitialDB(){const records=registeredDBs(),target=records.find(record=>record.env==='ДЕВ')||records[0];data.connection=target?.id||'';data.connectionMeta=target?clone(target):null;data.catalogAvailable=Boolean(target&&(['payments-dev','payments-ift','connection-4','connection-5'].includes(target.id))&&(/example\.invalid/.test(target.address)||String(target.address).startsWith('demo:')));data.object=data.catalogAvailable?'checkout_retry':'';data.rows=data.catalogAvailable?clone(initialRows):[];data.committed=clone(data.rows);data.readOnly=true;data.tableRows={};data.tableCommitted={};data.status=target?(data.catalogAvailable?'':'Подключение выбрано. Каталог ещё не загружен; реальной связи с сервером нет.'):'Привяжите PostgreSQL-подключение к проекту в настройках.';}
  // Feedback is event-based and dismissible; ordinary document metadata belongs to its controls.
  function noticeContent(message,action){return `<span class="di-notice-message">${esc(message)}</span>${button(action,icon('x'),'class="di-button di-icon" title="Закрыть сообщение" aria-label="Закрыть сообщение"')}`;}
  function noticeMarkup(message,error,action){return `<div class="di-notice ${error?'error':''}" role="${error?'alert':'status'}" ${message?'':'hidden'}>${noticeContent(message,action)}</div>`;}
  function updateNotice(root,message,error,action){const node=root.querySelector('.di-notice');if(!node)return;node.hidden=!message;node.innerHTML=noticeContent(message,action);node.classList.toggle('error',error);node.setAttribute('role',error?'alert':'status');}
  const dataNotice = (message,error = false) => {data.status=message;data.error=error;updateNotice(dataRoot,message,error,'dismiss-data-notice');};
  function dataToolbar() {
    return `<div class="di-bar d2-topbar">${button('schema',icon('folder'),'class="di-button di-icon" aria-label="Объекты базы данных" title="Показать или скрыть дерево объектов" aria-pressed="'+data.explorer+'"')}<span class="di-caption">PostgreSQL</span><span class="di-demo" title="Локальный интерактивный макет. Сервер PostgreSQL не подключён.">Макет</span><span class="di-spacer"></span>${button('data-jobs',icon('download')+(data.jobs.length?' '+data.jobs.length:''),'title="Импорт и экспорт: задания всех документов" aria-label="Задания импорта и экспорта"')}${button('db-binding',icon('settings'),'class="di-button di-icon" title="Настроить подключения" aria-label="Настроить подключение PostgreSQL"')}${button('db-more',icon('more'),'class="di-button di-icon" title="Сравнение схем, сессии и диагностика" aria-label="Инструменты базы данных"')}${button('db-agent',icon('spark'),'class="di-button di-icon" aria-label="Добавить контекст БД агенту" title="Добавить контекст документа в текущий разговор"')}</div>`;
  }
  function transactionControls(){return `<select id="di-tx-mode" aria-label="Режим транзакции" title="${data.transactionDirty?'Есть незафиксированные изменения: Commit или Rollback':'Режим транзакции этого документа'}" class="${data.transactionDirty?'di-txn':''}"><option value="auto" ${!data.transaction?'selected':''}>Auto</option><option value="manual" ${data.transaction?'selected':''}>Manual${data.transactionDirty?' •':''}</option></select>${data.transaction?button('commit','Commit',`title="Зафиксировать учебную транзакцию" ${!data.transactionDirty?'disabled':''}`)+button('rollback','Rollback',`title="Откатить учебную транзакцию" ${!data.transactionDirty?'disabled':''}`):''}`;}
  function dataDocumentToolbar(active){
    const connection=`<select id="di-connection" aria-label="Подключение документа" title="Подключение закреплено за этим документом. Другая цель откроется в новой консоли.">${dbOptions()}</select>`;
    if(active.kind==='table')return `<div class="di-bar d2-query-toolbar d2-object-toolbar"><span class="d2-target">${connection}</span><span class="di-caption d2-object-path" title="public.${esc(data.object)}">public.${esc(data.object)}</span><span class="di-spacer"></span>${button('object-query',icon('code'),'class="di-button di-icon" title="Открыть SELECT в новой консоли" aria-label="Запрос к таблице"')}${transactionControls()}</div>`;
    if(active.kind==='routine')return `<div class="di-bar d2-query-toolbar">${connection}${button('routine-review','Проверить изменение','class="di-button primary" title="Сравнить исходное и новое определение"')}${button('routine-console',icon('code'),'class="di-button di-icon" title="Открыть определение в SQL консоли" aria-label="Открыть определение в SQL консоли"')}<span class="di-spacer"></span>${button('format-sql',icon('code'),'class="di-button di-icon" title="Форматировать SQL" aria-label="Форматировать SQL"')}</div>`;
    return `<div class="di-bar d2-query-toolbar">${button(data.running?'cancel-query':'execute',icon(data.running?'stop':'run'),`class="di-button di-icon ${data.running?'':'primary'}" aria-label="${data.running?'Остановить запрос':'Выполнить запрос'}" title="${data.running?'Остановить запрос':'Выполнить · Ctrl+Enter'}"`)}<select id="di-execution-mode" aria-label="Что выполнить" title="Текущий оператор, выделение или весь скрипт">${[['current','Оператор'],['selection','Выделение'],['script','Скрипт']].map(([value,label])=>`<option value="${value}" ${data.executionMode===value?'selected':''}>${label}</option>`).join('')}</select>${button('format-sql',icon('code'),'class="di-button di-icon" aria-label="Форматировать SQL" title="Форматировать SQL"')}${button('query-parameters',':x','class="di-button di-icon" aria-label="Параметры SQL" title="Параметры запроса"')}<span class="di-spacer"></span>${connection}${transactionControls()}</div>`;
  }
  function renderEmptyData(){
    dataRoot.classList.add('d2-workspace');dataRoot.dataset.buffer='';dataRoot.style.setProperty('--d2-explorer-width',(data.explorerWidth||210)+'px');
    dataRoot.innerHTML=dataToolbar()+`<div class="di-body d2-body"><aside class="di-explorer d2-explorer" ${data.explorer?'':'hidden'} aria-label="Объекты базы данных"><div class="d2-explorer-target" title="${esc(dbTarget())}">${icon('data')}<strong>${esc(data.connectionMeta?.name||'Нет подключения')}</strong><span>${esc(data.connectionMeta?.env||'')}</span></div>${schemaFilterControl()}<input id="di-schema-search" placeholder="Найти объект…" aria-label="Поиск объекта" value="${esc(data.schemaFilter)}"><div id="di-schema-list">${schemaTree()}</div></aside>${data.explorer?databaseSeparator('explorer'):''}<div class="di-main d2-main"><div class="di-bar d2-query-toolbar"><select id="di-connection" aria-label="Подключение для новых документов" title="Подключение для новых документов">${dbOptions()}</select><span class="di-spacer"></span>${button('new-sql',icon('plus'),'class="di-button di-icon" title="Новая SQL консоль" aria-label="Новая SQL консоль"')}</div>${noticeMarkup(data.status,data.error,'dismiss-data-notice')}<div id="di-data-content" class="di-main d2-content">${data.section==='jobs'?dataSection():`<div class="di-empty d2-empty-documents"><b>Откройте таблицу или SQL консоль</b>Документы закрыты. Дерево объектов и задания сохранены.<div class="di-actions" style="justify-content:center;margin-top:16px">${button('new-sql','Новая SQL консоль','class="di-button primary" title="Открыть новый SQL документ"')}${button('find-db-object','Найти объект','class="di-button outline" title="Показать дерево объектов и перейти к поиску"')}</div></div>`}</div></div></div>`;
    dataRoot.querySelectorAll('button:not([title])').forEach(node=>node.title=node.getAttribute('aria-label')||node.textContent.trim());
  }
  function renderData() {
    if(!currentQuery()){renderEmptyData();return;}
    const active=currentQuery(),buffer=scopeName()+':'+active.id,changedBuffer=dataRoot.dataset.buffer!==buffer,restoreEditor=editorFocus(dataRoot,buffer);
    const sections=active.kind==='table'?[['results','Данные'],['structure','Структура'],['ddl','DDL'],['relations','Связи']]:active.kind==='routine'?[['dependencies','Зависимости']]:[['results','Результат'],['explain','План'],['history','История']];
    const editor=active.kind!=='table'?`<div class="di-editor d2-editor ${active.kind==='routine'?'d2-routine-editor':''}"><div class="di-gutter" aria-hidden="true">${active.sql.split('\n').map((_,i)=>i+1).join('\n')}</div><textarea data-language="sql" id="di-sql" aria-label="${active.kind==='routine'?'Определение процедуры или функции':'SQL редактор'}" spellcheck="false">${esc(active.sql)}</textarea></div>${databaseSeparator('editor')}`:'';
    dataRoot.classList.add('d2-workspace');dataRoot.style.setProperty('--d2-explorer-width',(data.explorerWidth||210)+'px');dataRoot.style.setProperty('--d2-editor-height',(data.editorHeight||174)+'px');
    dataRoot.innerHTML=dataToolbar()+`<div class="di-body d2-body"><aside class="di-explorer d2-explorer" ${data.explorer?'':'hidden'} aria-label="Объекты базы данных"><div class="d2-explorer-target" title="${esc(dbTarget())}">${icon('data')}<strong>${esc(data.connectionMeta?.name||'Нет подключения')}</strong><span>${esc(data.connectionMeta?.env||'')}</span></div>${schemaFilterControl()}<input id="di-schema-search" placeholder="Найти объект…" aria-label="Поиск объекта" value="${esc(data.schemaFilter)}"><div id="di-schema-list">${schemaTree()}</div></aside>${data.explorer?databaseSeparator('explorer'):''}<div class="di-main d2-main"><div class="di-tabbar d2-doc-tabs" role="tablist" aria-label="Документы базы данных">${data.tabs.map(tab=>`<div class="di-tabwrap ${tab.id===data.active?'active':''}"><button role="tab" aria-selected="${tab.id===data.active}" data-di="sql-tab" data-id="${tab.id}" title="${esc(tab.state.connectionMeta?.env||'')} · ${esc(tab.title)}${tab.state.running?' · выполняется':''}">${icon(tab.kind==='table'?'data':'code')}<span>${esc(tab.title)}</span>${tab.state.running?'<i class="d2-running" aria-label="Выполняется"></i>':documentDirty(tab)?'<span class="d2-dirty" title="Есть изменения">•</span>':''}</button><button data-di="close-sql" data-id="${tab.id}" aria-label="Закрыть ${esc(tab.title)}" title="Закрыть документ">${icon('x')}</button></div>`).join('')}${button('new-sql','+','class="di-button di-icon" aria-label="Новая SQL консоль" title="Новая SQL консоль"')}</div>${dataDocumentToolbar(active)}${noticeMarkup(data.status,data.error,'dismiss-data-notice')}${editor}<nav class="di-subnav d2-object-nav" aria-label="Содержимое документа">${sections.map(([key,name])=>button('data-section',name,`data-section="${key}" class="di-button ${data.section===key?'active':''}" aria-pressed="${data.section===key}" title="${name}"`)).join('')}<span class="di-spacer"></span>${data.section==='jobs'?button('data-section','Вернуться к документу',`data-section="${active.kind==='routine'?'dependencies':'results'}"`):''}</nav><div id="di-data-content" class="di-main d2-content">${active.kind==='routine'&&data.section!=='jobs'?routineContent():dataSection()}</div></div></div>`;
    restoreEditor();const field=dataRoot.querySelector('#di-sql');if(field&&changedBuffer&&active.editorView){field.setSelectionRange(active.editorView.start,active.editorView.end);field.scrollTop=active.editorView.top;field.scrollLeft=active.editorView.left;}
    dataRoot.querySelectorAll('button:not([title])').forEach(node=>node.title=node.getAttribute('aria-label')||node.textContent.trim());
  }
  function routineContent(){const active=currentQuery();return `<div class="di-content d2-routine-content"><h3>${active.group==='Функции'?'Функция':'Процедура'} · public.${esc(data.object)}</h3><p class="di-caption">Черновик определения сохраняется в этой вкладке. Перед применением — сравнение, проверка зависимостей и тесты.</p><div class="di-card"><b>Зависимости</b><p>${data.object==='retry_delay'?'Встроенные функции PostgreSQL: LEAST, GREATEST, power.':'public.orders · столбцы order_key, status.'}</p>${data.object!=='retry_delay'?button('db-object','Открыть orders','data-name="orders" data-group="Таблицы"'):''}</div><p class="di-caption">Определение и зависимости — fixture. Компиляция и изменение серверной процедуры в макете не выполняются.</p></div>`;}
  function schemaTree() {
    if(!data.catalogAvailable)return `<div class="di-empty"><b>Каталог пуст</b>Схемы этого подключения ещё не загружены.${button('db-demo-catalog','Загрузить учебный каталог')}</div>`;
    const selected=new Set(visibleSchemaNames()),query=data.schemaFilter.trim().toLocaleLowerCase();
    if(!selected.size)return `<div class="di-empty"><b>Схемы скрыты</b>Выберите схемы для дерева объектов.${button('schema-visibility','Выбрать схемы')}</div>`;
    const entries=databaseSchemas().filter(schema=>selected.has(schema.name)).map(schema=>{
      if(schema.name!=='public')return !query||schema.name.toLocaleLowerCase().includes(query)?`<details class="di-schema-entry" ${query?'open':''}><summary>${esc(schema.name)}</summary><p class="di-caption">Объекты этой схемы не загружены в макете.</p></details>`:'';
      const schemaMatch=schema.name.toLocaleLowerCase().includes(query);
      const groups=Object.entries(dbObjects).map(([group,objects])=>{
        const matches=objects.filter(name=>!query||schemaMatch||name.toLocaleLowerCase().includes(query));
        return matches.length?`<details open><summary>${esc(group)}</summary>${matches.map(name=>`<button class="di-tree" data-di="db-object" data-name="${esc(name)}" data-group="${esc(group)}" aria-current="${data.object===name}">${icon(group==='Процедуры'||group==='Функции'?'code':'data')}<span>${esc(name)}</span></button>`).join('')}</details>`:'';
      }).join('');
      return groups?`<details class="di-schema-entry" open><summary>public</summary>${groups}</details>`:'';
    }).join('');
    return entries||'<p class="di-caption">Нет совпадений в видимых схемах. Измените поиск или выбор схем.</p>';
  }
  function dataSection() {
    if(data.section==='ddl')return `<div class="di-bar d2-grid-toolbar"><strong>Определение</strong><span class="di-spacer"></span>${button('ddl-console-new','Открыть в SQL консоли','title="Создать консоль с этим определением"')}</div><div class="di-content"><pre data-language="sql" class="di-mono">${esc(databaseDDL(data.object))}</pre><p class="di-caption">Сокращённый fixture DDL. Полный серверный export потребует introspection драйвера.</p></div>`;
    if(data.section==='relations')return `<div class="di-content d2-relations"><h3>Связи public.${esc(data.object)}</h3>${(data.object==='customers'?[['orders','customer_id → customers.id','Входящая · 1 : N']]:data.object==='orders'?[['customers','orders.customer_id → customers.id','Исходящая · N : 1'],['checkout_retry','checkout_retry.order_id → orders.order_key','Входящая · 1 : N']]:data.object==='checkout_retry'?[['orders','checkout_retry.order_id → orders.order_key','Исходящая · N : 1']]:[]).map(([name,relation,type])=>`<div class="di-card"><b>${esc(name)}</b><p><code>${esc(relation)}</code><br>${esc(type)}</p>${button('db-object','Открыть таблицу',`data-name="${name}" data-group="Таблицы"`)}</div>`).join('')||'<p class="di-caption">В учебном каталоге внешние ключи этого объекта не представлены.</p>'}${button('diagram','Полная ER-диаграмма','class="di-button outline" title="Открыть карту связей схемы"')}</div>`;
    if (data.section==='results') return renderResults();
    if(data.section==='structure')return `<div class="di-content"><div class="di-bar"><strong>public.${esc(data.object)}</strong><span class="di-spacer"></span>${button('ddl','DDL')}${button('diagram','Связи')}${button('compare','Сравнить')}</div><table class="di-grid"><thead><tr><th>Столбец</th><th>Тип</th><th>Null</th><th>Значение</th></tr></thead><tbody>${(schemaFixtures[data.object]?.columns||schemaFixtures.checkout_retry.columns).map(row=>`<tr>${row.map(value=>'<td>'+value+'</td>').join('')}</tr>`).join('')}</tbody></table><div class="di-card" style="margin-top:14px"><b>Индексы и ограничения</b><p>${esc(data.object)}_pkey · unique btree (id)<br>${data.object==='checkout_retry'?'idx_retry_order · btree (order_id)<br>attempt_positive · CHECK (attempt &gt; 0)':'Ограничения выбранного fixture-объекта'}</p>${button('schema-change','Изменить структуру','class="di-button outline"')}</div><p class="di-caption">DDL, права и статистика в рабочем приложении загружаются из выбранной БД. Здесь — fixture одной схемы.</p></div>`;
    if(data.section==='explain'){
      const plan=data.plan,stale=plan&&plan.sourceSQL!==currentQuery().sql;
      return `<div class="di-bar d2-grid-toolbar"><select id="di-plan-mode" aria-label="Режим плана" title="EXPLAIN оценивает; ANALYZE выполняет запрос на сервере"><option value="estimate" ${plan?.mode!=='analyze'?'selected':''}>EXPLAIN · оценка</option><option value="analyze" ${plan?.mode==='analyze'?'selected':''}>ANALYZE · выполнение</option></select>${button('plan-build','Показать план','class="di-button outline" title="Построить учебный план выбранным режимом"')}<span class="di-spacer"></span><span class="di-caption">Пример структуры плана</span></div>${plan?`<div class="di-content">${stale?'<div class="di-card"><b>SQL изменён</b><p>Показан план предыдущей версии. Постройте новый план для текущего SQL.</p></div>':''}<h3>${plan.mode==='analyze'?'EXPLAIN ANALYZE · демонстрация':'EXPLAIN · пример оценки'}</h3><p class="di-caption">Учебный пример для public.checkout_retry. Введённый SQL сохранён отдельно, но макет его не анализирует.</p><div class="di-card"><b>Index Scan${plan.mode==='analyze'?' · actual 0.024 ms':''}</b><p>Cost 0.15–8.25 · оценка 5 строк${plan.mode==='analyze'?' · actual 5 rows · shared hit 2':''}</p></div><div class="di-treeplan">Limit · estimate 5 rows<div class="di-treeplan indent">Index Scan using checkout_retry_pkey<br><span class="di-caption">public.checkout_retry${plan.mode==='analyze'?' · actual rows 5 · loops 1':''}</span></div></div><p class="di-caption">${plan.mode==='analyze'?'В настоящей БД ANALYZE выполняет запрос, включая запись и побочные эффекты. Здесь показаны только заранее заданные метрики.':'Оценочный план не выполняет SQL и не содержит фактического времени / BUFFERS. Этот план — учебный fixture, не ответ PostgreSQL.'}</p><details><summary>Запрос и цель плана</summary><p class="di-caption">${esc(plan.target)}</p><pre data-language="sql" class="di-mono">${esc(plan.sql)}</pre></details></div>`:'<div class="di-empty"><b>План ещё не построен</b>Выберите оценку без выполнения или ANALYZE и нажмите «Показать план».<br>Макет не подключён к БД.</div>'}`;
    }
    if(data.section==='history')return `<div class="di-content"><h3>История запросов</h3>${data.history.length?data.history.map((entry,index)=>`<div class="di-card"><b>${esc(entry.target)} · ${esc(entry.time)}</b><p>${esc(entry.outcome)}</p><pre data-language="sql" class="di-mono">${esc(entry.sql)}</pre>${button('restore-query','Открыть в новой консоли',`data-index="${index}"`)}</div>`).join(''):'<div class="di-empty"><b>Запросов ещё нет</b>Выполните SQL. В истории сохраняются цель, запрос и результат.</div>'}</div>`;
    return `<div class="di-content"><h3>Импорт и экспорт</h3><div class="di-actions">${button('import','Импорт данных','class="di-button outline"')}${button('export','Экспорт данных','class="di-button outline"')}</div><p class="di-caption">Переключение вкладки не меняет цель задания.</p>${data.jobs.length?data.jobs.map(job=>`<div class="di-card"><b>${esc(job.name)}</b><p>${esc(job.target)} · ${esc(job.status)}</p><progress value="${job.progress}" max="100" aria-label="Прогресс ${esc(job.name)}"></progress><p>${job.progress}% · ${esc(job.detail)}</p>${job.status==='Выполняется'?button('cancel-job','Отменить',`data-id="${job.id}"`):button('job-receipt','Результат',`data-id="${job.id}"`)}${button('job-413','Сценарий 413',`data-id="${job.id}"`)}</div>`).join(''):'<div class="di-empty">Задания появятся здесь. Макет симулирует потоковую обработку, реальные файлы не читает.</div>'}</div>`;
  }
  function draftCount(){return Object.keys(data.pending).length+data.addedRows.length+data.deletedRows.length;}
  function cellSchema(column){return (schemaFixtures[data.object]?.columns||[]).find(item=>item[0]===column);}
  function gridRow(id){return [...data.rows,...data.addedRows].find(row=>row.id===Number(id));}
  function cellValue(row,column){const key=row.id+':'+column;return Object.hasOwn(data.pending,key)?data.pending[key]:row[column];}
  function gridCellMarkup(row,column,editable){
    const key=row.id+':'+column,value=cellValue(row,column),edit=data.cellEdit,editing=edit?.row===row.id&&edit.column===column,selected=data.activeCell===key;
    const label=value===null?'<i class="null">NULL</i>':value===''?'<span class="d2-empty-cell" aria-label="Пустая строка">∅</span>':esc(value);
    if(!editable||column==='id')return `<td>${label}</td>`;
    const nullable=cellSchema(column)?.[2]!=='NOT NULL';
    return `<td class="${Object.hasOwn(data.pending,key)?'edited':''} ${editing?'d2-cell-editing':''} ${selected?'d2-cell-selected':''}" data-cell-row="${row.id}" data-cell-column="${esc(column)}">${editing?`<div class="d2-cell-editor"><input id="di-cell-input" aria-label="Значение ${esc(column)}, строка ${row.id}" value="${esc(edit.isNull?'':edit.value)}" placeholder="${edit.isNull?'NULL':''}" ${edit.isNull?'class="d2-null-value"':''} aria-invalid="${Boolean(edit.error)}" ${edit.error?'aria-describedby="di-cell-error"':''} autocomplete="off" spellcheck="false" title="Enter — принять, Tab — следующая ячейка, Escape — отменить">${nullable?button('cell-null','∅',`class="di-button d2-null-toggle" aria-label="${edit.isNull?'Ввести значение вместо NULL':'Установить NULL'}" aria-pressed="${edit.isNull}" title="NULL · Ctrl+Alt+N"`):''}</div>${edit.error?`<span class="d2-cell-error" id="di-cell-error" role="alert">${esc(edit.error)}</span>`:''}`:`<button data-di="select-cell" data-row="${row.id}" data-column="${esc(column)}" aria-label="Изменить ${esc(column)}, строка ${row.id}" title="Двойной щелчок или F2 — редактировать · Ctrl+Alt+N — NULL" tabindex="${!data.activeCell||selected?'0':'-1'}">${label}</button>`}</td>`;
  }
  function renderGridEdit(focusEditor=false){
    const grid=dataRoot.querySelector('.d2-results'),position=grid?{top:grid.scrollTop,left:grid.scrollLeft}:null;renderData();
    const next=dataRoot.querySelector('.d2-results');if(next&&position){next.scrollTop=position.top;next.scrollLeft=position.left;}
    if(focusEditor){const input=dataRoot.querySelector('#di-cell-input');input?.focus({preventScroll:true});input?.select?.();}
    else if(data.activeCell){const [row,column]=data.activeCell.split(':');dataRoot.querySelector(`[data-cell-row="${row}"][data-cell-column="${column}"] [data-di="select-cell"]`)?.focus({preventScroll:true});}
  }
  function beginCellEdit(rowId,column,initial){
    if(data.readOnly||currentQuery()?.kind!=='table'||column==='id')return false;
    const row=gridRow(rowId);if(!row||!Object.hasOwn(row,column))return false;
    if(data.cellEdit&&!finishCellEdit(false))return false;
    const value=cellValue(row,column);data.activeCell=row.id+':'+column;data.cellEdit={row:row.id,column,value:initial??String(value??''),isNull:initial===undefined&&value===null,error:''};renderGridEdit(true);return true;
  }
  function parseCellDraft(edit,row){
    const schema=cellSchema(edit.column),type=schema?.[1]||'',nullable=schema?.[2]!=='NOT NULL';
    if(edit.isNull)return nullable?{value:null}:{error:'NULL не разрешён'};
    if(/^(?:bigint|integer|numeric)/.test(type)){
      const text=edit.value.trim(),integer=/^(?:bigint|integer)/.test(type),valid=integer?/^[+-]?\d+$/.test(text):/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text);
      if(!valid)return {error:integer?'Введите целое число':'Введите число'};
      const number=Number(text);if(!Number.isFinite(number))return {error:'Число вне диапазона'};
      if(integer&&type==='integer'&&(number<-2147483648||number>2147483647))return {error:'Вне диапазона integer'};
      if(type==='bigint'&&(BigInt(text)<-9223372036854775808n||BigInt(text)>9223372036854775807n))return {error:'Вне диапазона bigint'};
      // Decimal and large bigint values must never pass through a lossy JS Number.
      return {value:integer&&Number.isSafeInteger(number)?number:text};
    }
    return {value:edit.value};
  }
  function finishCellEdit(render=true){
    const edit=data.cellEdit;if(!edit)return true;const row=gridRow(edit.row);if(!row){data.cellEdit=null;return true;}
    const parsed=parseCellDraft(edit,row);if(parsed.error){edit.error=parsed.error;renderGridEdit(true);return false;}
    const key=edit.row+':'+edit.column;
    if(data.addedRows.includes(row))row[edit.column]=parsed.value;
    else if(Object.is(parsed.value,row[edit.column]))delete data.pending[key];else data.pending[key]=parsed.value;
    data.cellEdit=null;if(render)renderGridEdit();return true;
  }
  function cancelCellEdit(){data.cellEdit=null;renderGridEdit();}
  function moveGridCell(direction,editNext=false){
    const cells=[...dataRoot.querySelectorAll('.d2-results [data-cell-row]')].map(node=>({row:Number(node.dataset.cellRow),column:node.dataset.cellColumn}));
    const index=cells.findIndex(cell=>cell.row+':'+cell.column===data.activeCell),columns=cells.filter(cell=>cell.row===cells[0]?.row).length;
    const offset=direction==='up'?-columns:direction==='down'?columns:direction==='left'?-1:1,next=cells[index+offset];
    if(!next)return false;data.activeCell=next.row+':'+next.column;if(editNext)beginCellEdit(next.row,next.column);else renderGridEdit();return true;
  }
  function renderResults(){
    if(!data.catalogAvailable)return `<div class="di-empty"><b>${data.connectionMeta?'Нет загруженных объектов':'Выберите подключение'}</b>${data.connectionMeta?'Каталог этого подключения ещё не загружен.':'Привяжите подключение к проекту в настройках.'}<div class="di-actions" style="justify-content:center;margin-top:12px">${button('db-binding','Настроить подключение','class="di-button outline"')}${data.connectionMeta?button('db-demo-catalog','Открыть учебный каталог','class="di-button outline"'):''}</div></div>`;
    const rows=filteredRows(),pages=Math.max(1,Math.ceil(rows.length/data.pageSize));data.page=Math.min(pages,Math.max(1,data.page));
    const offset=(data.page-1)*data.pageSize,visible=rows.slice(offset,offset+data.pageSize),keys=Object.keys(data.rows[0]||data.addedRows[0]||Object.fromEntries((schemaFixtures[data.object]?.columns||[]).map(column=>[column[0],null]))).filter(key=>!data.hiddenColumns.includes(key));
    const pending=draftCount(),table=currentQuery()?.kind==='table',editable=table&&!data.readOnly;
    const editableKeys=keys.filter(key=>key!=='id');if(editable&&!visible.some(row=>editableKeys.some(key=>row.id+':'+key===data.activeCell)))data.activeCell=visible.length&&editableKeys.length?visible[0].id+':'+editableKeys[0]:null;
    return `<div class="di-bar d2-grid-toolbar"><div class="d2-filter">${icon('search')}<input id="di-result-search" type="search" value="${esc(data.queryFilter)}" placeholder="Фильтр строк…" aria-label="Фильтр строк результата" title="Поиск по значениям загруженного результата · Enter" autocomplete="off"></div>${button('grid-refresh',icon('refresh'),'class="di-button di-icon" title="Обновить учебный набор" aria-label="Обновить результат"')}${button('add-row','+','class="di-button di-icon" title="Добавить строку в черновик" aria-label="Добавить строку"'+(editable?'':' disabled'))}${button('delete-selected',icon('trash'),'class="di-button di-icon" title="Удалить выбранные строки" aria-label="Удалить выбранные строки"'+(editable&&data.selectedRows.length?'':' disabled'))}<span class="di-spacer"></span>${button('grid-columns',icon('panel'),'class="di-button di-icon" title="Выбрать видимые столбцы" aria-label="Видимые столбцы"')}${button('import',icon('upload'),'class="di-button di-icon" title="Импорт CSV, XLSX, SQL" aria-label="Импорт данных"'+(editable?'':' disabled'))}${button('export',icon('download'),'class="di-button di-icon" title="Экспорт CSV, XLSX, SQL" aria-label="Экспорт данных"')}${button('result-menu',icon('more'),'class="di-button di-icon" title="Лимиты, параметры и сценарии результата" aria-label="Действия с результатом"')}</div>${pending?`<div class="di-bar d2-draft-bar"><span class="di-txn">Черновик · ${pending} ${data.addedRows.length?' · +'+data.addedRows.length:''}${data.deletedRows.length?' · −'+data.deletedRows.length:''}</span><span class="di-spacer"></span>${button('discard-grid','Отменить','title="Отменить все неприменённые изменения этого документа"')}${button('apply-grid','Применить','class="di-button primary" title="Показать SQL и применить в макете"')}</div>`:''}${!table&&data.rows.length?`<div class="d2-result-origin"><span title="${esc(data.resultSnapshot?.sql||'Учебные строки до первого запуска')}">${data.resultSnapshot?((data.resultSnapshot.sourceSQL!==currentQuery().sql||data.lastAttemptSQL!==data.resultSnapshot.sql)?'Предыдущий результат':'Результат SELECT')+' · '+esc(data.resultSnapshot.time):'Учебный набор · запрос ещё не выполнен'} · только чтение</span>${button('db-object','Редактировать таблицу',`data-name="${esc(data.object)}" data-group="${data.object==='retry_summary'?'Представления':'Таблицы'}" title="Открыть отдельную вкладку исходной таблицы"`)}</div>`:''}<div class="di-results d2-results"><table class="di-grid"><thead><tr><th class="d2-row-select"><input type="checkbox" aria-label="Выбрать все строки страницы" data-di-select-all ${visible.length&&visible.every(row=>data.selectedRows.includes(row.id))?'checked':''}></th>${keys.map(key=>`<th><button data-di="sort" data-column="${esc(key)}" title="Сортировать по ${esc(key)}">${esc(key)} ${data.sort===key?(data.asc?'↑':'↓'):''}</button></th>`).join('')}</tr></thead><tbody>${visible.map(row=>`<tr class="${data.selectedRows.includes(row.id)?'d2-row-selected':''} ${data.addedRows.some(item=>item.id===row.id)?'d2-row-added':''}"><td class="d2-row-select"><input type="checkbox" data-di-row-select="${row.id}" aria-label="Выбрать строку ${row.id}" ${data.selectedRows.includes(row.id)?'checked':''}></td>${keys.map(key=>gridCellMarkup(row,key,editable)).join('')}</tr>`).join('')}</tbody></table>${visible.length?'':`<div class="di-empty"><b>${data.queryFilter?'Нет совпадений':'Нет результата'}</b>${data.queryFilter?'Измените фильтр строк.':table?'Добавьте строку или импортируйте данные.':'Выполните учебный SELECT. Другие запросы макет не исполняет.'}</div>`}</div><div class="di-bar d2-grid-footer"><span class="di-caption">${rows.length?offset+1:0}–${Math.min(offset+data.pageSize,rows.length)} из ${rows.length.toLocaleString('ru-RU')}${data.selectedRows.length?' · выбрано '+data.selectedRows.length:''}</span><span class="di-spacer"></span><select id="di-page-size" aria-label="Строк на странице" title="Строк на странице">${[50,100,250].map(size=>`<option ${size===data.pageSize?'selected':''} value="${size}">${size} / стр.</option>`).join('')}</select>${button('page-first','«',`aria-label="Первая страница" ${data.page===1?'disabled':''}`)}${button('page-prev','‹',`aria-label="Предыдущая страница" ${data.page===1?'disabled':''}`)}<span class="di-caption">${data.page} / ${pages}</span>${button('page-next','›',`aria-label="Следующая страница" ${data.page===pages?'disabled':''}`)}${button('page-last','»',`aria-label="Последняя страница" ${data.page===pages?'disabled':''}`)}</div>`;
  }
  function filteredRows(){return [...data.rows,...data.addedRows].filter(row=>!data.deletedRows.includes(row.id)&&(data.addedRows.includes(row)||Object.values(row).join(' ').toLowerCase().includes(data.queryFilter.toLowerCase()))).sort((a,b)=>(typeof a[data.sort]==='number'?a[data.sort]-b[data.sort]:String(a[data.sort]).localeCompare(String(b[data.sort])))*(data.asc?1:-1));}
  function newQuery(sql='-- Новая SQL консоль\nSELECT * FROM public.checkout_retry LIMIT 100;',title) {
    captureDataEditor();const state=freshDocumentState(currentDocumentState()),id=data.next++;data.tabs.push({id,kind:'console',title:title||`Console ${id}.sql`,sql,dirty:false,state});data.active=id;renderData();
  }
  // PostgreSQL-aware statement boundaries. This is a selection helper, not a SQL engine.
  function sqlStatementRanges(sql){
    const ranges=[];let start=0,i=0,quote=null,block=0;
    while(i<sql.length){
      if(block){if(sql.slice(i,i+2)==='/*'){block++;i+=2}else if(sql.slice(i,i+2)==='*/'){block--;i+=2}else i++;continue;}
      if(quote){if(sql.startsWith(quote,i)){if(quote.length===1&&sql[i+1]===quote){i+=2;continue;}i+=quote.length;quote=null;}else if(quote==="'"&&sql[i]==='\\'){i+=2}else i++;continue;}
      if(sql.slice(i,i+2)==='--'){const next=sql.indexOf('\n',i);i=next<0?sql.length:next+1;continue;}
      if(sql.slice(i,i+2)==='/*'){block=1;i+=2;continue;}
      if(sql[i]==="'"||sql[i]==='"'){quote=sql[i++];continue;}
      const dollar=sql.slice(i).match(/^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u);if(dollar){quote=dollar[0];i+=quote.length;continue;}
      if(sql[i]===';'){ranges.push({start,end:i+1});start=i+1;}i++;
    }
    if(sql.slice(start).trim())ranges.push({start,end:sql.length});return ranges;
  }
  function selectedSQL(query,mode,selection){
    if(mode==='selection')return query.sql.slice(selection.start,selection.end).trim();
    if(mode==='script')return query.sql.trim();
    const ranges=sqlStatementRanges(query.sql),range=ranges.find(item=>selection.start>=item.start&&selection.start<item.end)||ranges[ranges.length-1];return range?query.sql.slice(range.start,range.end).trim():'';
  }
  function sqlParameterNames(sql){
    let i=0,code='';
    while(i<sql.length){
      if(sql.slice(i,i+2)==='--'){const end=sql.indexOf('\n',i);i=end<0?sql.length:end;code+=' ';continue;}
      if(sql.slice(i,i+2)==='/*'){let depth=1;i+=2;while(i<sql.length&&depth){if(sql.slice(i,i+2)==='/*'){depth++;i+=2}else if(sql.slice(i,i+2)==='*/'){depth--;i+=2}else i++;}code+=' ';continue;}
      if(sql[i]==="'"||sql[i]==='"'){const quote=sql[i++];while(i<sql.length){if(sql[i]===quote){if(sql[i+1]===quote)i+=2;else {i++;break}}else if(quote==="'"&&sql[i]==='\\')i+=2;else i++;}code+=' ';continue;}
      const dollar=sql.slice(i).match(/^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u);if(dollar){const end=sql.indexOf(dollar[0],i+dollar[0].length);i=end<0?sql.length:end+dollar[0].length;code+=' ';continue;}
      code+=sql[i++];
    }
    return [...new Set([...code.matchAll(/(?<!:):([A-Za-z_][\w]*)/g)].map(match=>match[1]))];
  }
  function executeSQL(skipParameters=false,capturedSQL){
    if(data.running||currentQuery()?.kind!=='console')return;
    if(!allowNewDBOperation())return;
    const field=dataRoot.querySelector('#di-sql'),query=currentQuery(),selection={start:field?.selectionStart??query.editorView?.start??0,end:field?.selectionEnd??query.editorView?.end??0};
    const sql=capturedSQL??selectedSQL(query,data.executionMode,selection);
    if(!sql){dataNotice(data.executionMode==='selection'?'Выделите SQL в редакторе.':'Введите запрос.',true);return;}
    const names=sqlParameterNames(sql);
    if(names.length&&!skipParameters){queryParameters(names,true,sql);return;}
    const workspace=data,owner=query.state,target=dbTarget(),sourceSQL=query.sql,executionMode=owner.executionMode,connection=owner.connection,connectionMeta=clone(owner.connectionMeta),rowLimit=owner.limits.rows,token=++owner.queryToken;
    owner.lastAttemptSQL=sql;owner.running=true;owner.status='Выполняется локальная демонстрация…';owner.error=false;renderData();
    setTimeout(()=>{
      if(token!==owner.queryToken)return;owner.running=false;let outcome;
      const simple=sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g,'').trim(),match=simple.match(/^SELECT\s+(\*|id,\s*order_id,\s*attempt,\s*status_code,\s*response_kind)\s+FROM\s+public\.(checkout_retry|orders|customers|retry_summary)(?:\s+ORDER\s+BY\s+id)?(?:\s+LIMIT\s+(\d+))?\s*;?$/i);
      if(/\bmissing_table\b/i.test(simple)){outcome='Учебная ошибка 42P01: relation "missing_table" does not exist';owner.error=true;}
      else if(match&&(match[1]==='*'||match[2].toLowerCase()==='checkout_retry')){const name=match[2].toLowerCase(),limit=Math.min(Number(match[3]||rowLimit),rowLimit);owner.resultSnapshot={sql,sourceSQL,executionMode,target,time:new Date().toLocaleTimeString('ru-RU')};owner.object=name;owner.rows=clone(schemaFixtures[name].rows).slice(0,limit);owner.committed=clone(owner.rows);owner.pending={};owner.addedRows=[];owner.deletedRows=[];owner.selectedRows=[];owner.hiddenColumns=[];owner.page=1;owner.readOnly=true;owner.section='results';outcome=`${owner.rows.length} строк · учебный SELECT · ${target}`;owner.error=false;}
      else {outcome='SQL не выполнялся: этот макет показывает результат только для учебного SELECT из public.checkout_retry / orders / customers / retry_summary. Произвольный SQL и скрипты требуют драйвера.';owner.error=false;}
      owner.history.unshift({sql,target,connection,connectionMeta,mode:executionMode,sourceSQL,time:new Date().toLocaleTimeString('ru-RU'),outcome});owner.status=outcome;
      if(workspace===data&&currentQuery()===query)renderData();else if(workspace===data)renderData();
    },650);
  }
  function captureTransferSource(){
    const document=currentQuery(),owner=data;
    return {owner,document,sourceDocumentId:document?.id,connectionId:data.connection,target:dbTarget(),targetMeta:clone(data.connectionMeta),object:data.object,sql:document?.sql||'',rowCount:filteredRows().length,page:data.page,pageSize:data.pageSize,filter:data.queryFilter,sort:data.sort,asc:data.asc,columns:(schemaFixtures[data.object]?.columns||[]).map(c=>c[0])};
  }
  function transferSourceValid(source){
    if(data!==source.owner||!data.tabs.includes(source.document)||source.document.state?.connection!==source.connectionId)return false;
    const current=registeredDBs().find(item=>item.id===source.connectionId),captured=source.targetMeta,pinned=source.document.state.connectionMeta;
    return Boolean(current&&captured&&pinned&&['id','address','env','namespace'].every(key=>(current[key]||'')===(captured[key]||'')&&(pinned[key]||'')===(captured[key]||'')));
  }
  function importWizard() {
    const source=captureTransferSource();
    if(!source.object||data.readOnly){dataNotice('Выберите редактируемую таблицу для импорта.',true);return;}
    const columns=(schemaFixtures[source.object]?.columns||[]).filter(c=>!String(c[3]).includes('identity')).map(c=>c[0]);
    const draft={step:0,format:'CSV',name:source.object+'.csv',size:'1 GB',delimiter:',',encoding:'UTF-8',mode:'append',badRows:'stop',header:true,mapping:columns.map(name=>({source:name,target:name})),fileBytes:null};
    const valid=()=>transferSourceValid(source);
    const selected=(actual,expected)=>actual===expected?'selected':'';
    function readStep(){
      if(draft.step===0){
        draft.format=dialog.querySelector('#di-import-format').value;draft.name=dialog.querySelector('#di-import-name').value.trim();draft.size=dialog.querySelector('#di-import-size').value;draft.encoding=dialog.querySelector('#di-import-encoding').value;draft.delimiter=dialog.querySelector('#di-import-delimiter').value;draft.header=dialog.querySelector('#di-import-header').checked;
        if(!draft.name){dialog.querySelector('#di-import-name').focus();return false;}
      }
      if(draft.step===1){
        draft.mapping=[...dialog.querySelectorAll('.di-mapping')].map((x,i)=>({source:columns[i],target:x.value}));draft.mode=dialog.querySelector('#di-import-mode').value;draft.badRows=dialog.querySelector('#di-import-errors').value;
        const maps=draft.mapping.map(x=>x.target).filter(x=>x!=='skip');
        if(draft.format!=='SQL'&&(!maps.length||new Set(maps).size!==maps.length)){dialog.querySelector('#di-transfer-error').textContent='Выберите хотя бы один столбец; назначения не должны повторяться.';return false;}
      }
      return true;
    }
    function draw(){
      let content=`<div class="di-step">Шаг ${draft.step+1} из 3 · ${['Источник','Поля и обработка','Проверка задания'][draft.step]}</div><p>Назначение: <b>${esc(source.target)}.${esc(source.object)}</b></p>`;
      if(draft.step===0)content+=`<div class="di-columns"><label>Формат<select id="di-import-format">${['CSV','XLSX','SQL'].map(f=>`<option ${selected(draft.format,f)}>${f}</option>`).join('')}</select></label><label>Размер учебного набора<select id="di-import-size">${['100 MB','1 GB','10 GB'].map(v=>`<option ${selected(draft.size,v)}>${v}</option>`).join('')}</select></label></div><label>Имя файла<input id="di-import-name" value="${esc(draft.name)}"></label><label>Выбрать файл <span class="di-caption">В макете читаются только имя и размер</span><input type="file" id="di-import-file" accept=".csv,.xlsx,.sql"></label><div class="di-columns"><label>Кодировка<select id="di-import-encoding">${['UTF-8','Windows-1251'].map(v=>`<option ${selected(draft.encoding,v)}>${v}</option>`).join('')}</select></label><label>Разделитель CSV<select id="di-import-delimiter">${[[',','Запятая'],[';','Точка с запятой'],['tab','Табуляция']].map(([v,l])=>`<option value="${v}" ${selected(draft.delimiter,v)}>${l}</option>`).join('')}</select></label></div><label class="di-check"><input id="di-import-header" type="checkbox" ${draft.header?'checked':''}> Первая строка CSV содержит заголовки</label><p class="di-caption">Файл не загружается на сервер. Сопоставление на следующем шаге использует учебные поля таблицы.</p>`;
      else if(draft.step===1)content+=`${draft.format==='SQL'?'<div class="di-card"><b>SQL script / restore</b><p>SQL обрабатывается отдельно. COPY-блоки передаются потоково; тела функций и транзакционные границы сохраняются. Разделитель CSV и mapping к произвольному SQL не применяются.</p></div>':`<table class="di-grid"><thead><tr><th>Учебное поле</th><th>Назначение</th></tr></thead><tbody>${draft.mapping.map(field=>`<tr><td>${esc(field.source)}</td><td><select class="di-mapping" aria-label="Назначение ${esc(field.source)}"><option value="skip" ${selected(field.target,'skip')}>Пропустить</option>${columns.map(c=>`<option value="${esc(c)}" ${selected(field.target,c)}>${esc(c)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table><p>Identity генерирует БД. CSV/XLSX → потоковый COPY FROM STDIN.</p>`}<div class="di-columns"><label>Режим<select id="di-import-mode"><option value="append" ${selected(draft.mode,'append')}>Добавить строки</option><option value="staging" ${selected(draft.mode,'staging')}>Проверить через staging</option></select></label><label>Ошибка строки<select id="di-import-errors"><option value="stop" ${selected(draft.badRows,'stop')}>Остановить и откатить</option><option value="quarantine" ${selected(draft.badRows,'quarantine')}>Staging + карантин</option></select></label></div><p class="di-caption">В продукте: предпросмотр ≤ 200 строк / 1 MiB; точность numeric, NULL и кодировка проверяются до записи.</p>`;
      else content+=`<div class="di-card"><b>${esc(draft.name)}</b><p>${esc(draft.format)} · ${draft.fileBytes===null?esc(draft.size)+' · учебный набор':draft.fileBytes.toLocaleString('ru-RU')+' байт (только metadata)'}<br>Механизм: ${draft.format==='SQL'?'SQL script runner + COPY blocks':'COPY FROM STDIN'}<br>Кодировка: ${esc(draft.encoding)}<br>Режим: ${draft.mode==='staging'?'staging + валидация':'добавление'}<br>Ошибки: ${draft.badRows==='stop'?'откат задания':'карантин через staging'}</p>${draft.format==='SQL'?'':`<p>${draft.mapping.filter(x=>x.target!=='skip').map(x=>esc(x.source)+' → '+esc(x.target)).join('<br>')}</p>`}</div><p>Задание сохраняет эту цель и параметры. При обрыве с неизвестным commit повтор не запускается автоматически.</p><p class="di-caption">Запуск демонстрирует прогресс. Реальные данные не читаются и не записываются.</p>`;
      content+='<p id="di-transfer-error" class="di-error" role="alert"></p>';
      openDialog('Импорт данных',content,(draft.step?button('back','Назад'):'')+button('next',draft.step===2?'Запустить демонстрацию':'Далее','class="di-button primary"'),action=>{
        if(!valid()){dialog.querySelector('#di-transfer-error').textContent='Исходная вкладка или подключение изменены. Откройте мастер заново.';return;}
        if(action==='back'){readStep();draft.step--;draw();return;}
        if(action!=='next'||!readStep())return;
        if(draft.step<2){draft.step++;draw();return;}
        dialog.close();startJob(`Импорт · ${draft.name}`,source.target+'.'+source.object,draft.format==='SQL'?'SQL / COPY blocks':'COPY FROM STDIN',source.targetMeta,{...clone(draft),direction:'import',object:source.object,sourceDocumentId:source.sourceDocumentId,connectionId:source.connectionId});
      });
      if(draft.step===0)dialog.querySelector('#di-import-file').onchange=event=>{const file=event.target.files[0];if(!file)return;draft.fileBytes=file.size;dialog.querySelector('#di-import-name').value=file.name;const ext=file.name.split('.').pop().toUpperCase();if(['CSV','XLSX','SQL'].includes(ext))dialog.querySelector('#di-import-format').value=ext;};
    }
    draw();
  }
  function startJob(name,target,method,targetMeta=clone(data.connectionMeta),options={}) {
    const owner=data,job={id:Math.max(Date.now(),...(data.jobs.map(j=>j.id+1))),name,target,method,targetMeta:clone(targetMeta),options:clone(options),sourceDocumentId:options.sourceDocumentId??currentQuery()?.id,status:'Выполняется',progress:0,detail:'Подготовка потока · демонстрация'};
    owner.jobs.unshift(job);data.section='jobs';renderData();
    const timer=setInterval(()=>{
      if(job.status!=='Выполняется'){clearInterval(timer);return;}
      job.progress=Math.min(100,job.progress+10);job.detail=job.progress<100?`Учебный поток ${method} · ограниченный буфер`:'Демонстрация завершена. Реальных записей, файлов и серверного подтверждения нет.';
      if(job.progress===100){job.status='Завершено';clearInterval(timer);}
      if(data===owner&&data.section==='jobs'){const content=dataRoot.querySelector('#di-data-content');if(content)content.innerHTML=dataSection();}
    },400);
  }
  function exportDialog() {
    const source=captureTransferSource();
    if(!source.object){dataNotice('Сначала откройте таблицу или получите результат запроса.',true);return;}
    const pageCount=Math.max(0,Math.min(source.pageSize,source.rowCount-(source.page-1)*source.pageSize));
    openDialog('Экспорт данных',`<p>Источник: <b>${esc(source.target)}.${esc(source.object)}</b></p><div class="di-columns"><label>Формат<select id="di-export-format"><option>CSV</option><option>XLSX</option><option>SQL</option></select></label><label>Объём<select id="di-export-scope"><option value="result">Все отфильтрованные строки (${source.rowCount})</option><option value="page">Текущая страница (${pageCount})</option></select></label></div><label>Имя файла<input id="di-export-name" value="${esc(source.object)}"></label><div class="di-columns"><label>Кодировка CSV<select id="di-export-encoding"><option>UTF-8</option><option>Windows-1251</option></select></label><label>Разделитель CSV<select id="di-export-delimiter"><option value=",">Запятая</option><option value=";">Точка с запятой</option><option value="tab">Табуляция</option></select></label></div><label class="di-check"><input id="di-export-headers" type="checkbox" checked> Заголовки столбцов</label><label class="di-check"><input id="di-export-formulas" type="checkbox" checked> Защитить текст от формул Excel</label><p class="di-caption">Фильтр: ${esc(source.filter||'нет')} · порядок: ${esc(source.sort)} ${source.asc?'ASC':'DESC'}. Экспорт берёт сохранённые строки; несохранённые изменения сетки не включаются.</p><div class="di-card"><b>Большие результаты</b><p>CSV — COPY TO STDOUT. XLSX — потоковая запись с разбиением по лимиту листа; большие числа сохраняются текстом. SQL — INSERT данных, отдельно от дампа схемы.</p></div><p class="di-caption">В макете файл не создаётся. Задание сохраняет выбранный объём и параметры.</p><p id="di-transfer-error" class="di-error" role="alert"></p>`,button('export-run','Создать задание','class="di-button primary"'),action=>{
      if(action!=='export-run')return;
      if(!transferSourceValid(source)){dialog.querySelector('#di-transfer-error').textContent='Исходная вкладка или подключение изменены. Откройте экспорт заново.';return;}
      const format=dialog.querySelector('#di-export-format').value,name=dialog.querySelector('#di-export-name').value.trim(),scope=dialog.querySelector('#di-export-scope').value;
      if(!name||/[\\/:*?"<>|]/.test(name)){dialog.querySelector('#di-transfer-error').textContent='Укажите имя файла без символов пути.';return;}
      const options={direction:'export',format,scope,object:source.object,connectionId:source.connectionId,sourceDocumentId:source.sourceDocumentId,sql:source.sql,filter:source.filter,sort:source.sort,asc:source.asc,page:source.page,pageSize:source.pageSize,rowCount:scope==='page'?pageCount:source.rowCount,columns:source.columns,encoding:dialog.querySelector('#di-export-encoding').value,delimiter:dialog.querySelector('#di-export-delimiter').value,headers:dialog.querySelector('#di-export-headers').checked,protectFormulas:dialog.querySelector('#di-export-formulas').checked};
      dialog.close();startJob(`Экспорт · ${name}.${format.toLowerCase()}`,source.target+'.'+source.object,format==='CSV'?'COPY TO STDOUT':format==='XLSX'?'Streaming XLSX':'SQL writer',source.targetMeta,options);
    });
  }
  function showProcedure(name) {
    const isFunction=name==='retry_delay';
    const sql=isFunction?`CREATE OR REPLACE FUNCTION public.${name}(attempt integer)\nRETURNS integer LANGUAGE sql IMMUTABLE\nAS $body$\n  SELECT LEAST(30000, 250 * power(2, GREATEST(attempt - 1, 0)))::integer;\n$body$;`:`CREATE OR REPLACE PROCEDURE public.${name}(p_order_key text)\nLANGUAGE plpgsql\nAS $body$\nBEGIN\n  UPDATE public.orders\n  SET status = 'reconciled'\n  WHERE order_key = p_order_key;\nEND;\n$body$;`;
    openDialog(`${isFunction?'Функция':'Процедура'} · ${name}`,`<p>${esc(dbTarget())} · определение</p><textarea data-language="sql" id="di-procedure" aria-label="Исходный код процедуры или функции" spellcheck="false">${esc(sql)}</textarea><p class="di-caption">Изменения сначала проходят diff и проверку зависимостей. В макете сервер не подключён.</p>`,button('procedure-edit','Открыть в SQL консоли')+button('routine-preview','Проверить изменение','class="di-button primary"'),action=>{const text=dialog.querySelector('#di-procedure').value;if(action==='procedure-edit'){dialog.close();newQuery(text,name+'.sql');dataNotice('Определение перенесено в консоль. Выполнение DDL в прототипе отключено.');}if(action==='routine-preview'){openDialog('Изменение определения',`<div class="di-columns"><div><b>Было</b><pre data-language="sql" class="di-mono">${esc(sql)}</pre></div><div><b>Будет</b><pre data-language="sql" class="di-mono">${esc(text)}</pre></div></div><p>Зависимости: orders, вызывающие процедуры. Перед применением нужны compile / privilege check и тесты на выбранном стенде.</p>`,button('routine-draft','Подготовить SQL','class="di-button primary"'),choice=>{if(choice==='routine-draft'){dialog.close();newQuery(text,name+'.sql');}});}});
  }
  function dataAction(action,el) {
    if(action==='cell-null'){if(data.cellEdit){data.cellEdit.isNull=!data.cellEdit.isNull;data.cellEdit.error='';renderGridEdit(true);}return;}
    if(action==='cancel-cell'){cancelCellEdit();return;}
    if(action==='discard-grid')data.cellEdit=null;
    if(data.cellEdit&&!finishCellEdit())return;
    if(action==='select-cell'){data.activeCell=el.dataset.row+':'+el.dataset.column;const cell=dataRoot.querySelector(`[data-cell-row="${el.dataset.row}"][data-cell-column="${el.dataset.column}"]`),button=cell?.querySelector('[data-di="select-cell"]');dataRoot.querySelectorAll('.d2-cell-selected').forEach(node=>node.classList.remove('d2-cell-selected'));cell?.classList.add('d2-cell-selected');dataRoot.querySelectorAll('[data-di="select-cell"]').forEach(node=>node.tabIndex=node===button?0:-1);button?.focus({preventScroll:true});return;}
    if(action==='dismiss-data-notice'){dataNotice('');dataRoot.querySelector('#di-sql, #di-connection')?.focus();return;}
    if(!currentQuery()&&!['schema','schema-visibility','new-sql','find-db-object','db-object','db-binding','db-more','db-agent','db-demo-catalog','data-jobs','connection-info','sessions','diagram','compare','db-failure','cancel-job','job-receipt','job-413'].includes(action)){dataNotice('Откройте документ для этого действия.');return;}
    if(action==='find-db-object'){data.explorer=true;data.section='results';renderData();dataRoot.querySelector('#di-schema-search')?.focus();return;}
    if(expandedDataAction(action,el))return;
    if(action==='schema'){data.explorer=!data.explorer;renderData();}
    else if(action==='schema-visibility')selectVisibleSchemas();
    else if(action==='new-sql')newQuery();
    else if(action==='sql-tab')activateDataDocument(Number(el.dataset.id));
    else if(action==='close-sql')closeDataDocument(Number(el.dataset.id));
    else if(action==='execute')executeSQL();
    else if(action==='cancel-query'){data.queryToken++;data.running=false;data.status='Запрос отменён · локальная демонстрация';renderData();}
    else if(action==='format-sql')previewSQLFormatting();
    else if(action==='data-section'){data.section=el.dataset.section;renderData();}
    else if(action==='db-object')openDatabaseObject(el.dataset.name,el.dataset.group);
    else if(action==='sort'){data.asc=data.sort===el.dataset.column?!data.asc:true;data.sort=el.dataset.column;renderData();}
    else if(action==='discard-grid'){data.pending={};renderData();dataNotice('Локальные изменения отменены.');}
    else if(action==='apply-grid'){const updates=Object.entries(data.pending).map(([key,value])=>{const [id,column]=key.split(':');return `UPDATE public.${data.object} SET ${column} = ${value===null?'NULL':typeof value==='number'?value:"'"+String(value).replaceAll("'","''")+"'"} WHERE id = ${id};`;}).join('\n');openDialog('Применить изменения',`<p>${esc(dbTarget())} · ${data.transaction?'в открытой транзакции':'Auto-commit'}</p><pre data-language="sql" class="di-mono">${esc(updates)}</pre><p>Рабочая версия проверяет первичный ключ, исходные значения и количество затронутых строк. Здесь меняются только fixture-данные.</p>`,button('apply','Применить в макете','class="di-button primary"'),a=>{if(a==='apply'){Object.entries(data.pending).forEach(([key,value])=>{const [id,column]=key.split(':');data.rows.find(row=>row.id===Number(id))[column]=value;});data.pending={};data.transactionDirty=data.transaction;if(!data.transaction)data.committed=clone(data.rows);dialog.close();data.status=data.transaction?'Изменения применены в транзакции. Доступны Commit / Rollback.':'Изменения сохранены в локальном наборе.';renderData();}});}
    else if(action==='commit'||action==='rollback'){if(action==='commit')data.committed=clone(data.rows);else data.rows=clone(data.committed);data.transactionDirty=false;data.status=action==='commit'?'Транзакция зафиксирована в макете.':'Транзакция откачена в макете.';renderData();}
    else if(action==='import')importWizard();
    else if(action==='export')exportDialog();
    else if(action==='result-filter')openDialog('Фильтр результата',`<label>Текст в любой колонке<input id="di-filter" value="${esc(data.queryFilter)}" placeholder="Например, html или 429"></label>`,button('filter','Применить','class="di-button primary"'),a=>{if(a==='filter'){data.queryFilter=dialog.querySelector('#di-filter').value;dialog.close();renderData();}});
    else if(action==='restore-query'){const entry=data.history[Number(el.dataset.index)];newQuery(entry.sql);dataNotice('Запрос из истории. Текущая цель: '+dbTarget()+'.');}
    else if(action==='cancel-job'){const job=data.jobs.find(j=>j.id===Number(el.dataset.id));job.status='Отменено';job.detail='COPY отменён, транзакция откачена · сценарий';renderData();}
    else if(action==='job-receipt'){const job=data.jobs.find(j=>j.id===Number(el.dataset.id));openDialog('Результат задания',`<div class="di-card"><b>${esc(job.name)}</b><p>${esc(job.target)}<br>${esc(job.method)}<br>${esc(job.status)} · ${job.progress}%</p></div><p>${esc(job.detail)}</p>${job.options?`<details><summary>Параметры задания</summary><pre class="di-mono">${esc(JSON.stringify(job.options,null,2))}</pre></details>`:''}<p class="di-caption">Демонстрация. Реального файла, checksum и серверного commit receipt нет.</p>`,button('receipt-close','Понятно','class="di-button primary"'),a=>{if(a==='receipt-close')dialog.close();});}
    else if(action==='db-agent')sendToAgent(`Контекст Data: ${dbTarget()}; объект public.${data.object}. Помоги проверить запрос:\n${currentQuery()?.sql||'Документ не открыт'}\nМакет: данные и результаты демонстрационные.`,dataNotice);
    else if(action==='db-more')openDialog('Инструменты базы данных',`<div class="di-actions">${button('diagram','ER-диаграмма','class="di-button outline"')}${button('compare','Сравнение схем','class="di-button outline"')}${button('sessions','Активные сессии','class="di-button outline"')}${button('connection-info','Подключение','class="di-button outline"')}${button('db-failure','Сценарий обрыва','class="di-button outline"')}</div><p>Структура, права, миграции и диагностика работают в контексте выбранного подключения.</p>`, '', a=>dataAction(a,el));
    else if(action==='ddl')openDialog('DDL · checkout_retry',`<pre data-language="sql" class="di-mono">CREATE TABLE public.checkout_retry (\n  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  order_id varchar(40) NOT NULL REFERENCES orders(id),\n  attempt integer NOT NULL DEFAULT 1 CHECK (attempt &gt; 0),\n  status_code integer,\n  response_kind text\n);</pre>`,button('ddl-console','Открыть в консоли','class="di-button primary"'),a=>{if(a==='ddl-console'){const text=dialog.querySelector('pre').textContent;dialog.close();newQuery(text,'checkout_retry.ddl.sql');}});
    else if(action==='diagram')openDialog('Связи схемы',`<div class="di-card"><b>customers</b><p>id · bigint PK<br>email · text</p></div><p style="text-align:center">1 ↓ N · orders.customer_id</p><div class="di-card"><b>orders</b><p>id · varchar(40) PK<br>customer_id · bigint FK</p></div><p style="text-align:center">1 ↓ N · checkout_retry.order_id</p><div class="di-card"><b>checkout_retry</b><p>id · bigint PK<br>order_id · varchar(40) FK</p></div><p class="di-caption">Схема демонстрационная. В продукте — панорамирование, масштаб, выбор связей и экспорт.</p>`,button('diagram-close','Готово','class="di-button primary"'),a=>{if(a==='diagram-close')dialog.close();});
    else if(action==='compare')openDialog('Сравнение ДЕВ → ИФТ',`<div class="di-card"><b>public.checkout_retry</b><p class="di-success">+ индекс idx_retry_status(status_code)</p><p>Одинаково: 5 колонок, PK, FK, CHECK</p></div><label class="di-check"><input id="di-compare-index" type="checkbox" checked> Включить индекс в миграцию</label><p class="di-caption">Сравнение fixture. Сгенерированный SQL сначала открывается для review, автоматически не применяется.</p>`,button('migration','Создать SQL','class="di-button primary"'),a=>{if(a==='migration'){const text=dialog.querySelector('#di-compare-index').checked?'CREATE INDEX CONCURRENTLY idx_retry_status\nON public.checkout_retry (status_code);':'-- Изменения не выбраны';dialog.close();newQuery(text,'dev-to-ift.sql');}});
    else if(action==='schema-change')openDialog('Изменение структуры',`<label>Новый столбец<input id="di-column-name" value="duration_ms"></label><label>Тип<select id="di-column-type"><option>bigint</option><option>text</option><option>timestamptz</option></select></label><p>Предпросмотр миграции открывается в консоли. На этом этапе БД не меняется.</p>`,button('schema-sql','Подготовить SQL','class="di-button primary"'),a=>{if(a==='schema-sql'){const name=dialog.querySelector('#di-column-name').value.trim(),type=dialog.querySelector('#di-column-type').value;if(!/^[a-z_][a-z0-9_]*$/.test(name)){dialog.querySelector('#di-column-name').setCustomValidity('Латинские буквы, цифры и _. Начните с буквы.');dialog.querySelector('#di-column-name').reportValidity();return;}dialog.close();newQuery(`ALTER TABLE public.checkout_retry\nADD COLUMN ${name} ${type};`,'migration.sql');}});
    else if(action==='sessions')openDialog('Сессии и блокировки',`<table class="di-grid"><thead><tr><th>PID</th><th>Состояние</th><th>Ожидание</th></tr></thead><tbody><tr><td>4512</td><td>active</td><td>ClientRead</td></tr><tr><td>4550</td><td>idle in transaction</td><td>Lock</td></tr></tbody></table><div class="di-card" style="margin-top:14px"><b>Блокирующая транзакция · 4550</b><p>age 2 min · app: Workbench demo</p><button class="di-button outline" disabled title="В макете нет настоящей сессии. В продукте требуется capability cancel / terminate.">Остановить сессию</button></div>`,button('sessions-close','Готово','class="di-button primary"'),a=>{if(a==='sessions-close')dialog.close();});
    else if(action==='connection-info')openDialog('Подключение · '+data.connection,`<label>Название<input value="${esc(data.connection)}" readonly></label><label>JDBC URL<input value="jdbc:postgresql://example.invalid:5432/payments" readonly></label><div class="di-card"><b>Целевые настройки</b><p>Адрес / порт / БД / схема, SSL и сертификаты, SSH tunnel, driver version, secret reference, timeout, read-only, search_path, привязки к проектам.</p><p>В этом макете секреты не вводятся и сеть не используется.</p></div>`,button('connection-close','Готово','class="di-button primary"'),a=>{if(a==='connection-close')dialog.close();});
    else if(action==='db-failure'){dialog.close();data.queryToken++;data.running=false;dataNotice('Соединение потеряно. Исход последней записи неизвестен. Автоповтор отключён; сначала сверка состояния.',true);openDialog('Соединение прервано',`<p>Последний запрос мог завершиться на сервере. Повторять запись вслепую нельзя.</p><div class="di-card"><b>Восстановление</b><p>1. Проверить соединение.<br>2. Сверить transaction receipt и изменённые строки.<br>3. Продолжить с подтверждённого состояния.</p></div>`,button('reconcile','Сверить в демонстрации','class="di-button primary"'),a=>{if(a==='reconcile'){dialog.close();dataNotice('Сверка завершена в макете: изменений нет. Исходный запрос автоматически не повторён.');}});}
    else if(action==='explain-options'){data.section='explain';renderData();}

  }
  function previewSQLFormatting(){
    const owner=data,query=currentQuery(),before=query.sql,format=window.SuiteSQLFormat?.uppercaseKeywords;
    const after=format?format(before):before;
    openDialog('Форматирование SQL',`<p>В макете доступен один вариант: ключевые слова в верхний регистр. Строки, комментарии и отступы сохраняются. Полное форматирование PostgreSQL будет подключено в приложении.</p><pre data-language="sql" class="di-mono">${esc(after)}</pre><p id="di-format-status" role="status">${!format?'Средство форматирования не загрузилось.':after===before?'Изменений не требуется.':'Предпросмотр изменений текущей консоли.'}</p>`,button('format-apply','Применить','class="di-button primary"'+(after===before?' disabled':'')),action=>{
      if(action!=='format-apply')return;
      if(data!==owner||currentQuery()!==query||query.sql!==before){dialog.querySelector('#di-format-status').textContent='Запрос изменился. Закройте предпросмотр и откройте его заново.';return}
      query.sql=after;query.dirty=true;dialog.close();renderData();dataNotice('Регистр ключевых слов изменён в черновике. SQL не выполнялся.');
    });
  }
  function queryParameters(names,run=false,selected){
    if(!names.length){dataNotice('Именованных параметров нет. Используйте :имя вне строк и комментариев.');return;}
    openDialog('Параметры запроса',`<p>Тип и значение передаются драйверу отдельно от текста SQL. В макете сохраняется локальный набор.</p>${names.map(name=>`<div class="di-columns"><label>:${esc(name)}<input data-param="${esc(name)}" value="${esc(data.queryParams[name]??'')}" placeholder="Значение" ${data.queryParamTypes[name]==='NULL'?'disabled':''}></label><label>Тип<select data-param-type="${esc(name)}">${['text','integer','numeric','timestamp','NULL'].map(type=>`<option ${data.queryParamTypes[name]===type?'selected':''}>${type}</option>`).join('')}</select></label></div>`).join('')}<p class="di-caption">Связь с сервером отсутствует. Параметризованный SQL сохраняется в истории, но не выдаёт выдуманные строки результата.</p>`,button('bind-params',run?'Продолжить демонстрацию':'Сохранить','class="di-button primary"'),action=>{
      if(action!=='bind-params')return;
      const draft={};for(const field of dialog.querySelectorAll('[data-param]')){const type=[...dialog.querySelectorAll('[data-param-type]')].find(node=>node.dataset.paramType===field.dataset.param).value,value=field.value;
        if(type==='integer'&&!/^[+-]?\d+$/.test(value)||type==='numeric'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)){field.setCustomValidity('Введите значение выбранного числового типа.');field.reportValidity();return;}
        draft[field.dataset.param]={type,value:type==='NULL'?null:value};
      }
      Object.entries(draft).forEach(([name,param])=>{data.queryParams[name]=param.value;data.queryParamTypes[name]=param.type;});dialog.close();if(run)executeSQL(true,selected);else dataNotice('Типы и значения параметров сохранены в этом документе.');
    });
    dialog.querySelectorAll('[data-param-type]').forEach(select=>select.onchange=()=>{const field=[...dialog.querySelectorAll('[data-param]')].find(node=>node.dataset.param===select.dataset.paramType);field.disabled=select.value==='NULL';field.setCustomValidity('');});
  }
  function switchDataConnection(next){
    const target=registeredDBs().find(record=>record.id===next);if(!target)return;
    if(data.object){data.tableRows[data.object]=clone(data.rows);data.tableCommitted[data.object]=clone(data.committed);}
    data.connectionSnapshots[data.connection]={object:data.object,tableRows:data.tableRows,tableCommitted:data.tableCommitted,readOnly:data.readOnly,meta:clone(data.connectionMeta),catalogAvailable:data.catalogAvailable};
    const prior=data.connectionSnapshots[next],sameTarget=prior?.meta?.address===target.address&&prior?.meta?.env===target.env&&(prior?.meta?.namespace||'')===(target.namespace||'');
    const seeded=['payments-dev','payments-ift','connection-4','connection-5'].includes(target.id)&&(/example\.invalid/.test(target.address)||String(target.address).startsWith('demo:'));
    const saved=sameTarget?prior:{object:seeded?'checkout_retry':'',tableRows:seeded?{checkout_retry:clone(initialRows)}:{},tableCommitted:seeded?{checkout_retry:clone(initialRows)}:{},readOnly:false,catalogAvailable:seeded};
    data.connection=next;data.connectionMeta=clone(target);data.object=saved.object;data.tableRows=saved.tableRows;data.tableCommitted=saved.tableCommitted;data.rows=clone(data.tableRows[data.object]||[]);data.committed=clone(data.tableCommitted[data.object]||[]);data.readOnly=currentQuery()?.kind==='console'||saved.readOnly;data.catalogAvailable=saved.catalogAvailable;data.rows=[];data.committed=[];data.pending={};data.addedRows=[];data.deletedRows=[];data.selectedRows=[];data.hiddenColumns=[];data.plan=null;data.page=1;data.large=data.rows.length>100;data.queryFilter='';data.sort='id';
  }
  function allowNewDBOperation(){const binding=dbBinding();if(binding.missing){dataNotice('Подключение отвязано от проекта. Текущая консоль и задания сохранили target; для новой операции выберите доступное подключение.',true);return false;}if(binding.changed){dataNotice('Адрес / окружение подключения изменилось в настройках. Текущая консоль сохранила прежний target. Обновите привязку явно.',true);return false;}return true;}
  function resultMutationAllowed(){if(data.readOnly){dataNotice('Представление доступно только для чтения. Для изменений выберите базовую таблицу.',true);return false;}return true;}
  function expandedDataAction(action,el){
    if(['edit-cell','apply-grid','add-row','delete-row','delete-selected'].includes(action)&&(data.readOnly||currentQuery()?.kind!=='table')){dataNotice('Этот результат доступен только для чтения. Откройте базовую таблицу в отдельной вкладке.',true);return true;}
    if(action==='data-jobs'){data.section='jobs';renderData();return true;}
    if(action==='object-query'){newQuery(`SELECT * FROM public.${data.object} LIMIT 100;`,data.object+'.sql');return true;}
    if(action==='ddl-console-new'){newQuery(databaseDDL(data.object),data.object+'.ddl.sql');return true;}
    if(action==='routine-console'){newQuery(currentQuery().sql,data.object+'.sql');return true;}
    if(action==='routine-review'){
      const tab=currentQuery(),text=tab.sql;
      openDialog('Изменение определения',`<div class="di-before-after"><section><h3>Было</h3><pre data-language="sql">${esc(tab.originalSQL)}</pre></section><section><h3>Будет</h3><pre data-language="sql">${esc(text)}</pre></section></div><p>Перед применением нужны проверка зависимостей, компиляция и тесты на выбранном стенде. В макете сервер не изменяется.</p>`,button('routine-draft','Подготовить SQL','class="di-button primary"'),choice=>{if(choice==='routine-draft'){dialog.close();newQuery(text,data.object+'.sql');}});return true;
    }
    if(action==='plan-build'){
      const mode=dataRoot.querySelector('#di-plan-mode')?.value||'estimate',tab=currentQuery(),sql=selectedSQL(tab,data.executionMode,tab.editorView||{start:0,end:0});
      if(!sql){dataNotice('Введите SQL для плана.',true);return true;}
      const build=()=>{data.plan={mode,sql,sourceSQL:tab.sql,target:dbTarget()};data.section='explain';renderData();};
      if(mode==='analyze')openDialog('EXPLAIN ANALYZE',`<p>ANALYZE выполняет запрос на настоящем сервере, включая изменения данных и вызовы функций с побочными эффектами.</p><pre data-language="sql" class="di-mono">${esc(sql)}</pre><p>Сейчас будет показан только демонстрационный план; подключения к БД нет.</p>`,button('analyze-demo','Показать учебный ANALYZE','class="di-button primary"'),choice=>{if(choice==='analyze-demo'){dialog.close();build();}});else build();return true;
    }
    if(action==='grid-columns'){
      const keys=Object.keys(data.rows[0]||data.addedRows[0]||Object.fromEntries((schemaFixtures[data.object]?.columns||[]).map(column=>[column[0],null])));
      openDialog('Видимые столбцы',keys.map(key=>`<label class="di-check"><input type="checkbox" data-grid-column="${esc(key)}" ${data.hiddenColumns.includes(key)?'':'checked'}>${esc(key)}</label>`).join('')+'<p id="di-columns-validation" role="status"></p>',button('columns-save','Применить','class="di-button primary"'),choice=>{if(choice!=='columns-save')return;const shown=[...dialog.querySelectorAll('[data-grid-column]:checked')].map(node=>node.dataset.gridColumn);if(!shown.length){validate();return;}data.hiddenColumns=keys.filter(key=>!shown.includes(key));dialog.close();renderData();});
      function validate(){const valid=dialog.querySelectorAll('[data-grid-column]:checked').length>0;dialog.querySelector('[data-di="columns-save"]').disabled=!valid;dialog.querySelector('#di-columns-validation').textContent=valid?'':'Выберите хотя бы один столбец.';return valid;}
      dialog.querySelectorAll('[data-grid-column]').forEach(node=>node.onchange=validate);validate();return true;
    }
    if(action==='grid-refresh'){
      if(draftCount()||data.transactionDirty){dataNotice('Сначала примените / отмените черновик и завершите транзакцию.',true);return true;}
      data.queryFilter='';data.page=1;data.selectedRows=[];dataNotice('Показан текущий учебный набор. Настоящий refresh потребует соединения с БД.');renderData();return true;
    }
    if(action==='delete-selected'){
      const selected=[...data.selectedRows];data.addedRows=data.addedRows.filter(row=>!selected.includes(row.id));data.deletedRows=[...new Set([...data.deletedRows,...selected.filter(id=>data.rows.some(row=>row.id===id))])];for(const key of Object.keys(data.pending))if(selected.includes(Number(key.split(':')[0])))delete data.pending[key];data.selectedRows=[];data.status='Удаление '+selected.length+' строк подготовлено. Проверьте SQL кнопкой «Применить».';renderData();return true;
    }
    if(action==='discard-grid'){data.pending={};data.addedRows=[];data.deletedRows=[];data.selectedRows=[];data.status='Черновик изменений отменён.';renderData();return true;}
    if(action==='apply-grid'){
      for(const row of data.addedRows){for(const column of Object.keys(row)){if(column==='id')continue;const parsed=parseCellDraft({column,value:String(row[column]??''),isNull:row[column]===null},row);if(parsed.error){beginCellEdit(row.id,column);data.cellEdit.error=parsed.error;renderGridEdit(true);return true;}}}
      const invalid=Object.entries(data.pending).find(([key,value])=>key.endsWith(':attempt')&&(!Number.isInteger(value)||value<1));
      if(invalid||data.addedRows.some(row=>'attempt' in row&&(!Number.isInteger(row.attempt)||row.attempt<1))){dataNotice('CHECK attempt_positive: attempt должен быть целым числом > 0. Черновик сохранён.',true);return true;}
      if(!allowNewDBOperation())return true;
      const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'",table='public.'+data.object;
      const statements=[...data.addedRows.map(row=>`INSERT INTO ${table} (${Object.keys(row).filter(key=>key!=='id').join(', ')}) VALUES (${Object.entries(row).filter(([key])=>key!=='id').map(([,value])=>literal(value)).join(', ')});`),...Object.entries(data.pending).map(([key,value])=>{const [id,column]=key.split(':');return `UPDATE ${table} SET ${column} = ${literal(value)} WHERE id = ${id};`}),...data.deletedRows.map(id=>`DELETE FROM ${table} WHERE id = ${id};`)];
      if(!statements.length)return true;
      const owner=data,documentOwner=currentQuery(),draftSnapshot=JSON.stringify([data.connectionMeta,data.pending,data.addedRows,data.deletedRows,data.transaction]);
      openDialog('Применить изменения',`<p>${esc(dbTarget())} · ${data.transaction?'Manual · требуется Commit':'Auto-commit'}</p><pre data-language="sql" class="di-mono">${esc(statements.join('\n'))}</pre><p>В макете изменится только набор текущего документа. Настоящее применение требует проверки исходных значений, ограничений и числа затронутых строк.</p>`,button('apply','Применить в макете','class="di-button primary"'),choice=>{if(choice!=='apply')return;if(data!==owner||currentQuery()!==documentOwner||draftSnapshot!==JSON.stringify([data.connectionMeta,data.pending,data.addedRows,data.deletedRows,data.transaction])){dialog.close();dataNotice('Документ, цель или черновик изменились. Откройте проверку SQL заново.',true);return;}if(!allowNewDBOperation()){dialog.close();return;}data.rows=[...data.rows,...data.addedRows].filter(row=>!data.deletedRows.includes(row.id));Object.entries(data.pending).forEach(([key,value])=>{const [id,column]=key.split(':'),row=data.rows.find(item=>item.id===Number(id));if(row)row[column]=value});data.pending={};data.addedRows=[];data.deletedRows=[];data.selectedRows=[];data.transactionDirty=data.transaction;if(!data.transaction)data.committed=clone(data.rows);dialog.close();data.status=data.transaction?'Черновик применён в учебной транзакции. Commit / Rollback доступны.':'Изменения применены к локальному набору.';renderData();});return true;
    }
    if(['import','export','apply-grid','add-row','delete-row'].includes(action)&&!allowNewDBOperation())return true;
    if(action==='db-binding'){
      const binding=dbBinding();
      if(binding.changed){openDialog('Настройки подключения изменились',`<p>Активная консоль: ${esc(dbTarget())}</p><p>Новый адрес: ${esc(binding.current.address)}<br>Новое окружение: ${esc(binding.current.env)}</p><p>Уже запущенные задания и транзакции не перенаправляются. Новый target можно принять после завершения работы текущей консоли.</p>`,button('accept-binding','Обновить привязку','class="di-button primary"'),choice=>{if(choice!=='accept-binding')return;if(data.running||data.transactionDirty||Object.keys(data.pending).length){dataNotice('Сначала завершите текущий запрос / транзакцию / изменения.',true);dialog.close();return;}switchDataConnection(data.connection);dialog.close();data.status='Новая конфигурация принята явно. Старые задания сохранили прежнюю цель.';renderData();});}
      else if(window.SuitePrototype?.settings)window.SuitePrototype.settings('Подключения');
      else dataAction('connection-info',el);
      return true;
    }
    if(action==='db-demo-catalog'){
      if(!allowNewDBOperation())return true;
      data.catalogAvailable=true;data.object='checkout_retry';data.rows=clone(initialRows);data.committed=clone(initialRows);data.tableRows={};data.tableCommitted={};data.status='Открыт учебный каталог. Эти таблицы не загружены с '+data.connectionMeta.name+'.';renderData();return true;
    }
    if(action==='edit-cell'){beginCellEdit(Number(el.dataset.row),el.dataset.column);return true;}
    if(action==='apply-grid'){
      const invalid=Object.entries(data.pending).find(([key,value])=>key.endsWith(':attempt')&&(!Number.isInteger(value)||value<1));
      if(invalid){dataNotice('CHECK attempt_positive: attempt должен быть целым числом > 0. Изменения остались в черновике.',true);return true;}
    }
    if(action==='schema-change'){
      if(data.readOnly){dataNotice('Для этой таблицы системного каталога / view показан режим чтения. Выберите базовую таблицу.',true);return true;}
      const target=data.object;
      openDialog('Изменение структуры · '+target,`<label>Новый столбец<input id="di-column-name" value="duration_ms"></label><label>Тип<select id="di-column-type"><option>bigint</option><option>text</option><option>timestamptz</option></select></label><label class="di-check"><input id="di-column-nullable" type="checkbox" checked> Разрешить NULL</label><p>Перед применением: diff, блокировки, оценка rewrite таблицы и rollback. В макете откроется SQL.</p>`,button('column-sql','Предпросмотр SQL','class="di-button primary"'),a=>{if(a!=='column-sql')return;const field=dialog.querySelector('#di-column-name'),name=field.value.trim(),type=dialog.querySelector('#di-column-type').value;if(!/^[a-z_][a-z0-9_]*$/.test(name)){field.setCustomValidity('Используйте буквы, цифры и _.');field.reportValidity();return;}const nullable=dialog.querySelector('#di-column-nullable').checked;dialog.close();newQuery(`ALTER TABLE public.${target}\nADD COLUMN ${name} ${type}${nullable?'':' NOT NULL'};${nullable?'':'\n-- Existing rows require a default or staged backfill before NOT NULL.'}`,'migration-'+target+'.sql');});return true;
    }
    if(action==='db-object'){openDatabaseObject(el.dataset.name,el.dataset.group);return true;}
    if(['page-first','page-prev','page-next','page-last'].includes(action)){const count=Math.max(1,Math.ceil(filteredRows().length/data.pageSize));data.page=action==='page-first'?1:action==='page-last'?count:Math.max(1,Math.min(count,data.page+(action==='page-next'?1:-1)));renderData();return true;}
    if(action==='clear-result-filter'){data.queryFilter='';data.page=1;renderData();return true;}
    if(action==='result-menu'){
      openDialog('Результат запроса',`<div class="di-actions">${button('result-large','Большой набор · 5 000 строк','class="di-button outline"')}${button('result-small','Вернуть исходные строки','class="di-button outline"')}${button('add-row','Добавить строку','class="di-button outline"')}${button('delete-row','Удалить строку…','class="di-button outline"')}${button('query-parameters','Параметры запроса','class="di-button outline"')}${button('query-limit','Лимит и таймаут','class="di-button outline"')}</div><p>Постраничный результат не загружается целиком в DOM. Масштаб набора — сценарий интерфейса, не benchmark драйвера.</p>`,'',a=>{dialog.close();dataAction(a,el);});return true;
    }
    if(action==='result-large'||action==='result-small'){
      if(data.transactionDirty||Object.keys(data.pending).length){dataNotice('Сначала завершите изменения результата.',true);return true;}
      if(currentQuery()?.kind!=='console'||data.object!=='checkout_retry'){dataNotice('Сценарий большого результата доступен только в консоли checkout_retry. Объект документа не изменён.');return true;}data.readOnly=true;data.large=action==='result-large';data.rows=data.large?Array.from({length:5000},(_,i)=>({id:1000+i,order_id:'ord_'+String(i+1).padStart(6,'0'),attempt:i%3+1,status_code:i%7===0?429:200,response_kind:i%7===0?'html':'json'})):clone(initialRows);data.committed=clone(data.rows);data.page=1;data.queryFilter='';data.sort='id';data.status=data.large?'5 000 синтетических строк · страницы по '+data.pageSize:'Исходный набор восстановлен';renderData();return true;
    }
    if(action==='query-parameters'){queryParameters(sqlParameterNames(currentQuery().sql));return true;}
    if(action==='query-limit'){openDialog('Пределы выполнения',`<div class="di-columns"><label>Лимит строк<input id="di-query-rows" type="number" min="1" value="${data.limits.rows}"></label><label>Таймаут, секунд<input id="di-query-time" type="number" min="1" value="${data.limits.timeout}"></label></div><label class="di-check"><input type="checkbox" checked> Получать результат курсором</label><label class="di-check"><input type="checkbox" checked> Не читать LOB целиком до открытия</label><p>Отмена прерывает запрос и закрывает курсор. Если исход записи неизвестен, она не повторяется.</p>`,button('limits-save','Сохранить','class="di-button primary"'),a=>{if(a==='limits-save'){const rows=Number(dialog.querySelector('#di-query-rows').value),time=Number(dialog.querySelector('#di-query-time').value);if(!Number.isInteger(rows)||rows<1||!Number.isFinite(time)||time<1)return;data.limits={rows,timeout:time};dialog.close();dataNotice(`Лимит ${rows} строк · timeout ${time} с · настройки демонстрации`);}});return true;}
    if(action==='add-row'){
      if(!resultMutationAllowed())return true;
      const row={id:Math.max(0,...data.rows.map(r=>r.id),...data.addedRows.map(r=>r.id))+1},schema=schemaFixtures[data.object]?.columns||[];
      for(const [column,type,required,defaultValue] of schema){if(column==='id')continue;row[column]=/^[-+]?\d+(?:\.\d+)?$/.test(defaultValue)?(/^(bigint|integer)/.test(type)?Number(defaultValue):defaultValue):/^'[^']*'$/.test(defaultValue)?defaultValue.slice(1,-1):required==='NOT NULL'?'':null;}
      data.addedRows.push(row);const index=filteredRows().findIndex(item=>item.id===row.id);data.page=Math.floor(index/data.pageSize)+1;data.hiddenColumns=[];
      beginCellEdit(row.id,Object.keys(row).find(key=>key!=='id'));return true;
    }
    if(action==='delete-row'){
      if(!resultMutationAllowed())return true;
      openDialog('Удаление строки',`<label>Первичный ключ id<input id="di-delete-row" type="number" value="${data.rows[0]?.id??''}"></label><p>${esc(dbTarget())}.${esc(data.object)} · удаление сначала проверяет точный ключ и исходное значение строки.</p>`,button('remove-row','Удалить в макете','class="di-button outline"'),a=>{if(a!=='remove-row')return;const id=Number(dialog.querySelector('#di-delete-row').value);if(!data.rows.some(row=>row.id===id)){dialog.querySelector('#di-delete-row').setCustomValidity('Такой строки нет.');dialog.querySelector('#di-delete-row').reportValidity();return;}data.deletedRows=[...new Set([...data.deletedRows,id])];dialog.close();data.status='Удаление строки id = '+id+' подготовлено. Нажмите Применить.';renderData();});return true;
    }
    if(action==='job-413'){
      const job=data.jobs.find(item=>item.id===Number(el.dataset.id));job.status='Исход неизвестен';job.detail='413 · HTML от шлюза · повтор приостановлен';renderData();
      openDialog('Импорт остановлен · 413',`<p><b>${esc(job.target)}</b> · цель зафиксирована в задании</p><pre data-language="log" class="di-mono">HTTP 413 Request Entity Too Large\ncontent-type: text/html\n&lt;h1&gt;Request Entity Too Large&lt;/h1&gt;</pre><p>HTML показан как текст. Сначала нужно проверить, получил ли worker задание и были ли записаны данные. Повтор неизменённого большого запроса не поможет.</p><div class="di-card"><b>Восстановление</b><p>Передавать файловый поток через согласованный транспорт, ограничить размер chunk при поддержке адаптера, сохранить backpressure. Изменение лимита шлюза — отдельная настройка, не обход.</p></div>`,button('check-job','Сверить состояние','class="di-button primary"'),a=>{if(a!=='check-job')return;job.status='Можно повторить';job.detail='Сверка fixture: worker не принял задание, транзакции нет';openDialog('Сверка завершена',`<p>${esc(job.detail)}</p><p>Новое задание сохраняет прежний target. В демонстрации подтверждено отсутствие записи; это не разрешение повторять реальную операцию без сверки.</p>`,button('restart-job','Создать новый запуск','class="di-button primary"'),choice=>{if(choice==='restart-job'){dialog.close();const original=registeredDBs().find(record=>record.id===job.targetMeta?.id);if(!original||original.address!==job.targetMeta.address||original.env!==job.targetMeta.env||(original.namespace||'')!==(job.targetMeta.namespace||'')){dataNotice('Исходное подключение изменено или отвязано. Повтор задания не перенаправлен; восстановите привязку.',true);return;}startJob(job.name+' · повтор после сверки',job.target,job.method,job.targetMeta,clone(job.options||{}));}});renderData();});return true;
    }
    if(action==='compare'){schemaCompare();return true;}
    if(action==='diagram'){schemaDiagram();return true;}
    if(action==='ddl'){
      const columns=schemaFixtures[data.object]?.columns||schemaFixtures.checkout_retry.columns;
      const sql=`CREATE TABLE public.${data.object} (\n${columns.map(([name,type,nullable])=>'  '+name+' '+type+(nullable==='NOT NULL'?' NOT NULL':'')).join(',\n')}\n);`;
      openDialog('DDL · '+data.object,`<pre data-language="sql" class="di-mono">${esc(sql)}</pre><p class="di-caption">Сокращённое DDL fixture. Реальный экспорт должен включать defaults, identity, ограничения, права, комментарии и зависимости.</p>`,button('open-ddl','Открыть в консоли','class="di-button primary"'),a=>{if(a==='open-ddl'){dialog.close();newQuery(sql,data.object+'.ddl.sql');}});return true;
    }
    return false;
  }
  function databaseTargetMatches(snapshot){
    const current=snapshot&&registeredDBs().find(record=>record.id===snapshot.id);
    return Boolean(current&&['id','name','address','env','namespace'].every(key=>(current[key]||'')===(snapshot[key]||'')));
  }
  function schemaCompare(){
    const owner=data,records=registeredDBs().map(record=>clone(record)),sourceId=records.find(record=>record.id===data.connection)?.id||records[0]?.id||'',targetId=records.find(record=>record.id!==sourceId)?.id||'';
    const label=record=>record?`${record.env} · ${record.name}`:'Подключение не выбрано';
    const options=selected=>`<option value="" ${!selected?'selected':''} disabled>Выберите подключение</option>`+records.map(record=>`<option value="${esc(record.id)}" ${record.id===selected?'selected':''}>${esc(label(record))}</option>`).join('');
    const differences=[
      {name:'idx_retry_status',kind:'Индекс',sql:'CREATE INDEX CONCURRENTLY idx_retry_status\nON public.checkout_retry (status_code);',risk:'Учебный пример добавления индекса'},
      {name:'orders.comment',kind:'Столбец',sql:'ALTER TABLE public.orders ADD COLUMN comment text;',risk:'Учебный пример нового nullable столбца'},
      {name:'legacy_retry_log',kind:'Таблица',sql:'DROP TABLE public.legacy_retry_log;',risk:'Учебный пример удаления данных · не выбран по умолчанию'}
    ];
    function selectedTargets(){return {source:records.find(record=>record.id===dialog.querySelector('#di-compare-source').value),target:records.find(record=>record.id===dialog.querySelector('#di-compare-target').value)};}
    function validate(){
      const {source,target}=selectedTargets();let error='';
      if(owner!==data)error='Проект изменился. Откройте сравнение заново.';
      else if(!source||!target)error='Выберите два доступных подключения.';
      else if(source.id===target.id)error='Источник и назначение должны быть разными подключениями.';
      else if(!databaseTargetMatches(source)||!databaseTargetMatches(target))error='Настройки выбранного подключения изменились. Откройте сравнение заново.';
      dialog.querySelector('#di-compare-validation').textContent=error;dialog.querySelector('[data-di="migration-preview"]').disabled=Boolean(error);return !error;
    }
    openDialog('Сравнение схем',`<div class="di-columns"><label>Источник<select id="di-compare-source" aria-label="Источник сравнения">${options(sourceId)}</select></label><label>Назначение<select id="di-compare-target" aria-label="Назначение сравнения">${options(targetId)}</select></label></div><p><b>Схема public · учебное сравнение</b><br>Реальные каталоги не загружаются. Показанные ниже различия — один фиксированный пример и не являются результатом сравнения выбранных серверов.</p><p id="di-compare-validation" class="di-error" role="status"></p>${differences.map((item,index)=>`<div class="di-card"><label class="di-check"><input type="checkbox" data-diff="${index}" ${index<2?'checked':''}><b>${item.kind} · ${item.name}</b></label><p>${item.risk}</p><pre data-language="sql" class="di-mono">${esc(item.sql)}</pre></div>`).join('')}`,button('migration-preview','Предпросмотр учебной миграции','class="di-button primary"'),action=>{
      if(action!=='migration-preview'||!validate())return;
      const targets=selectedTargets(),sourceSnapshot=clone(targets.source),targetSnapshot=clone(targets.target),selected=[...dialog.querySelectorAll('[data-diff]:checked')].map(node=>differences[Number(node.dataset.diff)]).filter(Boolean);
      const sql=selected.map(item=>item.sql).join('\n\n');
      openDialog('Учебная миграция · '+label(sourceSnapshot)+' → '+label(targetSnapshot),`<p><b>Назначение: ${esc(label(targetSnapshot))} / public</b><br>Подключение: <code>${esc(targetSnapshot.id)}</code><br>${selected.length} учебных изменений. Серверное сравнение и применение не выполнялись.</p><pre data-language="sql" class="di-mono">${esc(sql||'-- Изменения не выбраны')}</pre><div class="di-card"><b>До реального применения</b><p>Получить серверные каталоги и schema fingerprint; проверить зависимости, блокировки и rollback. CREATE INDEX CONCURRENTLY нельзя включать в общую транзакцию. Удаление данных требует отдельной проверки.</p></div><p id="di-migration-validation" class="di-error" role="status"></p>`,button('migration-console','Открыть SQL для review','class="di-button primary"'+(selected.length?'':' disabled')),choice=>{
        if(choice!=='migration-console'||!selected.length)return;
        if(data!==owner||!databaseTargetMatches(sourceSnapshot)||!databaseTargetMatches(targetSnapshot)){
          dialog.querySelector('#di-migration-validation').textContent='Проект или настройки подключения изменились. Консоль не создана; закройте предпросмотр и выполните выбор заново.';
          dialog.querySelector('[data-di="migration-console"]').disabled=true;return;
        }
        dialog.close();newQuery('-- Учебная миграция: проверьте реальные каталоги перед применением.\n-- Target ID: '+String(targetSnapshot.id).replace(/[\r\n]/g,' ')+'\n'+sql,'migration-public.sql');
        switchDataConnection(targetSnapshot.id);currentQuery().migrationSnapshot={source:sourceSnapshot,target:targetSnapshot,schema:'public',fixture:true,differences:selected.map(item=>item.name)};
        data.status='SQL закреплён за '+label(targetSnapshot)+' ('+targetSnapshot.id+'). Это учебная миграция; DDL не выполнялся.';renderData();
      });
    });
    dialog.querySelector('#di-compare-source').onchange=validate;dialog.querySelector('#di-compare-target').onchange=validate;validate();
  }
  function schemaDiagram(){
    openDialog('ER-диаграмма · public',`<div class="di-bar">${button('diagram-out','−','aria-label="Уменьшить диаграмму"')}<span id="di-zoom-value">${data.diagramZoom}%</span>${button('diagram-in','+','aria-label="Увеличить диаграмму"')}${button('diagram-reset','Вписать')}</div><div style="height:310px;overflow:auto;border:1px solid var(--line);border-radius:8px"><div id="di-schema-diagram" style="min-width:570px;padding:25px;transform-origin:top left;zoom:${data.diagramZoom/100}"><div class="di-card" style="width:190px"><b>customers</b><p>id · bigint PK<br>email · text</p>${button('diagram-object','Открыть',`data-object="customers"`)}</div><div style="margin:0 0 8px 80px">1 ↓ N</div><div class="di-card" style="width:190px;margin-left:150px"><b>orders</b><p>id · bigint PK<br>customer_id · bigint FK</p>${button('diagram-object','Открыть',`data-object="orders"`)}</div><div style="margin:0 0 8px 225px">1 ↓ N</div><div class="di-card" style="width:190px;margin-left:300px"><b>checkout_retry</b><p>id · bigint PK<br>order_id · FK</p>${button('diagram-object','Открыть',`data-object="checkout_retry"`)}</div></div></div><p class="di-caption">Прокручивайте схему; масштаб и переход в таблицу работают локально.</p>`,button('diagram-done','Готово','class="di-button primary"'),(action,node)=>{if(action==='diagram-done')dialog.close();else if(action==='diagram-object'){const name=node.dataset.object;dialog.close();dataAction('db-object',{dataset:{name,group:'Таблицы'}});}else{data.diagramZoom=action==='diagram-reset'?100:Math.max(50,Math.min(150,data.diagramZoom+(action==='diagram-in'?10:-10)));dialog.querySelector('#di-zoom-value').textContent=data.diagramZoom+'%';dialog.querySelector('#di-schema-diagram').style.zoom=data.diagramZoom/100;}});
  }
  dataRoot.addEventListener('click',event=>{const el=event.target.closest('[data-di]');if(el)dataAction(el.dataset.di,el);});
  dataRoot.addEventListener('input',event=>{
    if(event.target.id==='di-cell-input'&&data.cellEdit){data.cellEdit.value=event.target.value;data.cellEdit.isNull=false;data.cellEdit.error='';event.target.classList.remove('d2-null-value');event.target.setAttribute('aria-invalid','false');return;}
    if(event.target.id==='di-sql'){currentQuery().sql=event.target.value;currentQuery().dirty=true;captureDataEditor();const gutter=dataRoot.querySelector('.di-gutter');if(gutter)gutter.textContent=event.target.value.split('\n').map((_,i)=>i+1).join('\n');}
    if(event.target.id==='di-schema-search'){data.schemaFilter=event.target.value;dataRoot.querySelector('#di-schema-list').innerHTML=schemaTree();}
    if(event.target.id==='di-result-search'){data.queryFilter=event.target.value;data.page=1;const start=event.target.selectionStart,end=event.target.selectionEnd;const content=dataRoot.querySelector('#di-data-content');content.innerHTML=dataSection();const next=dataRoot.querySelector('#di-result-search');next.focus({preventScroll:true});next.setSelectionRange(start,end);}
  });
  dataRoot.addEventListener('select',event=>{if(event.target.id==='di-sql')captureDataEditor();});
  dataRoot.addEventListener('change',event=>{
    const field=event.target;
    if(data.cellEdit&&!finishCellEdit())return;
    if(field.id==='di-page-size'){data.pageSize=Number(field.value);data.page=1;renderData();}
    if(field.id==='di-execution-mode')data.executionMode=field.value;
    if(field.id==='di-connection'){
      const next=field.value;if(next===data.connection)return;
      if(!currentQuery()){switchDataConnection(next);data.status='Подключение для новых документов: '+dbTarget();renderData();return;}
      const sql=currentQuery()?.kind==='console'?currentQuery().sql:`SELECT * FROM public.${data.object||'checkout_retry'} LIMIT 100;`;
      newQuery(sql);switchDataConnection(next);data.status='Открыта отдельная консоль для '+dbTarget()+'. Другие документы сохранили свои подключения.';renderData();
    }
    if(field.id==='di-tx-mode'){if(data.transactionDirty){field.value='manual';dataNotice('Сначала завершите текущую транзакцию.',true);}else{data.transaction=field.value==='manual';renderData();}}
    if(field.hasAttribute('data-di-row-select')){const id=Number(field.dataset.diRowSelect);data.selectedRows=field.checked?[...new Set([...data.selectedRows,id])]:data.selectedRows.filter(value=>value!==id);renderData();}
    if(field.hasAttribute('data-di-select-all')){const offset=(data.page-1)*data.pageSize,ids=filteredRows().slice(offset,offset+data.pageSize).map(row=>row.id);data.selectedRows=field.checked?[...new Set([...data.selectedRows,...ids])]:data.selectedRows.filter(id=>!ids.includes(id));renderData();}
  });
  function resizeDatabasePane(kind,value){
    const explorer=kind==='explorer',max=explorer?Math.max(150,Math.min(360,dataRoot.clientWidth-300)):Math.max(90,Math.min(500,dataRoot.clientHeight-250)),next=Math.round(Math.max(explorer?150:90,Math.min(max,value)));
    if(explorer)data.explorerWidth=next;else data.editorHeight=next;dataRoot.style.setProperty(explorer?'--d2-explorer-width':'--d2-editor-height',next+'px');
    const separator=dataRoot.querySelector(`[data-d2-resize="${kind}"]`);if(separator){separator.setAttribute('aria-valuenow',String(next));separator.setAttribute('aria-valuemax',String(max));}
  }
  let dataResize=null;
  dataRoot.addEventListener('pointerdown',event=>{const handle=event.target.closest('[data-d2-resize]');if(!handle||event.button!==0)return;event.preventDefault();event.stopPropagation();const kind=handle.dataset.d2Resize;dataResize={kind,start:kind==='explorer'?event.clientX:event.clientY,value:kind==='explorer'?data.explorerWidth||210:data.editorHeight||174};dataRoot.setPointerCapture(event.pointerId);dataRoot.classList.add('d2-resizing');});
  dataRoot.addEventListener('pointermove',event=>{if(!dataResize)return;const coordinate=dataResize.kind==='explorer'?event.clientX:event.clientY;resizeDatabasePane(dataResize.kind,dataResize.value+coordinate-dataResize.start);});
  const endDataResize=()=>{dataResize=null;dataRoot.classList.remove('d2-resizing');};dataRoot.addEventListener('pointerup',endDataResize);dataRoot.addEventListener('pointercancel',endDataResize);
  dataRoot.addEventListener('dblclick',event=>{const cell=event.target.closest('[data-di="select-cell"]');if(cell){event.preventDefault();beginCellEdit(Number(cell.dataset.row),cell.dataset.column);}});
  dataRoot.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    const inline=event.target.id==='di-cell-input',cell=event.target.closest('[data-di="select-cell"]');
    if(inline){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelCellEdit();return;}
      if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();event.stopPropagation();if(finishCellEdit()&&event.key==='Tab')moveGridCell(event.shiftKey?'left':'right',true);return;}
      if(event.ctrlKey&&event.altKey&&event.key.toLowerCase()==='n'){event.preventDefault();if(cellSchema(data.cellEdit.column)?.[2]!=='NOT NULL'){data.cellEdit.isNull=true;data.cellEdit.value='';renderGridEdit(true);}return;}
    }
    if(cell){
      data.activeCell=cell.dataset.row+':'+cell.dataset.column;
      if(event.key==='F2'||event.key==='Enter'){event.preventDefault();beginCellEdit(Number(cell.dataset.row),cell.dataset.column);return;}
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();moveGridCell(event.key.slice(5).toLowerCase());return;}
      if(event.ctrlKey&&event.altKey&&event.key.toLowerCase()==='n'){event.preventDefault();if(cellSchema(cell.dataset.column)?.[2]!=='NOT NULL'&&beginCellEdit(Number(cell.dataset.row),cell.dataset.column)){data.cellEdit.isNull=true;data.cellEdit.value='';finishCellEdit();}return;}
      if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();beginCellEdit(Number(cell.dataset.row),cell.dataset.column,event.key);return;}
    }

    if(event.target.id==='di-sql'&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();executeSQL();return;}
    const handle=event.target.closest('[data-d2-resize]');if(handle&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();const kind=handle.dataset.d2Resize,value=kind==='explorer'?data.explorerWidth||210:data.editorHeight||174;resizeDatabasePane(kind,event.key==='Home'?0:event.key==='End'?1000:value+(['ArrowLeft','ArrowUp'].includes(event.key)?-10:10));}
  });
  window.SuiteDatabasePrototype={snapshot:()=>clone(data),sqlStatementRanges,sqlParameterNames};

  /* IDE — interactive editor, review and debug fixtures, isolated from real files. */
  let files = {
    'src/retry-policy.ts':`export type RetryPolicy = {\n  maxAttempts: number;\n  delayMs: number;\n};\n\nexport async function executeWithRetry<T>(\n  operation: () => Promise<T>,\n  policy: RetryPolicy,\n): Promise<T> {\n  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {\n    try {\n      return await operation();\n    } catch (error) {\n      if (attempt === policy.maxAttempts) throw error;\n      await new Promise(resolve => setTimeout(resolve, policy.delayMs));\n    }\n  }\n  throw new Error('Retry exhausted');\n}\n`,
    'src/checkout.ts':`import { executeWithRetry } from './retry-policy';\n\nexport async function checkout(orderId: string) {\n  return executeWithRetry(\n    () => fetch('/orders/' + orderId),\n    { maxAttempts: 3, delayMs: 300 },\n  );\n}\n`,
    'src/Checkout.tsx':`import { useState } from 'react';\n\nexport function Checkout() {\n  const [pending, setPending] = useState(false);\n  return (\n    <button disabled={pending} onClick={() => setPending(true)}>\n      {pending ? 'Processing…' : 'Continue'}\n    </button>\n  );\n}\n`,
    'tests/retry-policy.test.ts':`import { describe, it, expect } from 'vitest';\nimport { executeWithRetry } from '../src/retry-policy';\n\ndescribe('retry policy', () => {\n  it('returns successful result', async () => {\n    const result = await executeWithRetry(\n      async () => 42, { maxAttempts: 3, delayMs: 0 },\n    );\n    expect(result).toBe(42);\n  });\n});\n`,
    'backend/PaymentService.java':`package com.atlas.payments;\n\nimport java.math.BigDecimal;\n\npublic class PaymentService {\n    public BigDecimal total(BigDecimal amount) {\n        return amount;\n    }\n}\n`,
    'scripts/verify_import.py':`from decimal import Decimal\n\ndef verify_total(rows):\n    return sum(Decimal(row['amount']) for row in rows)\n\nif __name__ == '__main__':\n    print(verify_total([{'amount': '12.50'}]))\n`,
    'README.md':'# Atlas workspace\n\nRetry policy, checkout UI and PostgreSQL utilities.\n\nRun tests before reviewing the patch.\n'
  };
  let ide={open:['src/retry-policy.ts','src/checkout.ts'],active:'src/retry-policy.ts',saved:clone(files),dirty:new Set(),explorer:true,expanded:new Set(['src','tests','backend','scripts']),filter:'',bottom:'problems',bottomCollapsed:true,status:'',breakpoints:new Set([14]),breakpointFiles:{'src/retry-policy.ts':[14]},editorViews:{},debug:false,debugLine:14,output:'Run configuration: Retry policy tests\nНажмите Run для демонстрации запуска.',running:false,runToken:0,config:'Retry policy tests',search:'',searchResults:[],searchMode:false,replace:'',terminal:'Workbench prototype terminal\nКоманды выполняются только как сценарии интерфейса.\n',terminalDraft:'',debugWatches:['attempt','policy.maxAttempts'],tests:[{name:'returns successful result',status:'Не запускался'},{name:'retries HTTP 429',status:'Не запускался'},{name:'does not replay unknown write',status:'Не запускался'}],runConfigurations:{'Retry policy tests':{command:'npm test',cwd:'.',env:'ДЕВ',before:''},'React · dev server':{command:'npm run dev',cwd:'.',env:'ДЕВ',before:''},'Java · PaymentService':{command:'./mvnw test',cwd:'backend',env:'ДЕВ',before:''},'Python · verify_import':{command:'python verify_import.py',cwd:'scripts',env:'ДЕВ',before:''}}};
  ide.languageActive='ts';
  ide.languageServices={
    ts:{name:'TypeScript / React',engine:'TypeScript language service',state:'ready',progress:100,token:0,executable:'node',sdk:'workspace TypeScript',root:'.',include:'src/**, tests/**',exclude:'node_modules/**, dist/**',mode:'Готово',capabilities:{completion:true,rename:true,extract:true,signature:true}},
    java:{name:'Java',engine:'Eclipse JDT LS',state:'unconfigured',progress:0,token:0,executable:'',sdk:'JDK не выбран',root:'backend',include:'src/**',exclude:'target/**',mode:'Не настроено',capabilities:{completion:false,rename:false,extract:false,signature:false}},
    python:{name:'Python',engine:'Python LSP',state:'ready',progress:100,token:0,executable:'python',sdk:'.venv',root:'scripts',include:'**/*.py',exclude:'.venv/**, __pycache__/**',mode:'Нет semantic capability',capabilities:{completion:true,rename:true,extract:false,signature:false}}
  };
  ide.profiler={state:'empty',runtime:'Node · workbench',mode:'CPU',scenario:'Обычная запись',progress:0,token:0,report:null,sample:null,hotspot:0};
  const ideNotice=message=>{ide.status=message;updateNotice(ideRoot,message,false,'dismiss-ide-notice');};
  function ideTree(){
    if(explorerWorkbench)return explorerWorkbench.tree();
    const paths=Object.keys(files).filter(path=>path.toLowerCase().includes(ide.filter.toLowerCase()));
    const row=path=>`<div style="display:flex;min-width:0"><button class="di-tree" style="flex:1;min-width:0" data-di="open-file" data-path="${esc(path)}" aria-current="${path===ide.active}" title="${esc(path)}">${icon('file')}<span>${esc(path.split('/').pop())}</span>${ide.dirty.has(path)?'<small>●</small>':''}</button>${button('file-menu','⋯',`class="di-button di-icon" style="width:22px" data-path="${esc(path)}" aria-label="Действия с ${esc(path)}"`)}</div>`;
    const root={folders:new Map(),paths:[]};
    for(const path of paths){const parts=path.split('/');let node=root;for(const folder of parts.slice(0,-1)){if(!node.folders.has(folder))node.folders.set(folder,{folders:new Map(),paths:[]});node=node.folders.get(folder);}node.paths.push(path);}
    const draw=(node,prefix='')=>[...node.folders.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,child])=>{const key=prefix?prefix+'/'+name:name;return `<details class="di-file-folder" data-folder="${esc(key)}" data-project="${esc(scopeName())}" data-filter-open="${Boolean(ide.filter)}" ${ide.expanded.has(key)||ide.filter?'open':''}><summary>${esc(name)}</summary><div style="padding-left:6px">${draw(child,key)}</div></details>`;}).join('')+node.paths.map(row).join('');
    return draw(root)||'<p class="di-caption">Файлы не найдены</p>';
  }
  function ideExplorer(){if(explorerWorkbench)return explorerWorkbench.markup();return `<aside id="di-project-files" class="di-explorer" ${ide.explorer?'':'hidden'} aria-label="Файлы проекта"><input id="di-file-search" placeholder="Найти файл…" aria-label="Найти файл" value="${esc(ide.filter)}"><div id="di-project-caption" class="di-caption" style="padding:0 6px 9px">${esc(scopeName())}</div><div id="di-file-list">${ideTree()}</div>${button('new-file','+ Новый файл','style="margin-top:10px"')}</aside>`;}
  function restoreExplorerView(){ideRoot.dataset.project=scopeName();const explorer=ideRoot.querySelector('#di-project-files');if(explorer&&!explorer.hidden)explorer.scrollTop=ide.explorerScroll||0;}
  function ideBottomPanel(){return `<div class="di-bottom"><div class="di-bottom-resizer" role="separator" tabindex="0" aria-label="Размер нижней панели IDE" aria-orientation="horizontal" aria-valuemin="120" aria-valuemax="600" aria-valuenow="${ide.bottomHeight||260}"></div><nav class="di-subnav" aria-label="Панель редактора">${[['problems','Проблемы'+(ideProblems().length?' · '+ideProblems().length:'')],['output','Вывод'],['tests','Тесты'],['terminal','Терминал'],['debug','Отладка'],['search','Поиск'],['toolchain','Среда']].map(([key,label])=>button('ide-bottom',label,`data-section="${key}" class="di-button ${!ide.bottomCollapsed&&ide.bottom===key?'active':''}" aria-pressed="${!ide.bottomCollapsed&&ide.bottom===key}"`)).join('')}${button('toggle-ide-bottom',ide.bottomCollapsed?'⌃':'⌄',`aria-label="${ide.bottomCollapsed?'Показать':'Скрыть'} нижнюю панель IDE" aria-expanded="${!ide.bottomCollapsed}" style="margin-left:auto"`)}</nav><div class="di-content" id="di-ide-bottom" ${ide.bottomCollapsed?'hidden':''}>${ideBottom()}</div></div>`;}
  function renderEmptyIDE(){
    ideRoot.dataset.buffer=scopeName()+':empty';
    ideRoot.innerHTML=`<div class="di-bar">${button('file-tree',icon('panel'),'aria-label="'+(ide.explorer?'Скрыть проводник проекта':'Показать проводник проекта')+'" title="'+(ide.explorer?'Скрыть проводник проекта':'Показать проводник проекта')+'" aria-pressed="'+ide.explorer+'" aria-controls="di-project-files"')}<strong>Code</strong><span class="di-demo">Демонстрация</span><span class="di-spacer"></span>${button('ide-search',icon('search'),'aria-label="Поиск по проекту"')}${button('ide-extensions',icon('extensions'),'aria-label="Расширения IDE" title="Расширения IDE"')}${button('ide-actions',icon('more'),'aria-label="Действия редактора"')}</div><div class="di-body">${ideExplorer()}<div class="di-main"><div class="di-empty" style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center"><b>${Object.keys(files).length?'Нет открытых файлов':'В проекте пока нет файлов'}</b><span>${Object.keys(files).length?'Выберите файл в проводнике или создайте новый.':'Создайте первый файл. Закрытие вкладки не создаёт файл автоматически.'}</span><div class="di-actions" style="margin-top:14px">${button('new-file','Создать файл','class="di-button primary"')}${button('language-settings','Среда разработки','class="di-button outline"')}${Object.keys(files).length?button('empty-find-file','Найти файл','class="di-button outline"'):''}</div></div>${languageWorkbench?languageWorkbench.toolbar():''}${ideBottomPanel()}${noticeMarkup(ide.status,false,'dismiss-ide-notice')}</div></div>`;
    restoreExplorerView();refreshGitMount();languageWorkbench?.bind();explorerWorkbench?.bind();bindIDEResizer();
  }
  function breakpointsFor(path,owner=ide){
    if(!path)return new Set();
    owner.breakpointFiles||={};const stored=owner.breakpointFiles[path];
    if(!(stored instanceof Set))owner.breakpointFiles[path]=new Set(Array.isArray(stored)?stored:[]);
    return owner.breakpointFiles[path];
  }
  function captureIDEView(){
    const field=ideRoot.querySelector('#di-code-input');if(!field||ideRoot.dataset.project!==scopeName())return;
    const path=field.dataset.document;if(!path||!Object.hasOwn(files,path))return;
    ide.editorViews||={};ide.editorViews[path]={start:field.selectionStart,end:field.selectionEnd,top:field.scrollTop,left:field.scrollLeft};
  }
  let ideSizeObserver=null;
  function bindIDEResizer(){
    ideSizeObserver?.disconnect();
    const panel=ideRoot.querySelector('.di-bottom'),handle=ideRoot.querySelector('.di-bottom-resizer');if(!panel||!handle)return;
    const maximum=()=>{const main=panel.parentElement;const fixed=[...main.children].filter(n=>n!==panel&&!n.classList.contains('di-code-editor')&&!n.classList.contains('di-empty')).reduce((height,n)=>height+n.getBoundingClientRect().height,0);return Math.max(80,main.clientHeight-fixed-140);};
    const fit=()=>{const preferred=ide.bottomHeight||(ideRoot.clientHeight<650?160:240),height=ide.bottomCollapsed?37:Math.min(maximum(),preferred);panel.style.height=height+'px';panel.classList.toggle('collapsed',Boolean(ide.bottomCollapsed));const content=panel.querySelector('#di-ide-bottom');if(content)content.hidden=Boolean(ide.bottomCollapsed);handle.setAttribute('aria-valuenow',String(Math.round(height)));handle.setAttribute('aria-valuemax',String(Math.round(maximum())));handle.setAttribute('aria-valuemin','80');};
    const resize=value=>{ide.bottomCollapsed=false;ide.bottomHeight=Math.max(80,Math.min(maximum(),value));fit();};
    fit();ideSizeObserver=new ResizeObserver(fit);ideSizeObserver.observe(ideRoot);
    handle.onkeydown=event=>{if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();resize(event.key==='Home'?80:event.key==='End'?maximum():panel.getBoundingClientRect().height+(event.key==='ArrowUp'?24:-24));}};
    handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();const start=event.clientY,height=panel.getBoundingClientRect().height;handle.setPointerCapture(event.pointerId);handle.onpointermove=move=>resize(height+start-move.clientY);handle.onpointerup=()=>{handle.onpointermove=null;handle.onpointerup=null;};handle.onpointercancel=handle.onpointerup;};
  }
  function ideProblems(){
    const kind=languageWorkbench?.workbench().selected||'frontend';
    const path=kind==='java'?'backend/PaymentService.java':kind==='python'?'scripts/verify_import.py':'src/checkout.ts',source=files[path];
    if(!source)return [];
    if(kind==='java'&&!source.includes('IllegalArgumentException'))return [{path,line:6,message:'Проверить контракт total: обработку null и отрицательной суммы'}];
    if(kind==='python'&&!/sum\([\s\S]*Decimal\(['"]0['"]\)/.test(source))return [{path,line:4,message:'Проверить тип результата sum для пустого набора'}];
    if(kind==='frontend'&&!source.includes('response.ok'))return [{path,line:5,message:'fetch не отклоняет Promise для HTTP 429'}];
    return [];
  }
  function refreshEditorChrome(){
    const path=ide.active,field=ideRoot.querySelector('#di-code-input');if(!field)return;
    ideRoot.querySelectorAll('.di-tabwrap > [role="tab"]').forEach(node=>{const name=node.dataset.path;node.textContent=name.split('/').pop()+(ide.dirty.has(name)?' ·':'')});
    const tree=ideRoot.querySelector('#di-file-list');if(tree)tree.innerHTML=ideTree();
    const gutter=ideRoot.querySelector('#di-ide-gutter');if(gutter){const scroll=gutter.scrollTop;gutter.innerHTML=files[path].split('\n').map((_,i)=>`<button class="di-bp-button ${breakpointsFor(path).has(i+1)?'on':''}" data-di="breakpoint" data-line="${i+1}" aria-label="${breakpointsFor(path).has(i+1)?'Убрать':'Добавить'} breakpoint, строка ${i+1}">${breakpointsFor(path).has(i+1)?'●':i+1}</button>`).join('');gutter.scrollTop=scroll;}
  }
  function renderIDE(){
    captureIDEView();
    const focus=document.activeElement;
    const formFocus=ideRoot.contains(focus)&&ideRoot.dataset.project===scopeName()&&focus.id&&focus.id!=='di-code-input'&&focus.matches('input,textarea')?{id:focus.id,value:focus.value,start:focus.selectionStart,end:focus.selectionEnd}:null;
    const existingField=ideRoot.querySelector('#di-code-input'),preserveField=existingField&&ideRoot.dataset.project===scopeName()&&existingField.dataset.document===ide.active&&existingField.value===files[ide.active]?existingField:null;
    const priorExplorer=ideRoot.querySelector('#di-project-files');if(ideRoot.dataset.project===scopeName()&&priorExplorer&&!priorExplorer.hidden)ide.explorerScroll=priorExplorer.scrollTop;
    ide.open=ide.open.filter(path=>Object.hasOwn(files,path));if(!ide.active||!Object.hasOwn(files,ide.active))ide.active=ide.open[0]||null;
    if(!ide.active){renderEmptyIDE();return;}
    const restoreEditor=editorFocus(ideRoot,scopeName()+':'+ide.active);
    ideRoot.innerHTML=`<div class="di-bar">${button('file-tree',icon('panel'),'aria-label="'+(ide.explorer?'Скрыть проводник проекта':'Показать проводник проекта')+'" title="'+(ide.explorer?'Скрыть проводник проекта':'Показать проводник проекта')+'" aria-pressed="'+ide.explorer+'" aria-controls="di-project-files"')}<strong>Code</strong><span class="di-demo">Демонстрация</span><span class="di-spacer"></span>${button('ide-search',icon('search'),'aria-label="Поиск по проекту"')}${button('ide-extensions',icon('extensions'),'aria-label="Расширения IDE" title="Расширения IDE"')}${button('ide-actions',icon('more'),'aria-label="Действия редактора"')}${button('ide-agent',icon('spark'),'aria-label="Обсудить код с агентом"')}</div><div class="di-body">${ideExplorer()}<div class="di-main"><div class="di-tabbar" role="tablist" aria-label="Открытые файлы">${ide.open.map(path=>`<div class="di-tabwrap ${path===ide.active?'active':''}"><button role="tab" aria-selected="${path===ide.active}" data-di="open-file" data-path="${path}" title="${path}">${esc(path.split('/').pop())}${ide.dirty.has(path)?' ·':''}</button><button data-di="close-file" data-path="${path}" aria-label="Закрыть ${esc(path)}">×</button></div>`).join('')}</div><div class="di-bar"><span class="di-caption di-code-status" title="${esc(ide.active)} · ${language(ide.active)} · UTF-8 · LF · ${['java','python'].includes(syntaxLanguage(ide.active))?4:2} пробела">${esc(ide.active)}</span><span class="di-spacer"></span>${button('save-file',icon('check'),'aria-label="Сохранить файл в макете" title="Сохранить · Ctrl+S"')}${button('ide-refactors','Refactor')}${button('definition','Символы')}</div>${noticeMarkup(ide.status,false,'dismiss-ide-notice')}<div class="di-code-editor"><div class="di-editor"><div class="di-gutter" id="di-ide-gutter">${files[ide.active].split('\n').map((_,i)=>`<button class="di-bp-button ${breakpointsFor(ide.active).has(i+1)?'on':''}" data-di="breakpoint" data-line="${i+1}" aria-label="${breakpointsFor(ide.active).has(i+1)?'Убрать':'Добавить'} breakpoint, строка ${i+1}">${breakpointsFor(ide.active).has(i+1)?'●':i+1}</button>`).join('')}</div><textarea data-language="${syntaxLanguage(ide.active)}" id="di-code-input" data-document="${esc(ide.active)}" aria-label="Редактор ${esc(ide.active)}" spellcheck="false">${esc(files[ide.active])}</textarea></div></div>${languageWorkbench?languageWorkbench.toolbar():`<div class="di-bar"><select id="di-run-config" aria-label="Конфигурация запуска">${Object.keys(ide.runConfigurations).map(name=>`<option ${name===ide.config?'selected':''}>${name}</option>`).join('')}</select>${button(ide.running?'stop-run':'run',icon(ide.running?'stop':'run')+(ide.running?'Остановить':'Run'))}${button('debug',icon('bug')+'Debug')}<span class="di-spacer"></span>${ide.debug?button('debug-step','Step')+button('debug-resume','Продолжить')+button('debug-stop','Стоп'):''}</div>`}${ideBottomPanel()}</div></div>`;
    const nextField=ideRoot.querySelector('#di-code-input');if(preserveField&&nextField)nextField.replaceWith(preserveField.closest('.wb-code-editor')||preserveField);
    restoreEditor();
    const view=ide.editorViews?.[ide.active],field=ideRoot.querySelector('#di-code-input');if(view&&field){field.setSelectionRange(view.start,view.end);field.scrollTop=view.top;field.scrollLeft=view.left;}
    restoreExplorerView();refreshGitMount();languageWorkbench?.bind();explorerWorkbench?.bind();bindIDEResizer();
    if(formFocus){const replacement=ideRoot.querySelector('#'+formFocus.id);if(replacement){replacement.value=formFocus.value;replacement.focus({preventScroll:true});if(formFocus.start!==null)replacement.setSelectionRange(formFocus.start,formFocus.end);}}
  }
  function syntaxLanguage(path){
    const name=String(path||'').split('/').pop().toLowerCase();
    if(name==='.env'||name.startsWith('.env.'))return 'bash';
    const extension=name.includes('.')?name.slice(name.lastIndexOf('.')+1):'';
    return {ts:'typescript',tsx:'tsx',js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'jsx',java:'java',py:'python',json:'json',jsonc:'json',sql:'sql',yaml:'yaml',yml:'yaml',sh:'bash',bash:'bash',zsh:'bash',ps1:'powershell',psm1:'powershell',md:'markdown',markdown:'markdown',log:'log',diff:'diff',patch:'diff',html:'html',htm:'html',css:'css',xml:'xml'}[extension]||'plaintext';
  }
  function language(path){const key=syntaxLanguage(path);return {typescript:'TypeScript',tsx:'TypeScript React',javascript:'JavaScript',jsx:'JavaScript React',java:'Java',python:'Python',json:'JSON',sql:'SQL',yaml:'YAML',bash:'Shell',powershell:'PowerShell',markdown:'Markdown',log:'Log',diff:'Diff',html:'HTML',css:'CSS',xml:'XML',plaintext:'Plain text'}[key];}
  function ideBottom(){
    const workflow=languageWorkbench?.bottom();if(workflow!=null)return workflow;
    const enhanced=extraIDEBottom();if(enhanced!==null)return enhanced;
    if(ide.bottom==='problems')return ideProblems().map((item,index)=>`<button class="di-diagnostic" data-di="diagnostic" data-index="${index}"><span class="di-error">△</span><span><b>${esc(item.message)}</b><br>${esc(item.path)}:${item.line} · учебный review</span></button>`).join('')+'<p class="di-caption">Замечания по учебному коду. Это не результат компиляции или LSP-диагностики. Отсутствие замечаний не означает корректность проекта.</p>';

    if(ide.bottom==='output')return `<pre data-language="log" class="di-mono">${esc(ide.output)}</pre>`;
    if(ide.bottom==='debug')return ide.debug?`<div class="di-debug-grid"><div><b>Call stack</b><pre data-language="log" class="di-mono">executeWithRetry:${ide.debugLine}\ncheckout:4\nmain:12</pre></div><div><b>Variables</b><pre data-language="javascript" class="di-mono">attempt = ${Math.max(1,ide.debugLine-13)}\npolicy.maxAttempts = 3\nerror.status = 429</pre></div></div>`:'<div class="di-caption">Выберите Debug. Точки останова переключаются в поле номеров строк.</div>';
    return `<label class="di-caption">Поиск во всех файлах</label><div class="di-bar" style="padding:4px 0 9px"><input id="di-global-search" value="${esc(ide.search)}" placeholder="executeWithRetry" aria-label="Поиск по содержимому" style="flex:1">${button('search-project','Найти')}</div>${ide.searchResults.length?ide.searchResults.map((result,index)=>`<button class="di-diagnostic" data-di="search-result" data-index="${index}">${esc(result.path)}:${result.line}<br>${esc(result.text.trim())}</button>`).join(''):`<p class="di-caption">${ide.search?'Совпадений нет':'Введите фрагмент кода.'}</p>`}`;
  }
  function validPath(path){return Boolean(path)&&!path.includes('..')&&!path.startsWith('/')&&!/[<>:"|?*\\\x00-\x1f]/.test(path);}
  function adjacentIDEFile(open,closed,active){
    if(active!==closed)return active;
    const index=open.indexOf(closed),remaining=open.filter(path=>path!==closed);
    return remaining[Math.min(Math.max(0,index),remaining.length-1)]||null;
  }
  function ideContext(){
    const git=ideGitController?.isOpen?.()?window.SuiteGitPrototype:null;
    if(git){
      const state=ideGitController.state(),repo=git.git(),path=state.path;
      const diff=path?(repo.diffs?.[path]||git.diffLines(path)||[]).join('\n'):'';
      return {prompt:`Проверь изменения Git в проекте ${scopeName()}, ветка ${repo.branch}. Файл: ${path||'не выбран'}. Это демонстрационный diff, не состояние репозитория на диске.\n${diff.slice(0,6000)}${diff.length>6000?'\n[Фрагмент ограничен; запроси оставшийся diff.]':''}`};
    }
    const path=ide.active;if(!path)return {prompt:`Помоги с проектом ${scopeName()}. Сейчас в IDE нет открытого файла.`};
    const field=ideRoot.querySelector('#di-code-input'),text=files[path]||'';
    const selected=field?.dataset.document===path&&field.selectionEnd>field.selectionStart?text.slice(field.selectionStart,field.selectionEnd):'';
    const start=selected?text.slice(0,field.selectionStart).split('\n').length:1;
    const fragment=(selected||text).slice(0,6000);
    return {prompt:`Помоги с ${path} в проекте ${scopeName()}. ${ide.dirty.has(path)?'Буфер содержит несохранённые изменения.':'Показан сохранённый текст макета.'} ${selected?'Выделенный фрагмент, начиная со строки '+start+':':'Содержимое текущего файла:'}\n${fragment}${(selected||text).length>6000?'\n[Фрагмент ограничен; запроси остальную часть при необходимости.]':''}`};
  }
  function openFile(path,reveal=false){if(!Object.hasOwn(files,path))return;if(reveal){const parts=path.split('/');for(let index=1;index<parts.length;index++)ide.expanded.add(parts.slice(0,index).join('/'));if(!path.toLowerCase().includes(ide.filter.toLowerCase()))ide.filter='';}if(!ide.open.includes(path))ide.open.push(path);ide.active=path;renderIDE();}
  function revealLine(line){const textarea=ideRoot.querySelector('#di-code-input');if(!textarea)return;const lines=textarea.value.split('\n');const start=lines.slice(0,line-1).join('\n').length+(line>1?1:0);textarea.focus();textarea.setSelectionRange(start,start+(lines[line-1]?.length||0));textarea.scrollTop=Math.max(0,(line-4)*20);}
  function documentSymbols(path){
    const code=files[path]||'',lang=syntaxLanguage(path),rows=[];
    const pattern=lang==='python'?/^[ \t]*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/gm:lang==='java'?/^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:(class|interface|enum|record)\s+([A-Za-z_]\w*)|[\w<>\[\],?]+\s+([A-Za-z_]\w*)\s*\()/gm:/^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let)\s+([A-Za-z_$][\w$]*)/gm;
    for(const match of code.matchAll(pattern)){const name=match[2]||match[3];if(name)rows.push({path,name,kind:match[1]||'method',line:code.slice(0,match.index).split('\n').length});}
    return rows;
  }
  function symbolsDialog(){
    const current=ide.active,all=Object.keys(files).flatMap(documentSymbols);
    openDialog('Символы проекта','<label>Найти символ<input id="di-symbol-filter" placeholder="Класс, метод, функция"></label><div id="di-symbol-results"></div><p class="di-caption">Каталог по тексту макета. Точная семантическая навигация требует language server.</p>','',action=>{if(!action.startsWith('symbol-'))return;const row=all[Number(action.slice(7))];if(row){dialog.close();openFile(row.path,true);revealLine(row.line);}});
    const draw=()=>{const term=dialog.querySelector('#di-symbol-filter').value.toLowerCase();dialog.querySelector('#di-symbol-results').innerHTML=all.map((x,index)=>({...x,index})).filter(x=>(x.name+' '+x.path).toLowerCase().includes(term)).sort((a,b)=>Number(b.path===current)-Number(a.path===current)).map(x=>button('symbol-'+x.index,`<b>${esc(x.name)}</b><small>${esc(x.kind)} · ${esc(x.path)}:${x.line}</small>`,'class="di-symbol-result"')).join('')||'<p>Символы не найдены.</p>';};
    dialog.querySelector('#di-symbol-filter').oninput=draw;draw();
  }
  function quickOpen(){
    const paths=Object.keys(files);openDialog('Открыть файл','<label>Путь или имя<input id="di-quick-file" placeholder="PaymentService, verify_import, Checkout"></label><div id="di-quick-results"></div>','',action=>{if(!action.startsWith('quick-file-'))return;const path=paths[Number(action.slice(11))];if(path){dialog.close();openFile(path,true)}});
    const draw=()=>{const term=dialog.querySelector('#di-quick-file').value.toLowerCase();dialog.querySelector('#di-quick-results').innerHTML=paths.map((path,i)=>({path,i})).filter(x=>x.path.toLowerCase().includes(term)).map(x=>button('quick-file-'+x.i,esc(x.path),'class="di-symbol-result"')).join('')||'<p>Файлы не найдены.</p>';};dialog.querySelector('#di-quick-file').oninput=draw;draw();dialog.querySelector('#di-quick-file').focus();
  }
  function refactorDialog(){
    openDialog('Переименование символа',`<p>Символ: <b>executeWithRetry</b> · TypeScript</p><label>Новое имя<input id="di-symbol-name" value="withRetry"></label><p>Preview показывает все вхождения. В макете это текстовый поиск; в продукте изменения должны приходить из language server с проверкой версий файлов.</p>`,button('preview','Предпросмотр','class="di-button primary"'),action=>{
      if(action!=='preview')return;
      const name=dialog.querySelector('#di-symbol-name').value.trim();if(!/^[A-Za-z_$][\w$]*$/.test(name)){dialog.querySelector('#di-symbol-name').setCustomValidity('Введите допустимое имя символа.');dialog.querySelector('#di-symbol-name').reportValidity();return;}
      const affected=Object.entries(files).filter(([,text])=>text.includes('executeWithRetry'));
      openDialog('Проверить изменения',`<p>${affected.length} файла · executeWithRetry → ${esc(name)}</p>${affected.map(([path,text])=>`<div class="di-card"><b>${esc(path)}</b><pre data-language="diff" class="di-mono">- executeWithRetry\n+ ${esc(name)}</pre><p class="di-caption">${text.split('executeWithRetry').length-1} вхождений</p></div>`).join('')}<p class="di-caption">Локальный fixture-preview. Семантическая корректность не проверена.</p>`,button('rename','Применить в макете','class="di-button primary"'),a=>{if(a==='rename'){affected.forEach(([path,text])=>{files[path]=text.replaceAll('executeWithRetry',name);ide.dirty.add(path);});dialog.close();ide.status='Переименовано в '+affected.length+' файлах. Проверьте diff и тесты.';renderIDE();}});
    });
  }
  function startRun(){
    const owner=ide,token=++ide.runToken;ide.running=true;ide.bottom='output';ide.bottomCollapsed=false;const config=ide.config;ide.output=`${config}\n[демонстрация] Запуск…\n`;renderIDE();
    setTimeout(()=>{if(token!==owner.runToken)return;owner.running=false;owner.output+=config.includes('tests')?'✓ retry-policy.test.ts — 1 test passed\nFixture, реальные тесты не запускались.':config.includes('React')?'Dev server ready · http://localhost:5173\nАдрес демонстрационный, сервер не запускался.':config.includes('Python')?'12.50\nProcess finished with exit code 0 · fixture':'PaymentService compilation completed · fixture';owner.status='Сценарий Run завершён. Реальная среда не запускалась.';if(ide===owner)renderIDE();},900);
  }
  function ideAction(action,el,event){
    if(action==='dismiss-ide-notice'){ideNotice('');ideRoot.querySelector('#di-code-input')?.focus();return;}
    if(action==='ide-extensions'){extensionWorkbench?.show();return;}
    if(explorerWorkbench?.action(action,el,event))return;
    if(action.startsWith('git-')){if(dialog.open)dialog.close();window.SuiteIDEPrototype?.showGit(action==='git-history'?'history':action==='git-blame'?'blame':'changes',ide.active);return;}
    if(languageWorkbench?.action(action,el))return;
    if(expandedIDEAction(action,el))return;
    if(action==='file-tree'){const focused=document.activeElement===el;ide.explorer=!ide.explorer;renderIDE();if(focused)ideRoot.querySelector('[data-di="file-tree"]').focus({preventScroll:true});}
    else if(action==='open-file')openFile(el.dataset.path);
    else if(action==='close-file'){const path=el.dataset.path;const close=()=>{ide.active=adjacentIDEFile(ide.open,path,ide.active);ide.open=ide.open.filter(name=>name!==path);renderIDE();};if(ide.dirty.has(path))openDialog('Несохранённые изменения',`<p>${esc(path)} — сохранить изменения перед закрытием?</p>`,button('discard','Не сохранять')+button('save','Сохранить','class="di-button primary"'),a=>{if(a==='save'||a==='discard'){if(a==='save')saveIDEFile(path);else files[path]=ide.saved[path];ide.dirty.delete(path);dialog.close();close();}});else close();}
    else if(action==='save-file'){if(!ide.active){ideNotice('Откройте или создайте файл.');return;}saveIDEFile(ide.active);ide.dirty.delete(ide.active);ide.status='Сохранено в памяти макета · '+ide.active;renderIDE();}
    else if(action==='new-file')openDialog('Новый файл',`<label>Путь от корня проекта<input id="di-new-file" placeholder="src/example.ts"></label><p>Файл создаётся только в памяти страницы.</p>`,button('create','Создать','class="di-button primary"'),a=>{if(a==='create'){const field=dialog.querySelector('#di-new-file'),path=field.value.trim();if(!validPath(path)||Object.hasOwn(files,path)){field.setCustomValidity('Введите новый относительный путь без .. и специальных символов.');field.reportValidity();return;}files[path]='';ide.saved[path]='';dialog.close();openFile(path,true);}});
    else if(action==='file-menu'){
      const path=el.dataset.path;
      openDialog('Файл · '+path,`<label>Путь от корня проекта<input id="di-file-rename" value="${esc(path)}"></label><p>Переименование обновит открытые вкладки. Эти действия затрагивают только данные макета.</p>`,button('delete-file','Удалить')+button('rename-file','Переименовать','class="di-button primary"'),a=>{
        if(a==='rename-file'){const field=dialog.querySelector('#di-file-rename'),next=field.value.trim();if(!validPath(next)||(next!==path&&Object.hasOwn(files,next))){field.setCustomValidity('Недопустимый или уже существующий путь.');field.reportValidity();return;}if(next!==path){files[next]=files[path];ide.saved[next]=ide.saved[path];delete files[path];delete ide.saved[path];ide.open=ide.open.map(item=>item===path?next:item);if(ide.active===path)ide.active=next;if(ide.dirty.delete(path))ide.dirty.add(next);if(ide.breakpointFiles?.[path]){ide.breakpointFiles[next]=ide.breakpointFiles[path];delete ide.breakpointFiles[path];}if(ide.editorViews?.[path]){ide.editorViews[next]=ide.editorViews[path];delete ide.editorViews[path];}}dialog.close();renderIDE();}
        if(a==='delete-file')openDialog('Удалить файл из макета?',`<p>${esc(path)}${ide.dirty.has(path)?' · есть несохранённые изменения':''}</p>`,button('confirm-delete','Удалить','class="di-button outline"'),choice=>{if(choice!=='confirm-delete')return;delete files[path];delete ide.saved[path];delete ide.breakpointFiles?.[path];delete ide.editorViews?.[path];ide.dirty.delete(path);ide.open=ide.open.filter(name=>name!==path);if(ide.active===path)ide.active=ide.open[0]||null;dialog.close();renderIDE();});
      });
    }
    else if(action==='refactor')refactorDialog();
    else if(action==='definition')symbolsDialog();
    else if(action==='toggle-ide-bottom'){ide.bottomCollapsed=!ide.bottomCollapsed;renderIDE();}
    else if(action==='quick-open')quickOpen();
    else if(action==='diagnostic'){const item=ideProblems()[Number(el.dataset.index)||0];if(item){openFile(item.path,true);revealLine(item.line);ideNotice(item.message);}}
    else if(action==='ide-bottom'){ide.bottomCollapsed=false;ide.bottom=el.dataset.section;renderIDE();}
    else if(action==='ide-search'){ide.bottom='search';ide.bottomCollapsed=false;renderIDE();ideRoot.querySelector('#di-global-search')?.focus();}
    else if(action==='search-project'){ide.search=ideRoot.querySelector('#di-global-search').value;searchProject();}
    else if(action==='search-result'){const result=ide.searchResults[Number(el.dataset.index)];openFile(result.path,true);revealLine(result.line);}
    else if(action==='breakpoint'){const line=Number(el.dataset.line),points=breakpointsFor(ide.active);if(points.has(line))points.delete(line);else points.add(line);el.classList.toggle('on',points.has(line));el.textContent=points.has(line)?'●':line;el.setAttribute('aria-label',(points.has(line)?'Убрать':'Добавить')+' breakpoint, строка '+line);}
    else if(action==='run')startRun();
    else if(action==='stop-run'){ide.runToken++;ide.running=false;ide.output+='\nПроцесс остановлен пользователем · fixture';renderIDE();}
    else if(action==='debug'){ide.debug=true;ide.bottomCollapsed=false;ide.debugLine=[...ide.breakpoints][0]||6;ide.bottom='debug';ide.status='Breakpoint · '+ide.active+':'+ide.debugLine+' · демонстрация';renderIDE();revealLine(ide.debugLine);}
    else if(action==='debug-step'){ide.debugLine=Math.min(files[ide.active].split('\n').length,ide.debugLine+1);renderIDE();revealLine(ide.debugLine);}
    else if(action==='debug-resume'){ide.debug=false;ide.output='Debug session completed · fixture';ide.bottom='output';ide.status='Отладочная сессия завершена в демонстрации.';renderIDE();}
    else if(action==='debug-stop'){ide.debug=false;ide.status='Отладка остановлена.';renderIDE();}
    else if(action==='ide-agent')sendToAgent(`Контекст IDE: ${ide.active}\n\n${files[ide.active]}\n\nПроверь корректность и предложи минимальное изменение. Это код демонстрационного макета.`,ideNotice);
    else if(action==='ide-actions')openDialog('Инструменты редактора',`<div class="di-actions">${button('format-code','Форматировать','class="di-button outline"')}${button('file-diff','Изменения файла','class="di-button outline"')}${button('api-client','HTTP-клиент','class="di-button outline"')}${button('run-settings','Запуски и окружения','class="di-button outline"')}${button('language-settings','Языковые службы','class="di-button outline"')}</div>`, '',a=>ideAction(a,el));
    else if(action==='format-code'){files[ide.active]=files[ide.active].split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n';ide.dirty.add(ide.active);dialog.close();ide.status='Убраны хвостовые пробелы. Полный formatter в макете не подключён.';renderIDE();}
    else if(action==='file-diff')openDialog('Изменения · '+ide.active,`<div class="di-columns"><div><b>Сохранено</b><pre data-language="${syntaxLanguage(ide.active)}" class="di-mono">${esc(ide.saved[ide.active])}</pre></div><div><b>Текущая версия</b><pre data-language="${syntaxLanguage(ide.active)}" class="di-mono">${esc(files[ide.active])}</pre></div></div>`,button('diff-close','Готово','class="di-button primary"'),a=>{if(a==='diff-close')dialog.close();});
    else if(action==='run-settings')openDialog('Конфигурации запуска',`<label>Название<input value="${esc(ide.config)}" id="di-config-name" readonly></label><label>Рабочая папка<input value="${ide.config.includes('Java')?'backend':ide.config.includes('Python')?'scripts':'.'}" readonly></label><label>Команда<input value="${ide.config.includes('tests')?'npm test':ide.config.includes('React')?'npm run dev':ide.config.includes('Python')?'python verify_import.py':'./mvnw test'}" readonly></label><label>Окружение<select><option>ДЕВ · локальные переменные</option><option>ИФТ · secret references</option></select></label><p>В продукте: executable, arguments array, env references, cwd, pre-launch task, timeout и compound configurations. Макет команды не запускает.</p>`,button('run-config-close','Готово','class="di-button primary"'),a=>{if(a==='run-config-close')dialog.close();});
    else if(action==='language-settings')openDialog('Языковые службы',`<div class="di-card"><b>Java</b><p>Eclipse JDT LS · build import Maven / Gradle · Java debugger</p></div><div class="di-card"><b>Python</b><p>Pyright-compatible LSP · interpreter / virtual environment · debugpy</p></div><div class="di-card"><b>TypeScript / React</b><p>TypeScript language service · tsconfig · formatter / linter · browser / Node debugger</p></div><p class="di-caption">Все службы — целевой контракт. В макете нет LSP, DAP, фоновой индексации или диагностики реального репозитория.</p>`,button('languages-close','Готово','class="di-button primary"'),a=>{if(a==='languages-close')dialog.close();});
    else if(action==='api-client')openDialog('HTTP-клиент',`<div class="di-columns"><label>Метод<select id="di-http-method"><option>GET</option><option>POST</option></select></label><label>Окружение<select><option>ДЕВ</option><option>ИФТ</option></select></label></div><label>URL<input id="di-http-url" value="https://example.invalid/api/health"></label><label>Тело<textarea data-language="json" style="min-height:80px" id="di-http-body">{}</textarea></label><div id="di-http-response"><p>Запрос не отправляется в сеть.</p></div>`,button('http-send','Отправить в макете','class="di-button primary"'),a=>{if(a==='http-send'){dialog.querySelector('#di-http-response').innerHTML='<div class="di-card"><b>200 OK · 34 ms · fixture</b><pre data-language="json" class="di-mono">{ "status": "healthy", "database": "ready" }</pre></div>';}});
  }
  function extraIDEBottom(){
    if(ide.bottom==='search')return `<div class="di-actions"><input id="di-global-search" value="${esc(ide.search)}" placeholder="Найти текст" aria-label="Поиск по содержимому" style="flex:1;min-width:120px">${button('search-project','Найти')}${button('search-replace','Заменить…')}</div>${ide.searchResults.length?ide.searchResults.map((result,index)=>`<button class="di-diagnostic" data-di="search-result" data-index="${index}"><span>${esc(result.path)}:${result.line}<br>${esc(result.text.trim())}</span></button>`).join(''):`<p class="di-caption">${ide.search?'Совпадений нет':'Поиск по файлам текущего проекта. Ctrl+Shift+F.'}</p>`}`;
    if(ide.bottom==='terminal')return `<div class="di-actions">${button('terminal-clear','Очистить')}${button('terminal-settings','PowerShell 5.1 ▾')}${button('terminal-agent','Разобрать вывод с агентом')}</div><pre data-language="log" class="di-mono" style="margin:6px 0">${esc(ide.terminal)}</pre><div class="di-actions"><span class="di-caption">PS &gt;</span><input id="di-terminal-input" value="${esc(ide.terminalDraft)}" placeholder="npm test · demo" aria-label="Команда демонстрационного терминала" style="flex:1">${button('terminal-submit','Enter','aria-label="Выполнить команду в демонстрации"')}</div>`;
    if(ide.bottom==='tests')return `<div class="di-actions">${button('test-all',icon('run')+'Все')}${button('test-failed','Повторить упавшие')}${button('test-known-failure','Сценарий сбоя')}${button('coverage-view','Coverage')}</div>${ide.tests.map((test,index)=>`<button class="di-diagnostic" data-di="test-detail" data-index="${index}"><span class="${test.status==='Успех'?'di-success':test.status==='Ошибка'?'di-error':'di-caption'}">${test.status==='Успех'?'✓':test.status==='Ошибка'?'×':'○'}</span><span>${esc(test.name)}<br><small>${test.status}</small></span></button>`).join('')}`;
    if(ide.bottom==='debug')return ide.debug?`<div class="di-actions">${button('debug-stack','Call stack')}${button('debug-watch','+ Watch')}${button('debug-variable','Изменить значение')}${button('debug-evaluate','Evaluate')}</div><div class="di-debug-grid"><div><b>Стек</b><pre data-language="log" class="di-mono">executeWithRetry:${ide.debugLine}\ncheckout:4\nmain:12</pre></div><div><b>Variables / watches</b><pre data-language="javascript" class="di-mono">${ide.debugWatches.map(name=>esc(name)+' = '+esc(debugValue(name))).join('\n')}</pre></div></div>`:`<div class="di-caption">Выберите Debug. Точки останова переключаются в поле номеров строк. Состояния стека и переменных — демонстрационные.</div>`;
    return null;
  }
  function debugValue(name){return name==='attempt'?(ide.debugAttempt??Math.max(1,ide.debugLine-13)):name==='policy.maxAttempts'?(ide.debugMax??3):name==='error.status'?429:'<недоступно в fixture>'}
  function expandedIDEAction(action,el){
    if(action==='empty-find-file'){ide.explorer=true;renderIDE();ideRoot.querySelector('#di-file-search').focus();return true;}
    if(action==='search-replace'){
      openDialog('Замена по проекту',`<label>Найти<input id="di-find-text" value="${esc(ide.search)}"></label><label>Заменить на<input id="di-replace-text" value="${esc(ide.replace)}"></label><p>Текстовая замена с обязательным просмотром изменений. Для символов используйте семантическое переименование.</p>`,button('replace-preview','Предпросмотр','class="di-button primary"'),a=>{
        if(a!=='replace-preview')return;const find=dialog.querySelector('#di-find-text').value,replacement=dialog.querySelector('#di-replace-text').value;if(!find){dialog.querySelector('#di-find-text').focus();return;}ide.search=find;ide.replace=replacement;
        const affected=Object.entries(files).filter(([,text])=>text.includes(find));
        openDialog('Проверить замену',`<p>${affected.length} файла · ${esc(find)} → ${esc(replacement||'(пусто)')}</p>${affected.map(([path,text],index)=>`<div class="di-card"><label class="di-check"><input type="checkbox" data-replace-file="${index}" checked><b>${esc(path)}</b></label><pre data-language="${syntaxLanguage(path)}" class="di-mono">${text.split('\n').filter(line=>line.includes(find)).slice(0,5).map(line=>'− '+esc(line)+'\n+ '+esc(line.replaceAll(find,replacement))).join('\n')}</pre></div>`).join('')||'<p>Совпадений нет.</p>'}`,button('replace-apply','Применить выбранное',`class="di-button primary" ${affected.length?'':'disabled'}`),choice=>{if(choice!=='replace-apply')return;dialog.querySelectorAll('[data-replace-file]:checked').forEach(node=>{const [path,text]=affected[Number(node.dataset.replaceFile)];files[path]=text.replaceAll(find,replacement);ide.dirty.add(path);});dialog.close();ide.status='Замена применена к выбранным файлам в макете.';searchProject();});
      });return true;
    }
    if(action==='run-settings'){runSettings();return true;}
    if(action==='terminal-submit'){
      const field=ideRoot.querySelector('#di-terminal-input'),command=field.value.trim();if(!command)return true;
      const output=command==='pwd'?'C:\\work\\atlas-platform':command==='git status'?'On branch gc-248-retry\nChanges not staged: src/retry-policy.ts':/npm (test|run test)/.test(command)?'Test suite: 3 passed · demonstration only':/python/.test(command)?'12.50 · fixture':command==='clear'?'':'Команда не выполняется: это HTML-макет, не системный терминал.';
      ide.terminal=command==='clear'?'':ide.terminal+'\nPS > '+command+'\n'+output+'\n';ide.terminalDraft='';renderIDE();return true;
    }
    if(action==='terminal-clear'){ide.terminal='';renderIDE();return true;}
    if(action==='terminal-agent'){sendToAgent('Разбери вывод терминала текущего проекта:\n'+ide.terminal+'\nЭто демонстрационный вывод.',ideNotice);return true;}
    if(action==='terminal-settings'){
      openDialog('Профили терминала',`<label>Профиль<select id="di-terminal-profile"><option>Windows PowerShell 5.1</option><option>Command Prompt</option><option>Git Bash</option><option>WSL · Ubuntu</option></select></label><label>Рабочая папка<input value="C:\\work\\atlas-platform"></label><label class="di-check"><input type="checkbox" checked> Восстановить вкладку в этом проекте</label><p>В рабочем приложении показываются установленные оболочки. У пользователя гарантирован только Windows PowerShell 5.1.</p>`,button('terminal-profile-save','Выбрать','class="di-button primary"'),a=>{if(a==='terminal-profile-save'){const profile=dialog.querySelector('#di-terminal-profile').value;dialog.close();ide.terminal+='\nПрофиль: '+profile+' · демонстрация';renderIDE();}});return true;
    }
    if(action==='test-all'||action==='test-failed'){
      const owner=ide,selected=ide.tests.filter(test=>action==='test-all'||test.status==='Ошибка');if(!selected.length){ideNotice('Нет упавших тестов.');return true;}selected.forEach(test=>test.status='Выполняется');ide.bottom='tests';ide.bottomCollapsed=false;renderIDE();setTimeout(()=>{selected.forEach(test=>test.status='Успех');owner.status='Сценарий тестов завершён, реальные тесты не запускались.';if(ide===owner)renderIDE();},700);return true;
    }
    if(action==='test-known-failure'){ide.tests[1].status='Ошибка';renderIDE();return true;}
    if(action==='test-detail'){
      const test=ide.tests[Number(el.dataset.index)];openDialog('Тест · '+test.name,`<p>${test.status} · fixture</p><pre data-language="log" class="di-mono">${test.status==='Ошибка'?'Expected retry count: 2\nReceived: 1\n\nfetch resolves on HTTP 429; response.ok was not checked.':'Test evidence not collected. This is a UI fixture.'}</pre>`,button('test-open','Открыть тест')+button('test-explain','Разобрать с агентом','class="di-button primary"'),a=>{if(a==='test-open'){dialog.close();openFile('tests/retry-policy.test.ts');}if(a==='test-explain'){dialog.close();sendToAgent('Проверь тест '+test.name+' и обработку HTTP 429. Статус в прототипе: '+test.status,ideNotice);}});return true;
    }
    if(action==='coverage-view'){
      openDialog('Покрытие тестами',`<p class="di-caption">Пример отчёта. Значения не получены из запущенных тестов.</p><table class="di-grid"><thead><tr><th>Файл</th><th>Statements</th><th>Branches</th></tr></thead><tbody><tr><td>retry-policy.ts</td><td>84%</td><td>66%</td></tr><tr><td>checkout.ts</td><td>50%</td><td>0%</td></tr></tbody></table><div class="di-card" style="margin-top:12px"><b>Непокрытые сценарии</b><p>Unknown result после записи; ответ HTML; abort во время backoff.</p></div>`,button('coverage-tests','Открыть тесты','class="di-button primary"'),a=>{if(a==='coverage-tests'){dialog.close();openFile('tests/retry-policy.test.ts');}});return true;
    }
    if(action==='debug-watch'){
      openDialog('Добавить watch',`<label>Выражение<input id="di-watch-expression" value="error.status"></label><p>Доступны attempt, policy.maxAttempts, error.status. Произвольный код в макете не вычисляется.</p>`,button('watch-add','Добавить','class="di-button primary"'),a=>{if(a==='watch-add'){const value=dialog.querySelector('#di-watch-expression').value.trim();if(value&&!ide.debugWatches.includes(value))ide.debugWatches.push(value);dialog.close();renderIDE();}});return true;
    }
    if(action==='debug-variable'){
      openDialog('Изменить переменную',`<label>Переменная<select id="di-debug-var"><option>attempt</option><option>policy.maxAttempts</option></select></label><label>Значение<input id="di-debug-value" type="number" value="2" min="1"></label><p>Изменение только в состоянии отладочного макета.</p>`,button('variable-set','Применить','class="di-button primary"'),a=>{if(a==='variable-set'){const name=dialog.querySelector('#di-debug-var').value,value=Number(dialog.querySelector('#di-debug-value').value);if(name==='attempt')ide.debugAttempt=value;else ide.debugMax=value;dialog.close();renderIDE();}});return true;
    }
    if(action==='debug-evaluate'){
      openDialog('Evaluate expression',`<label>Выражение<input id="di-evaluate-expression" value="attempt"></label><div id="di-evaluate-result" class="di-card">Выберите Evaluate.</div><p class="di-caption">Произвольный JS/Python/Java здесь не выполняется.</p>`,button('evaluate','Evaluate','class="di-button primary"'),a=>{if(a==='evaluate')dialog.querySelector('#di-evaluate-result').textContent=String(debugValue(dialog.querySelector('#di-evaluate-expression').value.trim()));});return true;
    }
    if(action==='debug-stack'){
      openDialog('Threads / call stack',`<label>Поток<select><option>Main thread · paused</option><option>Worker · waiting</option></select></label><div class="di-card"><b>executeWithRetry:${ide.debugLine}</b><p>src/retry-policy.ts</p>${button('stack-frame','Открыть frame')}</div><div class="di-card"><b>checkout:4</b><p>src/checkout.ts</p>${button('checkout-frame','Открыть frame')}</div>`,'',a=>{if(a==='stack-frame'||a==='checkout-frame'){dialog.close();openFile(a==='stack-frame'?'src/retry-policy.ts':'src/checkout.ts');revealLine(a==='stack-frame'?ide.debugLine:4);}});return true;
    }
    if(action==='ide-actions'){
      openDialog('Инструменты редактора',`<div class="di-actions">${[['format-code','Форматировать'],['git-changes','Git · изменения файла'],['git-history','Git · история файла'],['git-blame','Git · авторство строк'],['file-diff','Несохранённые изменения'],['api-client','HTTP-клиент'],['run-settings','Запуски'],['language-settings','Языковые службы'],['ide-dependencies','Зависимости'],['ide-profiler','Профилировщик'],['ide-refactors','Рефакторинги'],['ide-conflict','Конфликт сохранения']].map(([key,name])=>button(key,name,'class="di-button outline"'+(!ide.active&&['format-code','file-diff','ide-conflict'].includes(key)?' disabled title="Сначала откройте файл"':''))).join('')}</div>`,'',a=>ideAction(a,el));return true;
    }
    if(action==='ide-dependencies'){
      openDialog('Build & dependencies',`<label>Модуль<select id="di-build-module"><option>frontend · npm</option><option>backend · Maven</option><option>scripts · Python</option></select></label><div class="di-card"><b>Зависимости</b><p>react → 19.x · lockfile<br>spring-boot → managed BOM<br>pytest → requirements-dev</p></div><div id="di-dependency-result"></div><p>В продукте версии читаются из lockfile и build model. Обновление сначала показывает manifest/lock diff и запускает тесты; Sprut проверяет уязвимые версии.</p>`,button('deps-scan','Проверить Sprut')+button('deps-sync','Синхронизировать','class="di-button primary"'),a=>{const target=dialog.querySelector('#di-dependency-result');if(a==='deps-scan')target.innerHTML='<div class="di-card"><b>Демонстрационный отчёт</b><p>1 уязвимая транзитивная зависимость · исправление через обновление родителя · нужен review lockfile.</p></div>';else if(a==='deps-sync')target.innerHTML='<p>Модель проекта синхронизирована в сценарии. Реальная сборка не запускалась.</p>';});return true;
    }
    if(action==='language-settings'){languageServicesDialog();return true;}
    if(action==='ide-profiler'){profilerDialog();return true;}
    if(action==='ide-refactors'){refactorHub();return true;}
    if(action==='ide-conflict'){
      const local=files[ide.active],disk=ide.saved[ide.active]+'\n// Updated by another agent\n';
      openDialog('Файл изменён другим процессом',`<p>${esc(ide.active)} · сохранение приостановлено, чтобы не затереть чужие изменения</p><div class="di-columns"><div><b>Ваш черновик</b><pre data-language="${syntaxLanguage(ide.active)}" class="di-mono">${esc(local.slice(0,650))}</pre></div><div><b>Новая версия на диске · fixture</b><pre data-language="${syntaxLanguage(ide.active)}" class="di-mono">${esc(disk.slice(-650))}</pre></div></div>`,button('keep-local','Оставить черновик')+button('take-disk','Принять внешнюю версию')+button('merge-draft','Открыть объединённый черновик','class="di-button primary"'),a=>{if(a==='take-disk'){files[ide.active]=disk;ide.saved[ide.active]=disk;ide.dirty.delete(ide.active);}else if(a==='merge-draft'){files[ide.active]=local+'\n// Updated by another agent\n';ide.dirty.add(ide.active);}dialog.close();ide.status='Разрешение конфликта выбрано в макете. Реальных файлов нет.';renderIDE();});return true;
    }
    return false;
  }
  function languageStatus(service){return {ready:'Готово · демонстрация',indexing:'Индексирование · демонстрация',unconfigured:'Требуется настройка',cancelled:'Индексирование остановлено',error:'Служба недоступна',stopped:'Служба остановлена'}[service.state]||service.state;}
  function languageServiceSummary(service){
    return `<div class="di-card"><b>${esc(service.engine)}</b><p role="status">${languageStatus(service)}${service.state==='indexing'?' · '+service.progress+'%':''}</p>${service.state==='indexing'?`<progress value="${service.progress}" max="100" aria-label="Прогресс индексирования"></progress><p>Индексировано ${Math.round(service.progress/100*128)} / 128 fixture-файлов</p>`:''}<p>Workspace: ${esc(service.root)}<br>SDK / interpreter: ${esc(service.sdk)}<br>Includes: ${esc(service.include)}<br>Excludes: ${esc(service.exclude)}</p></div>`;
  }
  function languageServicesDialog(){
    const key=ide.languageActive,service=ide.languageServices[key];
    openDialog('Языковые службы и индексация',`<div class="di-columns"><label>Язык<select id="di-language-choice">${Object.entries(ide.languageServices).map(([id,item])=>`<option value="${id}" ${id===key?'selected':''}>${item.name}</option>`).join('')}</select></label><label>Сценарий макета<select id="di-language-scenario">${['Готово','Не настроено','Нет semantic capability','Сбой службы'].map(mode=>`<option ${service.mode===mode?'selected':''}>${mode}</option>`).join('')}</select></label></div><div id="di-service-summary">${languageServiceSummary(service)}</div><h3>Возможности службы</h3><div class="di-service-capabilities">${[['completion','Completion / navigation'],['rename','Rename'],['extract','Extract method'],['signature','Change signature']].map(([cap,label])=>`<span>${service.capabilities[cap]?'✓':'—'} ${label}</span>`).join('')}</div><p>Это контролируемые сценарии интерфейса, не результат LSP handshake. В приложении доступность определяется реальным ответом language server; отсутствие возможности не подменяется успешной операцией.</p><div class="di-actions">${button('service-configure','Настроить','class="di-button outline"')}${button('service-log','Журнал','class="di-button outline"')}${button('service-stop','Остановить службу','class="di-button outline"')}</div>`,button(service.state==='indexing'?'index-cancel':'index-start',service.state==='indexing'?'Остановить индексацию':'Индексировать · демо',`class="di-button primary" ${service.state==='unconfigured'||service.state==='error'||service.state==='stopped'?'disabled title="Сначала настройте или перезапустите службу"':''}`)+button('service-restart','Перезапустить'),action=>{
      if(action==='service-configure'){languageServiceConfig(key);return;}
      if(action==='service-log'){openDialog('Журнал · '+service.name,`<pre data-language="log" class="di-mono">[demo] workspace: ${esc(service.root)}\n[demo] engine: ${esc(service.engine)}\n[demo] status: ${esc(service.state)}\n[demo] capabilities: ${esc(JSON.stringify(service.capabilities))}\nРеальный language server не запускался.</pre>`,button('service-back','Назад','class="di-button primary"'),choice=>{if(choice==='service-back')languageServicesDialog();});return;}
      if(action==='service-stop'){service.token++;service.state='stopped';languageServicesDialog();return;}
      if(action==='index-cancel'){service.token++;service.state='cancelled';languageServicesDialog();return;}
      if(action==='service-restart'){if(!service.executable){languageServiceConfig(key);return;}service.token++;service.state='ready';service.mode=Object.values(service.capabilities).every(Boolean)?'Готово':'Нет semantic capability';languageServicesDialog();return;}
      if(action==='index-start')startIndexing(key);
    });
    dialog.dataset.diView='languages';
    dialog.querySelector('#di-language-choice').onchange=event=>{ide.languageActive=event.target.value;languageServicesDialog();};
    dialog.querySelector('#di-language-scenario').onchange=event=>{
      service.token++;service.mode=event.target.value;
      service.state=service.mode==='Не настроено'?'unconfigured':service.mode==='Сбой службы'?'error':'ready';
      service.capabilities=service.mode==='Готово'?{completion:true,rename:true,extract:true,signature:true}:service.mode==='Нет semantic capability'?{completion:true,rename:true,extract:false,signature:false}:{completion:false,rename:false,extract:false,signature:false};
      languageServicesDialog();
    };
  }
  function languageServiceConfig(key){
    const service=ide.languageServices[key];
    openDialog('Настройка · '+service.name,`<label>Исполняемый файл / команда службы<input id="di-lsp-executable" value="${esc(service.executable)}" placeholder="Путь на рабочем компьютере"></label><div class="di-columns"><label>SDK / interpreter<input id="di-lsp-sdk" value="${esc(service.sdk)}"></label><label>Корень модуля<input id="di-lsp-root" value="${esc(service.root)}"></label></div><label>Индексировать<input id="di-lsp-include" value="${esc(service.include)}"></label><label>Исключить<input id="di-lsp-exclude" value="${esc(service.exclude)}"></label><p>Настройки хранятся только в проекте макета. JDK/interpreter, сборка Maven/Gradle, tsconfig и virtual environment в приложении проверяются на машине пользователя.</p>`,button('lsp-save','Сохранить и проверить · демо','class="di-button primary"'),action=>{
      if(action!=='lsp-save')return;const field=dialog.querySelector('#di-lsp-executable');if(!field.value.trim()){field.setCustomValidity('Укажите команду или путь службы.');field.reportValidity();return;}
      Object.assign(service,{executable:field.value.trim(),sdk:dialog.querySelector('#di-lsp-sdk').value,root:dialog.querySelector('#di-lsp-root').value,include:dialog.querySelector('#di-lsp-include').value,exclude:dialog.querySelector('#di-lsp-exclude').value,state:'ready',mode:key==='python'?'Нет semantic capability':'Готово',capabilities:{completion:true,rename:true,extract:key!=='python',signature:key!=='python'}});languageServicesDialog();
    });
  }
  function startIndexing(key){
    const owner=ide,service=ide.languageServices[key],token=++service.token;service.state='indexing';service.progress=0;languageServicesDialog();
    const timer=setInterval(()=>{if(service.token!==token||service.state!=='indexing'){clearInterval(timer);return;}service.progress=Math.min(100,service.progress+10);if(service.progress===100){service.state='ready';clearInterval(timer);}if(owner===ide&&dialog.open&&dialog.dataset.diView==='languages'&&ide.languageActive===key){const node=dialog.querySelector('#di-service-summary');if(node)node.innerHTML=languageServiceSummary(service);if(service.state==='ready')languageServicesDialog();}},300);
  }
  function refactorHub(){
    if(['java','python'].includes(syntaxLanguage(ide.active))){
      openDialog('Рефакторинги · '+language(ide.active),`<p><b>${esc(ide.active)}</b></p><p>Семантическое переименование, extract method, изменение сигнатуры и проверка зависимых вызовов требуют адаптера выбранного языка. Сейчас он не запущен. Этот экран не применяет TypeScript-преобразование к Java или Python.</p><div class="di-actions">${button('language-settings','Настроить языковую среду','class="di-button outline"')}${button('refactor-agent','Подготовить с агентом','class="di-button primary"')}</div>`,'',action=>{dialog.close();if(action==='language-settings')ideAction(action);else if(action==='refactor-agent')sendToAgent('Подготовь семантический рефакторинг '+ide.active+' с preview, проверкой зависимых вызовов, compile и тестами. Не заменяй отсутствующий semantic adapter слепой текстовой заменой.',ideNotice)});
      return;
    }
    const service=ide.languageServices.ts,ready=service.state==='ready';
    openDialog('Рефакторинги',`<p>Выбранный редактор: <b>${esc(ide.active||'нет файла')}</b></p><div class="di-card"><b>TypeScript service · учебная цель src/retry-policy.ts</b><p>${languageStatus(service)}. Преобразования ниже работают с известным учебным кодом; полноценный semantic engine здесь не запускается.</p></div><div class="di-actions">${button('refactor','Rename symbol','class="di-button outline"'+(Object.values(files).some(text=>text.includes('executeWithRetry'))?'':' disabled title="Учебный символ executeWithRetry отсутствует"'))}${button('extract-method','Extract method',`class="di-button outline" ${ready&&service.capabilities.extract?'':'disabled title="Служба не готова или не сообщает extract capability"'}`)}${button('change-signature','Change signature',`class="di-button outline" ${ready&&service.capabilities.signature?'':'disabled title="Служба не готова или не сообщает change-signature capability"'}`)}</div>${!ready||!service.capabilities.extract?'<p>Недоступное действие не выполняется текстовой заменой под видом semantic refactoring. Настройте службу или передайте задачу агенту.</p>':''}`,button('refactor-services','Языковые службы')+button('refactor-agent','Обсудить с агентом'),action=>{
      if(action==='refactor-services'){languageServicesDialog();return;}if(action==='refactor-agent'){dialog.close();sendToAgent('Подготовь рефакторинг с проверяемым before/after, зависимыми вызовами и тестами. Контекст: '+(ide.active||scopeName()),ideNotice);return;}
      if(action==='refactor'){refactorDialog();return;}if(action==='extract-method'||action==='change-signature')semanticRefactorDialog(action);
    });
  }
  function semanticRefactorDialog(kind){
    const extracting=kind==='extract-method',path='src/retry-policy.ts',source=files[path];
    const needle=extracting?'await new Promise(resolve => setTimeout(resolve, policy.delayMs));':'  policy: RetryPolicy,\n): Promise<T> {';
    if(!source||!source.includes(needle)){
      openDialog(extracting?'Extract method · нет подходящего кода':'Change signature · нет подходящей сигнатуры',`<p>Учебное преобразование не применимо к текущему ${esc(path)}: файл удалён или его структура изменилась. Существующие правки сохраняются.</p><p>Можно создать отдельный учебный пример, чтобы проверить полный сценарий before/after, не перезаписывая рабочие файлы.</p>`,button('refactor-example','Создать отдельный пример','class="di-button primary"'),action=>{if(action!=='refactor-example')return;let index=1;while(files['examples/retry-demo-'+index+'.ts'])index++;const example='examples/retry-demo-'+index+'.ts';files[example]=initialFiles[path];ide.saved[example]=files[example];dialog.close();openFile(example,true);semanticRefactorForm(kind,example);});return;
    }
    semanticRefactorForm(kind,path);
  }
  function semanticRefactorForm(kind,path){
    const extracting=kind==='extract-method';
    openDialog(extracting?'Extract method':'Change signature',`<p>Файл: <b>${esc(path)}</b> · TypeScript fixture</p>${extracting?'<div class="di-card"><b>Выделенный фрагмент</b><pre data-language="typescript" class="di-mono">await new Promise(resolve =&gt; setTimeout(resolve, policy.delayMs));</pre></div>':'<div class="di-card"><b>Текущая сигнатура</b><pre data-language="typescript" class="di-mono">executeWithRetry&lt;T&gt;(operation: () =&gt; Promise&lt;T&gt;, policy: RetryPolicy)</pre></div>'}<label>${extracting?'Имя нового метода':'Новый параметр'}<input id="di-semantic-name" value="${extracting?'delay':'signal'}"></label>${extracting?'<p>Вход: delayMs: number. Результат: Promise&lt;void&gt;. Фрагмент заменяется вызовом, метод добавляется в этот модуль.</p>':'<p>Тип: AbortSignal · optional. Проверка отмены добавляется в retry-loop. При наличии связанных fixture-файлов обновляются checkout и тестовый вызов.</p>'}<p class="di-caption">Сначала будет конкретный diff. Apply меняет только локальные буферы макета, без LSP или записи на диск.</p>`,button('semantic-preview','Предпросмотр','class="di-button primary"'),action=>{
      if(action!=='semantic-preview')return;const field=dialog.querySelector('#di-semantic-name'),name=field.value.trim();if(!/^[A-Za-z_$][\w$]*$/.test(name)||['const','function','class','return','for','try','catch','undefined','null','await','yield','let','var','new','switch','default','if','else','throw','import','export','extends','implements','interface','type','enum','public','private','protected','static','this','super','true','false','void','delete','while','do','break','continue','case','in','instanceof','typeof','with','debugger'].includes(name)){field.setCustomValidity('Введите допустимое имя TypeScript-символа.');field.reportValidity();return;}
      field.setCustomValidity('');const before=files[path];let after,changes=[],skipped=[];const escapedName=name.replaceAll('$','\\$');if(new RegExp('(^|\\W)'+escapedName+'(?=$|\\W)').test(before)){field.setCustomValidity('Это имя уже используется в модуле. Выберите новое, чтобы избежать конфликта.');field.reportValidity();return;}
      if(extracting){if(new RegExp('\\bfunction\\s+'+name+'\\b').test(before)){field.setCustomValidity('Метод с таким именем уже существует.');field.reportValidity();return;}const expression='await new Promise(resolve => setTimeout(resolve, policy.delayMs));';if(!before.includes(expression)){dialog.querySelector('main').insertAdjacentHTML('beforeend','<p class="di-error">Исходный фрагмент изменился. Закройте и подготовьте преобразование заново.</p>');return;}after=before.replace(expression,'await '+name+'(policy.delayMs);')+`\nasync function ${name}(delayMs: number): Promise<void> {\n  await new Promise<void>(resolve => setTimeout(resolve, delayMs));\n}\n`;changes=[{path,before,after}];}
      else{
        const declaration='  policy: RetryPolicy,\n): Promise<T> {';if(!before.includes(declaration)){dialog.querySelector('main').insertAdjacentHTML('beforeend','<p class="di-error">Сигнатура изменилась. Подготовьте preview заново.</p>');return;}
        if(new RegExp('\\b'+name+'\\??\\s*:').test(before)){field.setCustomValidity('Параметр или поле с таким именем уже есть; выберите другое.');field.reportValidity();return;}
        after=before.replace(declaration,`  policy: RetryPolicy,\n  ${name}?: AbortSignal,\n): Promise<T> {`).replace('    try {',`    ${name}?.throwIfAborted();\n    try {`);changes.push({path,before,after});
        if(path==='src/retry-policy.ts'){
          const callerNameConflict=['src/checkout.ts','tests/retry-policy.test.ts'].find(file=>files[file]&&new RegExp('(^|\\W)'+escapedName+'(?=$|\\W)').test(files[file]));
          if(callerNameConflict){field.setCustomValidity('Это имя уже используется в '+callerNameConflict+'. Выберите другое имя.');field.reportValidity();return;}
          const caller='src/checkout.ts',callerBefore=files[caller];
          if(callerBefore?.includes('checkout(orderId: string)')&&callerBefore.includes('{ maxAttempts: 3, delayMs: 300 },'))changes.push({path:caller,before:callerBefore,after:callerBefore.replace('checkout(orderId: string)',`checkout(orderId: string, ${name}?: AbortSignal)`).replace('{ maxAttempts: 3, delayMs: 300 },',`{ maxAttempts: 3, delayMs: 300 },\n    ${name},`)});else skipped.push(caller);
          const test='tests/retry-policy.test.ts',testBefore=files[test];if(testBefore?.includes('async () => 42, { maxAttempts: 3, delayMs: 0 },'))changes.push({path:test,before:testBefore,after:testBefore.replace('async () => 42, { maxAttempts: 3, delayMs: 0 },','async () => 42, { maxAttempts: 3, delayMs: 0 }, undefined,')});else skipped.push(test);
        }
      }
      semanticPreview({kind,name,changes,skipped,owner:ide,fileOwner:files,project:scopeName(),selected:0});
    });
  }
  function semanticPreview(plan){
    const change=plan.changes[plan.selected],highlight=(text,other,cls)=>text.split('\n').map(line=>other.split('\n').includes(line)?esc(line):`<span class="${cls}">${esc(line)||' '}</span>`).join('\n');
    openDialog('Проверить рефакторинг · '+(plan.kind==='extract-method'?'Extract method':'Change signature'),`<p>${esc(plan.project)} · ${plan.changes.length} ${plan.changes.length===1?'файл':'файла'} · несохранённые буферы</p><nav class="di-change-tabs" aria-label="Файлы рефакторинга">${plan.changes.map((item,index)=>button('semantic-file',esc(item.path),`data-index="${index}" aria-pressed="${index===plan.selected}" class="di-button ${index===plan.selected?'di-selected':'outline'}"`)).join('')}</nav><div class="di-before-after"><section><h3>До</h3><pre data-language="${syntaxLanguage(change.path)}" data-syntax-preserve-wrappers="true">${highlight(change.before,change.after,'di-line-removed')}</pre></section><section><h3>После</h3><pre data-language="${syntaxLanguage(change.path)}" data-syntax-preserve-wrappers="true">${highlight(change.after,change.before,'di-line-added')}</pre></section></div>${plan.skipped?.length?`<p class="di-caption">Не изменены: ${plan.skipped.map(esc).join(', ')}. Известный вызов отсутствует или отредактирован; новый параметр optional. Полный поиск ссылок требует настоящего semantic engine.</p>`:''}<div id="di-semantic-status"><p>Набор применяется целиком: объявление и зависимые вызовы должны оставаться согласованы. Перед Apply сравнивается содержимое каждого буфера с версией preview.</p></div><p class="di-caption">Учебное структурное преобразование. Не заявляет полноту поиска вызовов, semantic correctness или успешные тесты.</p>`,button('semantic-apply','Применить в макете','class="di-button primary"'),(action,node)=>{
      if(action==='semantic-file'){plan.selected=Number(node.dataset.index);semanticPreview(plan);dialog.querySelector(`[data-di="semantic-file"][data-index="${plan.selected}"]`).focus();return;}
      if(action!=='semantic-apply')return;
      if(ide!==plan.owner||files!==plan.fileOwner){dialog.querySelector('#di-semantic-status').innerHTML='<p class="di-error">Проект изменился. Преобразование не применено.</p>';return;}
      const conflict=plan.changes.find(item=>files[item.path]!==item.before);if(conflict){dialog.querySelector('#di-semantic-status').innerHTML=`<p class="di-error">${esc(conflict.path)} изменён после подготовки preview. Ничего не применено. Закройте preview и пересчитайте изменение.</p>`;return;}
      plan.changes.forEach(item=>{files[item.path]=item.after;ide.dirty.add(item.path);});dialog.close();openFile(plan.changes[0].path,true);ideNotice(`Рефакторинг применён к ${plan.changes.length} файлам макета. Изменения не сохранены; нужны review и реальные тесты.`);
    });
  }
  function profilerRows(runtime){
    return runtime.startsWith('JVM')?[{name:'PaymentService.total',share:68,self:52,path:'backend/PaymentService.java',needle:'public BigDecimal total'},{name:'BigDecimal operations',share:23,self:23,path:null,needle:''},{name:'Application dispatch',share:9,self:9,path:null,needle:''}]:runtime.startsWith('Python')?[{name:'verify_total',share:63,self:31,path:'scripts/verify_import.py',needle:'def verify_total'},{name:'Decimal construction',share:28,self:28,path:'scripts/verify_import.py',needle:'return sum'},{name:'Python runtime',share:9,self:9,path:null,needle:''}]:[{name:'executeWithRetry',share:72,self:18,path:'src/retry-policy.ts',needle:'export async function executeWithRetry'},{name:'checkout',share:19,self:7,path:'src/checkout.ts',needle:'export async function checkout'},{name:'Checkout render',share:9,self:9,path:'src/Checkout.tsx',needle:'export function Checkout'}];
  }
  function profilerSource(item){const source=item?.path&&files[item.path];if(typeof source!=='string')return null;const index=source.split('\n').findIndex(text=>text.includes(item.needle));return index<0?null:{path:item.path,line:index+1};}
  function profilerReportMarkup(profile){
    if(profile.state==='recording')return `<div class="di-card"><b>Запись · ${profile.progress}%</b><p>Время сценария ${Math.round(profile.progress/10)} / 10 с. Пользователь может продолжать работу в редакторе.</p><progress value="${profile.progress}" max="100" aria-label="Запись профиля"></progress></div>`;
    if(profile.state==='unsupported')return '<div class="di-empty"><b>Профилировщик недоступен</b>Для выбранного runtime не обнаружена capture capability. Проверьте executable / SDK и адаптер профилировщика. Реальная поддержка здесь не проверялась.</div>';
    if(profile.state==='error')return '<div class="di-card"><b class="di-error">Не удалось получить samples</b><p>Сценарий: процесс завершился до получения профиля. Предыдущий отчёт, если был, не заменяется успешным результатом. Повтор запускается явно.</p></div>';
    if(!profile.report)return `<div class="di-empty"><b>${profile.state==='cancelled'?'Запись отменена':'Нет записи'}</b>Выберите процесс и режим, затем запишите демонстрационный профиль. Значения графика не являются замерами приложения.</div>`;
    const report=profile.report;
    if(!report.samples.length)return '<div class="di-empty"><b>Запись не содержит samples</b>Процесс мог бездействовать. Не следует придумывать hotspots: измените сценарий и запишите новый профиль.</div>';
    const rows=report.rows,selected=rows[profile.hotspot]||rows[0],sample=profile.sample===null?null:report.samples[profile.sample];
    return `${profile.state==='cancelled'?'<p class="di-caption">Новая запись отменена. Ниже сохранён предыдущий отчёт.</p>':''}<div class="di-bar"><b>${esc(report.mode)} · ${report.duration} с</b><span class="di-spacer"></span><span class="di-caption">${report.samples.length*128} samples · fixture</span></div><div class="di-timeline" aria-label="Временная шкала активности">${report.samples.map((value,index)=>`<button data-di="profiler-sample" data-index="${index}" aria-label="Интервал ${index}–${index+1} с, активность ${value}%" aria-pressed="${profile.sample===index}" style="--sample-height:${value}%" title="${index}–${index+1} с · ${value}%">${index}</button>`).join('')}</div><div class="di-bar"><span class="di-caption">${sample===null?'Вся запись':'Интервал '+profile.sample+'–'+(profile.sample+1)+' с · активность '+sample+'%'}</span><span class="di-spacer"></span>${button('profile-range-reset','Вся запись',profile.sample===null?'disabled':'')}</div><h3 style="margin-top:12px">Стек / flame view</h3><div class="di-flame-row"><button data-di="profiler-hotspot" data-index="0" style="width:100%" aria-pressed="${profile.hotspot===0}">${esc(report.runtime)} · 100%</button></div><div class="di-flame-row">${rows.map((item,index)=>`<button data-di="profiler-hotspot" data-index="${index}" style="width:${item.share}%" aria-pressed="${profile.hotspot===index}" title="${esc(item.name)} · total ${item.share}%, self ${item.self}%">${esc(item.name)} · ${item.share}%</button>`).join('')}</div><h3 style="margin-top:17px">Hotspots</h3>${rows.map((item,index)=>`<button class="di-profiler-hotspot" data-di="profiler-hotspot" data-index="${index}" aria-pressed="${profile.hotspot===index}"><span>${esc(item.name)}<br><small>${item.path?esc(item.path):'Внешний runtime · исходник не загружен'}</small></span><span>${item.share}%<br><small>self ${item.self}%</small></span></button>`).join('')}<div class="di-card" style="margin-top:13px"><b>${esc(selected.name)}</b><p>${selected.path?esc(selected.path):'Исходный файл для этого frame отсутствует.'}${profile.sample!==null?'<br>Выбран sample-интервал '+profile.sample+'–'+(profile.sample+1)+' с.':''}</p><div class="di-actions">${button('profiler-source','Открыть код',`class="di-button outline" ${profilerSource(selected)?'':'disabled title="Исходный файл или символ недоступен в текущем проекте"'}`)}${button('profiler-agent','Разобрать с агентом','class="di-button outline"')}</div></div><p class="di-caption">Timeline, проценты, стеки и samples — согласованный учебный набор. Выбор интервала выделяет sample; таблица показывает весь отчёт, а не притворяется пересчитанной выборкой.</p>`;
  }
  function profilerDialog(focusAction,focusIndex){
    const profile=ide.profiler,recording=profile.state==='recording';
    openDialog('Профилировщик',`<div class="di-columns"><label>Процесс<select id="di-profile-runtime" ${recording?'disabled':''}>${['Node · workbench','JVM · PaymentService','Python · verify_import'].map(value=>`<option ${profile.runtime===value?'selected':''}>${value}</option>`).join('')}</select></label><label>Режим<select id="di-profile-mode" ${recording?'disabled':''}>${['CPU','Allocations'].map(value=>`<option ${profile.mode===value?'selected':''}>${value}</option>`).join('')}</select></label></div><label>Сценарий макета<select id="di-profile-scenario" ${recording?'disabled':''}>${['Обычная запись','Пустая запись','Сбой записи','Нет capture capability'].map(value=>`<option ${profile.scenario===value?'selected':''}>${value}</option>`).join('')}</select></label><div id="di-profile-report">${profilerReportMarkup(profile)}</div>`,recording?button('profile-cancel','Отменить запись')+button('profile-stop','Завершить запись','class="di-button primary"'):button('profile-services','Службы')+button('profile-capture',profile.report?'Новая запись · демо':'Записать · демо',`class="di-button primary" ${profile.state==='unsupported'?'disabled title="Нет capture capability для выбранного сценария"':''}`),(action,node)=>{
      if(action==='profile-services'){languageServicesDialog();return;}
      if(action==='profile-capture'){startProfile();return;}
      if(action==='profile-cancel'){profile.token++;profile.state='cancelled';profilerDialog();return;}
      if(action==='profile-stop'){profile.token++;completeProfile(profile);profilerDialog();return;}
      if(action==='profiler-sample'){profile.sample=Number(node.dataset.index);profile.hotspot=profile.sample%profile.report.rows.length;profilerDialog(action,profile.sample);return;}
      if(action==='profiler-hotspot'){profile.hotspot=Number(node.dataset.index);profilerDialog(action,profile.hotspot);return;}
      if(action==='profile-range-reset'){profile.sample=null;profilerDialog();return;}
      const selected=profile.report?.rows[profile.hotspot];
      if(action==='profiler-source'&&profilerSource(selected)){const location=profilerSource(selected);dialog.close();openFile(location.path,true);revealLine(location.line);ideNotice('Переход из hotspot '+selected.name+' · строка найдена в fixture, это не source-map доказательство.');return;}
      if(action==='profiler-agent'&&selected){dialog.close();sendToAgent(`Проанализируй гипотезу оптимизации по ${selected.name} (${selected.path||'runtime'}). Учебный профиль: total ${selected.share}%, self ${selected.self}%. Значения демонстрационные; сначала получи реальный baseline, затем предложи минимальное изменение и сравни замеры.`,ideNotice);}
    });
    dialog.dataset.diView='profiler';
    dialog.querySelector('#di-profile-runtime').onchange=event=>{profile.runtime=event.target.value;profile.report=null;profile.state=profile.scenario==='Нет capture capability'?'unsupported':'empty';profile.sample=null;profile.hotspot=0;profilerDialog();};
    dialog.querySelector('#di-profile-mode').onchange=event=>{profile.mode=event.target.value;profile.report=null;profile.state=profile.scenario==='Нет capture capability'?'unsupported':'empty';profilerDialog();};
    dialog.querySelector('#di-profile-scenario').onchange=event=>{profile.scenario=event.target.value;profile.state=profile.scenario==='Нет capture capability'?'unsupported':'empty';profile.report=null;profilerDialog();};
    if(focusAction){const node=dialog.querySelector(`[data-di="${focusAction}"][data-index="${focusIndex}"]`);if(node)node.focus({preventScroll:true});}
  }
  function completeProfile(profile){
    if(profile.scenario==='Сбой записи'){profile.state='error';return;}
    const sampleCount=profile.progress>=100?10:Math.max(1,Math.round(profile.progress/10));
    profile.state='ready';profile.sample=null;profile.hotspot=0;profile.report={runtime:profile.runtime,mode:profile.mode,duration:sampleCount,samples:profile.scenario==='Пустая запись'?[]:[18,32,76,88,46,59,72,31,24,12].slice(0,sampleCount),rows:profilerRows(profile.runtime)};
  }
  function startProfile(){
    const owner=ide,profile=ide.profiler;if(profile.scenario==='Нет capture capability'){profile.state='unsupported';profilerDialog();return;}const token=++profile.token;profile.state='recording';profile.progress=0;profilerDialog();
    const timer=setInterval(()=>{if(profile.token!==token||profile.state!=='recording'){clearInterval(timer);return;}profile.progress=Math.min(100,profile.progress+10);if(profile.progress===100){completeProfile(profile);clearInterval(timer);}if(owner===ide&&dialog.open&&dialog.dataset.diView==='profiler'){if(profile.state==='recording'){const node=dialog.querySelector('#di-profile-report');if(node)node.innerHTML=profilerReportMarkup(profile);}else profilerDialog();}},300);
  }
  function runSettings(){
    const entries=Object.keys(ide.runConfigurations),current=ide.runConfigurations[ide.config]||ide.runConfigurations[entries[0]];
    openDialog('Конфигурация запуска',`<label>Название<input id="di-run-name" value="${esc(ide.config)}"></label><label>Команда<input id="di-run-command" value="${esc(current.command)}"></label><div class="di-columns"><label>Рабочая папка<input id="di-run-cwd" value="${esc(current.cwd)}"></label><label>Окружение<select id="di-run-env"><option ${current.env==='ДЕВ'?'selected':''}>ДЕВ</option><option ${current.env==='ИФТ'?'selected':''}>ИФТ</option></select></label></div><label>Перед запуском<input id="di-run-before" value="${esc(current.before)}" placeholder="Например, npm run build"></label><label>Переменные окружения<textarea data-language="bash" id="di-run-vars" style="min-height:80px" placeholder="NODE_ENV=development\nTOKEN=@secret:service-token">${esc(current.vars||'')}</textarea></label><p>В рабочем приложении executable и argv хранятся отдельно; секреты — по ссылкам. В макете команды не запускаются.</p>`,button('run-config-clone','Сохранить как новую')+button('run-config-save','Сохранить','class="di-button primary"'),a=>{if(a!=='run-config-save'&&a!=='run-config-clone')return;let name=dialog.querySelector('#di-run-name').value.trim();if(!name)return;if(a==='run-config-clone'&&Object.hasOwn(ide.runConfigurations,name))name+=' · copy';const config={command:dialog.querySelector('#di-run-command').value,cwd:dialog.querySelector('#di-run-cwd').value,env:dialog.querySelector('#di-run-env').value,before:dialog.querySelector('#di-run-before').value,vars:dialog.querySelector('#di-run-vars').value};if(a==='run-config-save'&&name!==ide.config)delete ide.runConfigurations[ide.config];ide.runConfigurations[name]=config;ide.config=name;dialog.close();ide.status='Конфигурация сохранена в макете';renderIDE();});
  }
  function searchProject(){ide.searchResults=[];if(ide.search.trim())Object.entries(files).forEach(([path,text])=>text.split('\n').forEach((line,index)=>{if(line.toLowerCase().includes(ide.search.toLowerCase()))ide.searchResults.push({path,line:index+1,text:line});}));renderIDE();}
  ideRoot.addEventListener('click',event=>{const el=event.target.closest('[data-di]');if(el)ideAction(el.dataset.di,el,event);});
  ideRoot.addEventListener('input',event=>{if(event.target.id==='di-code-input'){files[ide.active]=event.target.value;ide.dirty.add(ide.active);ideRoot.querySelector('.di-code-status').textContent=ide.active+' · изменён';refreshEditorChrome();}if(event.target.id==='di-file-search'){ide.filter=event.target.value;ideRoot.querySelector('#di-file-list').innerHTML=ideTree();}if(event.target.id==='di-global-search')ide.search=event.target.value;if(event.target.id==='di-terminal-input')ide.terminalDraft=event.target.value;});
  ideRoot.addEventListener('change',event=>{if(event.target.id==='di-run-config')ide.config=event.target.value;});
  ideRoot.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='p'){event.preventDefault();quickOpen();return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();ideAction('save-file');}if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();ideAction('ide-search');}if(event.target.id==='di-terminal-input'&&event.key==='Enter'){event.preventDefault();ideAction('terminal-submit');}if(event.target.id==='di-global-search'&&event.key==='Enter'){event.preventDefault();searchProject();}});
  // A project owns its tabs, drafts, results and file tree. The active chat is read at action time.
  const scopeName = () => String(window.SuitePrototype?.project?.() || currentScope || 'Atlas Platform');
  let currentScope = String(window.SuitePrototype?.project?.() || 'Atlas Platform');
  installDocumentState(data);
  chooseInitialDB();
  const initialData = clone(data), initialFiles = clone(files);
  const initialIDE = {...ide, saved:clone(ide.saved),open:[...ide.open],dirty:new Set(),expanded:new Set(ide.expanded),breakpoints:new Set(ide.breakpoints),breakpointFiles:structuredClone(ide.breakpointFiles),editorViews:{},debugWatches:[...ide.debugWatches],tests:clone(ide.tests),runConfigurations:clone(ide.runConfigurations),languageServices:clone(ide.languageServices),profiler:clone(ide.profiler)};
  const scopes = new Map([[currentScope,{data,ide,files}]]);
  ideRoot.addEventListener('toggle',event=>{if(event.target.matches('.di-file-folder')&&event.target.dataset.filterOpen!=='true'&&event.target.dataset.project===currentScope){const folder=event.target.dataset.folder;if(event.target.open)ide.expanded.add(folder);else {const keys=event.target.dataset.folderKeys?JSON.parse(event.target.dataset.folderKeys):[folder];keys.forEach(key=>ide.expanded.delete(key));}}},true);
  document.addEventListener('suite:scope-change',event=>{
    const next = String(event.detail?.project || window.SuitePrototype?.project?.() || currentScope);
    if(event.detail?.previousProject&&scopes.has(String(event.detail.previousProject))){const prior=String(event.detail.previousProject);scopes.set(next,scopes.get(prior));scopes.delete(prior);if(currentScope===prior)currentScope=next;}
    if(next===currentScope){const caption=ideRoot.querySelector('#di-project-caption');if(caption)caption.textContent=next;ideRoot.dataset.project=next;ideRoot.querySelectorAll('.di-file-folder').forEach(node=>node.dataset.project=next);return;}
    captureIDEView();if(dialog.open)dialog.close();
    const firstVisit=!scopes.has(next);
    if(firstVisit)scopes.set(next,{data:clone(initialData),files:clone(initialFiles),ide:{...initialIDE,saved:clone(initialFiles),open:[...initialIDE.open],dirty:new Set(),expanded:new Set(initialIDE.expanded),breakpoints:new Set(initialIDE.breakpoints),breakpointFiles:structuredClone(initialIDE.breakpointFiles),editorViews:{},searchResults:[],debugWatches:[...initialIDE.debugWatches],tests:clone(initialIDE.tests),runConfigurations:clone(initialIDE.runConfigurations),languageServices:clone(initialIDE.languageServices),profiler:clone(initialIDE.profiler)}});
    currentScope=next;({data,ide,files}=scopes.get(next));installDocumentState(data);if(firstVisit)chooseInitialDB();renderData();renderIDE();
  });
  document.addEventListener('suite:project-renamed',event=>{const previous=String(event.detail?.previousProject||''),next=String(event.detail?.project||'');if(previous&&next&&previous!==next&&scopes.has(previous)){scopes.set(next,scopes.get(previous));scopes.delete(previous);}});
  document.addEventListener('suite:connections-changed',()=>{const selector=dataRoot.querySelector('#di-connection');if(selector)selector.innerHTML=dbOptions();const binding=dbBinding();if(binding.missing||binding.changed)allowNewDBOperation();});
  function saveIDEFile(path){
    const before=ide.saved[path]??'',after=files[path]??'';
    ide.saved[path]=after;
    window.SuiteGitPrototype?.fileSaved(path,before,after);
  }
  function downloadedFilePath(names,name,revision=1){
    if(typeof name!=='string'||!name.trim()||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)||name==='.'||name==='..'||name.length>160)throw Error('Некорректное имя файла для Windows.');
    const used=new Set(names.map(x=>x.toLowerCase()));let folder='downloads',index=1;
    while(used.has(folder.toLowerCase()))folder='downloads-'+(++index);
    const dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
    const base=stem+(revision>1?'-r'+revision:'');let path=folder+'/'+base+ext,n=1;
    while(used.has(path.toLowerCase())||names.some(x=>x.toLowerCase().startsWith(path.toLowerCase()+'/')))path=folder+'/'+base+' ('+(++n)+')'+ext;
    return path;
  }
  function openDownloadedFile(payload){
    if(!payload||payload.project!==scopeName())return {ok:false,error:'Откройте исходный проект файла. Текущий проект не изменён.'};
    if(typeof payload.content!=='string'||payload.content.includes('\0')||new TextEncoder().encode(payload.content).length>1024*1024)return {ok:false,error:'Этот файл требует потокового или специализированного редактора. В макете IDE открывает текст до 1 МБ.'};
    if(!payload.fileId||!payload.scopeKey||!Number.isSafeInteger(payload.revision)||payload.revision<0)return {ok:false,error:'Отсутствует проверенная версия файла.'};
    const imports=ide.downloadImports||(ide.downloadImports={}),key=JSON.stringify([payload.scopeKey,payload.fileId,payload.revision]);
    const previous=imports[key];
    if(previous&&previous.source!==payload.content)return {ok:false,error:'Содержимое этой версии изменилось. Обновите карточку загрузки.'};
    if(previous&&Object.hasOwn(files,previous.path)){
      ideGitController?.close?.();window.SuiteWorkspaceLayout?.open?.('code');openFile(previous.path,true);
      ideNotice('Открыта прежняя рабочая копия. Ваши изменения сохранены; синхронизация с загрузкой не выполнялась.');
      return {ok:true,path:previous.path,existing:true};
    }
    let path;try{path=downloadedFilePath(Object.keys(files),payload.name||payload.path,payload.revision)}catch(e){return {ok:false,error:e.message}}
    captureIDEView();files[path]=payload.content;ide.saved[path]=payload.content;
    imports[key]={path,source:payload.content,fileId:payload.fileId,revision:payload.revision};
    ide.expanded.add(path.split('/')[0]);ide.filter='';ide.explorer=true;ideGitController?.close?.();
    window.SuiteWorkspaceLayout?.open?.('code');openFile(path,true);
    ideNotice('Независимая рабочая копия загрузки · макет. Правки в IDE не заменяют исходный скачанный файл.');
    return {ok:true,path,existing:false};
  }
  window.SuiteIDEPrototype={
    openDownloadedFile,downloadedFilePath,context:ideContext,
    gitReady:()=>!!ideGitController,
    dirtyFiles:()=>[...ide.dirty],
    showGit(section='changes',path){
      if(!ideGitController)return;
      window.SuiteWorkspaceLayout?.open?.('code');
      ideGitController.open(section,path);
    },
    attachGit(){
      const source=window.SuiteGitPrototype;if(ideGitController||!source||!window.SuiteIdeGit)return;
      ideGitController=window.SuiteIdeGit.create({
        git:source.git,diffLines:source.diffLines,project:scopeName,esc,
        changed:()=>{source.changed();refreshGitMount();},
        close:()=>refreshGitMount(),
        currentFile:()=>ide.active,dirtyFiles:()=>[...ide.dirty],
        openFile(path){if(!Object.hasOwn(files,path)){ideNotice('Файл '+path+' отсутствует в редакторском fixture этого проекта. Содержимое не подменено другим файлом.');return;}ideGitController.close();ide.status='Редакторский пример · Git diff использует отдельный fixture; реальной рабочей копии пока нет.';openFile(path,true);},
        ask:payload=>source.ask(payload),legacy:source.legacy
      });
      document.addEventListener('suite:git-changed',refreshGitMount);
      refreshGitMount();source.changed();
    }
  };
  extensionWorkbench=window.SuiteIDEExtensions?.create({ide:()=>ide,project:scopeName,dialog:openDialog,closeDialog:()=>dialog.close(),dialogElement:()=>dialog,ask:payload=>sendToAgent(payload,ideNotice),notice:ideNotice});
  explorerWorkbench=window.SuiteIDEExplorer?.create({ide:()=>ide,files:()=>files,project:scopeName,openFile:path=>openFile(path,true),render:renderIDE,dialog:openDialog,closeDialog:()=>dialog.close(),dialogElement:()=>dialog,ask:payload=>sendToAgent(payload,ideNotice),notice:ideNotice,quickOpen,captureView:captureIDEView,root:ideRoot,gitStatus:path=>{const source=window.SuiteGitPrototype;if(!source||source.project()!==scopeName())return null;const g=source.git();return {record:g.files.find(f=>f.path===path),staged:g.staged.includes(path)||g.hunks.some(h=>h.path===path)}}});
  languageWorkbench=window.SuiteIDELanguages?.create({ide:()=>ide,files:()=>files,project:scopeName,openFile:path=>openFile(path,true),revealLine,render:renderIDE,dialog:openDialog,closeDialog:()=>dialog.close(),dialogElement:()=>dialog,ask:payload=>sendToAgent(payload,ideNotice),notice:ideNotice,root:ideRoot,breakpoints:breakpointsFor});
  renderData();renderIDE();
  window.dispatchEvent(new CustomEvent('suite-prototype-extension-ready',{detail:{module:'data-ide',version:1}}));
})();
