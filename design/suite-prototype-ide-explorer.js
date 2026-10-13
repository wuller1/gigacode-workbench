/* Project explorer for the review prototype. All mutations affect in-memory fixtures only. */
(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const b=(a,text,attrs='')=>`<button type="button" class="di-button" data-di="ex-${a}" ${attrs}>${text}</button>`;
  const validPath=p=>Boolean(p)&&!p.startsWith('/')&&!p.includes('\\')&&p.split('/').every(s=>s&&!['.','..'].includes(s)&&!/[<>:"|?*\u0000-\u001f]/.test(s)&&!/[. ]$/.test(s)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
  function hierarchyConflicts(files,rows){
    const removed=new Set(rows.map(r=>r.from.toLowerCase())),remaining=Object.keys(files).filter(p=>!removed.has(p.toLowerCase())).concat(rows.map(r=>r.to)).map(p=>p.toLowerCase());
    const paths=new Set(remaining),errors=[];for(const path of remaining){const parts=path.split('/');for(let i=1;i<parts.length;i++){const parent=parts.slice(0,i).join('/');if(paths.has(parent))errors.push('Файл занят как папка: '+parent);}}
    return [...new Set(errors)];
  }
  function renamePlan(files,paths,options){
    const find=options.find||'',replace=options.replace||'',prefix=options.prefix||'',folder=options.folder?.trim().replace(/\/$/,'');
    const rows=paths.filter(p=>Object.hasOwn(files,p)).map(from=>{const bits=from.split('/'),name=bits.pop();let next=prefix+(find?name.split(find).join(replace):name);return {from,to:(folder?folder+'/':bits.length?bits.join('/')+'/':'')+next,source:files[from]};});
    const occupied=new Set(Object.keys(files).map(p=>p.toLowerCase())),sources=new Set(rows.map(r=>r.from.toLowerCase())),targets=new Set();
    const errors=[];
    rows.forEach(r=>{const key=r.to.toLowerCase();if(!validPath(r.to))errors.push('Недопустимый путь Windows: '+r.to);if(targets.has(key)||(occupied.has(key)&&!sources.has(key)))errors.push('Конфликт имени: '+r.to);targets.add(key);});
    if(!rows.length)errors.push('Выберите хотя бы один существующий файл.');
    if(rows.length&&rows.every(r=>r.from===r.to))errors.push('Пути не изменились.');
    errors.push(...hierarchyConflicts(files,rows));return {rows,errors};
  }
  function gitDecoration(record,staged=false){
    if(!record)return {state:'unknown',mark:'',label:'Git: состояние не получено'};
    const code=String(record.kind||record.status||'').trim(),xy=String(record.indexStatus||' ')+String(record.worktreeStatus||' ');
    let state='unknown';
    if(record.conflicted||['UU','AA','DD','AU','UD','DU','UA'].includes(code)||['UU','AA','DD','AU','UD','DU','UA'].includes(xy)||code==='U')state='conflict';
    else if(code==='!!'||code==='!')state='ignored';
    else if(code==='??'||code==='?')state='untracked';
    else if(code==='D'||xy.includes('D'))state='deleted';
    else if(code==='R'||xy.includes('R'))state='renamed';
    else if(code==='A'||xy.includes('A'))state='added';
    else if(code==='M'||xy.includes('M')||code==='T')state='modified';
    else if(record.clean===true||code==='clean')state='clean';
    const labels={modified:['M','Изменён'],added:['A','Добавлен'],untracked:['?','Не отслеживается'],ignored:['!','Игнорируется'],deleted:['D','Удалён'],renamed:['R','Переименован'],conflict:['U','Конфликт'],clean:['','Без изменений'],unknown:['','Состояние не получено']};
    return {state,mark:labels[state][0],label:'Git: '+labels[state][1]+(staged?' · Есть изменения в индексе':'')};
  }
  function create(api){
    let visiblePaths=[];
    const state=()=>{const ide=api.ide();if(!ide.explorerState)ide.explorerState={selected:[],anchor:null,compact:true,hideExcluded:true,width:210,lastRename:null};return ide.explorerState;};
    const selection=()=>state().selected.filter(p=>Object.hasOwn(api.files(),p));
    const icon=path=>{const ext=path.split('.').pop();return {java:'J',py:'Py',tsx:'R',jsx:'R',ts:'TS',js:'JS',json:'{}',xml:'<>',yml:'Y',yaml:'Y',md:'M',css:'#'}[ext]||'·';};
    const decoration=path=>{const status=api.gitStatus?.(path),d=gitDecoration(status?.record,status?.staged);if(api.ide().dirty.has(path))d.label+=' · Есть несохранённые изменения';return d;};
    function refreshGit(){api.root?.querySelectorAll('.ex-file[data-path]').forEach(node=>{const d=decoration(node.dataset.path);node.dataset.gitState=d.state;node.title=node.dataset.path+'\n'+d.label;node.setAttribute('aria-description',d.label);const badge=node.querySelector('.ex-git-mark');if(badge)badge.textContent=d.mark;});}
    function tree(){
      const st=state(),ide=api.ide(),filter=(ide.filter||'').toLowerCase(),chosen=new Set(selection());
      const paths=Object.keys(api.files()).filter(p=>(!st.hideExcluded||!/(^|\/)(node_modules|target|\.git|\.venv|__pycache__)(\/|$)/.test(p))&&p.toLowerCase().includes(filter)).sort((a,b)=>a.localeCompare(b));
      const root={folders:new Map(),files:[]};visiblePaths=[];
      for(const path of paths){const bits=path.split('/');let node=root;for(const part of bits.slice(0,-1)){if(!node.folders.has(part))node.folders.set(part,{folders:new Map(),files:[]});node=node.folders.get(part);}node.files.push(path);}
      const draw=(node,prefix='',depth=0,visible=true)=>[...node.folders].map(([original,child])=>{
        let label=original,path=prefix?prefix+'/'+original:original,keys=[path];
        if(st.compact)while(!child.files.length&&child.folders.size===1){const [part,next]=[...child.folders][0];label+=' / '+part;path+='/'+part;keys.push(path);child=next;}
        const open=Boolean(filter)||keys.some(k=>ide.expanded.has(k));
        return `<details class="di-file-folder ex-folder" data-folder="${esc(path)}" data-folder-keys="${esc(JSON.stringify(keys))}" data-project="${esc(api.project())}" data-filter-open="${Boolean(filter)}" ${open?'open':''}><summary title="${esc(path)}" data-ex-folder="${esc(path)}" style="--ex-depth:${depth}"><span>${esc(label)}</span></summary>${draw(child,path,depth+1,visible&&open)}</details>`;
      }).join('')+node.files.map(path=>{const git=decoration(path);if(visible)visiblePaths.push(path);return `<div class="ex-row ${chosen.has(path)?'selected':''}" style="--ex-depth:${depth}"><button type="button" class="di-tree ex-file" data-di="ex-open" data-path="${esc(path)}" data-git-state="${git.state}" aria-description="${esc(git.label)}" aria-current="${path===ide.active}" aria-pressed="${chosen.has(path)}" title="${esc(path)}&#10;${esc(git.label)}"><span class="ex-filetype" aria-hidden="true" data-ext="${esc(path.split('.').pop())}">${icon(path)}</span><span class="ex-filename">${esc(path.split('/').pop())}</span><span class="ex-git-mark" aria-hidden="true">${git.mark}</span>${ide.dirty.has(path)?'<small title="Есть несохранённые изменения">●</small>':''}</button>${b('menu','⋯',`data-path="${esc(path)}" aria-label="Действия с ${esc(path)}"`)}</div>`;}).join('');
      return draw(root)||'<p class="di-caption ex-empty">Файлы не найдены</p>';
    }
    function markup(){const st=state(),count=selection().length;return `<aside id="di-project-files" class="di-explorer ex-explorer" ${api.ide().explorer?'':'hidden'} style="width:${st.width}px" aria-label="Файлы проекта"><div class="ex-header"><b>Проект</b><span class="di-spacer"></span>${b('new','+', 'aria-label="Создать файл" title="Создать файл"')}${b('reveal','⊙','aria-label="Найти текущий файл в дереве" title="Найти текущий файл"')}${b('collapse','−','aria-label="Свернуть все папки" title="Свернуть все папки"')}${b('options','⋯','aria-label="Настройки проводника" title="Вид и массовые действия"')}</div><input id="di-file-search" placeholder="Найти файл…" aria-label="Найти файл"><div id="di-project-caption" title="${esc(api.project())}">${esc(api.project())}</div><div id="di-file-list">${tree()}</div><div class="ex-selection"><span>${count>1?'Выбрано: '+count:'Ctrl / Shift · выбор файлов'}</span>${count>1?b('bulk','Изменить'):''}</div><div class="ex-resizer" role="separator" tabindex="0" aria-label="Ширина проводника IDE" aria-orientation="vertical" aria-valuemin="150" aria-valuemax="440" aria-valuenow="${st.width}"></div></aside>`;}
    function show(title,body,actions,callback){const owner=api.ide();api.dialog(title,body,actions,(a,el,event)=>{if(api.ide()!==owner){api.closeDialog();return;}callback(a,el,event);});}
    const field=id=>api.dialogElement().querySelector('#'+id);
    function choose(path,event){const st=state();if(event?.ctrlKey||event?.metaKey){const set=new Set(selection());set.has(path)?set.delete(path):set.add(path);st.selected=[...set];st.anchor=path;api.render();return;}
      if(event?.shiftKey&&st.anchor&&visiblePaths.includes(st.anchor)){const from=visiblePaths.indexOf(st.anchor),to=visiblePaths.indexOf(path);st.selected=visiblePaths.slice(Math.min(from,to),Math.max(from,to)+1);api.render();return;}
      st.selected=[path];st.anchor=path;api.openFile(path);
    }
    function fileMenu(path){const selected=selection();if(!selected.includes(path)){state().selected=[path];state().anchor=path;}
      const list=selection();show(list.length>1?'Файлы · '+list.length:path,`<div class="ex-menu">${b('menu-open','Открыть')}${b('menu-rename',list.length>1?'Массовое переименование / перенос':'Переименовать / перенести')}${b('menu-duplicate','Создать копии')}${b('menu-path','Копировать путь')}${b('menu-new','Новый файл рядом')}${b('menu-delete','Удалить из макета')}${b('menu-find','Найти использования с агентом')}</div>`,'',(action)=>{
        if(action==='ex-menu-open'){api.closeDialog();list.forEach(p=>api.openFile(p));}
        else if(action==='ex-menu-rename')rename(list);
        else if(action==='ex-menu-duplicate')duplicate(list);
        else if(action==='ex-menu-delete')remove(list);
        else if(action==='ex-menu-path')show('Пути от корня проекта',`<label>Выделите и скопируйте<textarea id="ex-paths" readonly>${esc(list.join('\n'))}</textarea></label>`,b('done','Готово'),()=>api.closeDialog());
        else if(action==='ex-menu-new')newFile(path.split('/').slice(0,-1).join('/'));
        else if(action==='ex-menu-find'){api.closeDialog();api.ask('Проверь usages и связанные импорты до переименования этих файлов:\n'+list.join('\n')+'\nИспользуй реальные language server / project model, подготовь preview и тесты.');}
      });
    }
    function folderMenu(path){const list=Object.keys(api.files()).filter(p=>p.startsWith(path+'/'));show('Папка · '+path,`<p>${list.length} файлов</p><div class="ex-menu">${b('folder-new','Создать файл')}${b('folder-select','Выбрать все файлы папки')}${b('folder-rename','Переименовать папку')}</div>`,'',a=>{
      if(a==='ex-folder-new')newFile(path);
      if(a==='ex-folder-select'){state().selected=list;api.closeDialog();api.render();}
      if(a==='ex-folder-rename')show('Переименовать папку',`<label>Новый путь<input id="ex-folder-path" value="${esc(path)}"></label><p>Будет показан полный список изменений. Изменение package/import требует отдельного semantic preview.</p>`,b('folder-preview','Предпросмотр'),key=>{if(key!=='ex-folder-preview')return;const to=field('ex-folder-path').value.trim();const f=api.files(),rows=list.map(from=>({from,to:to+from.slice(path.length),source:f[from]}));preview(makePlan(rows));});
    });}
    function makePlan(rows){const files=api.files(),sources=new Set(rows.map(x=>x.from.toLowerCase())),targets=new Set(),occupied=new Set(Object.keys(files).map(p=>p.toLowerCase())),errors=[];for(const r of rows){if(!Object.hasOwn(files,r.from))errors.push('Missing source: '+r.from);const key=r.to.toLowerCase();if(!validPath(r.to))errors.push('Недопустимый путь: '+r.to);if(targets.has(key)||(occupied.has(key)&&!sources.has(key)))errors.push('Конфликт имени: '+r.to);targets.add(key);}if(rows.every(r=>r.from===r.to))errors.push('Пути не изменились.');errors.push(...hierarchyConflicts(files,rows));return {rows,errors};}
    function rename(paths){
      if(paths.length!==1){bulk(paths);return;}
      const path=paths[0];show('Переименовать файл',`<label>Путь от корня проекта<input id="ex-new-name" value="${esc(path)}"></label><p>Следующий шаг — предпросмотр. Содержимое файла остаётся прежним.</p>`,b('rename-preview','Предпросмотр'),action=>{if(action==='ex-rename-preview')preview(makePlan([{from:path,to:field('ex-new-name').value.trim(),source:api.files()[path]}]));});
    }
    function remove(paths){
      const owner=api.ide(),fileOwner=api.files(),snapshot=paths.map(path=>({path,text:fileOwner[path]}));
      show('Удалить из макета?',`<p>${paths.length} файлов будут удалены из памяти этой страницы. Несохранённые правки этих файлов также будут удалены.</p>${paths.map(p=>`<div class="ex-path">${esc(p)}</div>`).join('')}`,b('delete-confirm','Удалить'),action=>{
        if(action!=='ex-delete-confirm')return;if(api.ide()!==owner||api.files()!==fileOwner||snapshot.some(x=>fileOwner[x.path]!==x.text)){fieldError('Файлы изменились. Закройте окно и проверьте выбор.');return;}
        for(const {path} of snapshot){delete fileOwner[path];delete owner.saved[path];delete owner.breakpointFiles?.[path];delete owner.editorViews?.[path];owner.dirty.delete(path);}
        owner.open=owner.open.filter(p=>Object.hasOwn(fileOwner,p));if(!Object.hasOwn(fileOwner,owner.active))owner.active=owner.open[0]||null;state().selected=[];state().lastRename=null;api.closeDialog();owner.status='Файлы удалены только из макета.';api.render();
      });
    }
    function bulk(paths=selection()){
      if(!paths.length&&api.ide().active)paths=[api.ide().active];
      show('Массовое переименование',`<p>${paths.length} файлов · сначала preview, затем одно применение. Регистр проверяется как на Windows.</p><div class="di-columns"><label>Найти в имени<input id="ex-find" placeholder="Payment"></label><label>Заменить на<input id="ex-replace" placeholder="Invoice"></label></div><div class="di-columns"><label>Префикс имени<input id="ex-prefix" placeholder="Не изменять"></label><label>Переместить в папку<input id="ex-folder" placeholder="Оставить текущую папку"></label></div><p class="di-caption">Замена здесь буквальная, без regex. Содержимое файлов и импорты не меняются автоматически. Для rename symbol используйте Refactor в редакторе.</p><details><summary>Выбранные файлы</summary>${paths.map(p=>`<div class="ex-path">${esc(p)}</div>`).join('')}</details>`,b('preview','Предпросмотр'),action=>{if(action==='ex-preview')preview(renamePlan(api.files(),paths,{find:field('ex-find').value,replace:field('ex-replace').value,prefix:field('ex-prefix').value,folder:field('ex-folder').value}));});
    }
    function preview(plan,undo=false){
      const owner=api.ide(),fileOwner=api.files();
      show('Проверить переименование',`${plan.errors.length?`<div class="il-callout di-error">${plan.errors.map(esc).join('<br>')}</div>`:''}<div class="ex-rename-list">${plan.rows.map(r=>`<div><code>${esc(r.from)}</code><span>→</span><code>${esc(r.to)}</code></div>`).join('')}</div><p>Вкладки, несохранённые буферы, точки останова и положение курсора сохраняются. Java packages и импорты не изменятся; после структурного переноса нужен semantic refactoring и сборка.</p><p class="di-caption">Только файлы в памяти макета; файловая система компьютера не меняется.</p>`,b('back','Назад')+b('apply','Применить в макете',plan.errors.length?'disabled':''),action=>{
        if(action==='ex-back'){bulk(plan.rows.map(r=>r.from));return;}
        if(action!=='ex-apply'||plan.errors.length)return;
        if(owner!==api.ide()||fileOwner!==api.files()||plan.rows.some(r=>fileOwner[r.from]!==r.source)){fieldError('Файлы изменились после preview. Подготовьте план заново.');return;}
        const rechecked=makePlan(plan.rows);if(rechecked.errors.length){fieldError(rechecked.errors.join('; '));return;}
        apply(plan.rows);state().lastRename=undo?null:plan.rows.map(r=>({from:r.to,to:r.from,source:api.files()[r.to]}));api.closeDialog();api.ide().status='Переименовано файлов: '+plan.rows.length+'. Импорты не изменялись.';api.render();
      });
    }
    function fieldError(text){let node=field('ex-error');if(!node){node=document.createElement('p');node.id='ex-error';node.className='di-error';node.setAttribute('role','alert');api.dialogElement().querySelector('main').append(node);}node.textContent=text;}
    function apply(rows){
      api.captureView?.();const ide=api.ide(),files=api.files(),map=new Map(rows.map(r=>[r.from,r.to])),saved=new Map(rows.map(r=>[r.from,ide.saved[r.from]])),points=new Map(rows.map(r=>[r.from,ide.breakpointFiles?.[r.from]])),views=new Map(rows.map(r=>[r.from,ide.editorViews?.[r.from]]));
      for(const r of rows){delete files[r.from];delete ide.saved[r.from];delete ide.breakpointFiles?.[r.from];delete ide.editorViews?.[r.from];}
      for(const imported of Object.values(ide.downloadImports||{}))if(map.has(imported.path))imported.path=map.get(imported.path);
      for(const r of rows){files[r.to]=r.source;ide.saved[r.to]=saved.get(r.from);if(points.get(r.from)){ide.breakpointFiles||={};ide.breakpointFiles[r.to]=points.get(r.from);}if(views.get(r.from)){ide.editorViews||={};ide.editorViews[r.to]=views.get(r.from);}const parts=r.to.split('/');for(let i=1;i<parts.length;i++)ide.expanded.add(parts.slice(0,i).join('/'));}
      ide.open=ide.open.map(p=>map.get(p)||p);ide.active=map.get(ide.active)||ide.active;ide.dirty=new Set([...ide.dirty].map(p=>map.get(p)||p));state().selected=rows.map(r=>r.to);ide.filter='';
    }
    function duplicate(paths){const ide=api.ide(),files=api.files();for(const path of paths){const index=path.lastIndexOf('.'),stem=index>path.lastIndexOf('/')?path.slice(0,index):path,ext=index>path.lastIndexOf('/')?path.slice(index):'';let n=1,next;do{next=stem+'-copy'+(n>1?'-'+n:'')+ext;n++;}while(Object.keys(files).some(p=>p.toLowerCase()===next.toLowerCase()));files[next]=files[path];ide.saved[next]=files[next];}api.closeDialog();api.notice('Копии созданы в памяти макета.');api.render();}
    function newFile(folder=''){show('Новый файл',`<label>Путь от корня<input id="ex-new-path" value="${esc(folder?folder+'/':'')}"></label><p>Папки появятся вместе с файлом. Например: src/main/java/com/example/Service.java.</p>`,b('create','Создать'),a=>{if(a!=='ex-create')return;const path=field('ex-new-path').value.trim();if(!validPath(path)||Object.keys(api.files()).some(p=>p.toLowerCase()===path.toLowerCase())||hierarchyConflicts(api.files(),[{from:'',to:path}]).length){fieldError('Введите допустимый новый путь без конфликта имени.');return;}api.files()[path]='';api.ide().saved[path]='';api.closeDialog();api.openFile(path);});}
    function options(){const st=state();show('Проводник проекта',`<label class="di-check"><input id="ex-compact" type="checkbox" ${st.compact?'checked':''}>Объединять вложенные пустые папки</label><label class="di-check"><input id="ex-excluded" type="checkbox" ${st.hideExcluded?'checked':''}>Скрывать .git, .venv, target и node_modules</label><div class="ex-git-legend" aria-label="Цвета Git">${[['modified','Изменён'],['added','Добавлен'],['untracked','Не отслеживается'],['renamed','Переименован'],['ignored','Игнорируется'],['conflict','Конфликт']].map(([state,label])=>`<span data-git-state="${state}">${label}</span>`).join('')}</div><p>Цвет названия — Git-состояние. Точка отдельно показывает несохранённый буфер. Если Git-состояние не получено, имя остаётся нейтральным.</p><p>Ctrl / Cmd — отдельные файлы; Shift — диапазон видимых файлов. F2 — переименование; Ctrl/Cmd+P — быстрый переход.</p><div class="ex-menu">${b('options-bulk','Массовое переименование')}${b('options-undo','Отменить последнее переименование',st.lastRename?'':'disabled')}${b('options-quick','Быстро открыть файл')}</div>`,b('options-save','Применить'),a=>{if(a==='ex-options-save'){st.compact=field('ex-compact').checked;st.hideExcluded=field('ex-excluded').checked;api.closeDialog();api.render();}if(a==='ex-options-bulk')bulk();if(a==='ex-options-undo')preview(makePlan(st.lastRename||[]),true);if(a==='ex-options-quick'){api.closeDialog();api.quickOpen();}});}
    function bind(){const root=api.root,aside=root.querySelector('.ex-explorer');if(!aside)return;aside.querySelector('#di-file-search').value=api.ide().filter||'';
      aside.oncontextmenu=event=>{const row=event.target.closest('[data-path]'),folder=event.target.closest('[data-ex-folder]');if(!row&&!folder)return;event.preventDefault();row?fileMenu(row.dataset.path):folderMenu(folder.dataset.exFolder);};
      aside.onkeydown=event=>{if(event.key==='F2'&&selection().length){event.preventDefault();rename(selection());}};
      const handle=aside.querySelector('.ex-resizer'),set=value=>{state().width=Math.round(Math.max(150,Math.min(440,api.root.clientWidth*.45,value)));aside.style.width=state().width+'px';handle.setAttribute('aria-valuenow',state().width);};
      handle.onkeydown=event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();set(state().width+(event.key==='ArrowRight'?16:-16));}};
      handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();const start=event.clientX,width=aside.getBoundingClientRect().width;handle.setPointerCapture(event.pointerId);handle.onpointermove=e=>set(width+e.clientX-start);handle.onpointerup=()=>{handle.onpointermove=null;handle.onpointerup=null;};handle.onpointercancel=handle.onpointerup;};
    }
    function action(action,el,event){if(!action.startsWith('ex-'))return false;
      if(action==='ex-open')choose(el.dataset.path,event);if(action==='ex-menu')fileMenu(el.dataset.path);if(action==='ex-new')newFile();if(action==='ex-bulk')bulk();if(action==='ex-options')options();if(action==='ex-collapse'){api.ide().expanded.clear();api.render();}if(action==='ex-reveal'&&api.ide().active){api.ide().filter='';api.openFile(api.ide().active);api.root.querySelector('.di-tree[aria-current="true"]')?.scrollIntoView({block:'nearest'});}return true;
    }
    return {markup,tree,bind,action,state,bulk,apply,preview,refreshGit};
  }
  window.SuiteIDEExplorer={create,spec:{renamePlan,validPath,gitDecoration}};
})();
