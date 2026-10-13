/* IDE language workflows — local, interactive fixtures; no compiler, process or LSP is started. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons = {
    run:'<path d="m8 5 11 7-11 7Z"/>', stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
    debug:'<rect x="8" y="7" width="8" height="12" rx="4"/><path d="m9 4 3 3 3-3M4 10h4m8 0h4M4 15h4m8 0h4M7 21l2-3m6 0 2 3M12 8v10"/>',
    test:'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8"/>',
    settings:'<path d="M4 7h16M4 17h16"/><rect x="7" y="4" width="4" height="6" rx="1"/><rect x="14" y="14" width="4" height="6" rx="1"/>',
    next:'<path d="m7 6 8 6-8 6M18 5v14"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', agent:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'
  };
  const icon = name => `<svg class="icon sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.settings}</svg>`;
  const btn = (action,label,attrs='') => `<button type="button" class="di-button" data-di="il-${action}" ${attrs}>${label}</button>`;
  const ibtn = (action,name,label,attrs='') => btn(action,icon(name),`aria-label="${esc(label)}" title="${esc(label)}" ${attrs}`);
  const catalog = {
    java:{label:'Java',service:'java',entry:'backend/PaymentService.java',root:'backend',manifest:'backend/pom.xml',engine:'JDT LS · Java DAP',defaultConfig:'java-test',
      configs:[{id:'java-spring',name:'Spring Boot · payments',kind:'spring',entry:'backend/PaymentSpringApplication.java'},{id:'java-test',name:'JUnit · PaymentService',kind:'test',entry:'backend/src/test/java/com/atlas/payments/PaymentServiceTest.java'}, {id:'java-build',name:'Сборка backend',kind:'build',entry:'backend/pom.xml'},{id:'java-run',name:'PaymentService · запуск',kind:'run',entry:'backend/PaymentApplication.java'},{id:'java-goal',name:'Maven · выбранная цель',kind:'goal',entry:'backend/pom.xml'}],
      tests:[['java-total','Точно сохраняет сумму','backend/PaymentService.java',7],['java-null','Отклоняет null','backend/PaymentService.java',6],['java-negative','Отклоняет отрицательную сумму','backend/PaymentService.java',6]],
      dependencies:[['org.springframework.boot:spring-boot-starter-web','3.4.1','compile'],['org.springframework.boot:spring-boot-starter-actuator','3.4.1','compile'],['org.junit.jupiter:junit-jupiter','5.11.4','test'],['maven-compiler-plugin','3.13.0','build'],['maven-surefire-plugin','3.5.2','build']],
      steps:[6,7,8], variables:[['amount','12.50'],['currency','RUB'],['result','12.50']]},
    python:{label:'Python',service:'python',entry:'scripts/verify_import.py',root:'scripts',manifest:'scripts/pyproject.toml',engine:'Python LSP · debugpy',defaultConfig:'python-test',
      configs:[{id:'python-test',name:'pytest · импорт данных',kind:'test',entry:'scripts/tests/test_verify_import.py'},{id:'python-run',name:'verify_import.py',kind:'run',entry:'scripts/verify_import.py'},{id:'python-lint',name:'Ruff · проверки',kind:'lint',entry:'scripts/pyproject.toml'}],
      tests:[['python-decimal','Decimal без потери точности','scripts/verify_import.py',4],['python-empty','Пустой набор возвращает Decimal(0)','scripts/verify_import.py',4],['python-invalid','Некорректная сумма отклоняется','scripts/verify_import.py',4]],
      dependencies:[['pytest','8.3.4','test'],['ruff','0.9.1','dev'],['debugpy','1.8.12','debug']],
      steps:[3,4,7],variables:[['rows',"[{'amount': '12.50'}]"],['total',"Decimal('12.50')"],['len(rows)','1']]},
    frontend:{label:'Frontend',service:'ts',entry:'src/Checkout.tsx',debugEntry:'src/checkout.ts',root:'.',manifest:'package.json',engine:'TypeScript · React · Vite',defaultConfig:'web-test',
      configs:[{id:'web-dev',name:'Vite · dev server',kind:'server',entry:'src/Checkout.tsx'},{id:'web-test',name:'Vitest · retry / checkout',kind:'test',entry:'tests/retry-policy.test.ts'},{id:'web-typecheck',name:'TypeScript · типы',kind:'typecheck',entry:'tsconfig.json'},{id:'web-lint',name:'ESLint · проверки',kind:'lint',entry:'src/Checkout.tsx'},{id:'web-build',name:'Production build',kind:'build',entry:'vite.config.ts'},{id:'web-e2e',name:'Playwright · checkout',kind:'e2e',entry:'tests/checkout.spec.ts'}],
      tests:[['web-success','Успешный ответ возвращается','src/checkout.ts',4],['web-http','HTTP 429 распознаётся как ошибка','src/checkout.ts',5],['web-pending','Кнопка блокируется во время запроса','src/Checkout.tsx',6]],
      dependencies:[['react','19.0.0','runtime'],['typescript','5.7.3','dev'],['vite','6.0.7','dev'],['vitest','2.1.8','test']],
      steps:[4,5,7],variables:[['orderId','ord_91c2'],['response.status','429'],['response.ok','false']]}
  };
  // Explicit versions below are demonstration manifest data, not recommendations or vulnerability verdicts.
  const seedFiles = {
    java:{
      'backend/pom.xml':'<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.atlas</groupId>\n  <artifactId>payments</artifactId>\n  <version>0.1.0</version>\n  <properties><maven.compiler.release>21</maven.compiler.release></properties>\n  <dependencies>\n    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.11.4</version><scope>test</scope></dependency>\n  </dependencies>\n  <build>\n    <sourceDirectory>.</sourceDirectory>\n    <testSourceDirectory>src/test/java</testSourceDirectory>\n    <plugins>\n      <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version><configuration><excludes><exclude>src/test/**</exclude><exclude>target/**</exclude></excludes></configuration></plugin>\n      <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.2</version></plugin>\n      <plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version></plugin>\n    </plugins>\n  </build>\n</project>\n',
      'backend/build.gradle.kts':'plugins { java; application }\nrepositories { mavenCentral() }\njava { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }\nsourceSets {\n    main { java.setSrcDirs(listOf(".")); java.exclude("src/test/**", "build/**", "target/**") }\n    test { java.setSrcDirs(listOf("src/test/java")) }\n}\ndependencies { testImplementation("org.junit.jupiter:junit-jupiter:5.11.4") }\ntasks.test { useJUnitPlatform() }\napplication { mainClass.set("com.atlas.payments.PaymentApplication") }\n',
      'backend/PaymentApplication.java':'package com.atlas.payments;\n\nimport java.math.BigDecimal;\n\npublic class PaymentApplication {\n    public static void main(String[] args) {\n        var service = new PaymentService();\n        System.out.println(service.total(new BigDecimal("12.50")));\n    }\n}\n',
      'backend/src/test/java/com/atlas/payments/PaymentServiceTest.java':'package com.atlas.payments;\n\nimport org.junit.jupiter.api.Test;\nimport java.math.BigDecimal;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass PaymentServiceTest {\n    @Test void rejectsNull() {\n        assertThrows(IllegalArgumentException.class, () -> new PaymentService().total(null));\n    }\n    @Test void rejectsNegative() {\n        assertThrows(IllegalArgumentException.class, () -> new PaymentService().total(new BigDecimal("-1")));\n    }\n    @Test void preservesPrecision() {\n        assertEquals(new BigDecimal("12.50"), new PaymentService().total(new BigDecimal("12.50")));\n    }\n}\n'
    },
    python:{
      'scripts/pyproject.toml':'[project]\nname = "atlas-import"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n\n[project.optional-dependencies]\ndev = ["pytest==8.3.4", "ruff==0.9.1", "debugpy==1.8.12"]\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\npythonpath = ["."]\n\n[tool.ruff]\nline-length = 100\n',
      'scripts/tests/test_verify_import.py':'from decimal import Decimal\nfrom verify_import import verify_total\n\ndef test_total_is_decimal():\n    assert verify_total([{"amount": "12.50"}]) == Decimal("12.50")\n\ndef test_empty_total_is_decimal():\n    assert isinstance(verify_total([]), Decimal)\n',
      'scripts/requirements-dev.txt':'pytest==8.3.4\nruff==0.9.1\ndebugpy==1.8.12\n'
    },
    frontend:{
      'package.json':'{\n  "name": "atlas-ui",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc -b && vite build",\n    "typecheck": "tsc --noEmit",\n    "lint": "eslint src",\n    "test": "vitest run",\n    "test:e2e": "playwright test"\n  },\n  "dependencies": { "react": "19.0.0" },\n  "devDependencies": { "typescript": "5.7.3", "vite": "6.0.7", "vitest": "2.1.8" }\n}\n',
      'tsconfig.json':'{\n  "compilerOptions": {\n    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",\n    "jsx": "react-jsx", "strict": true, "noEmit": true\n  },\n  "include": ["src", "tests"]\n}\n',
      'vite.config.ts':"import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  server: { host: '127.0.0.1', port: 5173 },\n  build: { sourcemap: true },\n});\n",
      'tests/checkout.spec.ts':"import { test, expect } from '@playwright/test';\n\ntest('shows pending state', async ({ page }) => {\n  await page.goto('http://127.0.0.1:5173');\n  await page.getByRole('button', { name: 'Continue' }).click();\n  await expect(page.getByRole('button', { name: 'Processing…' })).toBeDisabled();\n});\n"
    }
  };
  // Spring fixture extends the same payments module; it does not create a parallel workspace.
  seedFiles.java['backend/pom.xml']=seedFiles.java['backend/pom.xml']
    .replace('  <dependencies>','  <dependencyManagement><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>3.4.1</version><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement>\n  <dependencies>\n    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>\n    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-actuator</artifactId></dependency>')
    .replace('    <plugins>','    <plugins>\n      <plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId><version>3.4.1</version><configuration><mainClass>com.atlas.payments.PaymentSpringApplication</mainClass></configuration></plugin>')
    .replace('</project>','  <profiles>\n    <profile><id>dev</id><properties><spring-boot.run.profiles>dev</spring-boot.run.profiles></properties></profile>\n    <profile><id>ift</id><properties><spring-boot.run.profiles>ift</spring-boot.run.profiles></properties></profile>\n  </profiles>\n</project>');
  seedFiles.java['backend/build.gradle.kts']=seedFiles.java['backend/build.gradle.kts']
    .replace('plugins { java; application }','plugins { java; application; id("org.springframework.boot") version "3.4.1" }')
    .replace('dependencies {','dependencies {\n    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.4.1"))\n    implementation("org.springframework.boot:spring-boot-starter-web")\n    implementation("org.springframework.boot:spring-boot-starter-actuator")\n')
    .replace('mainClass.set("com.atlas.payments.PaymentApplication")','mainClass.set("com.atlas.payments.PaymentSpringApplication")');
  seedFiles.java['backend/PaymentSpringApplication.java']='package com.atlas.payments;\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\nimport org.springframework.context.annotation.Bean;\n\n@SpringBootApplication\npublic class PaymentSpringApplication {\n    public static void main(String[] args) {\n        SpringApplication.run(PaymentSpringApplication.class, args);\n    }\n\n    @Bean\n    PaymentService paymentService() {\n        return new PaymentService();\n    }\n}\n';
  seedFiles.java['backend/PaymentController.java']='package com.atlas.payments;\n\nimport java.math.BigDecimal;\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RequestParam;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\npublic class PaymentController {\n    private final PaymentService payments;\n\n    public PaymentController(PaymentService payments) {\n        this.payments = payments;\n    }\n\n    @GetMapping("/api/payments/total")\n    public BigDecimal total(@RequestParam BigDecimal amount) {\n        return payments.total(amount);\n    }\n}\n';
  seedFiles.java['backend/src/main/resources/application.yml']='spring:\n  application:\n    name: payments\n  profiles:\n    default: dev\nserver:\n  port: 8080\nmanagement:\n  endpoints:\n    web:\n      exposure:\n        include: health,info\n';
  seedFiles.java['backend/src/main/resources/application-dev.yml']='logging:\n  level:\n    com.atlas.payments: DEBUG\n';
  seedFiles.java['backend/src/main/resources/application-ift.yml']='logging:\n  level:\n    com.atlas.payments: INFO\n';
  const clone = value => JSON.parse(JSON.stringify(value));
  function initialState(kind){
    return {kind,config:catalog[kind].defaultConfig,settings:{runtime:kind==='java'?'JDK 21':kind==='python'?'Python 3.12':'Node.js 22',path:kind==='java'?'C:\\Program Files\\Java\\jdk-21':kind==='python'?'.\\.venv\\Scripts\\python.exe':'node.exe',manager:kind==='java'?'maven':kind==='python'?'pip':'npm',cwd:catalog[kind].root,platform:'windows',args:'',env:'local',timeout:60},mavenGoal:'verify',mavenProfile:'',springProfile:'dev',offline:false,skipTests:false,ready:kind==='frontend',imported:kind==='frontend',scenario:'source',tab:'environment',generation:0,operation:null,console:[],tests:[],filter:'all',selectedTest:null,debug:null,history:[],configOverrides:{},dependencyFilter:'',notice:'',seeded:false};
  }
  const needsQuote = value => /[\s'"&|;<>$`(){}\[\]*?!#~]/.test(value);
  const quote = (value,win=true) => needsQuote(value) ? "'"+value.replaceAll("'",win?"''":"'\\''")+"'" : value;
  function commandFor(kind,state,configKey){
    const config=catalog[kind].configs.find(c=>c.id===configKey)||catalog[kind].configs[0],s=state.settings,win=s.platform==='windows';
    const effectiveKind=config.kind==='goal'&&state.mavenGoal==='test'?'test':config.kind;
    let command;
    if(kind==='java'){
      const wrapper=s.manager==='gradle'?(win?'.\\gradlew.bat':'./gradlew'):(win?'.\\mvnw.cmd':'./mvnw');
      const target=s.manager==='gradle'?{test:'test',build:'build',run:'run',spring:'bootRun --args='+quote('--spring.profiles.active='+(state.springProfile||'dev'),win),goal:state.mavenGoal||'build'}:{test:'test -Dtest=PaymentServiceTest',build:'verify',run:'exec:java -Dexec.mainClass=com.atlas.payments.PaymentApplication',spring:'spring-boot:run -Dspring-boot.run.profiles='+(state.springProfile||'dev'),goal:state.mavenGoal||'verify'};
      command=wrapper+' '+target[config.kind]+(s.manager==='maven'&&state.mavenProfile?' -P'+state.mavenProfile:'')+(state.offline?(s.manager==='gradle'?' --offline':' -o'):'')+(state.skipTests&&['build','goal'].includes(effectiveKind)?s.manager==='gradle'?' -x test':' -DskipTests':'');
    } else if(kind==='python'){
      const interpreter=s.path||'python';
      command=(win&&needsQuote(interpreter)?'& ':'')+quote(interpreter,win)+' '+({test:'-m pytest tests -v',lint:'-m ruff check .',run:'verify_import.py'}[config.kind]);
    } else {
      const manager=s.manager+(win?'.cmd':'');
      command=manager+' run '+({server:'dev',test:'test',typecheck:'typecheck',lint:'lint',build:'build',e2e:'test:e2e'}[config.kind]);
    }
    const override=state.configOverrides[config.id]||{};
    return {command:command+(override.args?' '+override.args:''),cwd:override.cwd||s.cwd,kind:effectiveKind,entry:config.entry,id:config.id,name:override.name||config.name,env:override.env||s.env};
  }
  function importCommandFor(kind,state){
    const s=state.settings,win=s.platform==='windows';let command;
    if(kind==='java')command=s.manager==='gradle'?(win?'.\\gradlew.bat projects':'./gradlew projects'):(win?'.\\mvnw.cmd dependency:resolve':'./mvnw dependency:resolve');
    else if(kind==='python')command=s.manager==='uv'?'uv sync --extra dev':(win&&needsQuote(s.path)?'& ':'')+quote(s.path,win)+' -m pip install -r requirements-dev.txt';
    else command=s.manager+(win?'.cmd':'')+' install';
    return {id:'import',name:'Подготовка '+catalog[kind].label,cwd:s.cwd,command,kind:'import'};
  }
  function evaluateTests(kind,files,scenario='source'){
    return catalog[kind].tests.map(([id,name,path,line],index)=>{
      const source=files[path];let pass=typeof source==='string',detail=pass?'Условие учебного сценария выполнено.':'Файл отсутствует в текущем проекте.';
      if(pass&&kind==='java'){
        if(index===0)pass=source.includes('BigDecimal')&&source.includes('return amount');
        if(index===1){pass=/amount\s*==\s*null|requireNonNull\(amount/.test(source);detail=pass?'Проверка null найдена в текущем буфере.':'Ожидалось исключение для null; PaymentService возвращает null.';}
        if(index===2){pass=/signum\(\)\s*<\s*0|compareTo\(BigDecimal.ZERO\)\s*<\s*0/.test(source);detail=pass?'Проверка отрицательного значения найдена.':'Отрицательная сумма проходит без проверки.';}
      }
      if(pass&&kind==='python'){
        if(index===0)pass=source.includes('Decimal(')&&!source.includes('float(');
        if(index===1){pass=/sum\([\s\S]*,\s*(?:start\s*=\s*)?Decimal\(['"]0['"]\)\s*\)/.test(source);detail=pass?'У sum указан начальный Decimal(0).':'sum для пустого набора возвращает int 0, ожидался Decimal.';}
        if(index===2)pass=source.includes('Decimal(');
      }
      if(pass&&kind==='frontend'){
        if(index===0)pass=source.includes('executeWithRetry');
        if(index===1){pass=/\b(response|res)\.ok/.test(source);detail=pass?'Проверка HTTP-статуса найдена в буфере.':'fetch разрешает Promise при HTTP 429; response.ok не проверяется.';}
        if(index===2)pass=/disabled\s*=\s*\{pending\}/.test(source);
      }
      if(scenario==='assertion'&&index===1){pass=false;detail='Принудительный сценарий: assertion failed. Выберите «По текущему коду», чтобы повторить без инъекции ошибки.';}
      return {id,name,path,line,status:pass?'passed':'failed',detail,duration:18+index*13,evaluatedSource:source??null};
    });
  }
  const statusLabel = status => ({running:'Выполняется',passed:'Успех',failed:'Ошибка',cancelled:'Остановлен',ready:'Готово',paused:'Пауза',server:'Работает',blocked:'Нужна настройка'}[status]||'Не запускался');
  function create(api){
    const root=api.root,timers=new Map();let dialogOwner=null;
    if(!document.getElementById('il-styles')){const link=document.createElement('link');link.id='il-styles';link.rel='stylesheet';link.href='suite-prototype-ide-languages.css';document.head.append(link);}
    function workbench(owner=api.ide()){
      if(!owner.languageWorkbench)owner.languageWorkbench={selected:owner.active?.endsWith('.java')?'java':owner.active?.endsWith('.py')?'python':'frontend',profiles:{java:initialState('java'),python:initialState('python'),frontend:initialState('frontend')}};
      return owner.languageWorkbench;
    }
    const state = () => workbench().profiles[workbench().selected];
    const profile = () => catalog[workbench().selected];
    const current = (owner,st) => api.ide()===owner&&state()===st;
    const rerender = (owner,st) => {if(current(owner,st))api.render();};
    const operationBusy = st => st.operation&&['running','server','paused'].includes(st.operation.status);
    function syncAggregate(owner){
      owner.running=Object.values(workbench(owner).profiles).some(operationBusy);
      owner.debug=Object.values(workbench(owner).profiles).some(p=>p.debug&&['running','paused'].includes(p.debug.status));
    }
    function seed(kind){
      const owner=api.ide(),st=workbench(owner).profiles[kind];if(st.seeded)return;
      const files=api.files();Object.entries(seedFiles[kind]).forEach(([path,source])=>{if(!Object.hasOwn(files,path)){files[path]=source;owner.saved[path]=source;}});st.seeded=true;
    }
    function select(kind){
      if(!Object.hasOwn(catalog,kind))return;
      const owner=api.ide();workbench(owner).selected=kind;owner.languageActive=catalog[kind].service;seed(kind);owner.bottom='toolchain';owner.bottomCollapsed=false;
      owner.status=catalog[kind].label+' · учебные файлы добавлены только в макет; существующие буферы сохранены.';
      const path=catalog[kind].entry;if(Object.hasOwn(api.files(),path))api.openFile(path);else api.render();
    }
    function toolbar(){
      const st=state(),kind=workbench().selected,p=catalog[kind],busy=operationBusy(st);
      return `<div class="di-bar il-workbar" aria-label="Среда разработки и запуск"><select id="il-language" aria-label="Стек разработки">${Object.entries(catalog).map(([key,value])=>`<option value="${key}" ${key===kind?'selected':''}>${value.label}</option>`).join('')}</select><span class="il-separator"></span><select id="il-run-config" aria-label="Конфигурация запуска ${p.label}">${p.configs.map(c=>`<option value="${c.id}" ${st.config===c.id?'selected':''}>${esc(st.configOverrides[c.id]?.name||c.name)}</option>`).join('')}</select>${ibtn(busy?'stop':'run',busy?'stop':'run',busy?'Остановить текущий запуск':'Запустить выбранную конфигурацию')}${ibtn('debug','debug','Отладка '+p.label,busy?'disabled':'')}${ibtn('tests','test','Запустить тесты '+p.label,busy?'disabled':'')}<span class="di-spacer"></span>${btn('environment',`<span class="il-dot ${st.ready?'ready':''}"></span><span class="il-env-label">${esc(st.ready?st.settings.runtime:'Настроить среду')}</span>`,`aria-label="Среда ${p.label}: ${st.ready?'настроена':'требует настройки'}" title="Среда разработки"`)}${ibtn('config','settings','Настроить запуск')}</div>`;
    }
    function empty(title,text,action,label){return `<div class="il-empty"><b>${esc(title)}</b><span>${esc(text)}</span>${action?btn(action,label):''}</div>`;}
    function environmentMarkup(st,kind){
      const p=catalog[kind],manager=st.settings.manager,busy=operationBusy(st),manifest=kind==='java'&&manager==='gradle'?'backend/build.gradle.kts':p.manifest;
      return `<div class="il-heading"><div><strong>${p.label} · ${esc(api.project())}</strong><span>${p.engine} · демонстрация состояния</span></div>${btn('configure','Настроить')}${btn('import',kind==='java'?'Импортировать проект':kind==='python'?'Подготовить окружение':'Установить зависимости',busy?'disabled':'')}</div><div class="il-environment-grid"><div><span class="il-label">${kind==='java'?'JDK / build JVM':kind==='python'?'Интерпретатор':'Node runtime'}</span><b>${esc(st.settings.runtime)}</b><code>${esc(st.settings.path)}</code></div><div><span class="il-label">${kind==='java'?'Сборка и модули':kind==='python'?'Окружение и пакеты':'Package manager / TypeScript'}</span><b>${esc(kind==='java'?manager==='maven'?'Maven wrapper · payments':'Gradle wrapper · payments':kind==='python'?manager==='uv'?'uv · .venv':'pip · .venv':manager+' · workspace TypeScript')}</b>${btn('manifest',esc(manifest),`title="Открыть ${esc(manifest)}"`)}</div><div><span class="il-label">Состояние</span><b class="${st.ready?'il-success':'il-warning'}">${busy&&st.operation.kind==='import'?'Подготовка…':st.ready?'Среда готова в макете':'Требуется настройка'}</b><span>${st.imported?'Модули и зависимости импортированы':'Импорт ещё не выполнялся'}</span></div></div><div class="il-options"><label>Сценарий<select id="il-scenario" aria-label="Сценарий запуска"><option value="source" ${st.scenario==='source'?'selected':''}>По текущему коду</option><option value="assertion" ${st.scenario==='assertion'?'selected':''}>Ошибка теста</option><option value="dependency" ${st.scenario==='dependency'?'selected':''}>Недоступен репозиторий пакетов</option><option value="toolchain" ${st.scenario==='toolchain'?'selected':''}>Runtime не найден</option></select></label>${btn('dependencies','Зависимости')}${kind==='java'?btn('maven',st.settings.manager==='gradle'?'Gradle':'Maven')+btn('spring','Spring'):''}${btn('agent',icon('agent')+'Обсудить среду')}</div>${st.notice?`<p class="il-callout" role="status">${esc(st.notice)}</p>`:''}<p class="di-caption">Команды и версии показаны для макета. Реальные JDK, Python, Node и языковые серверы здесь не запускаются.</p>`;
    }
    function outputMarkup(st,kind){
      const op=st.operation,command=op?.command||commandFor(kind,st,st.config);
      return `<div class="il-heading"><div><strong>${esc(command.name)}</strong><span>${op?statusLabel(op.status):'Ещё не запускалась'} · ${esc(command.cwd)} · ${esc(st.settings.platform==='windows'?'Windows / PowerShell 5.1':'POSIX shell')}</span></div>${op&&operationBusy(st)?btn('stop',icon('stop')+'Стоп'):btn('run-again',icon('run')+'Повторить')}${btn('agent',icon('agent'),'aria-label="Передать результат агенту" title="Передать результат агенту"')}</div><pre class="di-mono il-command" data-language="powershell">${esc(command.command)}</pre>${st.console.length?`<pre class="di-mono il-console" data-language="log" aria-live="polite">${esc(st.console.join('\n'))}</pre>`:'<p class="di-caption">Запустите конфигурацию или тесты. Результат появится здесь.</p>'}${op?.status==='server'?`<div class="il-actions">${btn('preview',kind==='java'?'Spring · endpoints':'Открыть preview')}${btn('debug','Перейти к отладке')}</div>`:''}${op?.status==='blocked'||(op?.status==='failed'&&['dependency','toolchain'].includes(st.scenario))?`<div class="il-actions">${btn('environment','Проверить среду')}${btn('configure','Изменить настройки')}${btn('recover','Снять сбой и повторить')}</div>`:''}${st.history.length?`<details class="il-history"><summary>История · ${st.history.length}</summary>${st.history.slice().reverse().map(h=>`<div><span class="il-state ${h.status}">${statusLabel(h.status)}</span><span>${esc(h.name)}</span><small>${esc(h.elapsed)}</small></div>`).join('')}</details>`:''}`;
    }
    function testsMarkup(st,kind){
      const stale=t=>['passed','failed'].includes(t.status)&&t.evaluatedSource!==(api.files()[t.path]??null);
      const outdated=st.tests.filter(stale).length,passed=st.tests.filter(t=>t.status==='passed'&&!stale(t)).length,failed=st.tests.filter(t=>t.status==='failed').length,busy=operationBusy(st),items=st.tests.filter(t=>st.filter!=='failed'||t.status==='failed');
      return `<div class="il-heading"><div><strong>${kind==='java'?'JUnit':kind==='python'?'pytest':st.operation?.kind==='e2e'?'Playwright':'Vitest'}</strong><span>${st.tests.length?`${passed} успешно · ${failed} с ошибкой${outdated?' · '+outdated+' устарело':''}`:'Тесты ещё не запускались'}</span></div>${btn('tests','Все',busy?'disabled':'')}${btn('test-failed','Повторить упавшие',busy||!failed?'disabled':'')}${btn('coverage','Coverage')}</div>${outdated?'<p class="il-stale-notice" role="status">Код изменён после проверки. Повторите тесты: предыдущий результат не подтверждает текущий буфер.</p>':''}<div class="il-test-filters">${btn('filter-all','Все',`aria-pressed="${st.filter==='all'}"`)}${btn('filter-failed','С ошибкой · '+failed,`aria-pressed="${st.filter==='failed'}"`)}<span class="di-caption">Проверки учебного буфера · ${esc(catalog[kind].label)}</span></div>${items.length?items.map(t=>`<button type="button" class="il-test" data-di="il-test-detail" data-id="${t.id}"><span class="il-test-icon ${stale(t)?'stale':t.status}">${stale(t)?'◷':t.status==='passed'?'✓':t.status==='failed'?'×':t.status==='running'?'◌':'—'}</span><span><b>${esc(t.name)}</b><small>${esc(t.path)}:${t.line}${stale(t)?' · код изменён':''}</small></span><span class="il-test-duration">${stale(t)?'Повторить':t.status==='running'?'Выполняется':t.status==='cancelled'?'Остановлен':t.duration+' мс'}</span></button>`).join(''):empty(st.filter==='failed'?'Нет упавших тестов':'Один запуск — виден весь результат',st.filter==='failed'?'Измените фильтр или запустите тесты.':'Ошибки ведут к строке кода и исправлению с предпросмотром.',st.filter==='failed'?'filter-all':'tests',st.filter==='failed'?'Показать все':'Запустить тесты')}<p class="di-caption">Это не JUnit / pytest / Vitest runner: результат воспроизводится по условиям демонстрационного исходника. Coverage без реального отчёта не вычисляется.</p>`;
    }
    function debugMarkup(st,kind){
      const d=st.debug;if(!d)return empty('Отладка '+catalog[kind].label,'Точки останова привязаны к файлам. Запуск сохраняет исходный файл, стек и конфигурацию.','debug','Начать отладку');
      const paused=d.status==='paused';
      return `<div class="il-heading"><div><strong>${paused?'Пауза на breakpoint':d.status==='finished'?'Отладка завершена':'Продолжение…'}</strong><span>${esc(d.path)}:${d.line} · ${catalog[kind].engine}</span></div>${ibtn('debug-step','next','Шаг с обходом',paused?'':'disabled')}${ibtn('debug-resume','run','Продолжить отладку',paused?'':'disabled')}${ibtn('stop','stop','Остановить отладку',d.status==='finished'?'disabled':'')}</div><div class="il-debug-grid"><section><span class="il-label">Стек вызовов</span><button class="il-stack" type="button" data-di="il-debug-source">${esc(kind==='java'?'PaymentService.total':kind==='python'?'verify_total':'checkout')}<small>${esc(d.path.split('/').pop())}:${d.line}</small></button><div class="il-stack secondary">${kind==='java'?'PaymentServiceTest':kind==='python'?'test_total_is_decimal':'retry-policy.test'}<small>fixture frame · 1</small></div></section><section><span class="il-label">Переменные</span>${d.variables.map(([name,value])=>`<div class="il-variable"><code>${esc(name)}</code><span>${esc(value)}</span></div>`).join('')}</section></div><div class="il-options">${btn('watch','Добавить watch')}${btn('evaluate','Вычислить выражение')}${btn('debug-source','К текущей строке')}${btn('agent',icon('agent')+'Разобрать с агентом')}</div>${d.watches.length?`<div class="il-watches">${d.watches.map(w=>`<div><code>${esc(w.name)}</code><span>${esc(w.value)}</span>${btn('remove-watch','×',`data-name="${esc(w.name)}" aria-label="Удалить watch ${esc(w.name)}"`)}</div>`).join('')}</div>`:''}`;
    }
    function bottom(){
      const st=state(),kind=workbench().selected,key=api.ide().bottom;
      if(key==='toolchain')return environmentMarkup(st,kind);
      if(key==='output')return outputMarkup(st,kind);
      if(key==='tests')return testsMarkup(st,kind);
      if(key==='debug')return debugMarkup(st,kind);
      return null;
    }
    function showDialog(title,body,actions,handler){
      const owner=api.ide(),st=state();dialogOwner={owner,st};
      api.dialog(title,body,actions,(action,el,event)=>{if(api.ide()!==owner||state()!==st){api.closeDialog();return;}handler(action,el,event);});
    }
    const field = id => api.dialogElement().querySelector('#'+id);
    function configure(){
      const st=state(),kind=workbench().selected,s=st.settings;
      const runtimes=kind==='java'?['JDK 21','JDK 17']:kind==='python'?['Python 3.12','Python 3.11','Python 3.13']:['Node.js 22','Node.js 24'];
      const managers=kind==='java'?[['maven','Maven wrapper'],['gradle','Gradle wrapper']]:kind==='python'?[['pip','pip + venv'],['uv','uv + venv']]:[['npm','npm'],['pnpm','pnpm'],['yarn','Yarn']];
      showDialog('Среда · '+catalog[kind].label,`<p>Настройки относятся к проекту ${esc(api.project())}. В макете сохраняется выбор, системные компоненты не устанавливаются.</p><div class="di-columns"><label>Runtime<select id="il-setting-runtime">${runtimes.map(v=>`<option ${v===s.runtime?'selected':''}>${v}</option>`).join('')}</select></label><label>Целевая система<select id="il-setting-platform"><option value="windows" ${s.platform==='windows'?'selected':''}>Windows / PowerShell 5.1</option><option value="posix" ${s.platform==='posix'?'selected':''}>Linux / macOS</option></select></label></div><label>${kind==='java'?'Путь JAVA_HOME':kind==='python'?'Интерпретатор выбранного окружения':'Node executable'}<input id="il-setting-path" value="${esc(s.path)}" placeholder="${kind==='python'?'.\\.venv\\Scripts\\python.exe':'Путь к runtime'}"></label><div class="di-columns"><label>Менеджер проекта<select id="il-setting-manager">${managers.map(([key,label])=>`<option value="${key}" ${key===s.manager?'selected':''}>${label}</option>`).join('')}</select></label><label>Рабочая папка<input id="il-setting-cwd" value="${esc(s.cwd)}"></label></div>${kind==='python'?'<p>Новое .venv создаётся из выбранного Python; существующее окружение сохраняется. В продукте путь проверяется запуском interpreter probe, без активации скрипта PowerShell.</p>':kind==='java'?'<p>Build JVM и runtime language server учитываются отдельно. Wrapper берётся из проекта; параметры Maven / Gradle импортируются перед индексацией.</p>':'<p>Lockfile определяет менеджер и версию пакетов. TypeScript берётся из workspace; dev server имеет отдельный управляемый жизненный цикл.</p>'}`,btn('settings-save','Сохранить выбор'),a=>{
        if(a!=='il-settings-save')return;
        const path=field('il-setting-path').value.trim(),cwd=field('il-setting-cwd').value.trim();if(!path||!cwd){const input=field(!path?'il-setting-path':'il-setting-cwd');input.setCustomValidity('Заполните поле.');input.reportValidity();return;}
        if(operationBusy(st))stop(st,api.ide(),'Остановлено перед изменением среды.');
        st.settings={...s,path,cwd,runtime:field('il-setting-runtime').value,manager:field('il-setting-manager').value,platform:field('il-setting-platform').value};st.ready=false;st.imported=false;st.notice='Выбор сохранён. Подготовьте среду, чтобы проверить следующий шаг.';api.closeDialog();api.ide().bottom='toolchain';api.ide().bottomCollapsed=false;api.render();
      });
    }
    function configDialog(){
      const st=state(),kind=workbench().selected,c=commandFor(kind,st,st.config),override=st.configOverrides[st.config]||{};
      showDialog('Конфигурация запуска',`<label>Название<input id="il-config-name" value="${esc(c.name)}"></label><div class="di-columns"><label>Рабочая папка<input id="il-config-cwd" value="${esc(c.cwd)}"></label><label>Окружение<input id="il-config-env" value="${esc(c.env)}"></label></div><label>Дополнительные аргументы<input id="il-config-args" value="${esc(override.args||'')}"></label><div class="il-callout"><b>${catalog[kind].label} · ${c.kind}</b><pre class="di-mono">${esc(c.command)}</pre><span>Имя можно изменить; тип запуска и язык остаются привязаны к конфигурации.</span></div><p>В продукте команда передаётся процессу как executable + argv, без склейки shell-команды. Значения environment здесь обозначают профиль, секреты не сохраняются в макете.</p>`,btn('config-save','Сохранить'),a=>{
        if(a!=='il-config-save')return;
        const name=field('il-config-name').value.trim(),cwd=field('il-config-cwd').value.trim();if(!name||!cwd){const input=field(!name?'il-config-name':'il-config-cwd');input.setCustomValidity('Заполните поле.');input.reportValidity();return;}
        st.configOverrides[st.config]={name,cwd,args:field('il-config-args').value.trim(),env:field('il-config-env').value.trim()||'local'};api.closeDialog();api.render();
      });
    }
    function finish(owner,st,status,lines){
      if(!st.operation)return;
      st.operation.status=status;st.console.push(...lines);st.history.push({name:st.operation.command.name,status,elapsed:((Date.now()-st.operation.started)/1000).toFixed(1)+' с'});if(st.history.length>12)st.history.shift();
      syncAggregate(owner);
      if(current(owner,st)){owner.status=status==='failed'?'В сценарии есть ошибка. Результат и исправление доступны в IDE.':'Демонстрационный сценарий завершён; реальная среда не запускалась.';}
      rerender(owner,st);
    }
    function later(owner,st,token,fn,delay=1200){
      const id=setTimeout(()=>{if(st.generation!==token||!st.operation||st.operation.status!=='running')return;if(timers.get(st)===id)timers.delete(st);fn();},delay);timers.set(st,id);
    }
    function stop(st=state(),owner=api.ide(),message='Процесс остановлен пользователем · fixture.'){
      st.generation++;const timer=timers.get(st);if(timer)clearTimeout(timer);timers.delete(st);
      st.tests.forEach(t=>{if(t.status==='running')t.status='cancelled';});if(st.debug)st.debug.status='finished';
      if(st.operation&&operationBusy(st))finish(owner,st,'cancelled',[message]);else rerender(owner,st);
    }
    function start(configKey,options={}){
      const owner=api.ide(),st=state(),kind=workbench(owner).selected,scenario=st.scenario;if(operationBusy(st)){api.notice('Сначала остановите текущий запуск '+catalog[kind].label+'.');return;}
      seed(kind);owner.bottomCollapsed=false;const files={...api.files()},command=commandFor(kind,st,configKey||st.config),token=++st.generation;
      st.operation={id:token,kind:command.kind,command:clone(command),status:'running',started:Date.now(),project:api.project(),source:files,scenario,springProfile:st.springProfile,skipTests:st.skipTests};st.console=[`[fixture] ${command.name}`,`cwd: ${command.cwd}`,`$ ${command.command}`,'Запуск…'];owner.bottom=command.kind==='test'||command.kind==='e2e'?'tests':'output';owner.running=true;
      if(!st.ready){st.console.push('Среда ещё не подготовлена.');finish(owner,st,'blocked',['Настройте runtime и импортируйте проект.']);owner.bottom='output';api.render();return;}
      const isTest=['test','e2e'].includes(command.kind),selected=options.failedOnly?new Set(st.tests.filter(t=>t.status==='failed').map(t=>t.id)):null;
      if(options.failedOnly&&!selected.size){st.operation=null;syncAggregate(owner);api.notice('Нет упавших тестов для повторного запуска.');return;}
      if(isTest){const cases=evaluateTests(kind,files,scenario);st.tests=cases.map(t=>selected&&!selected.has(t.id)?st.tests.find(old=>old.id===t.id)||t:{...t,status:'running'});}
      api.render();
      later(owner,st,token,()=>{
        if(scenario==='toolchain'){st.ready=false;st.tests.forEach(t=>{if(t.status==='running'){t.status='cancelled';t.detail='Runtime не найден.';}});if(current(owner,st))owner.bottom='output';finish(owner,st,'failed',['ERROR: выбранный runtime недоступен.','Проверьте путь в настройках среды.']);return;}
        if(scenario==='dependency'){st.tests.forEach(t=>{if(t.status==='running'){t.status='cancelled';t.detail='Зависимости недоступны.';}});if(current(owner,st))owner.bottom='output';finish(owner,st,'failed',['ERROR: repository connection timeout.','Проверьте corporate mirror / proxy и сертификат; TLS-проверка остаётся включённой.']);return;}
        if(isTest){
          const results=evaluateTests(kind,files,scenario);st.tests=results.map(t=>selected&&!selected.has(t.id)?st.tests.find(old=>old.id===t.id)||t:t);
          const failed=st.tests.filter(t=>t.status==='failed').length;finish(owner,st,failed?'failed':'passed',st.tests.map(t=>(t.status==='passed'?'PASS ':'FAIL ')+t.name).concat([`${st.tests.length-failed} passed, ${failed} failed · fixture; исходники захвачены при запуске.`]));return;
        }
        if(command.kind==='server'||command.kind==='spring'){st.operation.status='server';st.console.push(kind==='java'?'Spring Boot · демонстрация приложения ready':'Vite · демонстрация dev server ready',kind==='java'?'http://127.0.0.1:8080 · сервер не запускался':'http://127.0.0.1:5173 · сервер не запускался',kind==='java'?'Profile: '+st.operation.springProfile+' · endpoints доступны только как fixture из исходников':'Preview открывает безопасный локальный пример макета.');rerender(owner,st);return;}
        const result=kind==='java'?command.kind==='build'?'BUILD SUCCESS · compiler fixture':command.kind==='goal'?'Build goal finished · fixture; dependency tree / effective POM требуют реального отчёта':'12.50 · console fixture':kind==='python'?command.kind==='lint'?'Ruff fixture: no syntax issue in example':'12.50 · console fixture':command.kind==='typecheck'?'TypeScript fixture: selected project configuration loaded':command.kind==='lint'?'ESLint fixture: no generated diagnostics':'Build fixture: dist/index.html · asset report unavailable';
        finish(owner,st,'passed',[result,...(kind==='java'&&st.operation.skipTests&&['build','goal'].includes(command.kind)?['TESTS SKIPPED · тесты не проверялись']:[]),'Результат не подтверждает реальную компиляцию / проверку проекта.']);
      });
    }
    function importProject(){
      const owner=api.ide(),st=state(),kind=workbench().selected,scenario=st.scenario;if(operationBusy(st)){api.notice('Подготовка дождётся остановки текущего запуска.');return;}seed(kind);owner.bottomCollapsed=false;
      const token=++st.generation,command=importCommandFor(kind,st);
      st.operation={id:token,kind:'import',command,status:'running',started:Date.now(),project:api.project(),scenario};syncAggregate(owner);st.console=[`[fixture] ${command.command}`,'Разрешение зависимостей и импорт…'];st.notice='Подготовка среды…';owner.bottom='output';api.render();
      later(owner,st,token,()=>{if(['dependency','toolchain'].includes(scenario)){st.ready=false;st.imported=false;st.notice=scenario==='dependency'?'Недоступен репозиторий пакетов. Настройки сохранены.':'Runtime не найден. Исправьте путь и повторите.';finish(owner,st,'failed',['ERROR: '+st.notice]);return;}st.ready=true;st.imported=true;st.notice='Среда подготовлена в макете. Можно запускать тесты и отладку.';const service=owner.languageServices?.[catalog[kind].service];if(service){service.state='ready';service.mode='Готово · fixture';service.progress=100;service.executable=st.settings.path;service.sdk=st.settings.runtime;}finish(owner,st,'passed',[kind==='java'?'Module payments imported · source / test roots indexed':kind==='python'?'Virtual environment selected · pytest / Ruff / debugpy discovered':'Lockfile selected · workspace TypeScript / Vite scripts discovered','Реальный импорт, загрузка пакетов и индексация не выполнялись.']);});
    }
    function debugStart(){
      const owner=api.ide(),st=state(),kind=workbench().selected,p=catalog[kind];if(operationBusy(st)){if(st.operation.status==='server'){api.notice('Остановите dev server перед отдельным демонстрационным debug-сеансом.');return;}api.notice('Отладка уже активна или выполняется другая конфигурация.');return;}
      if(!st.ready){owner.bottom='toolchain';owner.bottomCollapsed=false;st.notice='Сначала подготовьте среду, чтобы запустить отладку.';api.render();return;}
      owner.bottomCollapsed=false;const path=p.debugEntry||p.entry; if(!Object.hasOwn(api.files(),path)){api.notice('Исходный файл отсутствует: '+path);return;}
      const points=api.breakpoints?.(path,owner)||new Set(),line=[...points].find(n=>n>0&&n<=api.files()[path].split('\n').length)||p.steps[0];
      const token=++st.generation;st.debug={path,line,status:'paused',variables:clone(p.variables),watches:[],step:0,token};st.operation={id:token,kind:'debug',command:{...commandFor(kind,st,st.config),name:'Debug · '+p.label},status:'paused',started:Date.now(),project:api.project()};st.console=['[fixture] Debug adapter connected','Stopped at '+path+':'+line];syncAggregate(owner);owner.debugLine=line;owner.bottom='debug';owner.status='Отладка · пауза на '+path+':'+line+' · fixture';api.openFile(path);api.revealLine(line);
    }
    function debugStep(resume=false){
      const owner=api.ide(),st=state(),kind=workbench().selected,d=st.debug;if(!d||d.status!=='paused')return;
      if(!Object.hasOwn(api.files(),d.path)){stop(st,owner,'Отладка остановлена: исходный файл удалён или переименован.');api.notice('Файл отладки был удалён или переименован: '+d.path+'. Запустите новый сеанс для актуального файла.');return;}
      if(resume){d.status='running';st.operation.status='running';owner.status='Отладка · выполнение продолжено · '+d.path+' · fixture';const token=st.generation;api.render();later(owner,st,token,()=>{d.status='finished';owner.debug=false;finish(owner,st,'passed',['Debugger process exited · fixture.']);},800);return;}
      d.step++;const lines=api.files()[d.path]?.split('\n').length||d.line;d.line=Math.min(lines,d.line+1);owner.debugLine=d.line;owner.bottom='debug';owner.status='Отладка · пауза на '+d.path+':'+d.line+' · fixture';api.openFile(d.path);api.revealLine(d.line);
    }
    function testDetail(id){
      const st=state(),kind=workbench().selected,t=st.tests.find(item=>item.id===id)||st.tests[Number(id)];if(!t)return;
      const stale=t.evaluatedSource!==(api.files()[t.path]??null);
      showDialog(t.name,`${stale?'<p class="il-stale-notice">Код изменён. Этот результат относится к предыдущему содержимому файла.</p>':''}<p class="il-state ${stale?'stale':t.status}">${statusLabel(t.status)} · ${t.duration} мс · fixture</p><pre class="di-mono">${esc(t.detail)}</pre><p>${esc(t.path)}:${t.line}</p>`,btn('test-source','Открыть исходник')+(stale?btn('test-rerun','Повторить тесты'):t.status==='failed'?btn('test-fix','Предпросмотр исправления'):'')+btn('test-agent','Разобрать с агентом'),a=>{
        if(a==='il-test-source'){api.closeDialog();if(!Object.hasOwn(api.files(),t.path)){api.notice('Исходный файл теста отсутствует: '+t.path);return;}api.openFile(t.path);api.revealLine(t.line);}
        else if(a==='il-test-agent'){api.closeDialog();ask(`Тест ${t.name}: ${t.detail}\n${t.path}:${t.line}`);}
        else if(a==='il-test-fix')quickFix(kind,t);
        else if(a==='il-test-rerun'){api.closeDialog();start(catalog[kind].configs.find(c=>c.kind==='test').id);}
      });
    }
    function quickFix(kind,test){
      const files=api.files(),before=files[test.path];let after=before;
      if(kind==='java'&&before?.includes('return amount;'))after=before.replace('return amount;','if (amount == null || amount.signum() < 0) {\n            throw new IllegalArgumentException("Amount must be non-negative");\n        }\n        return amount;');
      if(kind==='python'&&before?.includes("sum(Decimal(row['amount']) for row in rows)"))after=before.replace("sum(Decimal(row['amount']) for row in rows)","sum((Decimal(row['amount']) for row in rows), Decimal('0'))");
      if(kind==='frontend'&&before?.includes("() => fetch('/orders/' + orderId)"))after=before.replace("() => fetch('/orders/' + orderId)","async () => {\n      const response = await fetch('/orders/' + orderId);\n      if (!response.ok) throw new Error(`HTTP ${response.status}`);\n      return response;\n    }");
      if(after===before){showDialog('Исправление требует анализа',`<p>Текущее содержимое отличается от известного учебного фрагмента либо ошибка внедрена сценарием. Изменения автоматически не применяются.</p>`,btn('fix-agent','Передать агенту'),a=>{if(a==='il-fix-agent'){api.closeDialog();ask(test.detail+'\n'+test.path);}});return;}
      showDialog('Проверить исправление',`<p>${esc(test.path)} · изменения останутся несохранёнными</p><div class="di-before-after"><section><h3>До</h3><pre>${esc(before)}</pre></section><section><h3>После</h3><pre>${esc(after)}</pre></section></div><p>Учебная правка устраняет показанный дефект. Повторный запуск проверяет обновлённый буфер; реальные тесты остаются отдельным этапом.</p>`,btn('fix-apply','Применить в редакторе'),a=>{
        if(a!=='il-fix-apply')return;if(api.files()[test.path]!==before){api.closeDialog();api.notice('Буфер изменился. Откройте новый предпросмотр, чтобы не перезаписать изменения.');return;}
        api.files()[test.path]=after;api.ide().dirty.add(test.path);api.closeDialog();api.openFile(test.path);api.ide().bottom='tests';api.ide().bottomCollapsed=false;api.render();
      });
    }
    function dependencies(){
      const kind=workbench().selected,st=state(),p=catalog[kind];
      showDialog('Зависимости · '+p.label,`<p>${esc(st.settings.manager)} · версии — пример manifest, не актуальная рекомендация</p><table class="il-dependencies"><thead><tr><th>Пакет</th><th>Версия</th><th>Область</th></tr></thead><tbody>${p.dependencies.map(([name,version,scope])=>`<tr><td><code>${esc(name)}</code></td><td>${esc(version)}</td><td>${esc(scope)}</td></tr>`).join('')}</tbody></table><p>${kind==='java'?'Дерево Maven / Gradle: прямые и транзитивные зависимости, conflict resolution и effective POM должны приходить из build model.':kind==='python'?'Окружение изолировано для проекта; установка и удаление пакетов должны использовать именно выбранный интерпретатор.':'Менеджер выбирается по lockfile. Package scripts, типы и зависимости относятся к выбранному workspace package.'}</p>`,btn('deps-manifest','Открыть manifest')+btn('deps-agent','Проверить с агентом'),a=>{if(a==='il-deps-manifest'){api.closeDialog();openManifest();}if(a==='il-deps-agent'){api.closeDialog();ask('Проверь зависимости, конфликты и уязвимости выбранного модуля. Используй реальные lockfile и Sprut MCP, не версии из демонстрации.');}});
    }
    function mavenDialog(){
      const st=state(),gradle=st.settings.manager==='gradle';seed('java');
      const goals=gradle?['build','test','clean build','dependencies','tasks']:['verify','test','package','clean verify','dependency:tree','help:effective-pom'];
      showDialog((gradle?'Gradle':'Maven')+' · payments',`<div class="il-callout"><b>payments · com.atlas:payments:0.1.0</b><p>Корневой модуль: backend<br>Исходники: backend/*.java · тесты: src/test/java<br>Resources: src/main/resources · JDK ${esc(st.settings.runtime.replace('JDK ',''))}</p><span>Один импортированный модуль в учебном проекте. В продукте дерево модулей читается из build model.</span></div><div class="di-columns"><label>${gradle?'Задача':'Lifecycle / goal'}<select id="il-maven-goal">${goals.map(g=>`<option ${g===st.mavenGoal?'selected':''}>${g}</option>`).join('')}</select></label><label>Maven profile<select id="il-maven-profile" ${gradle?'disabled':''}><option value="" ${!st.mavenProfile?'selected':''}>Без профиля</option><option value="dev" ${st.mavenProfile==='dev'?'selected':''}>dev</option><option value="ift" ${st.mavenProfile==='ift'?'selected':''}>ift</option></select></label></div><label class="di-check"><input type="checkbox" id="il-maven-offline" ${st.offline?'checked':''}> Offline · использовать локальный кэш</label><label class="di-check"><input type="checkbox" id="il-maven-skip" ${st.skipTests?'checked':''}> Пропустить тесты при сборке</label><div class="il-options">${btn('maven-pom',gradle?'build.gradle.kts':'pom.xml')}${btn('maven-tree','Дерево зависимостей')}${btn('maven-reimport','Переимпортировать')}</div><p>Команда использует wrapper проекта. В макете можно выбрать цель и увидеть запуск / ошибку / отмену; wrapper и сеть не вызываются.</p>`,btn('maven-save','Сохранить')+btn('maven-run','Выполнить цель'),a=>{
        if(a==='il-maven-pom'){api.closeDialog();openManifest();return;}
        if(a==='il-maven-tree'){mavenTree();return;}
        if(a==='il-maven-reimport'){api.closeDialog();importProject();return;}
        if(!['il-maven-save','il-maven-run'].includes(a))return;
        st.mavenGoal=field('il-maven-goal').value;st.mavenProfile=field('il-maven-profile').value;st.offline=field('il-maven-offline').checked;st.skipTests=field('il-maven-skip').checked;st.config='java-goal';api.closeDialog();
        if(a==='il-maven-run')start(st.mavenGoal==='test'?'java-test':'java-goal');else api.render();
      });
    }
    function mavenTree(){
      showDialog('payments · дерево зависимостей',`<div class="il-dependency-tree"><details open><summary>com.atlas:payments:0.1.0</summary><details open><summary>spring-boot-starter-web · 3.4.1</summary><div>spring-web · управляется Spring BOM</div><div>spring-webmvc · управляется Spring BOM</div><div>spring-boot-starter-tomcat · runtime</div></details><details><summary>spring-boot-starter-actuator · 3.4.1</summary><div>spring-boot-actuator-autoconfigure</div><div>micrometer-observation</div></details><details><summary>junit-jupiter · 5.11.4 · test</summary><div>junit-jupiter-api</div><div>junit-jupiter-engine</div></details></details></div><p>Учебный граф из примера POM, без вызова dependency:tree. Разрешённые версии, причины выбора и конфликты в продукте берутся из настоящего отчёта Maven / Gradle; безопасность проверяется через Sprut.</p>`,btn('tree-run','Запустить dependency:tree')+btn('tree-agent','Проверить конфликты с агентом'),a=>{if(a==='il-tree-run'){state().mavenGoal=state().settings.manager==='gradle'?'dependencies':'dependency:tree';state().config='java-goal';api.closeDialog();start('java-goal');}if(a==='il-tree-agent'){api.closeDialog();ask('Сверь реальное дерево зависимостей, BOM, version mediation, exclusions и уязвимости через Sprut. Пример дерева из макета не является результатом Maven.');}});
    }
    function springInspector(){
      const st=state();seed('java');
      const command=commandFor('java',st,'java-spring'),running=st.operation?.kind==='spring'&&st.operation.status==='server';
      showDialog('Spring · payments',`<div class="il-spring-head"><span class="il-spring-mark">S</span><div><b>Spring Boot 3.4.1</b><span>${running?'Демонстрационный запуск активен':'Обзор исходников · приложение не запущено'}</span></div><span class="di-demo">Fixture</span></div><div class="di-columns"><label>Spring profile<select id="il-spring-profile"><option value="dev" ${st.springProfile==='dev'?'selected':''}>dev</option><option value="ift" ${st.springProfile==='ift'?'selected':''}>ift</option><option value="default" ${st.springProfile==='default'?'selected':''}>default</option></select></label><label>Конфигурация<input value="${esc(command.name)}" readonly></label></div><div class="il-options">${btn('spring-config','application.yml')}${btn('spring-profile-file','Файл профиля')}${btn('spring-main','Точка входа')}</div><div class="il-spring-section"><h3>Beans из учебных исходников</h3><button type="button" data-di="il-spring-bean" class="il-spring-row"><code>paymentService</code><span>@Bean → PaymentService</span>${icon('arrow')}</button><button type="button" data-di="il-spring-controller" class="il-spring-row"><code>paymentController</code><span>@RestController · constructor injection</span>${icon('arrow')}</button></div><div class="il-spring-section"><h3>Endpoints из mappings / конфигурации</h3><button type="button" data-di="il-spring-controller" class="il-spring-row"><code>GET /api/payments/total</code><span>PaymentController:17</span>${icon('arrow')}</button><button type="button" data-di="il-spring-health" class="il-spring-row"><code>GET /actuator/health</code><span>health включён в application.yml</span>${icon('arrow')}</button></div><p>Это обзор учебного примера. Live beans / mappings / health ещё не получены; показанный endpoint не означает, что сервер доступен.</p>`,btn('spring-save','Сохранить профиль')+btn('spring-run',running?'Перезапустить Spring Boot':'Запустить Spring Boot'),a=>{
        const navigate=(path,marker)=>{api.closeDialog();const source=api.files()[path];if(typeof source!=='string'){api.notice('Файл Spring был удалён или переименован: '+path);return;}const line=marker?source.split('\n').findIndex(text=>text.includes(marker))+1:0;if(marker&&!line){api.notice('Символ '+marker+' больше не найден в '+path+'. Обновите обзор исходников.');return;}api.openFile(path);if(line)api.revealLine(line);};
        if(a==='il-spring-config'){navigate('backend/src/main/resources/application.yml');return;}
        if(a==='il-spring-profile-file'){const selected=field('il-spring-profile').value;navigate(selected==='default'?'backend/src/main/resources/application.yml':'backend/src/main/resources/application-'+selected+'.yml');return;}
        if(a==='il-spring-main'||a==='il-spring-bean'){navigate('backend/PaymentSpringApplication.java',a==='il-spring-bean'?'@Bean':'@SpringBootApplication');return;}
        if(a==='il-spring-controller'){navigate('backend/PaymentController.java','@GetMapping');return;}
        if(a==='il-spring-health'){showDialog('GET /actuator/health',`<p>Адрес для выбранного примера: http://127.0.0.1:8080/actuator/health</p><p>HTTP-запрос не отправлен. Для live состояния нужны запущенный Spring process и ответ endpoint.</p>`,btn('health-agent','Передать проверку агенту'),choice=>{if(choice==='il-health-agent'){api.closeDialog();ask('Проверь live Spring health на фактическом порту проекта, покажи ответ и логи. Макет никаких HTTP-запросов не делал.');}});return;}
        if(a==='il-spring-save'||a==='il-spring-run'){st.springProfile=field('il-spring-profile').value;st.config='java-spring';api.closeDialog();if(a==='il-spring-run'){if(operationBusy(st))stop(st,api.ide(),'Остановлено перед перезапуском Spring Boot.');start('java-spring');}else api.render();}
      });
    }
    function openManifest(){const kind=workbench().selected;seed(kind);const path=kind==='java'&&state().settings.manager==='gradle'?'backend/build.gradle.kts':catalog[kind].manifest;api.openFile(path);}
    function ask(extra=''){
      const st=state(),kind=workbench().selected,c=st.operation?.command||commandFor(kind,st,st.config);
      api.ask(`[IDE / ${catalog[kind].label}] Проект: ${api.project()}\nФайл: ${api.ide().active||'не открыт'}\nСреда: ${st.settings.runtime}, ${st.settings.manager}, ${st.settings.path}\nКонфигурация: ${c.name}; cwd=${c.cwd}; command=${c.command}\nСостояние: ${st.operation?statusLabel(st.operation.status):'не запускалась'}\n${extra}\n${st.console.slice(-8).join('\n')}\nДанные выше из интерактивного макета. Проверь реальные файлы, конфигурацию и результат инструментов перед выводом.`);
    }
    function watchDialog(evaluate=false){
      const d=state().debug;if(!d){api.notice('Сначала запустите отладку.');return;}
      showDialog(evaluate?'Вычислить выражение':'Добавить watch',`<label>Выражение<input id="il-watch" placeholder="${esc(d.variables[0][0])}"></label><p>В макете доступны: ${d.variables.map(v=>esc(v[0])).join(', ')}. Произвольный код не вычисляется.</p><div id="il-evaluation" role="status"></div>`,btn('watch-save',evaluate?'Вычислить':'Добавить'),a=>{if(a!=='il-watch-save')return;const name=field('il-watch').value.trim(),value=d.variables.find(v=>v[0]===name)?.[1];if(value===undefined){field('il-evaluation').textContent='Выражение отсутствует в текущем демонстрационном frame.';return;}if(evaluate){field('il-evaluation').textContent=name+' = '+value;return;}if(!d.watches.some(w=>w.name===name))d.watches.push({name,value});api.closeDialog();api.render();});
    }
    function preview(){
      showDialog('Frontend preview',`<div class="il-preview"><span class="il-label">React · 390 × 240 · локальный пример</span><h3>Продолжить оплату</h3><p>Проверка состояния кнопки без настоящего dev server.</p><button type="button" class="di-button primary" data-di="il-preview-pending">Continue</button><p id="il-preview-state" role="status">Готово к действию</p></div><p>После интеграции откроется закреплённая вкладка браузера для URL текущего dev server с HMR и журналом console / network. Макет не загружает localhost:5173.</p>`,btn('preview-close','Закрыть'),a=>{if(a==='il-preview-close'){api.closeDialog();return;}if(a==='il-preview-pending'){const b=api.dialogElement().querySelector('[data-di="il-preview-pending"]');b.textContent='Processing…';b.disabled=true;field('il-preview-state').textContent='Запрос выполняется · disabled=true';}});
    }
    function action(action,el={dataset:{}}){
      const aliases={run:'il-run','stop-run':'il-stop',debug:'il-debug','debug-step':'il-debug-step','debug-resume':'il-debug-resume','debug-stop':'il-stop','test-all':'il-tests','test-failed':'il-test-failed','test-known-failure':'il-inject-failure','test-detail':'il-test-detail','coverage-view':'il-coverage','run-settings':'il-config','language-settings':'il-environment','ide-dependencies':'il-dependencies','debug-stack':'il-debug-source','debug-watch':'il-watch','debug-evaluate':'il-evaluate','debug-variable':'il-evaluate'};
      action=aliases[action]||action;if(!action.startsWith('il-'))return false;
      if(action==='il-environment'){api.closeDialog();api.ide().bottom='toolchain';api.ide().bottomCollapsed=false;api.render();}
      else if(action==='il-config'){api.closeDialog();configDialog();}
      else if(action==='il-configure')configure();
      else if(action==='il-import')importProject();
      else if(action==='il-run')start();
      else if(action==='il-run-again'){if(state().operation?.kind==='import')importProject();else start(state().operation?.command.id||state().config);}
      else if(action==='il-tests'||action==='il-test-failed'){const kind=workbench().selected;start(catalog[kind].configs.find(c=>c.kind==='test').id,{failedOnly:action==='il-test-failed'});}
      else if(action==='il-stop')stop();
      else if(action==='il-debug')debugStart();
      else if(action==='il-debug-step'||action==='il-debug-resume')debugStep(action==='il-debug-resume');
      else if(action==='il-debug-source'){const d=state().debug;if(d){if(!Object.hasOwn(api.files(),d.path)){api.notice('Исходный файл отладки отсутствует: '+d.path);return true;}api.openFile(d.path);api.revealLine(d.line);}}
      else if(action==='il-test-detail')testDetail(el.dataset.id??el.dataset.index);
      else if(action==='il-inject-failure'){state().scenario='assertion';api.ide().bottom='toolchain';api.ide().bottomCollapsed=false;api.render();}
      else if(action==='il-filter-all'||action==='il-filter-failed'){state().filter=action==='il-filter-all'?'all':'failed';api.render();}
      else if(action==='il-coverage')showDialog('Покрытие тестами',`<p>Coverage не получен: в макете нет реального отчёта ${workbench().selected==='java'?'JaCoCo':workbench().selected==='python'?'coverage.py / pytest-cov':'V8 / Istanbul'}.</p><p>В продукте здесь будут покрытые / пропущенные строки, branches, сравнение с предыдущим запуском и переход в исходник. Успех fixture-теста не означает покрытие кода.</p>`,btn('coverage-close','Понятно'),a=>{if(a==='il-coverage-close')api.closeDialog();});
      else if(action==='il-manifest')openManifest();
      else if(action==='il-dependencies')dependencies();
      else if(action==='il-agent')ask();
      else if(action==='il-watch'||action==='il-evaluate')watchDialog(action==='il-evaluate');
      else if(action==='il-remove-watch'){const d=state().debug;if(d)d.watches=d.watches.filter(w=>w.name!==el.dataset.name);api.render();}
      else if(action==='il-preview'){if(workbench().selected==='java')springInspector();else preview();}
      else if(action==='il-maven')mavenDialog();
      else if(action==='il-spring')springInspector();
      else if(action==='il-recover'){const st=state(),previous=st.operation?.kind;st.scenario='source';if(!st.ready||previous==='import')importProject();else start(st.operation?.command.id||st.config);}
      return true;
    }
    function bind(){
      const lang=root.querySelector('#il-language');if(lang)lang.onchange=()=>select(lang.value);
      const config=root.querySelector('#il-run-config');if(config)config.onchange=()=>{state().config=config.value;api.render();};
      const scenario=root.querySelector('#il-scenario');if(scenario)scenario.onchange=()=>{state().scenario=scenario.value;state().notice='Сценарий изменён. Он применяется к следующему запуску.';api.render();};
      const editor=root.querySelector('#di-code-input');if(editor&&!editor.dataset.ilTestFreshness){editor.dataset.ilTestFreshness='bound';editor.addEventListener('input',()=>{if(api.ide().bottom!=='tests')return;const result=root.querySelector('#di-ide-bottom');if(result)result.innerHTML=testsMarkup(state(),workbench().selected);});}
    }
    document.addEventListener('suite:scope-change',()=>{if(dialogOwner&&dialogOwner.owner!==api.ide()){api.closeDialog();dialogOwner=null;}});
    return {toolbar,bottom,bind,action,select,start,stop,importProject,debugStart,debugStep,state,workbench};
  }
  window.SuiteIDELanguages={create,spec:{catalog,commandFor,importCommandFor,evaluateTests,seedFiles,initialState}};
})();
