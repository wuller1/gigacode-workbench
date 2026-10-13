/* Explicit history fixtures for the prototype. Does not execute Git or write files. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const revisions = [
    {id:'demo/base',sha:'demo001',author:'Ирина · пример',time:'09:10',message:'Первый вариант повторов',lines:['export function shouldRetry(status, attempt, signal) {','  return status >= 500;','}']},
    {id:'demo/rate-limit',sha:'demo002',author:'Алексей · пример',time:'09:24',message:'Учитывать ограничения провайдера',lines:['export function shouldRetry(status, attempt, signal) {','  if (attempt >= 3) return false;','  return status === 429 || status >= 500;','}']},
    {id:'demo/cancellation',sha:'demo003',author:'Ирина · пример',time:'09:38',message:'Прекращать повторы после отмены',lines:['export function shouldRetry(status, attempt, signal) {','  if (signal.aborted) return false;','  if (attempt >= 3) return false;','  return status === 429 || status >= 500;','}']}
  ];
  const fixturePath='examples/retry-policy.ts';
  const reflog=[
    {id:'event-3',ref:'demo/HEAD@{0}',sha:'demo003',action:'commit',message:'Прекращать повторы после отмены',time:'09:38'},
    {id:'event-2',ref:'demo/HEAD@{1}',sha:'demo002',action:'commit',message:'Учитывать ограничения провайдера',time:'09:24'},
    {id:'event-1',ref:'demo/HEAD@{2}',sha:'demo001',action:'checkout',message:'Открыть исходную учебную ветку',time:'09:10'}
  ];
  function diffRows(a,b){
    const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    const rows=[];let i=0,j=0;
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j])rows.push({kind:'same',left:++i,right:++j,text:a[i-1]});
      else if(j<b.length&&(i===a.length||dp[i][j+1]>dp[i+1][j]))rows.push({kind:'add',left:null,right:++j,text:b[j-1]});
      else rows.push({kind:'remove',left:++i,right:null,text:a[i-1]});
    }
    return rows;
  }
  function annotation(revision){
    const end=revisions.indexOf(revision);
    return revision.lines.map((text,index)=>{
      const origin=revisions.slice(0,end+1).find(r=>r.lines.includes(text))||revision;
      return {text,line:index+1,sha:origin.sha,author:origin.author,time:origin.time};
    });
  }
  function validBranch(value){return value.length>0&&value.length<=100&&!/[\x00-\x20\x7f]/.test(value)&&!/[\s~^:?*\[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$|\.lock(?:\/|$)/.test(value)&&!value.startsWith('-')&&!value.split('/').some(p=>p.startsWith('.'))&&value!=='@';}
  function capture(g,project){return {project:String(project||''),repository:g.repository,branch:g.branch,head:g.commits?.[0]?.sha||''};}
  function scopeMatches(before,g,project){return before.project===String(project||'')&&before.repository===g.repository&&before.branch===g.branch&&before.head===(g.commits?.[0]?.sha||'');}
  let active=null;
  function open(kind,options={}){
    if(!['compare','blame','reflog'].includes(kind)||!options.g)return null;
    active?.close();
    const g=options.g;
    const getProject=()=>typeof options.project==='function'?options.project():window.SuitePrototype?.project?.()??options.project??'';
    const captured=capture(g,getProject()),returnFocus=document.activeElement;
    const state={kind,base:'demo/base',head:'demo/cancellation',revision:'demo/cancellation',selected:'event-3',name:'recovery/demo-cancellation',preview:null,error:'',success:''};
    const d=document.createElement('dialog');d.className='gh-dialog';d.setAttribute('aria-labelledby','gh-title');active=d;
    const btn=(id,text,extra='')=>`<button type="button" data-gh="${id}" ${extra}>${text}</button>`;
    const opts=selected=>revisions.map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>${r.id} · ${r.sha}</option>`).join('');
    const source=r=>`<div class="gh-source" aria-label="Исходный код учебной ревизии ${esc(r.sha)}"><pre data-language="typescript">${esc(r.lines.join('\n'))}</pre></div>`;
    function diffView(base,head){
      const rows=diffRows(base.lines,head.lines),added=rows.filter(r=>r.kind==='add').length,removed=rows.filter(r=>r.kind==='remove').length;
      return `<div class="gh-file-heading"><b>${fixturePath}</b><span class="gh-stats"><i>+${added}</i><em>−${removed}</em></span></div><div class="gh-diff" role="table" aria-label="Изменения между выбранными учебными ревизиями"><div class="gh-diff-head" role="row"><span>До</span><span>После</span><span>${esc(base.sha)} → ${esc(head.sha)}</span></div>${rows.map(r=>`<div class="gh-diff-row ${r.kind}" role="row"><span role="cell">${r.left??''}</span><span role="cell">${r.right??''}</span><code role="cell"><b aria-hidden="true">${r.kind==='add'?'+':r.kind==='remove'?'−':' '}</b>${esc(r.text)}</code></div>`).join('')}</div>${added+removed===0?'<p class="gh-note">Ревизии совпадают: изменений нет.</p>':''}`;
    }
    function compare(){
      const base=revisions.find(r=>r.id===state.base),head=revisions.find(r=>r.id===state.head);
      return `<div class="gh-compare-controls"><label>Базовая ревизия<select data-gh-field="base">${opts(state.base)}</select></label>${btn('swap','⇄','aria-label="Поменять ревизии местами" title="Поменять ревизии местами"')}<label>Сравнить с<select data-gh-field="head">${opts(state.head)}</select></label></div>${diffView(base,head)}<div class="gh-summary"><b>${esc(head.message)}</b><span>${esc(head.author)} · ${head.time}</span></div>`;
    }
    function blame(){
      const r=revisions.find(x=>x.id===state.revision);
      return `<div class="gh-controls"><label>Версия файла<select data-gh-field="revision">${opts(state.revision)}</select></label><span>${fixturePath}</span></div><div class="gh-blame" role="table" aria-label="Аннотации учебного файла"><div class="gh-blame-head" role="row"><span>Ревизия и автор</span><span>Строка</span><span>Код</span></div>${annotation(r).map(row=>`<div class="gh-blame-row" role="row"><button data-gh-sha="${row.sha}" aria-label="Показать ревизию ${row.sha}"><code>${row.sha}</code><small>${esc(row.author)}</small></button><span role="cell">${row.line}</span><code role="cell">${esc(row.text)}</code></div>`).join('')}</div><h3>История файла</h3><div class="gh-revisions">${[...revisions].reverse().map(item=>`<button data-gh-revision="${item.id}" aria-pressed="${item.id===state.revision}"><code>${item.sha}</code><b>${esc(item.message)}</b><small>${item.time}</small></button>`).join('')}</div><div class="gh-summary"><b>${esc(r.message)}</b><span>${esc(r.author)} · ${r.time}</span></div>`;
    }
    function recovery(){
      const selected=reflog.find(r=>r.id===state.selected),rev=revisions.find(r=>r.sha===selected.sha);
      return `<div class="gh-recovery-layout"><div><div class="gh-reflog" aria-label="Учебные записи reflog">${reflog.map(r=>`<button data-gh-event="${r.id}" aria-pressed="${r.id===state.selected}"><code>${r.ref}</code><span><b>${esc(r.message)}</b><small>${r.time} · ${r.action} · ${r.sha}</small></span></button>`).join('')}</div><p class="gh-note">Три учебные записи. Это не журнал реального репозитория и не история нажатий кнопок.</p></div><section class="gh-recovery"><h3>Снимок ${selected.sha}</h3>${source(rev)}${state.success?`<p class="gh-success" role="status">${esc(state.success)}</p>`:state.preview?`<div class="gh-preview"><h3>Восстановить в новую ветку</h3><dl><dt>Проект</dt><dd>${esc(captured.project)}</dd><dt>Репозиторий</dt><dd>${esc(captured.repository)}</dd><dt>Источник</dt><dd>${esc(state.preview.sha)} · учебная ревизия</dd><dt>Новая ветка</dt><dd>${esc(state.preview.name)}</dd></dl><p>В список веток добавится демонстрационная запись. Текущая ветка, HEAD, индекс и файлы сохранятся.</p><div class="gh-actions">${btn('back','Изменить')}${btn('recover','Создать ветку в макете','class="gh-primary"')}</div></div>`:`<form class="gh-recovery-form"><label>Новая ветка<input name="branch" data-gh-field="name" value="${esc(state.name)}" maxlength="100" required placeholder="recovery/my-work"></label><button type="submit">Проверить восстановление</button></form>`}${state.error?`<p class="gh-error" role="alert">${esc(state.error)}</p>`:''}</section></div>`;
    }
    function render(){
      const title={compare:'Сравнение веток',blame:'Аннотации и история файла',reflog:'Reflog и восстановление'}[state.kind];
      d.innerHTML=`<header class="gh-heading"><div><h2 id="gh-title">${title}</h2><small>${esc(captured.project)} · ${esc(captured.repository)}</small></div>${btn('close','<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>','class="gh-close" aria-label="Закрыть окно истории Git" title="Закрыть"')}</header><div class="gh-demo"><b>Учебный пример</b><span>Изолированные ревизии demo/* показывают поведение интерфейса. Реальный Git не вызывается.</span></div><main class="gh-content">${state.kind==='compare'?compare():state.kind==='blame'?blame():recovery()}</main><footer class="gh-footer"><span>${esc(captured.branch)} · HEAD ${esc(captured.head||'не задан')}${options.path?' · открыто из '+esc(options.path):''}</span>${btn('close','Закрыть')}</footer>`;
      d.querySelectorAll('pre[data-language],.gh-diff-row>code,.gh-blame-row>code').forEach(el=>window.SuiteSyntax?.highlightElement?.(el,'typescript'));
    }
    function checkScope(){
      const activeGit=window.SuiteGitPrototype?.git?.();
      if((activeGit&&activeGit!==g)||!scopeMatches(captured,g,getProject()))return 'Проект, ветка или HEAD изменились. Откройте восстановление заново в нужном контексте.';
      if(!Array.isArray(g.ideGit?.branches))return 'Откройте Git в IDE для этого проекта, затем повторите восстановление.';
      return '';
    }
    function validate(){
      const scopeError=checkScope();if(scopeError)return scopeError;
      if(!validBranch(state.name.trim()))return 'Укажите корректное имя новой ветки без пробелов.';
      if(g.ideGit.branches.includes(state.name.trim()))return 'Ветка с таким именем уже существует.';
      return '';
    }
    d.onclick=event=>{
      const node=event.target.closest('button');if(!node)return;
      if(node.dataset.gh==='close'){d.close();return;}
      if(node.dataset.gh==='swap'){[state.base,state.head]=[state.head,state.base];render();d.querySelector('[data-gh="swap"]').focus();return;}
      if(node.dataset.ghRevision){state.revision=node.dataset.ghRevision;render();d.querySelector(`[data-gh-revision="${state.revision}"]`).focus();return;}
      if(node.dataset.ghSha){state.revision=revisions.find(r=>r.sha===node.dataset.ghSha).id;render();d.querySelector(`[data-gh-revision="${state.revision}"]`).focus();return;}
      if(node.dataset.ghEvent){state.selected=node.dataset.ghEvent;state.preview=null;state.error='';state.success='';render();d.querySelector(`[data-gh-event="${state.selected}"]`).focus();return;}
      if(node.dataset.gh==='back'){state.preview=null;state.error='';render();d.querySelector('input')?.focus();return;}
      if(node.dataset.gh==='recover'){
        state.error=validate();if(!state.preview||state.error){render();return;}
        const record={name:state.preview.name,sha:state.preview.sha,source:'explicit-history-fixture',project:captured.project,repository:captured.repository,prototype:true};
        g.ideGit.branches.push(record.name);(g.ideGit.recoveredFixtures??=[]).push(record);
        state.success=`Ветка ${record.name} добавлена в макет от ${record.sha}. Текущая ветка ${captured.branch} и файлы не изменены.`;state.preview=null;options.changed?.();render();d.querySelector('[data-gh="close"]')?.focus();
      }
    };
    d.oninput=event=>{if(event.target.dataset.ghField==='name')state.name=event.target.value;};
    d.onchange=event=>{const key=event.target.dataset.ghField;if(['base','head','revision'].includes(key)){state[key]=event.target.value;render();d.querySelector(`[data-gh-field="${key}"]`)?.focus();}};
    d.onsubmit=event=>{event.preventDefault();state.error=validate();if(!state.error)state.preview={name:state.name.trim(),sha:reflog.find(r=>r.id===state.selected).sha};render();d.querySelector(state.error?'input':'[data-gh="recover"]')?.focus();};
    d.addEventListener('click',event=>{if(event.target===d){const rect=d.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)d.close();}});
    d.addEventListener('close',()=>{if(active===d)active=null;d.remove();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});},{once:true});
    render();document.body.append(d);d.showModal();d.querySelector('select,input,button')?.focus();return d;
  }
  window.SuiteGitHistory={open,_test:{diffRows,annotation,validBranch,capture,scopeMatches,revisions}};
})();
