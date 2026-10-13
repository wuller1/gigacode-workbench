/* Project-scoped extension planning UI. No extension packages are downloaded or executed. */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const button=(action,label,attrs='')=>`<button type="button" class="di-button" data-di="ix-${action}" ${attrs}>${label}</button>`;
  const catalog=[
    {id:'redhat.java',name:'Language Support for Java',publisher:'Red Hat',license:'EPL-2.0',letter:'J',tags:['Java','LSP','JDK'],description:'Навигация, диагностика, автодополнение и рефакторинги Java. Требует Java runtime и совместимого language client.',url:'https://open-vsx.org/extension/redhat/java',scope:'Языковой сервер · JDK · модель Maven / Gradle'},
    {id:'VMware.vscode-spring-boot',name:'Spring Boot Tools',publisher:'VMware',license:'EPL-1.0',letter:'S',tags:['Java','Spring','Boot'],description:'Поддержка Spring Boot: конфигурация, свойства, аннотации и сведения о приложении. Live возможности требуют доступного приложения и поддержки host.',url:'https://open-vsx.org/extension/VMware/vscode-spring-boot',scope:'Spring tooling · Java runtime · интеграция с host'},
    {id:'vscjava.vscode-maven',name:'Maven for Java',publisher:'Microsoft',license:'MIT',letter:'M',tags:['Java','Maven','Build'],description:'Дерево Maven-проектов, цели сборки и управление командами. Доступ к wrapper и терминалу проверяется отдельно.',url:'https://open-vsx.org/extension/vscjava/vscode-maven',scope:'Project model · Maven wrapper · terminal API'},
    {id:'ms-pyright.pyright',name:'Pyright',publisher:'Microsoft',license:'MIT',letter:'P',tags:['Python','Types','LSP'],description:'Статический анализ типов Python и языковые возможности. Pyright и Pylance — разные расширения; эта запись относится только к Pyright.',url:'https://open-vsx.org/extension/ms-pyright/pyright',scope:'Language client · выбранный Python environment'},
    {id:'dbaeumer.vscode-eslint',name:'ESLint',publisher:'Microsoft',license:'MIT',letter:'E',tags:['Frontend','JavaScript','TypeScript'],description:'Диагностика и исправления ESLint для JavaScript и TypeScript. Версия ESLint и конфигурация читаются из проекта.',url:'https://open-vsx.org/extension/dbaeumer/vscode-eslint',scope:'Workspace ESLint · Node runtime · code actions'},
    {id:'esbenp.prettier-vscode',name:'Prettier',publisher:'Prettier',license:'MIT',letter:'F',tags:['Frontend','Format','CSS'],description:'Форматирование кода с настройками проекта. Не заменяет семантический анализ, тесты или проверку дизайна.',url:'https://open-vsx.org/extension/esbenp/prettier-vscode',scope:'Formatter API · workspace Prettier · настройки проекта'}
  ];
  const byId=id=>catalog.find(item=>item.id===id);
  function create(api){
    let selected=null,tab='catalog',query='',owner=null,dialogGeneration=0;
    if(!document.getElementById('ix-styles')){const css=document.createElement('link');css.id='ix-styles';css.rel='stylesheet';css.href='suite-prototype-ide-extensions.css';document.head.append(css);}
    function state(){
      const ide=api.ide();if(!ide.extensionPlans)ide.extensionPlans={source:'openvsx',corporateURL:'',items:{}};
      return ide.extensionPlans;
    }
    const field=id=>api.dialogElement().querySelector('#'+id);
    const validOwner=()=>api.ide()===owner;
    function renderSummary(){return `<span>${esc(api.project())}</span><span>${Object.keys(state().items).length} в плане · extension host ещё не подключён</span>`;}
    function header(){const s=state();return `<div class="ix-toolbar"><div class="ix-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="ix-search" type="search" value="${esc(query)}" placeholder="Java, Python, форматирование…" aria-label="Найти расширение"></div><select id="ix-source" aria-label="Источник расширений"><option value="openvsx" ${s.source==='openvsx'?'selected':''}>Open VSX</option><option value="corporate" ${s.source==='corporate'?'selected':''}>Корпоративный каталог</option></select></div><nav class="ix-tabs" aria-label="Списки расширений">${button('catalog','Каталог','aria-pressed="'+(tab==='catalog')+'"')}${button('planned','В плане · '+Object.keys(s.items).length,'aria-pressed="'+(tab==='planned')+'"')}<span></span>${button('vsix','VSIX')}${button('host','Совместимость')}</nav>`;}
    function listed(){const q=query.trim().toLowerCase();return catalog.filter(item=>(tab!=='planned'||state().items[item.id])&&(!q||[item.id,item.name,item.description,...item.tags].join(' ').toLowerCase().includes(q)));}
    function corporate(){return `<div class="ix-corporate"><b>Подключение корпоративного каталога</b><p>Укажите адрес реестра Open VSX или внутреннего сервиса. В макете сохраняется только URL; сетевой запрос не выполняется.</p><label>URL каталога<input id="ix-corporate-url" type="url" placeholder="https://extensions.example.org" value="${esc(state().corporateURL)}"></label><div class="ix-actions">${button('save-source','Сохранить адрес')}${button('source-agent','Адаптировать с агентом')}</div><p class="di-caption">Доступные пакеты появятся после подключения провайдера в приложении. Записи Open VSX не выдаются за содержимое вашего сервера.</p></div>`;}
    function listMarkup(){
      if(state().source==='corporate'&&tab==='catalog')return corporate();
      const items=listed();if(!items.length)return `<div class="ix-empty"><b>${query?'Ничего не найдено':'План установки пуст'}</b><p>${query?'Измените запрос. Поиск работает по названию, ID и назначению.':'Добавьте нужные расширения из каталога. Установка начнётся только после реализации совместимого host.'}</p>${query?button('clear-search','Сбросить поиск'):button('catalog','Открыть каталог')}</div>`;
      return items.map(item=>`<button type="button" class="ix-row ${selected===item.id?'selected':''}" data-di="ix-open" data-id="${item.id}" aria-pressed="${selected===item.id}"><span class="ix-glyph">${item.letter}</span><span class="ix-row-text"><b>${item.name}</b><small>${item.publisher} · ${item.license}</small><span>${item.tags.join(' · ')}</span></span><span class="ix-row-status">${state().items[item.id]?'В плане':'＋'}</span></button>`).join('');
    }
    function detailMarkup(){
      const item=byId(selected);if(!item)return `<div class="ix-empty ix-detail-empty"><b>Расширения для проекта</b><p>Выберите расширение, чтобы увидеть назначение, лицензию и требования к среде.</p><p>Monaco сам по себе не исполняет расширения VS Code. План установки сохраняется отдельно от фактического подключения.</p></div>`;
      const plan=state().items[item.id];return `<div class="ix-detail-head"><span class="ix-glyph">${item.letter}</span><div><h3>${item.name}</h3><code>${item.id}</code></div></div><div class="ix-meta"><span>${item.publisher}</span><span>${item.license}</span><span>Open VSX</span></div><p>${item.description}</p><div class="ix-compatibility"><b>Нужна проверка extension host</b><span>Host API, engines.vscode, зависимости и возможности пакета ещё не проверены в нашем приложении. Совместимость не подтверждена.</span></div><dl class="ix-details"><dt>Версия</dt><dd>Выбрать совместимую при подключении; проверенной версии пока нет.</dd><dt>Требования</dt><dd>${item.scope}</dd><dt>Статус</dt><dd>${plan?'В плане установки · не загружено, не установлено':'Доступно для добавления в план'}</dd></dl><div class="ix-actions">${plan?button('remove','Убрать из плана',`data-id="${item.id}"`):button('add','Добавить в план',`data-id="${item.id}"`)}${plan?button('configure','Настройки проекта',`data-id="${item.id}"`):''}${button('agent','Обсудить с агентом',`data-id="${item.id}"`)}</div><details class="ix-origin"><summary>Источник и ограничения</summary><p><a href="${item.url}" target="_blank" rel="noopener noreferrer">Запись Open VSX</a></p><p>ID и лицензия сверены 13.10.2026. Наличие в реестре не подтверждает поддержку всех API нашим host. VS Code Marketplace не считается доступным источником по умолчанию.</p></details>`;
    }
    function refresh(){if(!validOwner())return;const list=field('ix-list'),detail=field('ix-detail');if(list)list.innerHTML=listMarkup();if(detail)detail.innerHTML=detailMarkup();const summary=field('ix-summary');if(summary)summary.innerHTML=renderSummary();api.dialogElement().querySelectorAll('.ix-tabs [data-di]').forEach(node=>{if(node.dataset.di==='ix-catalog'||node.dataset.di==='ix-planned')node.setAttribute('aria-pressed',String(node.dataset.di==='ix-'+tab));if(node.dataset.di==='ix-planned')node.textContent='В плане · '+Object.keys(state().items).length;});}
    function show(options={}){
      const sameOwner=owner===api.ide();owner=api.ide();if(!options.restore||!sameOwner){selected=null;query='';tab='catalog';}
      const capturedOwner=owner,generation=++dialogGeneration;
      const active=()=>api.ide()===capturedOwner&&generation===dialogGeneration;
      const body=`<section class="ix-manager" aria-label="Расширения IDE">${header()}<div class="ix-body"><div class="ix-list" id="ix-list">${listMarkup()}</div><div class="ix-detail" id="ix-detail">${detailMarkup()}</div></div><div class="ix-summary" id="ix-summary" role="status">${renderSummary()}</div></section>`;
      api.dialog('Расширения IDE',body,button('close','Закрыть'),(action,el)=>{if(active())handle(action,el);});
      const search=field('ix-search');search.addEventListener('input',()=>{if(!active())return;query=search.value;refresh();});
      field('ix-source').addEventListener('change',event=>{if(!active())return;state().source=event.target.value;selected=null;refresh();});
      api.dialogElement().classList.add('ix-dialog');
      const dialog=api.dialogElement();dialog.addEventListener('close',()=>{if(!dialog.open)dialog.classList.remove('ix-dialog');},{once:true});
    }
    function subdialog(title,body,actions,handler){
      const capturedOwner=api.ide(),generation=++dialogGeneration;
      api.dialogElement().classList.remove('ix-dialog');
      api.dialog(title,body,actions,(action,el)=>{if(api.ide()!==capturedOwner||generation!==dialogGeneration)return;handler(action,el);});
    }
    function configure(id){
      const plan=state().items[id],item=byId(id);if(!plan||!item)return;
      subdialog('Настройки · '+item.name,`<p>${esc(api.project())} · настройки будут применены после проверки и установки расширения.</p><label>Workspace settings (JSON)<textarea id="ix-settings" spellcheck="false">${esc(JSON.stringify(plan.settings||{},null,2))}</textarea></label><label class="di-check"><input type="checkbox" id="ix-enable" ${plan.enableAfterValidation?'checked':''}> Включить после подтверждения совместимости</label><p id="ix-config-error" class="ix-error" role="status"></p><p>Схема параметров берётся из манифеста конкретной версии. На этапе макета проверяется только корректность JSON-объекта.</p>`,button('save-config','Сохранить')+button('return','К списку'),action=>{
        if(action==='ix-return'){show({restore:true});return;}if(action!=='ix-save-config')return;
        let settings;try{settings=JSON.parse(field('ix-settings').value);if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error();}catch{field('ix-config-error').textContent='Нужен JSON-объект, например {"setting": true}.';return;}
        plan.settings=settings;plan.enableAfterValidation=field('ix-enable').checked;show({restore:true});selected=id;tab='planned';refresh();
      });
    }
    function host(){subdialog('Как будут работать расширения',`<div class="ix-host-step"><b>1. Выбрать host на проверяемом прототипе</b><p>Theia или совместимая оболочка на Code-OSS могут предоставить extension API. Простое встраивание Monaco этого не даёт.</p></div><div class="ix-host-step"><b>2. Проверить каждый пакет</b><p>engines.vscode, entrypoints main/browser, runtime dependencies, Node/native modules, webviews, terminal / debug / workspace API и лицензия.</p></div><div class="ix-host-step"><b>3. Установить проверенную версию</b><p>Зафиксировать ID, источник, версию, digest и отчёт smoke-проверки Java / Python / frontend. Только тогда состояние изменится на «Установлено».</p></div><p>Сейчас расширения не скачиваются и не запускаются. План относится к выбранному проекту.</p>`,button('host-agent','Передать проверку агенту')+button('return','К списку'),a=>{if(a==='ix-return')show();if(a==='ix-host-agent'){api.closeDialog();api.ask('Проведи compatibility spike extension host для IDE проекта '+api.project()+'. Сравни Theia / Code-OSS, проверь Open VSX packages из очереди, совместимость engines.vscode и API, лицензии и smoke Java/Python/frontend. Monaco без extension host не считать поддержкой VS Code расширений. План: '+JSON.stringify(state().items));}});}
    function vsix(){subdialog('Локальный VSIX',`<p>В итоговом приложении здесь будет выбор локального .vsix. Макет не загружает и не исполняет пакеты.</p><ol><li>Прочитать манифест, ID, версию, engines.vscode, main/browser, зависимости, лицензию и источник пакета.</li><li>Сверить digest и совместимость с выбранным host; определить нужные platform / architecture.</li><li>Добавить пакет в план. Установка и запуск — отдельные подтверждённые состояния с журналом ошибки и возможностью отката.</li></ol><p>Файл VSIX не даёт автоматически право перераспространять пакет и не гарантирует совместимость. Корпоративный реестр хранит проверенные версии и правила обновления.</p>`,button('return','К списку'),a=>{if(a==='ix-return')show();});}
    function handle(action,el){
      if(!validOwner()){api.closeDialog();return;}
      const id=el?.dataset?.id,item=byId(id);
      if(action==='ix-close'){api.closeDialog();return;}
      if(action==='ix-open'){selected=id;refresh();return;}
      if(action==='ix-catalog'||action==='ix-planned'){tab=action==='ix-catalog'?'catalog':'planned';selected=null;refresh();return;}
      if(action==='ix-clear-search'){query='';field('ix-search').value='';refresh();return;}
      if(action==='ix-add'&&item){state().items[id]={id,source:'openvsx',sourceURL:item.url,status:'planned',version:null,enableAfterValidation:true,settings:{}};refresh();return;}
      if(action==='ix-remove'&&item){delete state().items[id];refresh();return;}
      if(action==='ix-configure'){configure(id);return;}
      if(action==='ix-agent'&&item){api.closeDialog();api.ask('Для IDE проекта '+api.project()+' проверь и адаптируй расширение '+item.id+' из '+item.url+'. Лицензия по каталогу '+item.license+'. Выбери совместимую версию по engines.vscode и extension-host API, проверь зависимости, затем выполни smoke тесты. Сейчас пакет только спланирован; не установлен. '+item.scope);return;}
      if(action==='ix-host'){host();return;}
      if(action==='ix-vsix'){vsix();return;}
      if(action==='ix-save-source'){const input=field('ix-corporate-url');try{const url=new URL(input.value.trim());if(url.protocol!=='https:'||url.username||url.password)throw Error();state().corporateURL=url.href;input.setCustomValidity('');const summary=field('ix-summary');summary.textContent='Адрес сохранён для проекта. Подключение ещё не выполнялось.';}catch{input.setCustomValidity('Укажите HTTPS URL без логина и пароля в адресе.');input.reportValidity();}return;}
      if(action==='ix-source-agent'){const url=state().corporateURL;api.closeDialog();api.ask('Адаптируй корпоративный каталог расширений для IDE проекта '+api.project()+'. '+(url?'Адрес: '+url+'. ':'Адрес ещё не настроен. ')+'Определи протокол каталога, способ авторизации через настройки подключения, совместимые версии и политики обновления. В макете подключения к реестру не было.');}
    }
    return {show,state};
  }
  window.SuiteIDEExtensions={create,catalog};
})();
