/* Git workbench interaction model. Prototype data only: never executes Git. */
(function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    branch:'M6 3v12a3 3 0 0 0 6 0V9M12 9a6 6 0 0 0 6-6M4 3h4M16 3h4',
    plus:'M12 5v14M5 12h14', close:'M6 6l12 12M18 6L6 18', more:'M5 12h.01M12 12h.01M19 12h.01',
    fetch:'M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4', push:'M12 17V5m-5 5 5-5 5 5M5 17v4h14v-4',
    history:'M4 10a8 8 0 1 1 1 8M4 4v6h6M12 7v5l3 2', file:'M6 3h8l4 4v14H6zM14 3v5h4',
    settings:'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    back:'M14 5l-7 7 7 7', check:'M5 12l4 4L19 6', tag:'M3 3h8l10 10-8 8L3 11zM7 7h.01',
    external:'M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7', search:'M16 16l5 5M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0',
  };
  const ico = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.file}"/></svg>`;
  const button = (action, label, more='') => `<button type="button" class="ig-button" data-ig-action="${action}" ${more}>${label}</button>`;
  const iconButton = (action, name, label, more='') => `<button type="button" class="ig-button ig-icon" data-ig-action="${action}" aria-label="${escape(label)}" title="${escape(label)}" ${more}>${ico(name)}</button>`;
  const option = (values, selected) => values.map(v=>`<option value="${escape(v)}" ${v===selected?'selected':''}>${escape(v)}</option>`).join('');
  const fingerprint = text => { let n=2166136261; for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(36); };
  const changedLine = line => /^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line);
  const codeLanguage = path => ({ts:'typescript',tsx:'typescript',js:'javascript',jsx:'javascript',java:'java',py:'python',sql:'sql',json:'json',yaml:'yaml',yml:'yaml',html:'xml',css:'css',sh:'bash'}[String(path).split('.').pop()]||'plaintext');
  let commitSerial=0;
  function hunks(lines) {
    const out=[];let current=null;
    lines.forEach((line,index)=>{if(changedLine(line)){if(!current){current={indices:[],start:index};out.push(current);}current.indices.push(index);}else current=null;});
    return out.map(h=>({...h,id:'h-'+fingerprint(h.indices.map(i=>lines[i]).join('\n'))+'-'+h.start,lines:h.indices.map(i=>lines[i])}));
  }
  function selectedLines(g,path,lines) {
    if(g.staged.includes(path))return lines.map((l,i)=>changedLine(l)?i:-1).filter(i=>i>=0);
    return [...new Set(g.hunks.filter(h=>h.path===path).flatMap(h=>h.indices||[]))].filter(i=>changedLine(lines[i]||''));
  }
  function setSelected(g,path,lines,indices) {
    const s=seed(g);s.indexSnapshots||={};
    const unique=[...new Set(indices)].filter(i=>changedLine(lines[i]||''));
    const all=lines.map((l,i)=>changedLine(l)?i:-1).filter(i=>i>=0);
    g.staged=g.staged.filter(p=>p!==path);g.hunks=g.hunks.filter(h=>h.path!==path);
    if(unique.length&&unique.length===all.length)g.staged.push(path);
    else if(unique.length)g.hunks.push({path,id:'selected',indices:unique,lines:unique.map(i=>lines[i])});
    if(unique.length)s.indexSnapshots[path]={fingerprint:fingerprint(lines.join('\n')),lines:copy(lines)};else delete s.indexSnapshots[path];
  }
  function takeSnapshot(g,linesFor,paths=g.files.map(f=>f.path)) {
    return {files:copy(g.files.filter(f=>paths.includes(f.path))),diffs:Object.fromEntries(paths.map(path=>[path,copy(linesFor(path))])),staged:g.staged.filter(p=>paths.includes(p)),hunks:copy(g.hunks.filter(h=>paths.includes(h.path))),indexSnapshots:copy(Object.fromEntries(Object.entries(g.ideGit?.indexSnapshots||{}).filter(([path])=>paths.includes(path))))};
  }
  function commitSelected(g,linesFor,message,amend=false) {
    const entries=g.files.map(file=>({file,lines:linesFor(file.path),selected:selectedLines(g,file.path,linesFor(file.path))})).filter(x=>x.selected.length);
    if(!message.trim()||(!entries.length&&!amend)|| (amend&&!g.commits.length))return null;
    const state=seed(g);state.indexError='';
    const stale=entries.find(({file,lines})=>state.indexSnapshots?.[file.path]&&state.indexSnapshots[file.path].fingerprint!==fingerprint(lines.join('\n')));
    if(stale){state.indexError='Файл '+stale.file.path+' изменился после подготовки. Обновите diff и подготовьте нужные строки заново.';return null;}
    const snapshots=entries.map(({file,lines,selected})=>({...copy(file),diff:lines.filter((l,i)=>!changedLine(l)||selected.includes(i)),partial:selected.length<lines.filter(changedLine).length}));
    const old=amend?g.commits[0]:null;
    const merged=new Map((old?.files||[]).map(file=>[file.path,copy(file)]));
    snapshots.forEach(file=>{const previous=merged.get(file.path);if(previous)file.versions=[...(previous.versions||[{label:'До amend',diff:previous.diff||[]}]),{label:'Добавлено amend',diff:file.diff}];merged.set(file.path,file);});
    const commit={sha:'demo'+Date.now().toString(36).slice(-6)+(++commitSerial).toString(36),message:message.trim(),who:'Вы',at:'Только что',files:[...merged.values()],branch:g.branch,prototype:true};
    if(old){commit.amends=old.sha;g.commits[0]=commit;}else {g.commits.unshift(commit);g.unpushed++;}
    entries.forEach(({file,lines,selected})=>{
      const remaining=lines.flatMap((line,index)=>selected.includes(index)?(line.startsWith('+')?[' '+line.slice(1)]:[]):[line]);
      if(remaining.some(changedLine)) {g.diffs[file.path]=remaining;file.add=remaining.filter(l=>l.startsWith('+')).length;file.remove=remaining.filter(l=>l.startsWith('-')).length;}
      else {g.files=g.files.filter(f=>f.path!==file.path);delete g.diffs[file.path];}
    });
    g.staged=[];g.hunks=[];state.indexSnapshots={};return commit;
  }
  function validRef(value) { return !!value && value.length<=160 && !/[\x00-\x20\x7f]/.test(value) && !/\s|\.\.|[~^:?*\[\\]|@\{|\/\/|^\/|\/$|\.$|\.lock(?:\/|$)/.test(value) && !value.startsWith('-') && !value.split('/').some(p=>p.startsWith('.')) && value!=='@'; }
  function seed(g) {
    if(!g.ideGit)g.ideGit={section:'changes',open:false,path:g.files[0]?.path||'',mode:'split',modeManual:false,filter:'',owner:'Все',list:'Все изменения',assignment:{},lists:['Default','Изменения агента'],message:'',amend:false,selectedRows:[],logFilter:'',logAuthor:'Все авторы',logPath:'',selectedSha:g.commits[0]?.sha||'',branches:[g.branch,'main','develop','release/2.18'].filter((x,i,a)=>a.indexOf(x)===i),remoteBranches:['origin/main','origin/develop'],tags:['v2.18.0','v2.17.0'],worktrees:[{path:'Текущий проект',branch:g.branch,main:true}],remotes:[{name:'origin',fetch:'ssh://git.example.invalid/'+g.repository+'.git',push:'ssh://git.example.invalid/'+g.repository+'.git'}],shelves:[],console:[],operation:null,notice:'',checks:{whitespace:true,tests:false,sign:false},remoteStatus:'Последнее обновление — fixture',stashMode:'stash',settings:{staging:true,autofetch:false,sign:false,crlf:'input',author:'Вы',email:'developer@example.invalid'}};
    const s=g.ideGit;
    if(!s.branches.includes(g.branch))s.branches.unshift(g.branch);
    g.files.forEach(f=>{if(!s.assignment[f.path])s.assignment[f.path]=f.who==='Агент'?'Изменения агента':'Default';});
    if(!g.files.some(f=>f.path===s.path))s.path=g.files[0]?.path||'';
    return s;
  }
  function effectiveDiffMode(state,width){return state.modeManual?state.mode:width>0&&width<900?'unified':state.mode;}
  function create(api) {
    let host=null,rendering=false,sizeObserver=null,observedHost=null,renderedMode=null;
    const linesFor=path=>copy(api.git().diffs[path]||api.diffLines(path)||[]);
    const project=()=>String(api.project?.()||'Проект');
    const current=()=>{const g=api.git();return {g,s:seed(g)};};
    function log(command,result='Завершено в макете') {const {s}=current();s.console.push({time:new Date().toLocaleTimeString('ru-RU'),command,result});if(s.console.length>100)s.console.shift();}
    function update(message) {const {s}=current();if(message)s.notice=message;api.changed?.();if(host?.isConnected)render(host);}
    function open(section='changes',path) {const {s}=current();s.open=true;s.section=['changes','log','branches','stash','remotes','console','settings'].includes(section)?section:'changes';if(path)s.path=path;if(section==='history'){s.section='log';s.logPath=path||api.currentFile?.()||'';}if(section==='blame'){s.section='changes';api.legacy?.('blame',{path:path||api.currentFile?.()||s.path});}update();}
    function close(){const {s}=current();s.open=false;s.operation=null;api.close?.();}
    const countStaged=g=>g.files.filter(f=>selectedLines(g,f.path,linesFor(f.path)).length).length;
    const dirtyPaths=()=>{const v=api.dirtyFiles?.()||[];return Array.isArray(v)?v.map(x=>typeof x==='string'?x:x.path):[];};
    function start(kind,values={}) {const {g,s}=current();const trigger=typeof document==='undefined'?null:document.activeElement?.closest?.('[data-ig-action]');s.operation={kind,project:project(),branch:g.branch,repository:g.repository,head:g.commits[0]?.sha||'',opener:trigger?{action:trigger.dataset.igAction,ref:trigger.dataset.ref}:null,...values};update();host?.querySelector('.ig-operation')?.scrollIntoView({block:'nearest'});host?.querySelector('.ig-operation form input, .ig-operation form select, .ig-operation form textarea, .ig-operation form button')?.focus({preventScroll:true});}
    function cancelOperation(){const {s}=current(),opener=s.operation?.opener;s.operation=null;update();if(host){const trigger=[...host.querySelectorAll('[data-ig-action]')].find(n=>n.dataset.igAction===opener?.action&&n.dataset.ref===opener?.ref)||host.querySelector('[data-ig-section]');trigger?.focus({preventScroll:true});}}
    function empty(text,detail=''){return `<div class="ig-empty"><b>${escape(text)}</b>${detail?`<span>${escape(detail)}</span>`:''}</div>`;}
    function render(target) {
      if(rendering||!target)return;rendering=true;host=target;
      const {g,s}=current();const prev=host.querySelector('[data-ig-focus]:focus');const focus=prev?{key:prev.dataset.igFocus,start:prev.selectionStart,end:prev.selectionEnd}:null;
      const scroll=host.querySelector('.ig-body')?.scrollTop||0;
      host.classList.add('ig-host');host.innerHTML=`<section class="ig-workbench" aria-label="Git в IDE"><header class="ig-header"><span class="ig-repo" title="${escape(g.repository)}">${ico('branch')}<b>${escape(g.branch)}</b><small>${escape(g.repository)}</small></span><span class="ig-actions">${iconButton('fetch','fetch','Fetch — обновить удалённые ветки')}${button('pull','Pull')}${button('push','Push'+(g.unpushed?' ↑'+g.unpushed:''))}${iconButton('settings','settings','Настройки Git')}${iconButton('ask','spark','Проверить Git изменения с агентом')}</span></header><nav class="ig-tabs" aria-label="Разделы Git">${[['changes','Изменения',g.files.length],['log','История'],['branches','Ветки'],['stash','Stash / Shelf'],['remotes','Remotes'],['console','Консоль']].map(([id,label,count])=>`<button type="button" data-ig-section="${id}" class="${s.section===id?'active':''}" aria-current="${s.section===id?'page':'false'}">${label}${count?`<span>${count}</span>`:''}</button>`).join('')}</nav>${s.notice?`<div class="ig-notice" role="status"><span>${escape(s.notice)}</span>${iconButton('dismiss-notice','close','Скрыть сообщение Git')}</div>`:''}<div class="ig-body">${s.section==='changes'?renderChanges(g,s):s.section==='log'?renderLog(g,s):s.section==='branches'?renderBranches(g,s):s.section==='stash'?renderStash(g,s):s.section==='remotes'?renderRemotes(g,s):s.section==='console'?renderConsole(g,s):renderSettings(g,s)}${s.operation?renderOperation(g,s):''}</div></section>`;
      host.onclick=handleClick;host.onchange=handleChange;host.oninput=handleInput;host.onsubmit=handleSubmit;
      host.onkeydown=event=>{if(event.key!=='Escape')return;const details=event.target.closest?.('details[open]');if(details){details.open=false;details.querySelector('summary')?.focus();event.preventDefault();event.stopPropagation();return;}if(current().s.operation){event.preventDefault();event.stopPropagation();cancelOperation();}};
      if(s.operation?.data&&!s.operation.preview){const fields=host.querySelectorAll('[data-ig-form="operation"] [name]');fields.forEach(field=>{if(!(field.name in s.operation.data))return;const value=s.operation.data[field.name];if(field.type==='checkbox')field.checked=!!value;else if(value!=null)field.value=value;});}
      host.querySelector('.ig-body').scrollTop=scroll;
      if(focus){const field=[...host.querySelectorAll('[data-ig-focus]')].find(f=>f.dataset.igFocus===focus.key);if(field){field.focus({preventScroll:true});if(typeof field.setSelectionRange==='function')try{field.setSelectionRange(focus.start,focus.end);}catch{}}}
      renderedMode=effectiveDiffMode(s,host.clientWidth||0);
      if(typeof ResizeObserver!=='undefined'&&observedHost!==host){
        sizeObserver?.disconnect();observedHost=host;
        sizeObserver=new ResizeObserver(()=>{const {s}=current();if(!rendering&&host?.isConnected&&host.clientWidth>0&&s.open&&s.section==='changes'&&effectiveDiffMode(s,host.clientWidth)!==renderedMode)render(host);});sizeObserver.observe(host);
      }
      rendering=false;
    }
    function visibleFiles(g,s) { return g.files.filter(f=>(!s.filter||f.path.toLowerCase().includes(s.filter.toLowerCase()))&&(s.owner==='Все'||f.who.includes(s.owner))&&(s.list==='Все изменения'||s.assignment[f.path]===s.list)); }
    function renderChanges(g,s) {
      const files=visibleFiles(g,s);if(!files.some(f=>f.path===s.path))s.path=files[0]?.path||'';
      const selected=g.files.find(f=>f.path===s.path);const staged=countStaged(g);g.files.forEach(f=>{const ls=linesFor(f.path);f.add=ls.filter(l=>l.startsWith('+')).length;f.remove=ls.filter(l=>l.startsWith('-')).length;});
      return `<div class="ig-changes-layout"><aside class="ig-file-pane"><div class="ig-file-tools"><input data-ig-focus="file-filter" data-ig-input="filter" placeholder="Найти файл…" aria-label="Фильтр изменённых файлов" value="${escape(s.filter)}"><div class="ig-filter-row"><select data-ig-change="list" aria-label="Список изменений">${option(['Все изменения',...s.lists],s.list)}</select>${iconButton('new-list','plus','Создать changelist')}</div><select data-ig-change="owner" aria-label="Автор изменений">${option(['Все','Агент','Вы'],s.owner)}</select></div><div class="ig-file-summary"><span>${files.length} файлов</span>${button('stage-all','Видимые в индекс',files.length?'':'disabled')}</div><div class="ig-file-list" role="list" aria-label="Изменённые файлы">${files.map(f=>{const lines=linesFor(f.path),indices=selectedLines(g,f.path,lines),all=g.staged.includes(f.path);return `<div class="ig-file-row ${s.path===f.path?'selected':''}" role="listitem"><button type="button" class="ig-stage-toggle ${all?'checked':indices.length?'partial':''}" data-ig-stage="${escape(f.path)}" aria-label="${all?'Убрать из индекса':'Подготовить файл'} ${escape(f.path)}" aria-pressed="${all}">${all?'✓':indices.length?'−':''}</button><button class="ig-file-main" type="button" data-ig-file="${escape(f.path)}"><span><i class="ig-file-kind">${f.kind}</i>${escape(f.path.split('/').pop())}</span><small>${escape(f.path.substring(0,f.path.lastIndexOf('/'))||'.')} · ${escape(f.who)}</small></button><span class="ig-file-delta">+${f.add} <em>−${f.remove}</em></span></div>`;}).join('')||empty('Нет изменений',s.filter?'Измените фильтр.':'Рабочее дерево чистое.')}</div><form class="ig-commit" data-ig-form="commit"><label for="ig-commit-message">${s.amend?'Исправить последний коммит':'Сообщение коммита'}</label><textarea id="ig-commit-message" data-ig-focus="message" data-ig-input="message" rows="3" placeholder="Опишите результат изменений" aria-label="Сообщение коммита">${escape(s.message)}</textarea><div class="ig-commit-options"><label><input type="checkbox" data-ig-change="amend" ${s.amend?'checked':''} ${g.commits.length?'':'disabled'}> Amend</label><details><summary>Проверки</summary><div class="ig-checks">${[['whitespace','Пробелы'],['tests','Тесты'],['sign','Подпись']].map(([id,label])=>`<label><input type="checkbox" data-ig-check="${id}" ${s.checks[id]?'checked':''}> ${label}</label>`).join('')}<small>Макет фиксирует выбор. Реальные проверки выполнятся перед commit.</small></div></details></div><div class="ig-commit-submit"><small>${staged} файлов в индексе</small><button class="ig-button ig-primary" type="submit" ${s.message.trim()&&(staged||s.amend)?'':'disabled'}>Commit${s.amend?' amend':''}</button></div></form></aside><main class="ig-diff-pane">${selected?renderDiff(g,s,selected):empty('Выберите файл','Сравнение, блоки, строки и автор изменений появятся здесь.')}</main></div>`;
    }
    function diffEntries(g,s,path) {const ls=linesFor(path),staged=selectedLines(g,path,ls);return ls.flatMap((line,index)=>s.diffSource==='index'&&changedLine(line)&&!staged.includes(index)?(line.startsWith('-')?[{line:' '+line.slice(1),index}]:[]):[{line,index}]);}
    function renderDiff(g,s,file) {
      const mode=effectiveDiffMode(s,host?.clientWidth||0);
      const original=linesFor(file.path),entries=diffEntries(g,s,file.path),lines=entries.map(e=>e.line),indices=selectedLines(g,file.path,original),blocks=hunks(lines);const selectedSet=new Set(s.selectedRows);
      const saved=s.indexSnapshots?.[file.path];
      if(saved&&saved.fingerprint!==fingerprint(original.join('\n'))&&s.diffSource==='index'){
        const selected=selectedLines(g,file.path,saved.lines),snapshot=saved.lines.filter((line,i)=>!changedLine(line)||selected.includes(i));
        return `<div class="ig-page"><h3>Снимок индекса · ${escape(file.path)}</h3><p class="ig-warning">Рабочая копия изменилась после подготовки. Ниже сохранённый снимок, а не текущий diff. Commit заблокирован до повторной подготовки.</p><pre data-language="diff">${escape(snapshot.join('\n'))}</pre><div class="ig-toolbar">${button('unstage-file','Убрать из индекса')}${button('show-worktree','Рабочая копия')}</div></div>`;
      }
      return `<header class="ig-diff-head"><div><b title="${escape(file.path)}">${escape(file.path)}</b><small>${escape(file.who)} · ${indices.length} из ${original.filter(changedLine).length} изменённых строк в индексе</small></div><details class="ig-more"><summary aria-label="Действия файла">${ico('more')}</summary><div>${button('open-file','Открыть в редакторе')}${button('file-history','История файла')}${button('blame','Аннотации / Blame')}${button('move-list','Переместить в changelist')}${button('discard','Откатить изменения')}${button('patch','Создать patch')}</div></details></header><div class="ig-diff-toolbar"><select data-ig-change="diffSource" aria-label="Источник сравнения"><option value="worktree" ${s.diffSource!=='index'?'selected':''}>Рабочая копия</option><option value="index" ${s.diffSource==='index'?'selected':''}>Индекс</option></select><div class="ig-segment" aria-label="Режим сравнения">${button('diff-split','Рядом',`aria-pressed="${mode==='split'}"`)}${button('diff-unified','Единый',`aria-pressed="${mode==='unified'}"`)}</div><label><input type="checkbox" data-ig-change="whitespace" ${s.ignoreWhitespace?'checked':''}> Скрыть пустые изменения</label><span class="ig-fill"></span>${button('stage-lines','В индекс выбранное',s.selectedRows.length?'':'disabled')}</div><div class="ig-diff-scroll"><div class="ig-diff-labels ${mode==='split'?'split':''}"><span>HEAD · до изменений</span><span>${s.diffSource==='index'?'Индекс · будущий коммит':'Рабочая копия'}</span></div>${!blocks.length?empty('Нет текстовых изменений'):blocks.map((h,blockIndex)=>{const staged=h.indices.every(i=>indices.includes(entries[i].index));const start=Math.max(0,h.start-1),end=Math.min(lines.length,h.indices.at(-1)+2);const slice=lines.slice(start,end);return `<section class="ig-hunk"><header><code>@@ блок ${blockIndex+1} · строки ${start+1}–${end} @@</code>${button('stage-hunk',staged?'Убрать блок':'В индекс',`data-hunk="${escape(h.id)}" aria-pressed="${staged}"`)}</header><div class="ig-diff-lines ${mode==='split'?'split':''}">${slice.map((line,n)=>{const index=entries[start+n].index,isChange=changedLine(line),minus=line.startsWith('-'),plus=line.startsWith('+');if(s.ignoreWhitespace&&isChange&&/^\s*$/.test(line.slice(1)))return '';const number=`<span class="ig-line-no">${index+1}</span>`;const check=isChange?`<input type="checkbox" data-ig-line="${index}" ${selectedSet.has(index)?'checked':''} aria-label="Выбрать строку ${index+1}">`:'<span class="ig-line-space"></span>';const left=plus?'':line.replace(/^[- ]/,'');const right=minus?'':line.replace(/^[+ ]/,'');return mode==='split'?`<div class="ig-diff-line ${minus?'removed':''}">${check}${number}<code data-language="${codeLanguage(file.path)}">${escape(left)||' '}</code></div><div class="ig-diff-line ${plus?'added':''} ${indices.includes(index)?'in-index':''}">${number}<code data-language="${codeLanguage(file.path)}">${escape(right)||' '}</code></div>`:`<div class="ig-diff-line ${minus?'removed':plus?'added':''} ${indices.includes(index)?'in-index':''}">${check}${number}<code data-language="${codeLanguage(file.path)}">${escape(line)||' '}</code></div>`;}).join('')}</div></section>`;}).join('')}</div><div class="ig-diff-foot"><span>${escape(s.assignment[file.path]||'Default')}</span>${button('unstage-file','Убрать из индекса',indices.length?'':'disabled')}${button('stage-file','Подготовить файл',g.staged.includes(file.path)?'disabled':'')}</div>`;
    }
    function renderLog(g,s) {
      const commits=g.commits.filter(c=>(!s.logFilter||[c.message,c.sha,c.who].join(' ').toLowerCase().includes(s.logFilter.toLowerCase()))&&(s.logAuthor==='Все авторы'||c.who===s.logAuthor)&&(!s.logPath||!c.files||c.files.some(f=>f.path===s.logPath)));
      const c=commits.find(c=>c.sha===s.selectedSha)||commits[0];if(c)s.selectedSha=c.sha;
      return `<div class="ig-page"><div class="ig-toolbar"><input data-ig-focus="log-filter" data-ig-input="logFilter" value="${escape(s.logFilter)}" placeholder="Сообщение, автор или SHA…" aria-label="Поиск по истории"><select data-ig-change="logAuthor" aria-label="Автор коммита">${option(['Все авторы',...new Set(g.commits.map(c=>c.who))],s.logAuthor)}</select>${button('log-all','Все файлы',s.logPath?'':'hidden')}${button('rebase','Interactive rebase')}${button('reflog','Reflog')}</div>${s.logPath?`<p class="ig-note">История файла ${escape(s.logPath)}. Для старых fixture коммитов точный список файлов не предоставлен.</p>`:''}<div class="ig-history-layout"><div class="ig-log-list">${commits.map((c,n)=>`<button class="ig-log-row ${c.sha===s.selectedSha?'selected':''}" data-ig-commit="${escape(c.sha)}"><span class="ig-graph-node" aria-hidden="true"><i></i></span><span><b>${escape(c.message)}</b><small>${escape(c.who)} · ${escape(c.at)}</small></span><code>${escape(c.sha)}</code>${c.sha===g.commits[0]?.sha?`<em>${escape(g.branch)}</em>`:''}</button>`).join('')||empty('Коммитов не найдено')}</div><aside class="ig-commit-detail">${c?`<small>${escape(c.sha)}</small><h3>${escape(c.message)}</h3><p>${escape(c.who)} · ${escape(c.at)}</p><div class="ig-wrap-actions">${button('commit-cherry','Cherry-pick',`data-sha="${escape(c.sha)}"`)}${button('commit-revert','Revert',`data-sha="${escape(c.sha)}"`)}${button('commit-reset','Reset…',`data-sha="${escape(c.sha)}"`)}${button('commit-tag','Tag…',`data-sha="${escape(c.sha)}"`)}${button('commit-patch','Patch',`data-sha="${escape(c.sha)}"`)}</div><h4>Изменённые файлы</h4>${c.files?.length?c.files.map(f=>`<details class="ig-commit-file"><summary>${escape(f.path)} ${f.partial?'· частично':''}</summary><pre data-language="diff">${escape(f.versions?f.versions.map(v=>'# '+v.label+'\n'+v.diff.join('\n')).join('\n\n'):(f.diff||[]).join('\n'))}</pre></details>`).join(''):'<p class="ig-note">Исторический снимок файлов в этом fixture отсутствует. Содержимое рабочей копии не выдаётся за diff коммита.</p>'}`:empty('Выберите коммит')}</aside></div></div>`;
    }
    function renderBranches(g,s) {
      return `<div class="ig-page"><div class="ig-toolbar">${button('new-branch',ico('plus')+' Новая ветка')}${button('new-tag','Новый тег')}${button('new-worktree','Worktree')}${button('conflict','Конфликт · пример')}<span class="ig-fill"></span>${button('fetch','Fetch')}</div><div class="ig-branch-grid"><section><h3>Локальные ветки</h3>${s.branches.map(name=>`<div class="ig-branch-row ${name===g.branch?'selected':''}"><span>${ico('branch')}<b>${escape(name)}</b>${name===g.branch?'<small>Текущая</small>':''}</span><details class="ig-more"><summary aria-label="Действия ветки ${escape(name)}">${ico('more')}</summary><div>${button('checkout','Переключиться',`data-ref="${escape(name)}" ${name===g.branch?'disabled':''}`)}${button('merge','Merge в текущую',`data-ref="${escape(name)}" ${name===g.branch?'disabled':''}`)}${button('rebase-onto','Rebase текущей на эту',`data-ref="${escape(name)}" ${name===g.branch?'disabled':''}`)}${button('compare','Сравнить',`data-ref="${escape(name)}"`)}${button('rename-branch','Переименовать',`data-ref="${escape(name)}"`)}${button('delete-branch','Удалить',`data-ref="${escape(name)}" ${name===g.branch?'disabled':''}`)}</div></details></div>`).join('')}<h3>Удалённые ветки</h3>${s.remoteBranches.map(name=>`<div class="ig-branch-row"><span>${ico('branch')}<b>${escape(name)}</b></span>${button('track-branch','Checkout',`data-ref="${escape(name)}"`)}</div>`).join('')}</section><section><h3>Теги</h3>${s.tags.map(name=>`<div class="ig-branch-row"><span>${ico('tag')}<b>${escape(name)}</b></span>${button('delete-tag','Удалить',`data-ref="${escape(name)}"`)}</div>`).join('')||empty('Тегов нет')}<h3>Worktrees</h3>${s.worktrees.map((w,i)=>`<div class="ig-worktree"><b>${escape(w.branch)}</b><code>${escape(w.path)}</code>${w.main?'<small>Текущая рабочая копия</small>':button('remove-worktree','Убрать',`data-index="${i}"`)}</div>`).join('')}</section></div></div>`;
    }
    function renderStash(g,s) {
      const list=s.stashMode==='stash'?g.stash:s.shelves;
      return `<div class="ig-page"><div class="ig-toolbar"><div class="ig-segment">${button('show-stash','Stash',`aria-pressed="${s.stashMode==='stash'}"`)}${button('show-shelf','Shelf',`aria-pressed="${s.stashMode==='shelf'}"`)}</div><span class="ig-fill"></span>${button(s.stashMode==='stash'?'save-stash':'save-shelf',ico('plus')+' Сохранить изменения',g.files.length?'':'disabled')}${button('apply-patch','Применить patch…')}</div><p class="ig-note">${s.stashMode==='stash'?'Stash хранится в Git репозитории и доступен другим Git клиентам.':'Shelf — локальные отложенные наборы IDE; они не создают Git stash и сохраняют свои названия и changelist.'} При применении исходный набор остаётся; Pop удаляет его только после успешного восстановления.</p><div class="ig-stack">${list.map((entry,i)=>`<article class="ig-stash-card"><header><div><b>${escape(entry.name)}</b><small>${entry.files.length} файлов · ${escape(entry.branch||g.branch)}</small></div><span class="ig-actions">${button('apply-saved','Применить',`data-index="${i}"`)}${button('pop-saved',s.stashMode==='stash'?'Pop':'Восстановить и удалить',`data-index="${i}"`)}${iconButton('drop-saved','close','Удалить '+entry.name,`data-index="${i}"`)}</span></header><details><summary>Файлы и patch</summary>${entry.files.map(f=>`<div class="ig-saved-file"><b>${escape(f.path)}</b><pre data-language="diff">${escape((entry.diffs?.[f.path]||[]).join('\n')||'Снимок diff не получен в старом fixture')}</pre></div>`).join('')}</details></article>`).join('')||empty(s.stashMode==='stash'?'Stash пуст':'Shelf пуст','Сохраните изменения, чтобы переключиться на другую задачу.')}</div></div>`;
    }
    function renderRemotes(g,s) {
      return `<div class="ig-page"><div class="ig-toolbar"><h3>Удалённые репозитории</h3><span class="ig-fill"></span>${button('new-remote',ico('plus')+' Добавить')}${button('clone','Клонировать')}</div>${s.remotes.map((r,i)=>`<article class="ig-remote-card"><header><b>${escape(r.name)}</b><span class="ig-actions">${button('edit-remote','Изменить',`data-index="${i}"`)}${button('delete-remote','Удалить',`data-index="${i}"`)}</span></header><dl><dt>Fetch</dt><dd><code>${escape(r.fetch)}</code></dd><dt>Push</dt><dd><code>${escape(r.push)}</code></dd></dl></article>`).join('')||empty('Нет remotes')}<div class="ig-toolbar">${button('fetch','Fetch all')}${button('pull','Pull…')}${button('push','Push…')}${button('prs','Pull requests / review')}</div><p class="ig-note">${escape(s.remoteStatus)}. Адреса fixture; сеть не вызывается. Учётные данные продукта — через Git credential manager / SSH agent, вне URL и журналов.</p></div>`;
    }
    function renderConsole(g,s) { return `<div class="ig-page"><div class="ig-toolbar"><h3>Git Console</h3><span class="ig-fill"></span>${button('clear-console','Очистить')}</div><p class="ig-note">Журнал действий макета. Команды ниже не запускались.</p><div class="ig-console">${s.console.map(e=>`<article><small>${escape(e.time)}</small><pre><code>${escape(e.command)}</code></pre><p>${escape(e.result)}</p></article>`).join('')||empty('Пока нет операций')}</div></div>`; }
    function renderSettings(g,s) {return `<div class="ig-page ig-settings"><h3>Git · ${escape(project())}</h3><p class="ig-note">Настройки этого репозитория в макете. Глобальная конфигурация компьютера не изменяется.</p><form data-ig-form="settings"><label>Имя автора<input name="author" value="${escape(s.settings.author)}" required></label><label>Email автора<input name="email" type="email" value="${escape(s.settings.email)}" required></label><label>Переносы строк · core.autocrlf<select name="crlf">${option(['input','true','false'],s.settings.crlf)}</select></label><label class="ig-check-label"><input name="autofetch" type="checkbox" ${s.settings.autofetch?'checked':''}> Автоматический fetch</label><label class="ig-check-label"><input name="sign" type="checkbox" ${s.settings.sign?'checked':''}> Подписывать коммиты</label><button class="ig-button ig-primary">Сохранить настройки</button></form></div>`;}
    const titles={
      'new-branch':'Создать ветку','new-tag':'Создать тег','new-worktree':'Новая рабочая копия','rename-branch':'Переименовать ветку','delete-branch':'Удалить ветку','delete-tag':'Удалить тег','remove-worktree':'Убрать рабочую копию',
      'checkout':'Переключить ветку','track-branch':'Создать отслеживаемую ветку','merge':'Merge в текущую ветку','rebase-onto':'Rebase текущей ветки','compare':'Сравнение веток','cherry':'Cherry-pick','revert':'Revert коммита','reset':'Reset к коммиту',
      'new-list':'Новый changelist','move-list':'Переместить файл','save-stash':'Сохранить stash','save-shelf':'Отложить на Shelf','drop-saved':'Удалить сохранённый набор','discard':'Откатить изменения','new-remote':'Добавить remote','edit-remote':'Изменить remote','delete-remote':'Удалить remote',
      'push':'Отправка коммитов','pull':'Обновление рабочей копии','patch':'Patch изменений','commit-patch':'Patch коммита','apply-patch':'Импорт patch','blame':'Аннотации файла','reflog':'Reflog · действия макета','checks':'Проверки перед коммитом'
    };
    function field(label,html) {return `<label>${escape(label)}${html}</label>`;}
    function input(name,value='',placeholder='') {const draft=current().s.operation?.data;if(draft&&name in draft)value=draft[name];return `<input name="${name}" value="${escape(value)}" placeholder="${escape(placeholder)}" required>`;}
    function renderOperation(g,s) {
      const o=s.operation;let body='',submit=true;const selected=g.files.find(f=>f.path===s.path);const target=o.ref||o.sha||s.path;
      if(o.preview){body=`<p class="ig-note">${escape(o.summary||'Изменится только демонстрационное состояние.')}<br>Репозиторий: ${escape(g.repository)} · ветка: ${escape(o.branch)}</p><pre class="ig-command"><code>${escape(o.command||'')}</code></pre>${o.danger?'<p class="ig-warning">Операция меняет историю или удаляет данные рабочей копии. В продукте сохраняются recovery checkpoint и точный список затронутых файлов.</p>':''}`;}
      else if(['new-branch','rename-branch','new-tag','new-list'].includes(o.kind))body=field(o.kind==='new-list'?'Название списка':'Имя',input('name',o.kind==='rename-branch'?o.ref:''))+(o.kind==='new-branch'||o.kind==='new-tag'?field('Начальная ревизия',input('from',o.sha||g.branch)):'')+(o.kind==='new-branch'?'<label class="ig-check-label"><input type="checkbox" name="checkout" checked> Переключиться после создания</label>':'');
      else if(o.kind==='new-worktree')body=field('Папка новой рабочей копии',input('path','','C:\\Projects\\checkout-review'))+field('Новая ветка',input('name','','review/gc-248'))+field('От ревизии',input('from',g.branch));
      else if(o.kind==='move-list')body=`<p>${escape(s.path)}</p>`+field('Changelist',`<select name="name">${option(s.lists,s.assignment[s.path])}</select>`);
      else if(['save-stash','save-shelf'].includes(o.kind))body=field('Название',input('name',(o.kind==='save-stash'?'WIP ':'Shelf ')+g.branch))+field('Набор файлов',`<select name="scope">${option(['Все изменения',...s.lists],s.list)}</select>`)+`<label class="ig-check-label"><input type="checkbox" name="keep"> Оставить изменения в рабочей копии</label><p class="ig-note">Сохраняются diff, полный и частичный индекс. Несохранённый текст редактора требует отдельного сохранения.</p>`;
      else if(['new-remote','edit-remote'].includes(o.kind)){const r=s.remotes[o.index]||{name:'',fetch:'',push:''};body=field('Название remote',input('name',r.name,'origin'))+field('Fetch URL',input('fetch',r.fetch,'ssh://git.example.invalid/PROJECT/repo.git'))+field('Push URL',input('push',r.push,'ssh://git.example.invalid/PROJECT/repo.git'));}
      else if(['checkout','track-branch'].includes(o.kind))body=`<p>${escape(g.branch)} → <b>${escape(o.ref)}</b></p><p class="ig-note">${g.files.length} файлов изменено. В реальном Git переключение предваряется проверкой совместимости изменений с целевой ревизией.</p><label class="ig-check-label"><input type="checkbox" name="carry" ${g.files.length?'':'checked'}> Сохранить изменения при переключении</label>`;
      else if(o.kind==='merge'||o.kind==='rebase-onto')body=`<p><b>${escape(o.ref)}</b> → ${escape(g.branch)}</p>`+field('Стратегия',`<select name="strategy">${option(o.kind==='merge'?['Merge commit','Fast-forward only','Squash']:['Rebase','Rebase --rebase-merges'],'Merge commit')}</select>`)+`<p class="ig-note">Предварительная проверка конфликтов, состояния индекса и незавершённых операций обязательна. История fixture не является реальным графом предков.</p>`;
      else if(o.kind==='compare'){submit=false;body=`<p>${escape(g.branch)} ↔ ${escape(o.ref)}</p><p class="ig-note">В макете нет снимков деревьев этих двух веток. Можно перейти к их истории; текущий diff не подставляется вместо сравнения.</p>${button('open-log','Открыть историю')}`;}
      else if(o.kind==='reset')body=`<p>Цель: <code>${escape(o.sha)}</code></p>`+field('Режим reset',`<select name="mode"><option value="soft">Soft — сохранить индекс и файлы</option><option value="mixed">Mixed — сохранить файлы, очистить индекс</option><option value="hard">Hard — сбросить индекс и файлы</option></select>`);
      else if(o.kind==='cherry'||o.kind==='revert')body=`<p>${escape(o.sha)} · ${escape(g.commits.find(c=>c.sha===o.sha)?.message||'Коммит')}</p><p class="ig-note">${o.kind==='revert'?'Создаётся новый обратный коммит; история сохраняется.':'Изменения выбранного коммита переносятся в текущую ветку новым коммитом.'}</p>`;
      else if(o.kind==='push')body=field('Remote',`<select name="remote">${option(s.remotes.map(r=>r.name),s.remotes[0]?.name)}</select>`)+field('Удалённая ветка',input('target',g.branch))+`<p>${g.unpushed} локальных коммитов к отправке</p><label class="ig-check-label"><input type="checkbox" name="lease"> Force with lease · только с проверкой ожидаемого remote HEAD</label><p class="ig-note">Обычный push — по умолчанию. Неизвестный результат сверяется по remote HEAD, а не повторяется вслепую.</p>`;
      else if(o.kind==='pull')body=field('Remote',`<select name="remote">${option(s.remotes.map(r=>r.name),s.remotes[0]?.name)}</select>`)+field('Стратегия',`<select name="strategy">${option(['Fast-forward only','Rebase','Merge'],'Fast-forward only')}</select>`)+`<p class="ig-note">До обновления: fetch, сравнение входящих коммитов, проверка несохранённых файлов и конфликтов.</p>`;
      else if(o.kind==='patch'||o.kind==='commit-patch'){const files=o.kind==='commit-patch'?(g.commits.find(c=>c.sha===o.sha)?.files||[]):(o.path?[g.files.find(f=>f.path===o.path)].filter(Boolean):g.files);const text=files.map(f=>`diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n@@ demonstration patch @@\n${(f.diff||linesFor(f.path)).join('\n')}`).join('\n');o.patch=text;submit=false;body=`<p class="ig-note">Текст демонстрационного patch; fixture не содержит точных исходных диапазонов. В продукте экспортируется настоящий применимый unified diff.</p><textarea class="ig-patch" readonly aria-label="Содержимое patch">${escape(text||'Снимок изменений не получен')}</textarea>${button('download-patch','Скачать пример patch',text?'':'disabled')}`;}
      else if(o.kind==='apply-patch')body=field('Текст unified patch','<textarea name="patch" rows="6" placeholder="diff --git a/... b/..." required></textarea>')+`<p class="ig-note">В макете — разбор списка файлов и предпросмотр. Применение hunks к реальному содержимому требует Git apply --check.</p>`;
      else if(o.kind==='blame'){submit=false;const path=o.path||s.path;const lines=linesFor(path).filter(l=>!l.startsWith('-'));body=`<p><b>${escape(path)}</b></p><p class="ig-note">Пример аннотаций. Реальный line-level provenance fixture не содержит; автор не назначается произвольно.</p><div class="ig-blame">${lines.map((line,i)=>`<div><span>Не получено</span><i>${i+1}</i><code>${escape(line.replace(/^[+ ]/,''))}</code></div>`).join('')}</div>${button('file-history','История файла')}`;}
      else if(o.kind==='reflog'){submit=false;body=`<p class="ig-note">Reflog репозитория ещё не загружен. Ниже доступны лишь действия текущего сеанса макета.</p>${s.console.map(c=>`<p><code>${escape(c.time)}</code> ${escape(c.command)}</p>`).join('')||empty('Нет действий')}`;}
      else if(o.kind==='checks'){body=`<p>Выбраны проверки: ${Object.entries(s.checks).filter(([,v])=>v).map(([k])=>escape(k)).join(', ')||'нет'}.</p><p class="ig-note">Макет не запускает проверки и не выдаёт им статус pass. Сообщение и индекс сохранены; в продукте commit ждёт завершения выбранных проверок.</p>`;}
      else body=`<p>${escape(target||s.remotes[o.index]?.name||s.worktrees[o.index]?.path||'Выбранный объект')}</p><p class="ig-note">${o.kind==='discard'?'Откат выбранного файла удалит его изменения из рабочей копии и индекса макета.':o.kind==='drop-saved'?'Удалится только сохранённый набор; уже применённые файлы останутся.':'Изменится только выбранный объект.'}</p>`;
      return `<section class="ig-operation" aria-label="${escape(titles[o.kind]||'Git операция')}"><header><div><small>${escape(project())} · ${escape(o.branch)}</small><h3>${escape(titles[o.kind]||'Git операция')}${o.preview?' · предпросмотр':''}</h3></div>${iconButton('cancel-operation','close','Закрыть операцию Git')}</header><form data-ig-form="operation">${body}${o.error?`<p class="ig-error" role="alert">${escape(o.error)}</p>`:''}<footer>${button('cancel-operation','Отмена')}${o.preview?button('edit-operation','Изменить'):''}${submit?`<button class="ig-button ig-primary" type="submit">${o.preview?'Применить в макете':o.kind==='checks'?'Создать без запуска проверок в макете':'Продолжить'}</button>`:''}</footer></form></section>`;
    }
    function handleInput(event) {
      const n=event.target,{s}=current();if(n.name&&n.closest?.('[data-ig-form="operation"]')&&s.operation){s.operation.data||={};s.operation.data[n.name]=n.type==='checkbox'?(n.checked?n.value||'on':false):n.value;}
      if(n.dataset.igInput){s[n.dataset.igInput]=n.value;if(n.dataset.igInput==='message'){const button=host.querySelector('.ig-commit button[type="submit"]');if(button)button.disabled=!s.message.trim()||(!countStaged(api.git())&&!s.amend);}else render(host);}
    }
    function handleChange(event) {
      const n=event.target,{g,s}=current();
      if(n.name&&n.closest?.('[data-ig-form="operation"]')&&s.operation){s.operation.data||={};s.operation.data[n.name]=n.type==='checkbox'?(n.checked?n.value||'on':false):n.value;}
      if(n.dataset.igChange){const key=n.dataset.igChange;if(key==='amend'){s.amend=n.checked;if(n.checked&&!s.message)s.message=g.commits[0]?.message||'';}else if(key==='whitespace')s.ignoreWhitespace=n.checked;else s[key]=n.value;update();}
      if(n.dataset.igCheck){s.checks[n.dataset.igCheck]=n.checked;}
      if(n.dataset.igLine){const line=Number(n.dataset.igLine);s.selectedRows=n.checked?[...new Set([...s.selectedRows,line])]:s.selectedRows.filter(i=>i!==line);render(host);}
    }
    function stageFile(path) {const {g}=current();const lines=linesFor(path);setSelected(g,path,lines,g.staged.includes(path)?[]:lines.map((line,i)=>changedLine(line)?i:-1).filter(i=>i>=0));log('git '+(g.staged.includes(path)?'add':'restore --staged')+' -- '+path);update();}
    function handleClick(event) {
      const section=event.target.closest('[data-ig-section]');if(section){const {s}=current();s.section=section.dataset.igSection;s.operation=null;update();return;}
      const f=event.target.closest('[data-ig-file]');if(f){const {s}=current();s.path=f.dataset.igFile;s.selectedRows=[];s.operation=null;update();return;}
      const staged=event.target.closest('[data-ig-stage]');if(staged){stageFile(staged.dataset.igStage);return;}
      const c=event.target.closest('[data-ig-commit]');if(c){current().s.selectedSha=c.dataset.igCommit;update();return;}
      const n=event.target.closest('[data-ig-action]');if(!n||n.disabled)return;
      const action=n.dataset.igAction,{g,s}=current();const file=g.files.find(f=>f.path===s.path);const lines=file?linesFor(file.path):[];
      n.closest('details')?.removeAttribute('open');
      if(action==='dismiss-notice'){s.notice='';update();host?.querySelector('[data-ig-action="ask"]')?.focus({preventScroll:true});return;}
      if(action==='cancel-operation'){cancelOperation();return;}
      if(action==='edit-operation'){s.operation.preview=false;update();return;}
      if(action==='settings'){s.section='settings';s.operation=null;update();return;}
      if(action==='open-log'||action==='file-history'){s.section='log';s.logPath=action==='file-history'?s.path:'';s.operation=null;update();return;}
      if(action==='log-all'){s.logPath='';update();return;}
      if(action==='open-file'){api.openFile?.(s.path);return;}
      if(action==='ask'){api.ask?.(`Проверь Git изменения в ${g.repository}, ветка ${g.branch}, проект ${project()}. ${s.path?'Файл: '+s.path+'. ':''}Найди риски, предложи проверки и улучшения. Сначала прочитай фактический diff.`);return;}
      if(action==='stage-file'){if(file)stageFile(file.path);return;}
      if(action==='unstage-file'){if(file)setSelected(g,file.path,lines,[]);update();return;}
      if(action==='stage-all'){visibleFiles(g,s).forEach(f=>{const ls=linesFor(f.path);setSelected(g,f.path,ls,ls.map((line,i)=>changedLine(line)?i:-1).filter(i=>i>=0));});log('git add -- <видимые изменённые файлы>');update();return;}
      if(action==='stage-hunk'){const entries=diffEntries(g,s,s.path),h=hunks(entries.map(e=>e.line)).find(h=>h.id===n.dataset.hunk);if(!h)return;const selected=h.indices.map(i=>entries[i].index),indices=selectedLines(g,s.path,lines),all=selected.every(i=>indices.includes(i));setSelected(g,s.path,lines,all?indices.filter(i=>!selected.includes(i)):[...indices,...selected]);log('git add -p -- '+s.path,(all?'Убран':'Подготовлен')+' один блок fixture');update();return;}
      if(action==='stage-lines'){setSelected(g,s.path,lines,[...selectedLines(g,s.path,lines),...s.selectedRows]);s.selectedRows=[];log('git apply --cached <выбранные строки>');update();return;}
      if(action==='diff-split'||action==='diff-unified'){s.mode=action==='diff-split'?'split':'unified';s.modeManual=true;update();return;}
      if(action==='show-worktree'){s.diffSource='worktree';update();return;}
      if(action==='fetch'){s.remoteStatus='Fetch просмотрен сейчас';log('git fetch --all --prune','Fixture обновлён; сеть не вызывалась');update('Удалённые ссылки обновлены в макете');return;}
      if(action==='show-stash'||action==='show-shelf'){s.stashMode=action==='show-stash'?'stash':'shelf';s.operation=null;update();return;}
      if(action==='apply-saved'||action==='pop-saved'){applySaved(Number(n.dataset.index),action==='pop-saved');return;}
      if(action==='clear-console'){s.console=[];update();return;}
      if(action==='download-patch'){const blob=new Blob([s.operation?.patch||''],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='changes-demo.patch';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);update('Пример patch сохранён');return;}
      if(['rebase','conflict','clone','prs','compare','blame','reflog'].includes(action)){api.legacy?.(action,{path:s.path,ref:n.dataset.ref});return;}
      if(action==='commit-cherry'||action==='commit-revert'||action==='commit-reset'||action==='commit-tag'||action==='commit-patch'){start(action==='commit-tag'?'new-tag':action==='commit-patch'?action:action.replace('commit-',''),{sha:n.dataset.sha});return;}
      if(titles[action]){start(action,{ref:n.dataset.ref,index:n.dataset.index==null?undefined:Number(n.dataset.index),path:file?.path});return;}
    }
    function applySaved(index,pop) {
      const {g,s}=current(),list=s.stashMode==='stash'?g.stash:s.shelves,item=list[index];if(!item)return;
      const dirty=dirtyPaths();if(item.files.some(f=>g.files.some(x=>x.path===f.path)||dirty.includes(f.path))){update('Набор не применён: есть пересекающиеся изменения или несохранённый редактор. Сначала сохраните их отдельно.');return;}
      if(!item.diffs){update('У старого набора нет снимка diff. Его применение не симулируется как успешное.');return;}
      g.files.push(...copy(item.files));Object.assign(g.diffs,copy(item.diffs));g.staged.push(...(item.staged||[]));g.hunks.push(...copy(item.hunks||[]));s.indexSnapshots={...(s.indexSnapshots||{}),...copy(item.indexSnapshots||{})};if(item.assignment)Object.assign(s.assignment,item.assignment);if(pop)list.splice(index,1);
      log(s.stashMode==='stash'?'git stash '+(pop?'pop':'apply'):'IDE unshelve',pop?'Набор восстановлен и удалён':'Набор восстановлен, оригинал сохранён');update('Изменения и индекс восстановлены в макете');
    }
    function handleSubmit(event) {
      const form=event.target.closest('[data-ig-form]');if(!form)return;event.preventDefault();const {g,s}=current();const data=Object.fromEntries(new FormData(form));form.querySelectorAll?.('input[type="checkbox"][name]').forEach(n=>{data[n.name]=n.checked?n.value||'on':false;});
      if(form.dataset.igForm==='commit'){
        if(dirtyPaths().length){update('Есть несохранённые файлы редактора. Сохраните их или проверьте, что commit должен содержать только снимок на диске.');return;}
        if(s.checks.tests||s.checks.sign){start('checks');return;}finishCommit();return;
      }
      if(form.dataset.igForm==='settings'){s.settings={...s.settings,author:data.author,email:data.email,crlf:data.crlf,autofetch:!!data.autofetch,sign:!!data.sign};s.section='changes';log('git config --local <настройки>');update('Настройки сохранены только в макете');return;}
      if(form.dataset.igForm==='operation'){
        const o=s.operation;if(!o)return;
        if(o.project!==project()||o.branch!==g.branch||o.repository!==g.repository||o.head!==(g.commits[0]?.sha||'')){s.operation=null;update('Контекст изменился. Операция отменена; откройте её в нужном репозитории заново.');return;}
        if(o.kind==='checks'){s.operation=null;finishCommit();return;}
        if(!o.preview){o.data=data;const error=validateOperation(o,data,g,s);if(error){o.error=error;update();return;}o.data=data;o.preview=true;o.error='';const description=previewOperation(o,g,s);Object.assign(o,description);update();return;}
        applyOperation(o,g,s);
      }
    }
    function finishCommit() {
      const {g,s}=current();if(dirtyPaths().length){update('Сначала сохраните изменения редактора.');return;}
      const commit=commitSelected(g,linesFor,s.message,s.amend);if(!commit){if(s.indexError)update(s.indexError);return;}
      log('git commit'+(s.amend?' --amend':''),'Создан '+commit.sha+' в fixture; выбранные проверки не запускались');s.message='';s.amend=false;s.selectedRows=[];s.selectedSha=commit.sha;s.operation=null;update('Коммит создан в макете. Неподготовленные изменения сохранены.');
    }
    function validateOperation(o,d,g,s) {
      const kind=o.kind;
      if(['new-branch','rename-branch','new-tag','new-worktree'].includes(kind)&&!validRef((d.name||'').trim()))return 'Недопустимое имя Git reference.';
      if(['new-branch','rename-branch','new-worktree'].includes(kind)&&s.branches.includes(d.name.trim()))return 'Ветка с таким именем уже существует.';
      if(kind==='new-tag'&&s.tags.includes(d.name.trim()))return 'Тег с таким именем уже существует.';
      if(kind==='new-list'&&(!d.name.trim()||s.lists.includes(d.name.trim())))return 'Укажите новое непустое название списка.';
      if(['new-remote','edit-remote'].includes(kind)){
        if(!/^[A-Za-z0-9._-]+$/.test(d.name)||s.remotes.some((r,i)=>i!==o.index&&r.name===d.name))return 'Укажите уникальное имя remote.';
        if([d.fetch,d.push].some(v=>!/^(https?:\/\/|ssh:\/\/|[\w.-]+@[\w.-]+:)/.test(v)||/@/.test(v.replace(/^ssh:\/\/[^:@/]+@/,'').replace(/^[\w.-]+@(?=[\w.-]+:)/,''))))return 'Используйте Git URL без встроенного пароля или токена.';
      }
      if(kind==='new-worktree'&&(!d.path.trim()||s.worktrees.some(w=>w.path===d.path.trim())))return 'Укажите новую папку рабочей копии.';
      if(['checkout','track-branch'].includes(kind)&&g.files.length&&!d.carry)return 'Для переключения с изменениями отметьте их перенос либо сначала сохраните stash / shelf.';
      if((['checkout','track-branch','merge','rebase-onto','reset','discard','save-stash','save-shelf','pull'].includes(kind)||(kind==='new-branch'&&d.checkout))&&dirtyPaths().length)return 'Есть несохранённые буферы IDE. Сохраните их перед операцией.';
      if(['merge','rebase-onto','cherry','revert','pull'].includes(kind)&&g.files.length)return 'Сначала сохраните рабочие изменения в commit, stash или shelf; автоматическое перезаписывание не выполняется.';
      if(kind==='push'&&!s.remotes.length)return 'Сначала добавьте remote.';
      if(kind==='push'&&!validRef(d.target))return 'Укажите корректную целевую ветку.';
      if(kind==='apply-patch'&&!/^diff --git a\/.+ b\/.+$/m.test(d.patch||''))return 'Не найден заголовок unified patch «diff --git a/… b/…».';
      return '';
    }
    function previewOperation(o,g,s) {
      const d=o.data,k=o.kind;let command='',summary='',danger=false;
      const simple={
        'new-branch':`git ${d.checkout?'switch -c':'branch'} ${d.name} ${d.from}`,'new-tag':`git tag ${d.name} ${d.from}`,'rename-branch':`git branch -m ${o.ref} ${d.name}`,'delete-branch':`git branch -d ${o.ref}`,'delete-tag':`git tag -d ${o.ref}`,
        'new-worktree':`git worktree add -b ${d.name} ${d.path} ${d.from}`,'remove-worktree':`git worktree remove ${s.worktrees[o.index]?.path}`,'checkout':`git switch ${o.ref}`,'track-branch':`git switch --track ${o.ref}`,
        'merge':`git merge ${d.strategy==='Squash'?'--squash ':d.strategy==='Fast-forward only'?'--ff-only ':''}${o.ref}`,'rebase-onto':`git rebase ${d.strategy==='Rebase --rebase-merges'?'--rebase-merges ':''}${o.ref}`,
        'cherry':`git cherry-pick ${o.sha}`,'revert':`git revert ${o.sha}`,'reset':`git reset --${d.mode} ${o.sha}`,'discard':`git restore --worktree --staged -- ${o.path||s.path}`,
        'save-stash':`git stash push -u -m "${d.name}"${d.keep?'\ngit stash apply --index <созданный stash>':''}`,'save-shelf':`IDE shelf: ${d.name}`,'drop-saved':s.stashMode==='stash'?'git stash drop':'IDE shelf delete',
        'push':`git push ${d.lease?'--force-with-lease ':''}${d.remote} ${g.branch}:${d.target}`,'pull':`git pull ${d.strategy==='Rebase'?'--rebase':d.strategy==='Merge'?'--no-rebase':'--ff-only'} ${d.remote}`,
        'new-remote':`git remote add ${d.name} ${d.fetch}`,'edit-remote':`git remote set-url ${d.name} ${d.fetch}`,'delete-remote':`git remote remove ${s.remotes[o.index]?.name}`,
        'new-list':`IDE changelist: ${d.name}`,'move-list':`IDE move ${s.path} → ${d.name}`,'apply-patch':'git apply --check <patch> · preview only'
      };
      command=simple[k]||k;
      summary=['merge','rebase-onto','cherry','revert','reset','pull'].includes(k)?'Показан план операции. Fixture не содержит полного DAG и снимков деревьев; реальное применение истории не симулируется.':k==='apply-patch'?'Будет показан список файлов; содержимое редактора не перезаписывается.':'Действие меняет только состояние макета.';
      danger=['delete-branch','delete-tag','remove-worktree','discard','drop-saved','reset','rebase-onto','delete-remote'].includes(k)||(k==='push'&&d.lease);
      return {command,summary,danger};
    }
    function applyOperation(o,g,s) {
      if(o.project!==project()||o.branch!==g.branch||o.repository!==g.repository||o.head!==(g.commits[0]?.sha||'')){s.operation=null;update('Контекст Git изменился. Операция отменена; начните её заново.');return;}
      const d=o.data,k=o.kind;const error=validateOperation(o,d,g,s);if(error){o.error=error;update();return;}
      let result='Операция завершена в макете';
      if(k==='new-branch'){s.branches.unshift(d.name.trim());if(d.checkout)g.branch=d.name.trim();}
      else if(k==='new-tag')s.tags.unshift(d.name.trim());
      else if(k==='new-worktree'){s.branches.push(d.name.trim());s.worktrees.push({path:d.path.trim(),branch:d.name.trim(),main:false});}
      else if(k==='rename-branch'){s.branches=s.branches.map(b=>b===o.ref?d.name.trim():b);s.worktrees.forEach(w=>{if(w.branch===o.ref)w.branch=d.name.trim();});if(g.branch===o.ref)g.branch=d.name.trim();}
      else if(k==='delete-branch')s.branches=s.branches.filter(b=>b!==o.ref);
      else if(k==='delete-tag')s.tags=s.tags.filter(t=>t!==o.ref);
      else if(k==='remove-worktree')s.worktrees.splice(o.index,1);
      else if(k==='checkout')g.branch=o.ref;
      else if(k==='track-branch'){g.branch=o.ref.split('/').slice(1).join('/');if(!s.branches.includes(g.branch))s.branches.push(g.branch);}
      else if(k==='new-list'){s.lists.push(d.name.trim());s.list=d.name.trim();}
      else if(k==='move-list')s.assignment[s.path]=d.name;
      else if(k==='discard'){g.files=g.files.filter(f=>f.path!==o.path);g.staged=g.staged.filter(p=>p!==o.path);g.hunks=g.hunks.filter(h=>h.path!==o.path);delete g.diffs[o.path];}
      else if(k==='save-stash'||k==='save-shelf'){
        const paths=g.files.filter(f=>d.scope==='Все изменения'||s.assignment[f.path]===d.scope).map(f=>f.path);
        if(!paths.length){o.error='В выбранном списке нет файлов.';update();return;}
        const snapshot={...takeSnapshot(g,linesFor,paths),name:d.name.trim(),branch:g.branch,assignment:Object.fromEntries(paths.map(p=>[p,s.assignment[p]]))};
        (k==='save-stash'?g.stash:s.shelves).unshift(snapshot);if(!d.keep){g.files=g.files.filter(f=>!paths.includes(f.path));g.staged=g.staged.filter(p=>!paths.includes(p));g.hunks=g.hunks.filter(h=>!paths.includes(h.path));paths.forEach(p=>{delete g.diffs[p];if(s.indexSnapshots)delete s.indexSnapshots[p];});}s.section='stash';s.stashMode=k==='save-stash'?'stash':'shelf';
      }
      else if(k==='drop-saved')(s.stashMode==='stash'?g.stash:s.shelves).splice(o.index,1);
      else if(k==='new-remote')s.remotes.push({name:d.name,fetch:d.fetch,push:d.push});
      else if(k==='edit-remote')s.remotes[o.index]={name:d.name,fetch:d.fetch,push:d.push};
      else if(k==='delete-remote')s.remotes.splice(o.index,1);
      else if(k==='push'){g.unpushed=0;result='Fixture push завершён; сетевой запрос не отправлялся';}
      else if(k==='apply-patch'){const files=[...d.patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map(m=>m[2]);result=`Предпросмотр ${files.length} файлов: ${files.join(', ')}. Применение к рабочей копии не выполнялось.`;}
      else if(['merge','rebase-onto','cherry','revert','reset','pull'].includes(k)){result='План сохранён в консоли. Изменения истории не применялись: нужен реальный Git backend и полный граф.';}
      if(s.worktrees[0]?.main)s.worktrees[0].branch=g.branch;
      log(o.command,result);s.operation=null;update(result);
    }
    return {render,open,close,isOpen:()=>seed(api.git()).open,state:()=>seed(api.git()),_test:{hunks,selectedLines,setSelected,commitSelected,takeSnapshot,validRef,seed,applySaved,validateOperation}};
  }
  window.SuiteIdeGit={create,_test:{effectiveDiffMode,hunks,selectedLines,setSelected,commitSelected,takeSnapshot,validRef,seed}};
})();
