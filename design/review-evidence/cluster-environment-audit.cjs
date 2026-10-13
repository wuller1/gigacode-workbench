/* Local Node VM audit of extracted prototype functions. No browser or live cluster. */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const files=['design/suite-prototype-tasks-ops.js','design/suite-prototype-shell.js'];
const [ops,shell]=files.map(file=>fs.readFileSync(path.join(root,file),'utf8'));
function extract(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a,'Source markers changed: '+start);return source.slice(a,b);}
const registry=extract(ops,'  const environmentStorage=','  const resourceBanks=');
const targets=extract(ops,'  function target(){','  function targetText');
const settingsFields=extract(shell,'function renderEnvironmentFields(){','address.placeholder=');
const tests=[];
function test(name,fn){try{fn();tests.push({name,pass:true});}catch(error){tests.push({name,pass:false,error:error.stack});}}
const plain=value=>JSON.parse(JSON.stringify(value));
function load(raw='{}',storageFailure=false){
  const context={connection:{id:'connection-0',fixtureKey:'corp',name:'Corp'},projectName:'Atlas',window:{},raw,storageFailure};
  vm.createContext(context);
  vm.runInContext(`
    let env='dev',namespace='payments',writes=0,renders=0,doneCalls=0,closed=false;
    let form={values:{}},error={hidden:true},focuses=0;
    const localStorage={getItem:()=>raw,setItem:(key,value)=>{if(storageFailure)throw Error('Storage unavailable');raw=value;writes++;}};
    const binding=()=>connection,project=()=>projectName;
    const esc=x=>String(x),field=(name,html)=>html;
    const $=selector=>selector==='form'?form:selector==='#stoEnvironmentError'?error:{focus:()=>focuses++};
    const dialog=()=>{form={values:{}};error={hidden:true};closed=false;return {close:()=>closed=true,addEventListener(){}};};
    class FormData{constructor(value){this.values=value.values;}get(key){return this.values[key];}}
    const renderCluster=()=>renders++,notice=()=>{};
    ${registry}
    ${targets}
    globalThis.audit={list:clusterEnvironments,target,resourceKey,setEnv:value=>env=value,setNames:value=>environmentNames=value,
      rename(values){renameEnvironments(connection,()=>doneCalls++);form.values=values;form.onsubmit({preventDefault(){}});},
      snapshot:()=>({raw,writes,renders,doneCalls,closed,error:JSON.parse(JSON.stringify(error)),focuses})};
  `,context);
  return context;
}
const c=load(),a=c.audit,captured=a.target(),key=a.resourceKey(captured);
test('Seeded targets use stable environment IDs',()=>{assert.equal(captured.environmentId,'dev');assert.equal(captured.cluster,'corp-dev-01');});
test('Rename preserves physical target and resource bank key',()=>{a.rename({dev:'Разработка',ift:'Приёмка'});const t=a.target();assert.equal(t.environment,'Разработка');assert.equal(t.environmentId,'dev');assert.equal(t.cluster,captured.cluster);assert.equal(a.resourceKey(t),key);});
test('Previously captured target retains its identity and historical display name',()=>{assert.equal(captured.environment,'ДЕВ');assert.equal(captured.cluster,'corp-dev-01');assert.equal(a.resourceKey(captured),key);});
test('Successful rename persists once and refreshes callback',()=>{const s=a.snapshot();assert.equal(s.writes,1);assert.equal(s.renders,1);assert.equal(s.doneCalls,1);assert.equal(s.closed,true);});
test('Reload restores renamed labels',()=>assert.equal(load(a.snapshot().raw).audit.target().environment,'Разработка'));
test('Second environment maps to its original distinct cluster',()=>{a.setEnv('ift');assert.equal(a.target().cluster,'corp-ift-01');assert.equal(a.target().environment,'Приёмка');assert.notEqual(a.resourceKey(a.target()),key);});
test('Connection labels are shared across projects',()=>{c.projectName='Nova';assert.equal(a.target().environment,'Приёмка');});
test('Other connections remain isolated and Sandbox has one target',()=>{c.connection={id:'connection-1',fixtureKey:'sandbox',name:'Sandbox',env:'ДЕВ'};assert.equal(a.target().environment,'ДЕВ');assert.equal(a.target().cluster,'sandbox-01');assert.equal(a.list(c.connection).length,1);});
test('Renaming Sandbox does not change its target or corporate names',()=>{const before=a.resourceKey(a.target());a.rename({default:'Песочница'});assert.equal(a.target().environment,'Песочница');assert.equal(a.resourceKey(a.target()),before);assert.equal(a.list({id:'connection-0',fixtureKey:'corp',name:'Corp'})[0].name,'Разработка');});
for(const [label,raw] of [
  ['invalid JSON','broken'],['null','null'],['array','[]'],['number','0'],['string','"text"'],
  ['null nested record','{"connection-0":null}'],['object label','{"connection-0":{"dev":{}}}'],
  ['whitespace label','{"connection-0":{"dev":"   "}}'],
  ['control character',JSON.stringify({'connection-0':{dev:'A\nB',ift:'Test'}})],
  ['overlong label',JSON.stringify({'connection-0':{dev:'x'.repeat(65)}})],
  ['duplicate labels',JSON.stringify({'connection-0':{dev:'Same',ift:'Same'}})],
  ['case-insensitive duplicates',JSON.stringify({'connection-0':{dev:'same',ift:'SAME'}})]
])test('Malformed saved registry falls back safely: '+label,()=>{const fixture=load(raw);assert.deepEqual(plain(fixture.audit.list(fixture.connection).map(e=>e.name)),['ДЕВ','ИФТ']);assert.equal(fixture.audit.target().cluster,'corp-dev-01');});
test('Saved labels are trimmed',()=>assert.equal(load('{"connection-0":{"dev":"  Work  ","ift":" Test "}}').audit.target().environment,'Work'));
for(const [label,values] of [
  ['empty',{dev:'',ift:'Test'}],['whitespace',{dev:'   ',ift:'Test'}],['long',{dev:'x'.repeat(65),ift:'Test'}],
  ['control',{dev:'A\nB',ift:'Test'}],['duplicate',{dev:'same',ift:'SAME'}]
])test('Actual rename submit rejects '+label,()=>{const fixture=load();fixture.audit.rename(values);const s=fixture.audit.snapshot();assert.equal(s.writes,0);assert.equal(s.closed,false);assert.equal(s.error.hidden,false);assert.equal(fixture.audit.target().environment,'ДЕВ');});
test('Storage failure does not apply or close rename',()=>{const fixture=load('{}',true);fixture.audit.rename({dev:'Work',ift:'Test'});const s=fixture.audit.snapshot();assert.equal(s.closed,false);assert.equal(s.error.hidden,false);assert.equal(fixture.audit.target().environment,'ДЕВ');assert.equal(s.renders,0);});
test('Missing connection has no environments and an explicit unbound target',()=>{const fixture=load();fixture.connection=null;assert.equal(fixture.audit.list(null).length,0);assert.equal(fixture.audit.target().environmentId,'unbound');});
test('Settings dynamically switches environment fields without copying their implementation',()=>{
  const fixture={window:{SuiteClusterEnvironments:{}},existing:true,c:{type:'Kubernetes'},type:{value:'Kubernetes'},env:{value:'Custom'},done(){}};
  vm.createContext(fixture);
  vm.runInContext(`let children=[];const environmentFields={replaceChildren:(...nodes)=>children=nodes};const clusterEnvironmentCard=()=>({kind:'registry'}),label=(name,input)=>({kind:'input',input});${settingsFields};globalThis.read=()=>children;`,fixture);
  assert.equal(fixture.read()[0].kind,'registry');
  fixture.type.value='Jenkins';fixture.type.onchange();assert.equal(fixture.read()[0].kind,'input');assert.equal(fixture.read()[0].input,fixture.env);
  fixture.type.value='Kubernetes';fixture.type.onchange();assert.equal(fixture.read()[0].kind,'registry');
  fixture.c.type='Jenkins';fixture.type.value='Kubernetes';fixture.type.onchange();assert.equal(fixture.read()[0].kind,'input');
  fixture.existing=false;fixture.c.type='Kubernetes';fixture.type.onchange();assert.equal(fixture.read()[0].kind,'input');
});
const result={scope:'Node VM audit of real extracted prototype functions; no live browser, MCP or cluster testing',sourceHashes:Object.fromEntries(files.map((file,i)=>[file,crypto.createHash('sha256').update(i? shell:ops).digest('hex')])),passed:tests.filter(t=>t.pass).length,failed:tests.filter(t=>!t.pass).length,tests};
const output=process.argv[2]||path.join(__dirname,'cluster-environment-audit.json');
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,failed:result.failed,output}));
for(const failure of tests.filter(t=>!t.pass))console.error(failure.name+'\n'+failure.error);
if(result.failed)process.exitCode=1;
