import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _electron } from 'playwright';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-ide-live-'));
const fixture = path.join(temporary, 'project');
await fs.mkdir(path.join(fixture, 'src'), { recursive: true });
await fs.writeFile(path.join(fixture,'.gitignore'),'.venv/\nnode_modules/\ndist/\njava-maven/target/\n');
await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'ide-fixture', private: true, type: 'module', scripts: { test: 'node --test' } }));
await fs.writeFile(path.join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true }, include: ['src/**/*.ts'] }));
await fs.writeFile(path.join(fixture, 'src/greet.ts'), 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n');
await fs.writeFile(path.join(fixture, 'src/main.ts'), 'import { greet } from "./greet.js";\nconst count: number = "intentional diagnostic";\nconsole.log(greet("Workbench"), count);\n');
await fs.writeFile(path.join(fixture, 'README.md'), '# Live IDE fixture\n\nA real editor, diagnostics, navigation and Git workflow.\n');
await fs.mkdir(path.join(fixture, '.vscode'), { recursive: true });
await fs.writeFile(path.join(fixture, 'runner.test.mjs'), 'import { test } from "node:test"; import assert from "node:assert/strict"; test("real fixture", () => assert.equal(2 + 2, 4));\n');
await fs.writeFile(path.join(fixture, 'debug.mjs'), 'const answer = 42;\ndebugger;\nconsole.log(answer);\n');
await fs.writeFile(path.join(fixture, '.vscode/tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [ { label: 'Fixture pass', type: 'process', command: 'node', args: ['--test','runner.test.mjs'], problemMatcher: [] }, { label: 'Fixture fail', type: 'process', command: 'node', args: ['-e','process.exit(7)'], problemMatcher: [] } ] }));
await fs.writeFile(path.join(fixture, '.vscode/launch.json'), JSON.stringify({ version: '0.2.0', configurations: [ { name: 'Fixture Node Debug', type: 'node', request: 'launch', program: '${workspaceFolder}/debug.mjs', stopOnEntry: true, console: 'internalConsole' } ] }));
if (process.argv.includes('--languages')) {
  await fs.cp(path.resolve(root,'../ide/fixtures/java-maven'),path.join(fixture,'java-maven'),{recursive:true});
  await fs.cp(path.resolve(root,'../ide/fixtures/python'),path.join(fixture,'python'),{recursive:true});
  await exec(process.platform==='win32'?'python':'python3',['-m','venv',path.join(fixture,'.venv')]);
  const interpreter=path.join(fixture,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  await fs.writeFile(path.join(fixture,'.vscode/settings.json'),JSON.stringify({'python.defaultInterpreterPath':interpreter,'python.testing.unittestEnabled':true,'python.testing.pytestEnabled':false,'python.testing.unittestArgs':['-v','-s','python','-p','test_*.py'],'python.analysis.typeCheckingMode':'basic','java.import.maven.enabled':true}));
  await fs.writeFile(path.join(fixture,'pyrightconfig.json'),JSON.stringify({include:['python'],typeCheckingMode:'basic',venvPath:'.',venv:'.venv'}));
}
await exec('git', ['init', '-q', fixture]);
await exec('git', ['-C', fixture, 'add', '.']);
await exec('git', ['-C', fixture, '-c', 'user.name=Workbench Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture baseline']);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/OPENAI|OPENROUTER|QWEN|GIGACODE|API_KEY|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/i.test(key)) delete env[key];
env.WORKBENCH_DATA_DIR = path.join(temporary, 'userdata');
env.WORKBENCH_CLI_PATH = path.join(root, 'tests/fixtures/acp-fixture.mjs');
const results = [], errors = [];
let application;
const keep = process.argv.includes('--keep-open');
const record = (name, observed) => { results.push({ name, observed }); console.log('PASS', name, JSON.stringify(observed).slice(0, 400)); };
try {
  application = await _electron.launch({ executablePath: require('electron'), args: [root], env, timeout: 60_000 });
  process.once('SIGTERM', () => { void application.close().finally(() => process.exit(0)); });
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  await page.waitForFunction(() => Boolean(window.workbench), { timeout: 30_000 });
  const project = await page.evaluate(async (fixture) => window.workbench.invoke('project.create', { name: 'IDE Live Fixture', path: fixture }), fixture);
  await page.locator('.project-name').filter({ hasText: 'IDE Live Fixture' }).click();
  await page.getByRole('button', { name: 'IDE', exact: true }).click();
  console.log('IDE startup requested', temporary);
  const status = await page.evaluate(async (projectId) => window.workbench.invoke('ide.status', { projectId }), project.id);
  if (status.frontendState !== 'ready' || status.plugins.length < 50) throw new Error('IDE extensions are not actually deployed/ready: ' + JSON.stringify(status.plugins));
  record('Real Theia frontend and backend', { engine: status.engine, version: status.version, roots: status.roots, pluginCount: status.plugins.length });
  const open = await page.evaluate(async (projectId) => window.workbench.invoke('ide.open', { projectId, path: 'src/main.ts' }), project.id);
  if (open.languageId !== 'typescript') throw new Error('TypeScript language grammar was not registered');
  record('Open real project file', open);
  const read = await page.evaluate(async (projectId) => window.workbench.invoke('ide.read', { projectId, path: 'src/main.ts' }), project.id);
  if (!read.text.includes('intentional diagnostic')) throw new Error('Editor did not read real file content');
  record('Read authoritative buffer', { version: read.version, language: read.languageId, text: read.text });
  const invoke = (method, parameters = {}) => page.evaluate(({ method, parameters, projectId }) => window.workbench.invoke(method, { projectId, ...parameters }), { method, parameters, projectId: project.id });
  async function until(name, read, accept, timeout = 90_000) {
    const start = Date.now(); let value;
    do { value = await read(); if (accept(value)) return value;
      if (name.startsWith('Native IDE test run')) {
        const controllerId=name.slice('Native IDE test run '.length), controller=value.controllers?.find(c=>c.id===controllerId);
        const latest=controller?.runs.at(-1);
        if(latest && !latest.running && !latest.items.some(item=>item.result?.state===3)) {
          await fs.writeFile(path.join(temporary,'native-test-failure.json'),JSON.stringify({controller},null,2));
          throw new Error('Actual IDE test runner finished without any passing test: '+JSON.stringify(latest));
        }
      } await new Promise(resolve => setTimeout(resolve, 500)); } while (Date.now() - start < timeout);
    await fs.writeFile(path.join(temporary,'timeout-'+name.replaceAll(/[^a-zA-Z0-9]+/g,'-')+'.json'),JSON.stringify(value,null,2));
    throw new Error(name + ' timeout; last=' + JSON.stringify(value).slice(0, 3000));
  }
  await fs.writeFile(path.join(fixture,'src/lifetime.ts'),'export const value = 1;\n');
  const firstModel=await invoke('ide.open',{path:'src/lifetime.ts'});
  const closeAction=(await invoke('ide.commands',{query:'close.tab',limit:100})).find(command=>command.enabled);
  if(!closeAction)throw new Error('Native close editor command unavailable');await invoke('ide.command',{id:closeAction.id,args:[]});
  const reopened=await invoke('ide.open',{path:'src/lifetime.ts'});
  if(reopened.revision===firstModel.revision)throw new Error('Closed/reopened model reused a stale revision');
  try { await invoke('ide.edit',{path:'src/lifetime.ts',expectedVersion:reopened.version,expectedRevision:firstModel.revision,operationId:'live-closed-model-01',edits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:'bad'}]});throw new Error('Stale closed-model edit accepted'); } catch(error){if(!String(error).includes('STALE_REVISION'))throw error;}
  record('Actual close/reopen rejects old model revision at matching numeric version',true);
  await invoke('ide.open',{path:'src/main.ts'});
  const diagnostics = await until('TypeScript diagnostic', () => invoke('ide.diagnostics'), value => value.some(item => item.message.includes('not assignable')));
  record('Actual TypeScript diagnostic detects intentional error', diagnostics);
  const line = read.text.split('\n')[1];
  const edit = { path: 'src/main.ts', expectedVersion: read.version, expectedRevision: read.revision, operationId: 'live-fix-type-0001', edits: [{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: line.length } }, newText: 'const count: number = 1;' }] };
  const edited = await invoke('ide.edit', edit);
  if (!edited.dirty || edited.version <= read.version) throw new Error('IDE edit did not modify the shared unsaved document');
  if (!(await fs.readFile(path.join(fixture, 'src/main.ts'), 'utf8')).includes('intentional diagnostic')) throw new Error('Unsaved edit unexpectedly changed disk');
  record('Edit same unsaved buffer without overwriting disk', edited);
  const duplicate = await invoke('ide.edit', edit);
  if (!duplicate.alreadyApplied || duplicate.version !== edited.version) throw new Error('Idempotent edit receipt failed');
  record('Duplicate operation does not apply twice', duplicate);
  try { await invoke('ide.edit', { ...edit, operationId: 'live-stale-edit-0002' }); throw new Error('Stale edit accepted'); } catch (error) { if (!String(error).includes('STALE_REVISION')) throw error; record('Stale revision rejected', String(error)); }
  await until('TypeScript diagnostic clears after correction', () => invoke('ide.diagnostics'), value => !value.some(item => item.message.includes('not assignable')));
  const saved = await invoke('ide.save', { path: 'src/main.ts', expectedVersion: edited.version, expectedRevision: edited.revision });
  if (saved.dirty || !(await fs.readFile(path.join(fixture, 'src/main.ts'), 'utf8')).includes('const count: number = 1;')) throw new Error('Save did not persist actual buffer');
  record('Save verified on disk and diagnostics cleared', saved);
  const navigation = await invoke('ide.semantic.navigate', { path: 'src/main.ts', line: 3, column: 14 });
  if (!navigation.locations.some(item => item.uri.endsWith('/src/greet.ts'))) throw new Error('Real TypeScript definition navigation failed: ' + JSON.stringify(navigation));
  record('Semantic definition navigates across files', navigation);
  const greet = await invoke('ide.open', { path: 'src/greet.ts' });
  const proposal = await invoke('ide.semantic.rename', { path: 'src/greet.ts', line: 1, column: 18, newName: 'welcome', expectedVersion: greet.version, expectedRevision: greet.revision });
  if (proposal.files.length < 2) throw new Error('Semantic rename did not find project usages');
  record('Multi-file semantic rename preview', proposal);
  const applied = await invoke('ide.semantic.apply', { proposalId: proposal.proposalId });
  const renamed = await invoke('ide.read', { path: 'src/main.ts' });
  if (!renamed.text.includes('welcome(') || renamed.text.includes('greet(')) throw new Error('Semantic rename did not update actual usage buffer');
  record('Semantic rename updates actual usages', applied);
  if (!renamed.dirty || !(await fs.readFile(path.join(fixture,'src/main.ts'),'utf8')).includes('greet(')) throw new Error('Semantic edit silently saved an open buffer');
  record('Semantic rename preserves dirty-buffer state instead of silently saving',true);
  try { await invoke('ide.debug.start',{name:'Fixture Node Debug'}); throw new Error('Debugger silently saved dirty files'); } catch(error) { if(!String(error).includes('UNSAVED_DOCUMENTS'))throw error;record('Agent execution refuses dirty buffers without silently saving unrelated edits',true); }
  const renameBuffer=await invoke('ide.read',{path:'src/greet.ts'});
  const reviewed=await invoke('ide.semantic.rename',{path:'src/greet.ts',line:1,column:18,newName:'reviewedWelcome',expectedVersion:renameBuffer.version,expectedRevision:renameBuffer.revision});
  const previewResult=await invoke('ide.semantic.apply',{proposalId:reviewed.proposalId,review:true});
  if(previewResult.applied!==false || !previewResult.previewOpened || (await invoke('ide.read',{path:'src/greet.ts'})).text.includes('reviewedWelcome'))throw new Error('Opening preview was misreported as an applied refactoring');
  record('Native refactoring preview is explicitly pending, not reported as applied',previewResult);
  const discard=(await invoke('ide.commands',{query:'bulk-edit',limit:100})).find(command=>/discard/i.test(command.id));
  if(!discard)throw new Error('Native preview discard action is missing');await invoke('ide.command',{id:discard.id,args:[]});
  for(const file of ['src/main.ts','src/greet.ts']) { const buffer=await invoke('ide.read',{path:file}); await invoke('ide.save',{path:file,expectedVersion:buffer.version,expectedRevision:buffer.revision}); }
  const again = await invoke('ide.semantic.apply', { proposalId: proposal.proposalId });
  if (!again.alreadyApplied) throw new Error('Semantic proposal applied twice');
  const git = await exec('git', ['-C', fixture, 'diff', '--stat']);
  if (!git.stdout.includes('src/main.ts')) throw new Error('Git does not observe the real saved change');
  record('Git tracks actual file changes', git.stdout.trim());
  const markdown=await invoke('ide.open',{path:'README.md'});
  await invoke('ide.command',{id:'markdown.showPreviewToSide',args:[markdown.uri]});
  const preview=await until('Markdown webview renders real content',()=>application.evaluate(async ({webContents})=>{
    const view=webContents.getAllWebContents().find(v=>v.getURL().startsWith('http://localhost:'));if(!view)return [];
    const frames=[];for(const frame of view.mainFrame.framesInSubtree)if(frame.url.includes('.webview.localhost:')) frames.push({url:frame.url,text:await frame.executeJavaScript('document.body?.innerText||""').catch(()=> '')});return frames;
  }),frames=>frames.some(frame=>frame.text.includes('Live IDE fixture')));
  record('Actual isolated Markdown webview renders project content',preview.map(frame=>({text:frame.text.slice(0,200),isolatedOrigin:true})));
  if(process.argv.includes('--languages')) {
    for(const dependency of ['react','react-dom','scheduler','csstype','@types/react','@types/react-dom']) await fs.cp(path.join(root,'node_modules',dependency),path.join(fixture,'node_modules',dependency),{recursive:true});
    await fs.writeFile(path.join(fixture,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',jsx:'react-jsx',rootDir:'src',noEmit:true},include:['src/**/*']}));
    await fs.writeFile(path.join(fixture,'src/Counter.tsx'),'import { useState } from "react";\ntype Props = { initial: number };\nexport function Counter({ initial }: Props) {\n  const [count,setCount] = useState(initial);\n  return <button onClick={() => setCount(count + 1)}>{count}</button>;\n}\nconst preview = <Counter initial="intentional error" />;\n');
    const component=await invoke('ide.open',{path:'src/Counter.tsx'});if(component.languageId!=='typescriptreact')throw new Error('TSX language not registered');
    await until('React TSX prop diagnostic',()=>invoke('ide.diagnostics'),items=>items.some(item=>item.uri.endsWith('/src/Counter.tsx')&&item.code==='2322'));
    const componentBuffer=await invoke('ide.read',{path:'src/Counter.tsx'}),last=componentBuffer.text.split('\n')[6];
    const fixed=await invoke('ide.edit',{path:'src/Counter.tsx',expectedVersion:componentBuffer.version,expectedRevision:componentBuffer.revision,operationId:'live-react-prop-fix-01',edits:[{range:{start:{line:6,character:0},end:{line:6,character:last.length}},newText:'const preview = <Counter initial={1} />;'}]});
    await invoke('ide.save',{path:'src/Counter.tsx',expectedVersion:fixed.version,expectedRevision:fixed.revision});
    await until('React TSX diagnostic clears',()=>invoke('ide.diagnostics'),items=>!items.some(item=>item.uri.endsWith('/src/Counter.tsx')&&item.severity===1));
    const runtimeLock=JSON.parse(await fs.readFile(path.resolve(root,'../ide/node-runtime-lock.json'),'utf8'));
    const pinnedNode=path.join(root,'runtime/ide-node','node-'+runtimeLock.version+'-'+(process.platform==='win32'?'win':process.platform)+'-'+process.arch,process.platform==='win32'?'node.exe':'bin/node');
    await exec(pinnedNode,[path.join(root,'node_modules/typescript/bin/tsc'),'--project',path.join(fixture,'tsconfig.json'),'--noEmit','false','--outDir','dist'],{cwd:fixture});
    const rendered=await exec(pinnedNode,['--input-type=module','-e','import {renderToString} from "react-dom/server";import {createElement} from "react";import {Counter} from "./dist/Counter.js";console.log(renderToString(createElement(Counter,{initial:1})));'],{cwd:fixture});
    if(!rendered.stdout.includes('<button>1</button>'))throw new Error('Actual React component did not render');
    record('Real React TSX diagnostic, repair, TypeScript build and React DOM render',rendered.stdout.trim());
    await invoke('ide.open',{path:'python/main.py'});
    const py = await until('Actual Pyright type diagnostic',()=>invoke('ide.diagnostics'),items=>items.some(item=>item.uri.endsWith('/python/main.py') && item.source === 'Pyright' && item.code === 'reportAssignmentType'),180_000);
    record('Real Pyright detects incompatible Python assignment',py.filter(item=>item.uri.endsWith('.py')));
    const pythonVersion = await exec(path.join(fixture,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),['-m','unittest','discover','-s','python','-p','test_*.py'],{cwd:fixture});
    if(!pythonVersion.stderr.includes('OK')) throw new Error('Actual Python unittest fixture failed');
    record('Real Python virtualenv unittest',pythonVersion.stderr.trim());
    await invoke('ide.open',{path:'java-maven/src/main/java/dev/workbench/Application.java'});
    await until('Java semantic provider',()=>invoke('ide.semantic.capabilities',{path:'java-maven/src/main/java/dev/workbench/Application.java'}),value=>value.definition && value.rename,240_000);
    const javaNav=await until('Java definition',()=>invoke('ide.semantic.navigate',{path:'java-maven/src/main/java/dev/workbench/Application.java',line:8,column:32}),value=>value.locations.some(item=>item.uri.endsWith('GreetingService.java')),240_000);
    record('Real JDT Java definition across Maven project',javaNav);
    const actual=await invoke('ide.status');const mvn=path.join(actual.toolchains.mavenHome,'bin',process.platform==='win32'?'mvn.cmd':'mvn');
    const built=await exec(mvn,['-B','-ntp','test'],{cwd:path.join(fixture,'java-maven'),env:{...env,JAVA_HOME:actual.toolchains.languageServerJavaHome},maxBuffer:4_000_000,timeout:240_000,shell:process.platform==='win32'});
    if(!built.stdout.includes('BUILD SUCCESS') || !built.stdout.includes('Tests run: 1')) throw new Error('Actual Spring/Maven/JUnit fixture did not pass');
    record('Real Java21 Spring Maven JUnit build',built.stdout.slice(-1800));
    await invoke('ide.tests.refresh');
    const discovered=await until('Actual Java/Python test discovery',()=>invoke('ide.tests.list'),value=>!value.refreshing && value.controllers.some(c=>c.tests.some(t=>t.label==='test_greeting')),180_000);
    record('Native test controllers discover real tests',discovered.controllers.map(c=>({id:c.id,tests:c.tests.length,profiles:c.profiles})));
    for(const controller of discovered.controllers.filter(c=>['python-tests','java'].includes(c.id))) {
      const requested = await invoke('ide.tests.run',{controllerId:controller.id}); console.log('NATIVE_TEST_REQUEST',JSON.stringify(requested));
      const observed=await until('Native IDE test run '+controller.id,()=>invoke('ide.tests.list'),value=>value.controllers.find(c=>c.id===controller.id)?.runs.some(run=>!run.running && run.items.some(item=>item.result?.state===3)),240_000);
      const run=observed.controllers.find(c=>c.id===controller.id).runs.at(-1);
      if(run.items.some(item=>[4,6].includes(item.result?.state)))throw new Error('Native IDE tests failed '+JSON.stringify(run));
      record('Native IDE test runner passed actual tests: '+controller.id,run);
      if(controller.id==='python-tests') {
        const file=path.join(fixture,'python/test_greeting.py'),original=await fs.readFile(file,'utf8');
        await fs.writeFile(file,original.replace('"Hello, Workbench"','"Intentional failing expectation"'));
        await invoke('ide.tests.run',{controllerId:controller.id});
        const failed=await until('Native Python failure is observed',()=>invoke('ide.tests.list',{controllerId:controller.id}),value=>value.controllers[0]?.runs.some(r=>r.id!==run.id&&!r.running&&r.items.some(item=>item.result?.state===4)));
        record('Native test runner reports actual assertion failure',failed.controllers[0].runs.at(-1));
        await fs.writeFile(file,original);await invoke('ide.tests.run',{controllerId:controller.id});
        const failedId=failed.controllers[0].runs.at(-1).id;
        const repaired=await until('Native Python rerun after fixing failure',()=>invoke('ide.tests.list',{controllerId:controller.id}),value=>value.controllers[0]?.runs.some(r=>r.id!==run.id&&r.id!==failedId&&!r.running&&r.items.some(item=>item.result?.state===3)));
        record('Native test runner passes after actual repair',repaired.controllers[0].runs.at(-1));
      }
    }
  }
  const tasks = await invoke('ide.tasks.list');
  if (!tasks.configured.some(task => task.label === 'Fixture pass')) throw new Error('Actual tasks.json task missing');
  for (const [label, code] of [['Fixture pass', 0], ['Fixture fail', 7]]) {
    const task = tasks.configured.find(task => task.label === label);
    const run = await invoke('ide.tasks.run', { id: task.id });
    const result = await until(label, () => invoke('ide.tasks.list'), value => value.results.some(item => item.taskId === run.taskId && item.exitCode === code));
    record('Actual build task exit: ' + label, result.results.find(item => item.taskId === run.taskId));
    // Refreshing tasks gives new short-lived choices.
    tasks.configured = result.configured;
  }
  const debugStart = await invoke('ide.debug.start', { name: 'Fixture Node Debug' });
  if (!debugStart.started) throw new Error('Actual Node debugger did not launch');
  const debugStatus = await until('Debugger session', () => invoke('ide.status'), value => value.debugSessions.some(session => session.threadCount > 0));
  const debugId = debugStatus.debugSessions.find(session => session.threadCount > 0 && session.current)?.id || debugStatus.debugSessions.find(session=>session.threadCount>0).id;
  const threads = await until('Debug threads', () => invoke('ide.debug.request', { sessionId: debugId, command: 'threads' }), value => value.body?.threads?.length);
  record('Actual debug adapter threads', threads);
  const stack = await invoke('ide.debug.request', { sessionId: debugId, command: 'stackTrace', args: { threadId: threads.body.threads[0].id } });
  if (!stack.body?.stackFrames?.length) throw new Error('Debugger did not pause at an actual source stack frame');
  record('Actual paused source stack', stack);
  await invoke('ide.debug.stop', { sessionId: debugId });
  const current = await invoke('ide.read', { path: 'src/main.ts' });
  await invoke('ide.edit', { path: 'src/main.ts', expectedVersion: current.version, expectedRevision: current.revision, operationId: 'live-recover-draft-01', edits: [{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:'// unsaved recovery fixture\n'}] });
  await invoke('ide.restart');
  await invoke('ide.status');
  const recovered = await invoke('ide.read', { path:'src/main.ts' });
  if (!recovered.dirty || !recovered.text.startsWith('// unsaved recovery fixture')) throw new Error('Unsaved draft did not survive an actual backend restart');
  record('Unsaved buffer recovered after actual IDE backend restart', {dirty:recovered.dirty,text:recovered.text.slice(0,80)});
  try { await invoke('ide.edit', { path:'src/main.ts',expectedVersion:recovered.version,expectedRevision:current.revision,operationId:'live-old-lifetime-01',edits:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:'bad'}] }); throw new Error('Old lifetime revision accepted'); } catch(error) { if(!String(error).includes('STALE_REVISION'))throw error; record('Old document lifetime rejected after restart even with matching numeric version',true); }
  if(process.platform!=='win32') {
    const engines=await invoke('ide.list'), previousPid=engines[0].pid;
    await application.evaluate((_electron,pid)=>process.kill(pid,'SIGKILL'),previousPid);
    await new Promise(resolve=>setTimeout(resolve,300));
    const restarted=await invoke('ide.status'), buffer=await invoke('ide.read',{path:'src/main.ts'});
    if(!buffer.dirty || !buffer.text.startsWith('// unsaved recovery fixture'))throw new Error('Backend crash lost the live dirty document');
    const next=(await invoke('ide.list'))[0];if(next.pid===previousPid)throw new Error('Backend crash did not replace its process');
    record('Forced backend crash replaces process/view and preserves live dirty document',{differentPid:true,dirty:buffer.dirty});
  }
  const diskBefore=await fs.readFile(path.join(fixture,'src/main.ts'),'utf8');
  await fs.writeFile(path.join(fixture,'src/main.ts'),'// external write\n'+diskBefore);
  await invoke('ide.restart');const conflict=await invoke('ide.status');
  if(!conflict.recovery.drafts.some(d=>d.conflict))throw new Error('External disk conflict not preserved');
  const preserved=await invoke('ide.recovery.read',{path:'src/main.ts'});
  if(!preserved.text.startsWith('// unsaved recovery fixture'))throw new Error('Conflicting recovery draft lost');
  if(!(await fs.readFile(path.join(fixture,'src/main.ts'),'utf8')).startsWith('// external write'))throw new Error('External disk changes overwritten');
  record('Recovery preserves both external disk edit and conflicting unsaved draft',{conflict:true});
  await invoke('ide.recovery.discard',{path:'src/main.ts'});
  const commands = await page.evaluate(async (projectId) => window.workbench.invoke('ide.commands', { projectId, query: 'git', limit: 300 }), project.id);
  if (!commands.some(command => command.id === 'git.refresh')) throw new Error('Git extension commands missing');
  record('Actual Git commands registered', commands.map(value => value.id));
  await page.getByRole('button',{name:'Чат',exact:true}).click();
  if(await page.locator('section.conversation-area').isVisible())throw new Error('Chat did not hide');
  await page.getByRole('button',{name:'Чат',exact:true}).click();
  if(!await page.locator('section.conversation-area').isVisible())throw new Error('Chat did not return');
  record('Chat hide/return from the same left rail button',true);
  await page.getByRole('button',{name:'План задачи',exact:true}).click();
  const planTab=page.getByRole('tab',{name:'План задачи',exact:true});
  const ideTab=page.getByRole('tab',{name:'IDE',exact:true});
  const from=await planTab.boundingBox(), to=await page.locator('section.dock-content[aria-label="IDE"]').boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:18});await page.mouse.up();
  const grouped=await page.evaluate(()=>JSON.parse(localStorage.getItem('workbench.layout.v2')));
  const containsGroup=node=>node?.kind==='group'?node.tabs.includes('files')&&node.tabs.includes('plan'):containsGroup(node?.a)||containsGroup(node?.b);
  if(!containsGroup(grouped.tree))throw new Error('Mouse center drop did not group panels');
  record('Actual mouse drag groups tabs in the same pane',grouped.tree);
  await page.getByRole('button',{name:'Скрыть План задачи',exact:true}).click();
  await page.getByRole('tab',{name:'IDE',exact:true}).click();
  const ideHeader=page.getByRole('tab',{name:'IDE',exact:true}).locator('xpath=ancestor::div[contains(@class,"desktop-dock-header")]');
  await ideHeader.getByRole('button',{name:'Развернуть панель',exact:true}).click();
  if(await page.locator('section.conversation-area').isVisible())throw new Error('Maximizing IDE did not hide chat');
  await ideHeader.getByRole('button',{name:'Вернуть расположение',exact:true}).click();
  await invoke('ide.layout',{explorer:true,bottom:false});
  for (const theme of ['dark','light']) {
    await invoke('settings.update',{patch:{theme}});
    await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
    await until('Native '+theme+' theme matches the host',()=>invoke('ide.status'),value=>value.theme?.toLowerCase().includes(theme));
    await new Promise(resolve=>setTimeout(resolve,300));
    const surfaces=await application.evaluate(async ({BrowserWindow})=> {
      const win=BrowserWindow.getAllWindows()[0], [width,height]=win.getContentSize();
      const base=(await win.capturePage()).toPNG().toString('base64');
      const children=[];
      for(const child of win.contentView.children)if(child.webContents && child.getVisible() && child.webContents.getURL().startsWith('http://localhost:')) children.push({bounds:child.getBounds(),png:(await child.webContents.capturePage()).toPNG().toString('base64')});
      return {base,width,height,children};
    });
    const base=Buffer.from(surfaces.base,'base64'),meta=await sharp(base).metadata(),scale=meta.width/surfaces.width;
    const layers=[];for(const child of surfaces.children)layers.push({input:await sharp(Buffer.from(child.png,'base64')).resize(Math.round(child.bounds.width*scale),Math.round(child.bounds.height*scale)).toBuffer(),left:Math.round(child.bounds.x*scale),top:Math.round(child.bounds.y*scale)});
    if(!layers.length)throw new Error('Native IDE not visible after panel layout changes');
    await sharp(base).composite(layers).toFile(path.join(temporary,'workspace-'+theme+'.png'));
    record('Actual native IDE surface composited with host '+theme+' theme',{file:'workspace-'+theme+'.png',children:surfaces.children.map(c=>c.bounds)});
  }
  const native = await application.evaluate(async ({ webContents }) => {
    const all = webContents.getAllWebContents();
    const ide = all.find(value => value.getURL().startsWith('http://localhost:') && value.getURL().includes('/#'));
    if (!ide) throw new Error('Native IDE view missing');
    return { id: ide.id, url: ide.getURL(), text: await ide.executeJavaScript('document.body.innerText.slice(0, 7000)') };
  });
  await fs.writeFile(path.join(temporary, 'native-ui.json'), JSON.stringify(native, null, 2));
  console.log('Native UI:', native.text.slice(0, 2500));
  const capture = await page.evaluate(async (projectId) => window.workbench.invoke('ide.capture', { projectId }), project.id);
  record('Native editor screenshot', capture);
  await fs.writeFile(path.join(temporary, 'result.json'), JSON.stringify({ results, errors, fixture, temporary, level: 'live Electron / real Theia on ' + process.platform }, null, 2));
  console.log('LIVE_IDE_REPORT', path.join(temporary, 'result.json'));
} catch (error) {
  if(application) {
    const channels=await application.evaluate(async ({webContents})=>{const view=webContents.getAllWebContents().find(v=>v.getURL().startsWith('http://localhost:'));if(!view)return [];const channels=await view.executeJavaScript('window.workbenchIDE.invoke("output")');const logs=[];for(const channel of channels)logs.push(await view.executeJavaScript('window.workbenchIDE.invoke("output",'+JSON.stringify({channel:channel.name,limit:12000})+')'));return logs;}).catch(error=>({error:String(error)}));
    await fs.writeFile(path.join(temporary,'native-output.json'),JSON.stringify(channels,null,2));
    const native = await application.evaluate(async ({webContents})=>{const view=webContents.getAllWebContents().find(v=>v.getURL().startsWith('http://localhost:'));return view ? {status:await view.executeJavaScript('window.workbenchIDE?.invoke("status")').catch(e=>String(e)), text: await view.executeJavaScript('document.body.innerText.slice(-10000)')} : {};}).catch(()=>({})); await fs.writeFile(path.join(temporary,'native-error.json'), JSON.stringify(native,null,2)); console.error('NATIVE_ERROR',JSON.stringify(native).slice(-4000)); }
  console.error('LIVE_IDE_FAILED', String(error), String(error?.stdout||'').slice(-5000), String(error?.stderr||'').slice(-5000), 'data:', temporary);
  await fs.writeFile(path.join(temporary, 'result.json'), JSON.stringify({ results, errors, failure: String(error), temporary }, null, 2));
  process.exitCode = 1;
} finally {
  if (keep && application) { console.log('IDE QA window retained for inspection.'); await new Promise(() => {}); }
  await application?.close();
}
