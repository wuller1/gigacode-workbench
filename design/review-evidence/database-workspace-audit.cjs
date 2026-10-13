/* Actual prototype DATA actions in an isolated VM. No driver, MCP, SQL execution or live browser. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const relative = 'design/suite-prototype-data-ide.js';
const source = fs.readFileSync(path.resolve(__dirname, '../suite-prototype-data-ide.js'), 'utf8');
const begin = source.indexOf('  const initialRows =');
const end = source.indexOf('  /* IDE —');
assert(begin > 0 && end > begin, 'Prototype DATA section must remain identifiable');
const body = source.slice(begin, end);
const tests = [];
const plain = value => JSON.parse(JSON.stringify(value));
function test(name, check) {
  try { check(); tests.push({name, pass:true}); }
  catch (error) { tests.push({name, pass:false, error:error.stack}); }
}
function fixture() {
  let modal = null, renders = 0, timerId = 0;
  const fields = {}, listeners = {}, timers = new Map(), intervals = new Map();
  const field = (initial={}) => Object.assign({value:'',checked:false,dataset:{},classList:{toggle(){},add(){},remove(){}},style:{},focus(){this.focused=true;},closest(){return null;},setAttribute(){},setCustomValidity(message){this.validation=message;},reportValidity(){},append(){},addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},setSelectionRange(){},getBoundingClientRect(){return {width:300,height:300};}}, initial);
  const notice=field(),content=field(),gutter=field();
  const root={id:'di-data',dataset:{},style:{},addEventListener:(type,handler)=>{(listeners[type]||=[]).push(handler);},querySelector:selector=>fields[selector]||({'.di-notice':notice,'#di-data-content':content,'.di-gutter':gutter}[selector])||null,querySelectorAll:selector=>fields[selector]||[]};
  let modalElements=[];
  const dialog={dataset:{},open:false,querySelector:selector=>{
    if(fields[selector])return fields[selector];const attribute=selector.match(/^\[data-([\w-]+)="([^"]*)"\]$/);return attribute?modalElements.find(node=>node.dataset[attribute[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]===attribute[2])||null:null;
  },querySelectorAll:selector=>fields[selector]||modalElements.filter(node=>{
    if(selector.startsWith('.'))return node.classes.includes(selector.slice(1));
    const attribute=selector.match(/^\[data-([\w-]+)\](?::checked)?$/);return attribute&&Object.hasOwn(node.dataset,attribute[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase()))&&(!selector.endsWith(':checked')||node.checked);
  }),close(){this.open=false;}};
  function openDialog(title,markup,actions,callback) {
    modal={title,markup,actions,callback};dialog.open=true;fields.main=field();modalElements=[];
    const attribute=(text,name)=>text.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"'))?.[1];
    for(const match of (markup+(actions||'')).matchAll(/<(input|select|textarea|p|button)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){
      const [,tag,attrs,inner='']=match,node=field({classes:(attribute(attrs,'class')||'').split(/\s+/)}),id=attribute(attrs,'id');
      node.value=attribute(attrs,'value')||'';node.checked=/(?:^|\s)checked(?:\s|$)/.test(attrs);node.disabled=/(?:^|\s)disabled(?:\s|$)/.test(attrs);
      for(const dataAttr of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g))node.dataset[dataAttr[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=dataAttr[2];
      if(tag==='select'){const options=[...inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)],selected=options.find(option=>/(?:^|\s)selected(?:\s|$)/.test(option[1]))||options[0];node.value=selected?(attribute(selected[1],'value')??selected[2]):'';}
      if(tag==='textarea')node.value=inner;
      if(id)fields['#'+id]=node;modalElements.push(node);
    }
  }
  const connections=[{id:'payments-dev',name:'payments',env:'ДЕВ',address:'demo://payments-dev'},{id:'payments-ift',name:'payments',env:'ИФТ',address:'demo://payments-ift'}];
  const context={window:{SuitePrototype:{connections:()=>connections,project:()=> 'Audit project'}},document:{addEventListener(){},createElement:()=>field(),querySelector:()=>null},dataRoot:root,dialog,openDialog,esc:value=>String(value??''),icon:name=>`<i>${name}</i>`,button:(action,label,attrs='')=>`<button data-di="${action}" ${attrs}>${label}</button>`,editorFocus:()=>()=>{},scopeName:()=> 'Audit project',currentScope:'Audit project',sendToAgent(){},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{intervals.set(++timerId,fn);return timerId;},clearInterval:id=>intervals.delete(id),structuredClone,console};
  vm.createContext(context);
  vm.runInContext(body+'\nrenderData=()=>__render();\nif(typeof installDocumentState===\'function\')installDocumentState(data);\nchooseInitialDB();',Object.assign(context,{__render:()=>renders++}),{filename:relative});
  const run=expression=>vm.runInContext(expression,context);
  return {context,run,connections,fields,field,listeners,dialog,root,notice,
    get modal(){return modal;}, get renders(){return renders;},
    state(){return run('data');},doc(){return run('currentQuery()');},
    action(action,dataset={}) {context.__action=action;context.__element={dataset};return run('dataAction(__action,__element)');},
    choose(action,dataset={}) {assert(modal?.callback,'No active dialog action handler');return modal.callback(action,{dataset});},
    change(id,value){for(const handler of listeners.change||[])handler({target:{id,value}});},
    flush(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());},
    tick(){[...intervals.values()].forEach(fn=>fn());},
    syncGridCells() {fields['.d2-results [data-cell-row]']=[...run('renderResults()').matchAll(/data-cell-row="([^"]*)" data-cell-column="([^"]*)"/g)].map(([,cellRow,cellColumn])=>field({dataset:{cellRow,cellColumn}}));},
    inputCell(value) {const target=field({id:'di-cell-input',value});for(const handler of listeners.input||[])handler({target});return target;},
    keyCell(key,options={}) {const event={key,target:field({id:'di-cell-input'}),isComposing:false,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...options};for(const handler of listeners.keydown||[])handler(event);return event;},
    set(selector,value,extras={}){return fields[selector]=field({value,...extras});}
  };
}

// Tests below exercise user-observable transitions and immutable operation targets.
test('Object navigation preserves an existing unsaved SQL draft',()=>{
  const f=fixture(),original=f.doc();original.sql='SELECT 42 AS my_unsaved_work;';original.dirty=true;
  f.action('db-object',{name:'orders',group:'Таблицы'});
  assert.equal(original.sql,'SELECT 42 AS my_unsaved_work;');assert.equal(original.dirty,true);
  assert.notEqual(f.doc().id,original.id);assert.equal(f.state().object,'orders');
});
test('Opening a database object keeps the object explorer visible',()=>{
  const f=fixture();f.state().explorer=true;f.action('db-object',{name:'orders',group:'Таблицы'});assert.equal(f.state().explorer,true);
});
test('Reopening the same object reuses its tab and staged changes',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const id=f.doc().id,count=f.state().tabs.length;
  f.state().pending['201:status']='review';f.action('db-object',{name:'customers',group:'Таблицы'});f.action('db-object',{name:'orders',group:'Таблицы'});
  assert.equal(f.doc().id,id);assert.equal(f.state().tabs.length,count+1);assert.equal(f.state().pending['201:status'],'review');
});
test('Independent documents retain their rows, filters, paging and staged cells',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const a=f.doc().id;
  f.state().pending['201:status']='review';f.state().queryFilter='paid';f.state().pageSize=100;
  f.action('db-object',{name:'customers',group:'Таблицы'});const b=f.doc().id;
  assert.equal(f.state().object,'customers');assert.deepEqual(plain(f.state().pending),{});assert.equal(f.state().queryFilter,'');
  f.action('sql-tab',{id:a});assert.equal(f.state().object,'orders');assert.equal(f.state().rows[0].order_key,'ord_91c2');assert.equal(f.state().queryFilter,'paid');assert.equal(f.state().pageSize,100);assert.equal(f.state().pending['201:status'],'review');
  f.action('sql-tab',{id:b});assert.equal(f.state().rows[0].name,'Atlas demo');
});
test('Read-only mode belongs to its object document',()=>{
  const f=fixture();f.action('db-object',{name:'retry_summary',group:'Представления'});const view=f.doc().id;assert.equal(f.state().readOnly,true);
  f.action('db-object',{name:'orders',group:'Таблицы'});assert.equal(f.state().readOnly,false);f.action('sql-tab',{id:view});assert.equal(f.state().readOnly,true);
});
test('Reconfigured connection identity cannot reuse an object tab pinned to the old server',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const old=f.doc();f.action('new-sql');f.connections[0].address='demo://replacement-server';f.run("switchDataConnection('payments-dev')");
  f.action('db-object',{name:'orders',group:'Таблицы'});assert.notEqual(f.doc().id,old.id);assert.equal(f.state().connectionMeta.address,'demo://replacement-server');assert.equal(old.state.connectionMeta.address,'demo://payments-dev');
});
test('An in-flight query completes into its original console after tab switch',()=>{
  const f=fixture(),first=f.doc();first.sql='SELECT * FROM public.checkout_retry;';f.action('execute');assert.equal(f.state().running,true);
  f.action('new-sql');const second=f.doc();second.sql='SELECT 2;';const before=f.state().status;assert.notEqual(second.id,first.id);assert.equal(f.state().running,false);
  f.flush();assert.equal(f.doc().id,second.id);assert.equal(f.state().status,before);
  f.action('sql-tab',{id:first.id});assert.equal(f.state().running,false);assert.match(f.state().status,/демонстрац|fixture|учебн/i);
});
test('Repeated execution in one console does not duplicate history',()=>{
  const f=fixture();f.action('execute');f.action('execute');f.flush();assert.equal(f.state().history.length,1);
});
test('Unsupported projection cannot fabricate a successful result for another table',()=>{
  const f=fixture();f.doc().sql='SELECT id, order_id, attempt, status_code, response_kind FROM public.orders;';f.action('execute');f.flush();assert.doesNotMatch(f.state().status,/\d+ строк · учебный SELECT/);assert.match(f.state().status,/не выполнял|не поддерж|ошиб|неизвест/i);
});
test('Cancelling one running console cannot cancel a second console',()=>{
  const f=fixture();const first=f.doc().id;f.action('execute');f.action('new-sql');const second=f.doc().id;f.doc().sql='SELECT 2;';f.action('execute');
  f.action('sql-tab',{id:first});f.action('cancel-query');f.flush();assert.match(f.state().status,/отмен/i);f.action('sql-tab',{id:second});assert.equal(f.state().running,false);assert.doesNotMatch(f.state().status,/отмен/i);
});
test('Closing a running console preserves its active operation',()=>{
  const f=fixture();const id=f.doc().id;f.action('execute');f.action('close-sql',{id});assert(f.state().tabs.some(tab=>tab.id===id));assert.equal(f.state().running,true);
});
test('Closing a dirty SQL console first offers a decision without deleting it',()=>{
  const f=fixture(),id=f.doc().id;f.doc().dirty=true;f.doc().sql='SELECT private_draft;';f.action('close-sql',{id});assert(f.state().tabs.some(tab=>tab.id===id));assert(f.dialog.open);assert.match(f.modal.markup,/несохран|черновик|измен/i);
  f.dialog.close();assert.equal(f.doc().sql,'SELECT private_draft;');
});
test('Closing a clean middle active console chooses its neighbour',()=>{
  const f=fixture();f.action('new-sql');const middle=f.doc().id;f.action('new-sql');const last=f.doc().id;f.action('sql-tab',{id:middle});f.action('close-sql',{id:middle});assert.equal(f.doc().id,last);
});
test('Closing an inactive console preserves the active selection',()=>{
  const f=fixture(),first=f.doc().id;f.action('new-sql');const second=f.doc().id;f.action('close-sql',{id:first});assert.equal(f.doc().id,second);
});
test('Removed connection rejects a new query while keeping the SQL draft',()=>{
  const f=fixture();const sql=f.doc().sql;f.connections.splice(0,1);f.action('execute');assert.equal(f.state().running,false);assert.equal(f.doc().sql,sql);assert.match(f.state().status,/отвяз|недоступ|подключ/i);
});
test('Changing the endpoint cannot silently redirect a new query',()=>{
  const f=fixture();f.connections[0].address='demo://different-server';f.action('execute');assert.equal(f.state().running,false);assert.equal(f.state().connectionMeta.address,'demo://payments-dev');assert.match(f.state().status,/измен|привяз/i);
});
test('A new unfamiliar connection has no invented catalog or old rows',()=>{
  const f=fixture();f.connections.splice(0,f.connections.length,{id:'corporate',env:'QA',name:'customerdb',address:'https://example.invalid/new-target'});f.run('chooseInitialDB()');assert.equal(f.state().catalogAvailable,false);assert.equal(f.state().rows.length,0);assert.equal(f.state().object,'');
});
test('Background job retains a detached copy of its connection target',()=>{
  const f=fixture();f.run("startJob('Export fixture',dbTarget(),'COPY TO STDOUT',data.connectionMeta)");const job=f.state().jobs[0],saved=plain(job.targetMeta);f.state().connectionMeta.address='demo://changed';assert.deepEqual(plain(job.targetMeta),saved);assert.equal(job.status,'Выполняется');
});
test('Cancelled background job remains cancelled after subsequent progress ticks',()=>{
  const f=fixture();f.run("startJob('Import fixture',dbTarget(),'COPY FROM STDIN',data.connectionMeta)");const job=f.state().jobs[0];f.tick();const progress=job.progress;f.action('cancel-job',{id:job.id});f.tick();f.tick();assert.equal(job.status,'Отменено');assert.equal(job.progress,progress);
});
test('A deserialized project reinstalls document ownership without shared snapshots',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const orders=f.doc().id;f.state().pending['201:status']='draft';
  f.run('const savedForAudit=clone(data); data=installDocumentState(clone(savedForAudit));');
  f.action('new-sql');assert.deepEqual(plain(f.state().pending),{});f.action('sql-tab',{id:orders});assert.equal(f.state().pending['201:status'],'draft');
  f.state().pending['201:status']='changed';assert.equal(f.run("savedForAudit.tabs.find(tab=>tab.id==="+orders+").state.pending['201:status']"),'draft');
});
test('Execution mode selection runs only the selected SQL fragment',()=>{
  const f=fixture();f.doc().sql='SELECT 1; SELECT * FROM public.orders; SELECT 3;';const start=f.doc().sql.indexOf('SELECT *'),end=f.doc().sql.indexOf(';',start)+1;
  f.state().executionMode='selection';f.set('#di-sql',f.doc().sql,{selectionStart:start,selectionEnd:end});f.action('execute');f.flush();
  assert.equal(f.state().history[0].sql,'SELECT * FROM public.orders;');assert.equal(f.state().rows[0].order_key,'ord_91c2');
});
test('Execution mode selection refuses to run the full file when nothing is selected',()=>{
  const f=fixture();f.state().executionMode='selection';f.set('#di-sql',f.doc().sql,{selectionStart:0,selectionEnd:0});f.action('execute');f.flush();assert.equal(f.state().history.length,0);assert.equal(f.state().running,false);assert.match(f.state().status,/выдел/i);
});
test('SQL statement splitter preserves quoted and nested-comment semicolons',()=>{
  const f=fixture();const sql=`SELECT ';' AS "semi;colon", 'it''s;fine'; /* outer ; /* nested ; */ done */ SELECT 2;`;
  f.context.__sql=sql;const pieces=plain(f.run('sqlStatementRanges(__sql).map(range=>__sql.slice(range.start,range.end))'));
  assert.equal(pieces.length,2);assert.equal(pieces[0],`SELECT ';' AS "semi;colon", 'it''s;fine';`);assert.match(pieces[1],/SELECT 2;$/);
});
test('SQL statement splitter retains complete Unicode dollar-quoted routine bodies',()=>{
  const f=fixture();const sql='DO $тело$ BEGIN PERFORM 1; PERFORM 2; END; $тело$; SELECT 3;';f.context.__sql=sql;
  assert.equal(f.run('sqlStatementRanges(__sql).length'),2);assert.match(f.run('selectedSQL({sql:__sql},"current",{start:20,end:20})'),/END; \$тело\$;$/);
});
test('Parameter detection ignores quoted literals, identifiers, casts and comments',()=>{
  const f=fixture();f.context.__sql=`SELECT ':inside', E'escaped\\\' :quoted', "col:param", 1::integer, :wanted, :wanted /* :comment /* :nested */ */ -- :line\n, $$:body$$, $тело$:body2$тело$;`;
  assert.deepEqual(plain(f.run('sqlParameterNames(__sql)')),['wanted']);
});
test('Export uses the actual selected object, page, order and settings',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.state().pageSize=1;f.state().page=2;f.state().sort='amount';f.state().asc=false;
  f.action('export');assert.match(f.modal.markup,/orders/);assert.doesNotMatch(f.modal.markup,/checkout_retry/);
  f.set('#di-export-format','XLSX');f.set('#di-export-scope','page');f.set('#di-export-name','orders-page');f.set('#di-export-encoding','Windows-1251');f.set('#di-export-delimiter',';');f.set('#di-export-headers','',{checked:false});f.set('#di-export-formulas','',{checked:true});f.choose('export-run');
  const job=f.state().jobs[0];assert.equal(job.options.object,'orders');assert.equal(job.options.rowCount,1);assert.equal(job.options.scope,'page');assert.equal(job.options.page,2);assert.equal(job.options.sort,'amount');assert.equal(job.options.asc,false);assert.equal(job.options.headers,false);assert.equal(job.options.protectFormulas,true);assert.equal(job.method,'Streaming XLSX');assert.match(job.target,/orders$/);assert(job.options.columns.includes('amount'));
});
test('Export background job snapshots options instead of aliasing caller state',()=>{
  const f=fixture();f.context.__options={columns:['id','amount'],filter:'paid',direction:'export'};f.run("startJob('fixture',dbTarget(),'COPY TO STDOUT',data.connectionMeta,__options)");const job=f.state().jobs[0];f.context.__options.columns.push('secret');f.context.__options.filter='changed';assert.deepEqual(plain(job.options.columns),['id','amount']);assert.equal(job.options.filter,'paid');
});
test('Export cannot begin after the captured connection endpoint is reconfigured',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('export');f.connections[0].address='demo://changed-during-dialog';f.choose('export-run');assert.equal(f.state().jobs.length,0);assert.match(f.fields['#di-transfer-error'].textContent,/измен|привяз|подключ/i);
});
test('Import defaults and mapping belong to the chosen table',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('import');assert.equal(f.fields['#di-import-name'].value,'orders.csv');assert.doesNotMatch(f.modal.markup,/checkout_retry/);
  f.set('#di-import-encoding','Windows-1251');f.set('#di-import-delimiter',';');f.set('#di-import-header','',{checked:false});f.choose('next');
  assert.match(f.modal.markup,/order_key/);assert.match(f.modal.markup,/amount/);assert.doesNotMatch(f.modal.markup,/response_kind/);f.set('#di-import-mode','staging');f.set('#di-import-errors','quarantine');f.choose('next');f.choose('next');
  const job=f.state().jobs[0];assert.equal(job.options.object,'orders');assert.equal(job.options.encoding,'Windows-1251');assert.equal(job.options.delimiter,';');assert.equal(job.options.header,false);assert.equal(job.options.mode,'staging');assert.equal(job.options.badRows,'quarantine');assert.equal(job.method,'COPY FROM STDIN');assert(job.options.mapping.some(item=>item.source==='amount'&&item.target==='amount'));assert.match(job.target,/orders$/);
});
test('Import back navigation keeps chosen source settings',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('import');f.set('#di-import-format','XLSX');f.set('#di-import-name','my-orders.xlsx');f.set('#di-import-size','10 GB');f.set('#di-import-encoding','Windows-1251');f.choose('next');f.choose('back');
  assert.equal(f.fields['#di-import-format'].value,'XLSX');assert.equal(f.fields['#di-import-name'].value,'my-orders.xlsx');assert.equal(f.fields['#di-import-size'].value,'10 GB');assert.equal(f.fields['#di-import-encoding'].value,'Windows-1251');
});
test('Import duplicate destination mapping cannot advance or create a job',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('import');f.choose('next');const mappings=f.dialog.querySelectorAll('.di-mapping');assert(mappings.length>1);mappings[1].value=mappings[0].value;f.choose('next');assert.match(f.fields['#di-transfer-error'].textContent,/повтор/i);assert.equal(f.state().jobs.length,0);
});
test('Import cannot begin after the captured connection disappears',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('import');f.choose('next');f.choose('next');f.connections.splice(0,1);f.choose('next');assert.equal(f.state().jobs.length,0);assert.match(f.fields['#di-transfer-error'].textContent,/измен|привяз|подключ/i);
});
test('413 recovery retains the original transfer options after reconciliation',()=>{
  const f=fixture();f.context.__options={direction:'export',object:'orders',format:'XLSX',scope:'page',page:2,pageSize:50,filter:'pending',columns:['id','amount']};f.run("startJob('fixture',dbTarget(),'Streaming XLSX',data.connectionMeta,__options)");
  const original=f.state().jobs[0];f.action('job-413',{id:original.id});assert.equal(original.status,'Исход неизвестен');assert.equal(f.state().jobs.length,1);f.choose('check-job');assert.equal(f.state().jobs.length,1);f.choose('restart-job');const retry=f.state().jobs[0];assert.notEqual(retry.id,original.id);assert.deepEqual(plain(retry.options),plain(original.options));assert.deepEqual(plain(retry.targetMeta),plain(original.targetMeta));
});
test('Table edits stage first and manual rollback restores this table only',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const doc=f.doc().id,before=plain(f.state().rows);f.state().transaction=true;
  f.action('edit-cell',{row:201,column:'status'});f.inputCell('reviewed');f.keyCell('Enter');assert.equal(f.state().rows[0].status,'paid');assert.equal(f.state().pending['201:status'],'reviewed');
  f.action('apply-grid');assert.match(f.modal.markup,/UPDATE public.orders/);f.choose('apply');assert.equal(f.state().rows[0].status,'reviewed');assert.equal(f.state().transactionDirty,true);
  f.action('db-object',{name:'customers',group:'Таблицы'});const customers=plain(f.state().rows);f.action('sql-tab',{id:doc});f.action('rollback');assert.deepEqual(plain(f.state().rows),before);assert.equal(f.state().transactionDirty,false);
  f.action('db-object',{name:'customers',group:'Таблицы'});assert.deepEqual(plain(f.state().rows),customers);
});
test('An apply preview cannot write to a different active document or consume its drafts',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const orders=f.doc(),ordersBefore=plain(f.state().rows);f.action('edit-cell',{row:201,column:'status'});f.inputCell('review');f.keyCell('Enter');f.action('apply-grid');assert.equal(f.dialog.open,true);
  f.action('db-object',{name:'customers',group:'Таблицы'});const customers=f.doc(),customersBefore=plain(f.state().rows);f.state().pending['301:name']='other draft';f.choose('apply');
  assert.equal(f.doc().id,customers.id);assert.deepEqual(plain(orders.state.rows),ordersBefore);assert.deepEqual(plain(customers.state.rows),customersBefore);assert.equal(orders.state.pending['201:status'],'review');assert.equal(customers.state.pending['301:name'],'other draft');assert.equal(f.state().error,true);assert.equal(f.dialog.open,false);
});
test('An apply preview rejects changed drafts and changed endpoint bindings while preserving the staged work',()=>{
  for(const drift of ['draft','endpoint']){
    const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const before=plain(f.state().rows);f.action('edit-cell',{row:201,column:'status'});f.inputCell('review');f.keyCell('Enter');f.action('apply-grid');assert.equal(f.dialog.open,true);
    if(drift==='draft')f.state().pending['201:status']='newer draft';else f.connections[0].address='demo://changed-after-preview';
    f.choose('apply');assert.deepEqual(plain(f.state().rows),before);assert.equal(f.state().pending['201:status'],drift==='draft'?'newer draft':'review');assert.equal(f.state().error,true);assert.equal(f.dialog.open,false);assert.match(f.state().status,/измен|подключ|привяз|цель/i);
  }
});
test('A selected-row delete remains a draft until apply and supports discard',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.state().selectedRows=[201];f.action('delete-selected');assert.equal(f.state().rows.length,2);assert.deepEqual(plain(f.state().deletedRows),[201]);f.action('discard-grid');assert.equal(f.state().rows.length,2);assert.deepEqual(plain(f.state().deletedRows),[]);
});
test('Read-only result rejects edit and write actions without mutating rows',()=>{
  const f=fixture();f.action('db-object',{name:'retry_summary',group:'Представления'});const before=plain(f.state().rows);f.action('edit-cell',{row:1,column:'attempts'});assert.equal(f.dialog.open,false);f.action('add-row');assert.equal(f.dialog.open,false);f.action('delete-selected');assert.deepEqual(plain(f.state().rows),before);
});
test('NULL and empty text are distinct staged cell values',()=>{
  const f=fixture();f.action('db-object',{name:'customers',group:'Таблицы'});f.action('edit-cell',{row:301,column:'email'});f.action('cell-null');f.keyCell('Enter');assert.equal(f.state().pending['301:email'],null);
  f.action('edit-cell',{row:302,column:'email'});f.inputCell('');f.keyCell('Enter');assert.equal(f.state().pending['302:email'],'');
});
test('Enter accepts an inline cell draft without mutating committed table rows or opening a dialog',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const original=plain(f.state().rows),committed=plain(f.state().committed);
  f.action('edit-cell',{row:201,column:'status'});assert.equal(f.dialog.open,false);assert.equal(f.state().cellEdit.column,'status');
  assert.match(f.run('renderResults()'),/id="di-cell-input"/);f.inputCell('reviewed');const event=f.keyCell('Enter');
  assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(f.state().cellEdit,null);assert.equal(f.state().pending['201:status'],'reviewed');assert.deepEqual(plain(f.state().rows),original);assert.deepEqual(plain(f.state().committed),committed);assert.equal(f.dialog.open,false);
});
test('Escape cancels only the active editor and preserves a previous staged cell value',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.state().pending['201:status']='previous draft';
  f.action('edit-cell',{row:201,column:'status'});assert.equal(f.state().cellEdit.value,'previous draft');f.inputCell('discard this');f.keyCell('Escape');
  assert.equal(f.state().cellEdit,null);assert.equal(f.state().pending['201:status'],'previous draft');assert.equal(f.state().rows[0].status,'paid');assert.equal(f.dialog.open,false);
});
test('Restoring the original value removes an obsolete pending cell change',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.state().pending['201:status']='previous draft';f.action('edit-cell',{row:201,column:'status'});f.inputCell('paid');f.keyCell('Enter');assert(!Object.hasOwn(f.state().pending,'201:status'));assert.equal(f.state().rows[0].status,'paid');
});
for(const invalid of ['1.5','not a number','2147483648'])test('Invalid integer '+JSON.stringify(invalid)+' leaves the inline editor open without overwriting a pending value',()=>{
  const f=fixture();f.action('db-object',{name:'checkout_retry',group:'Таблицы'});f.state().pending['101:attempt']=4;f.action('edit-cell',{row:101,column:'attempt'});f.inputCell(invalid);f.keyCell('Enter');
  assert.equal(f.state().cellEdit.value,invalid);assert(f.state().cellEdit.error);assert.equal(f.state().pending['101:attempt'],4);assert.equal(f.state().rows[0].attempt,2);assert.match(f.run('renderResults()'),/aria-invalid="true"/);assert.equal(f.dialog.open,false);
  f.inputCell('5');f.keyCell('Enter');assert.equal(f.state().pending['101:attempt'],5);assert.equal(f.state().cellEdit,null);
});
test('A required cell rejects NULL and retains the editor instead of staging it',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('edit-cell',{row:201,column:'status'});f.state().cellEdit.isNull=true;f.keyCell('Enter');assert.match(f.state().cellEdit.error,/NULL/);assert.deepEqual(plain(f.state().pending),{});assert.equal(f.state().rows[0].status,'paid');
});
test('Decimal cell text remains exact while table data remains unchanged until apply',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('edit-cell',{row:201,column:'amount'});f.inputCell('1234567890123456.01');f.keyCell('Enter');assert.equal(f.state().pending['201:amount'],'1234567890123456.01');assert.equal(f.state().rows[0].amount,'1250.00');
});
test('Large bigint foreign key values are not rounded by JavaScript',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('edit-cell',{row:201,column:'customer_id'});f.inputCell('9007199254740993');f.keyCell('Enter');assert.equal(f.state().pending['201:customer_id'],'9007199254740993');assert.equal(f.state().rows[0].customer_id,301);
});
test('Numeric editing never converts precise decimal text to Number when an earlier fixture value was numeric',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.state().rows[0].amount=1250;f.action('edit-cell',{row:201,column:'amount'});f.inputCell('1234567890123456.01');f.keyCell('Enter');assert.equal(f.state().pending['201:amount'],'1234567890123456.01');assert.equal(f.state().rows[0].amount,1250);
});
for(const value of ['9223372036854775808','-9223372036854775809'])test('Bigint outside the signed PostgreSQL range '+value+' stays in the editor',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('edit-cell',{row:201,column:'customer_id'});f.inputCell(value);f.keyCell('Enter');assert(f.state().cellEdit?.error);assert.deepEqual(plain(f.state().pending),{});assert.equal(f.state().rows[0].customer_id,301);
});
test('A newly added row stays visible under a restrictive filter and edits remain in its draft',()=>{
  const f=fixture();f.action('db-object',{name:'customers',group:'Таблицы'});const before=plain(f.state().rows);f.state().queryFilter='no existing row matches';f.action('add-row');const row=f.state().addedRows[0];assert.equal(f.dialog.open,false);assert.equal(f.state().cellEdit.row,row.id);assert(f.run('filteredRows()').some(item=>item.id===row.id));assert.match(f.run('renderResults()'),new RegExp('data-cell-row="'+row.id+'"'));f.inputCell('New customer');f.keyCell('Enter');assert.equal(row.name,'New customer');assert.deepEqual(plain(f.state().rows),before);assert.deepEqual(plain(f.state().pending),{});
});
test('Inline editors and pending values stay attached to their original document',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const orders=f.doc();f.action('edit-cell',{row:201,column:'status'});f.inputCell('from orders');
  f.action('db-object',{name:'customers',group:'Таблицы'});const customers=f.doc();assert.equal(orders.state.cellEdit,null);assert.equal(orders.state.pending['201:status'],'from orders');assert(!f.state().cellEdit);assert.deepEqual(plain(f.state().pending),{});
  f.action('edit-cell',{row:301,column:'name'});f.inputCell('from customers');f.keyCell('Enter');f.action('sql-tab',{id:orders.id});assert.equal(f.state().pending['201:status'],'from orders');assert(!Object.hasOwn(f.state().pending,'301:name'));assert.equal(customers.state.pending['301:name'],'from customers');
});
test('An invalid cell cannot be silently lost by switching documents',()=>{
  const f=fixture();f.action('db-object',{name:'checkout_retry',group:'Таблицы'});const original=f.doc().id;f.action('edit-cell',{row:101,column:'attempt'});f.inputCell('bad');f.action('db-object',{name:'customers',group:'Таблицы'});assert.equal(f.doc().id,original);assert.equal(f.state().cellEdit.value,'bad');assert(f.state().cellEdit.error);assert.deepEqual(plain(f.state().pending),{});
});
test('Tab accepts a cell and opens the adjacent editor without invoking a modal',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('edit-cell',{row:201,column:'order_key'});f.inputCell('ord_changed');f.syncGridCells();f.keyCell('Tab');assert.equal(f.state().pending['201:order_key'],'ord_changed');assert.equal(f.state().cellEdit.row,201);assert.equal(f.state().cellEdit.column,'customer_id');assert.equal(f.dialog.open,false);
});
test('Discard clears an invalid open editor together with all unsubmitted grid drafts',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const before=plain(f.state().rows);f.state().pending['201:status']='review';f.state().deletedRows=[202];f.action('add-row');const added=f.state().addedRows[0];f.action('edit-cell',{row:added.id,column:'customer_id'});f.inputCell('not an integer');f.keyCell('Enter');assert(f.state().cellEdit.error);f.action('discard-grid');assert.equal(f.state().cellEdit,null);assert.deepEqual(plain(f.state().pending),{});assert.deepEqual(plain(f.state().addedRows),[]);assert.deepEqual(plain(f.state().deletedRows),[]);assert.deepEqual(plain(f.state().rows),before);
});
test('Applying a new row with an incomplete numeric field focuses that inline cell and preserves the draft',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});const before=plain(f.state().rows);f.action('add-row');const added=f.state().addedRows[0];f.inputCell('ord_new');f.keyCell('Enter');f.action('apply-grid');assert.equal(f.dialog.open,false);assert.equal(f.state().cellEdit.row,added.id);assert.equal(f.state().cellEdit.column,'customer_id');assert(f.state().cellEdit.error);assert.equal(f.state().addedRows.length,1);assert.deepEqual(plain(f.state().rows),before);
});
test('Deleting a newly inserted draft row removes it without scheduling a server delete',()=>{
  const f=fixture();f.action('db-object',{name:'customers',group:'Таблицы'});const before=plain(f.state().rows);f.action('add-row');const added=f.state().addedRows[0];f.inputCell('temporary');f.keyCell('Enter');f.state().selectedRows=[added.id];f.action('delete-selected');assert.deepEqual(plain(f.state().addedRows),[]);assert.deepEqual(plain(f.state().deletedRows),[]);assert.deepEqual(plain(f.state().rows),before);assert.equal(f.dialog.open,false);
});
test('Plan estimate and ANALYZE are exclusive and retain the SQL snapshot',()=>{
  const f=fixture();f.set('#di-plan-mode','estimate');f.action('plan-build');assert.equal(f.state().plan.mode,'estimate');const sql=f.doc().sql;assert.equal(f.state().plan.sourceSQL,sql);
  f.set('#di-plan-mode','analyze');f.action('plan-build');assert.equal(f.state().plan.mode,'estimate');assert.match(f.modal.title,/ANALYZE/);f.choose('analyze-demo');assert.equal(f.state().plan.mode,'analyze');assert.equal(f.state().plan.sourceSQL,sql);
  f.doc().sql='SELECT 2;';assert.equal(f.state().plan.sourceSQL,sql);f.action('new-sql');assert.equal(f.state().plan,null);
});
test('A result keeps dispatch-time SQL provenance even when the draft is edited in flight',()=>{
  const f=fixture(),before=f.doc().sql;f.action('execute');f.doc().sql='SELECT * FROM public.orders;';f.state().executionMode='script';f.flush();
  assert.equal(f.state().resultSnapshot.sourceSQL,before);assert.equal(f.state().history[0].mode,'current');assert.match(f.run('renderResults()'),/Предыдущий результат/);
});
test('A failed query leaves older rows clearly labelled as a previous result',()=>{
  const f=fixture();f.action('execute');f.flush();const before=plain(f.state().rows);f.doc().sql='SELECT * FROM public.missing_table;';f.action('execute');f.flush();assert.equal(f.state().error,true);assert.deepEqual(plain(f.state().rows),before);assert.match(f.run('renderResults()'),/Предыдущий результат/);
});
test('Estimate plan contains no fabricated actual time and starts empty',()=>{
  const f=fixture();f.state().section='explain';assert.match(f.run('dataSection()'),/План ещё не построен/);f.set('#di-plan-mode','estimate');f.action('plan-build');const markup=f.run('dataSection()');assert.doesNotMatch(markup,/actual 0\.024|actual 5 rows|actual rows 5/);assert.match(markup,/учебный fixture/);
});
test('Numeric parameter precision and explicit NULL survive per-document storage',()=>{
  const f=fixture();f.run('queryParameters(["amount","optional"])');const values=f.dialog.querySelectorAll('[data-param]'),types=f.dialog.querySelectorAll('[data-param-type]');values[0].value='12345678901234567890.123456789';types[0].value='numeric';values[1].value='discarded';types[1].value='NULL';f.choose('bind-params');
  assert.equal(f.state().queryParams.amount,'12345678901234567890.123456789');assert.equal(f.state().queryParams.optional,null);assert.equal(f.state().queryParamTypes.amount,'numeric');assert.equal(f.state().queryParamTypes.optional,'NULL');const old=f.doc().id;f.action('new-sql');assert.deepEqual(plain(f.state().queryParams),{});f.action('sql-tab',{id:old});assert.equal(f.state().queryParams.optional,null);
});
test('Invalid integer parameter does not save a partial parameter set',()=>{
  const f=fixture();f.run('queryParameters(["valid","invalid"])');const values=f.dialog.querySelectorAll('[data-param]'),types=f.dialog.querySelectorAll('[data-param-type]');values[0].value='yes';values[1].value='1.5';types[1].value='integer';f.choose('bind-params');assert.deepEqual(plain(f.state().queryParams),{});assert.equal(f.dialog.open,true);assert(values[1].validation);
});
test('Closing the final document leaves an empty workspace and New opens a fresh console',()=>{
  const f=fixture(),target=f.state().connectionMeta.address;f.action('close-sql',{id:f.doc().id});assert.equal(f.state().tabs.length,0);
  f.action('new-sql');assert.equal(f.state().tabs.length,1);assert.equal(f.doc().kind,'console');assert.equal(f.state().connectionMeta.address,target);assert.deepEqual(plain(f.state().pending),{});assert.equal(f.state().running,false);
});
test('The object explorer remains usable after closing the final document',()=>{
  const f=fixture(),target=f.state().connectionMeta.address;f.action('close-sql',{id:f.doc().id});assert.equal(f.state().tabs.length,0);
  f.action('db-object',{name:'orders',group:'Таблицы'});assert.equal(f.state().tabs.length,1);assert.equal(f.doc().kind,'table');assert.equal(f.state().connectionMeta.address,target);assert.equal(f.state().object,'orders');assert.equal(f.state().rows.length,2);
});
test('One table draft can combine update, insert and delete before a single apply',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('edit-cell',{row:201,column:'status'});f.inputCell('reviewed');f.keyCell('Enter');
  f.action('add-row');assert.equal(f.dialog.open,false);assert.equal(f.state().addedRows.length,1);const row=f.state().addedRows[0];assert.equal(f.state().cellEdit.row,row.id);assert.equal(f.state().cellEdit.column,'order_key');
  for(const [column,value] of Object.entries({order_key:'ord_added',customer_id:'301',amount:'99.01',currency:'RUB',status:'new'})){f.action('edit-cell',{row:row.id,column});f.inputCell(value);f.keyCell('Enter');}
  assert.equal(f.state().addedRows.length,1);assert.equal(f.state().pending['201:status'],'reviewed');assert.equal(f.state().rows.length,2);
  f.action('delete-row');f.set('#di-delete-row','202');f.choose('remove-row');assert.deepEqual(plain(f.state().deletedRows),[202]);assert.equal(f.state().rows.length,2);
  f.action('apply-grid');assert.match(f.modal.markup,/INSERT INTO public.orders/);assert.match(f.modal.markup,/UPDATE public.orders/);assert.match(f.modal.markup,/DELETE FROM public.orders/);f.choose('apply');
  assert.equal(f.state().rows.length,2);assert.equal(f.state().rows.find(row=>row.id===201).status,'reviewed');assert(!f.state().rows.some(row=>row.id===202));assert(f.state().rows.some(row=>row.order_key==='ord_added'));assert.deepEqual(plain(f.state().pending),{});assert.equal(f.state().addedRows.length,0);assert.equal(f.state().deletedRows.length,0);
});
test('Column chooser rejects hiding everything but applies a non-empty selection',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('grid-columns');const controls=f.dialog.querySelectorAll('[data-grid-column]');assert(controls.length>1);controls.forEach(control=>control.checked=false);f.choose('columns-save');assert.equal(f.dialog.open,true);assert.deepEqual(plain(f.state().hiddenColumns),[]);
  controls[0].checked=true;f.choose('columns-save');assert.equal(f.dialog.open,false);assert.equal(f.state().hiddenColumns.length,controls.length-1);assert(!f.state().hiddenColumns.includes(controls[0].dataset.gridColumn));
});
test('A fresh console has no invented source object, rows or previous table columns',()=>{
  const f=fixture();f.action('db-object',{name:'orders',group:'Таблицы'});f.action('object-query');assert.equal(f.doc().kind,'console');assert.equal(f.state().object,'');assert.equal(f.state().rows.length,0);assert(f.state().resultSnapshot==null);const markup=f.run('renderResults()');assert.doesNotMatch(markup,/data-column="(?:order_id|order_key|response_kind|amount)"/);assert.match(markup,/Нет результата/);
});
test('Schema comparison pins the selected target ID even when environment labels are identical',()=>{
  const f=fixture(),original=f.doc();f.connections[0].env='Общий';f.connections[1].env='Общий';f.connections[1].name='Второй сервер';f.action('compare');
  assert.equal(f.fields['#di-compare-source'].value,'payments-dev');assert.equal(f.fields['#di-compare-target'].value,'payments-ift');f.choose('migration-preview');f.choose('migration-console');
  assert.notEqual(f.doc().id,original.id);assert.equal(f.state().connection,'payments-ift');assert.equal(f.state().connectionMeta.name,'Второй сервер');assert.equal(f.doc().migrationSnapshot.source.id,'payments-dev');assert.equal(f.doc().migrationSnapshot.target.id,'payments-ift');assert.equal(original.state.connection,'payments-dev');assert.equal(f.doc().migrationSnapshot.fixture,true);
});
test('Schema comparison rejects selecting the same source and target ID',()=>{
  const f=fixture();f.action('compare');f.fields['#di-compare-target'].value=f.fields['#di-compare-source'].value;f.fields['#di-compare-target'].onchange();assert.equal(f.dialog.querySelector('[data-di="migration-preview"]').disabled,true);assert.match(f.fields['#di-compare-validation'].textContent,/разными/i);const count=f.state().tabs.length;f.choose('migration-preview');assert.equal(f.modal.title,'Сравнение схем');assert.equal(f.state().tabs.length,count);
});
for(const changed of ['source','target'])test('Migration preview rejects a changed '+changed+' endpoint without creating a console',()=>{
  const f=fixture();f.action('compare');f.choose('migration-preview');const count=f.state().tabs.length;f.connections[changed==='source'?0:1].address='demo://changed-after-preview';f.choose('migration-console');assert.equal(f.state().tabs.length,count);assert.match(f.fields['#di-migration-validation'].textContent,/изменились/);assert.equal(f.dialog.querySelector('[data-di="migration-console"]').disabled,true);
});
test('Migration preview rejects a target that was removed from the project',()=>{
  const f=fixture();f.action('compare');f.choose('migration-preview');const count=f.state().tabs.length;f.connections.splice(1,1);f.choose('migration-console');assert.equal(f.state().tabs.length,count);assert.equal(f.dialog.querySelector('[data-di="migration-console"]').disabled,true);
});
test('Schema comparison requires two available IDs instead of inferring an environment',()=>{
  const f=fixture();f.connections.splice(1,1);f.action('compare');assert.equal(f.dialog.querySelector('[data-di="migration-preview"]').disabled,true);assert.match(f.fields['#di-compare-validation'].textContent,/два доступных/);f.choose('migration-preview');assert.equal(f.modal.title,'Сравнение схем');
});
test('Migration preview cannot add a console to a different project owner',()=>{
  const f=fixture();f.action('compare');f.choose('migration-preview');const count=f.state().tabs.length;f.run('data=installDocumentState(clone(data))');f.choose('migration-console');assert.equal(f.state().tabs.length,count);assert.match(f.fields['#di-migration-validation'].textContent,/Проект|настройки/);
});

test('Idle documents have no persistent technical status strip',()=>{
  const f=fixture();assert.equal(f.state().status,'');f.action('db-object',{name:'orders',group:'Таблицы'});assert.equal(f.state().status,'');f.action('new-sql');assert.equal(f.state().status,'');
});
test('Dismissing an error preserves SQL, drafts, transaction and query history',()=>{
  const f=fixture();f.state().pending['101:attempt']=3;f.state().transaction=true;f.state().transactionDirty=true;f.state().history.push({sql:'SELECT 1',outcome:'demo'});const sql=f.doc().sql,history=plain(f.state().history);
  f.run("dataNotice('Проверка подключения не прошла',true)");assert.equal(f.notice.hidden,false);assert.match(f.notice.innerHTML,/Проверка подключения/);
  f.action('dismiss-data-notice');assert.equal(f.notice.hidden,true);assert.equal(f.state().status,'');assert.equal(f.state().error,false);assert.equal(f.doc().sql,sql);assert.equal(f.state().pending['101:attempt'],3);assert.equal(f.state().transactionDirty,true);assert.deepEqual(plain(f.state().history),history);
  f.connections.splice(0,1);f.action('execute');assert.equal(f.notice.hidden,false);assert.equal(f.state().error,true);assert.match(f.state().status,/подключ|отвяз/i);
});

const result={scope:'Actual prototype DATA section executed in Node VM with fake DOM, controlled timers and modal callbacks. Assertions cover document state and target ownership only. No database, real file transfer, MCP, driver, rendering or application-runtime parity is claimed.',sourceHashes:{[relative]:crypto.createHash('sha256').update(source).digest('hex')},passed:tests.filter(item=>item.pass).length,failed:tests.filter(item=>!item.pass).length,tests};
fs.writeFileSync(path.join(__dirname,'database-workspace-audit.json'),JSON.stringify(result,null,2)+'\n');
console.log(`${result.passed}/${tests.length} prototype database behavior checks passed`);
for(const item of tests.filter(item=>!item.pass))console.error(item.name+'\n'+item.error);
if(result.failed)process.exitCode=1;
