/* Actual prototype schema preference controller, tested without a database. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const file = 'design/suite-prototype-schema-filter.js';
const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
function api(window = {}) {
  const context = {window};
  vm.createContext(context);
  vm.runInContext(source, context);
  return window.SuiteSchemaFilter;
}
const controller = api();
const key = controller.storageKey;
function memory(seed) {
  const values = new Map(seed ? [[key, seed]] : []);
  return {getItem:k=>values.get(k)||null, setItem:(k,v)=>values.set(k,v)};
}
const names = value => Array.from(value);
const catalog = [{name:'public'}, {name:'payments'}, {name:'audit'}, {name:'information_schema',system:true}, {name:'pg_catalog',system:true}];
const tests = [];
function test(name, fn) {
  try {fn();tests.push({name,pass:true});}
  catch (error) {tests.push({name,pass:false,error:error.stack});}
}
test('Unset defaults exclude system schemas',()=>{
  assert.deepEqual(names(controller.create({storage:null}).get('db',catalog)),['public','payments','audit']);
});
test('String catalogs and explicit system descriptor work',()=>{
  assert.deepEqual(names(controller.create({storage:null}).get('db',['public','pg_catalog','information_schema',{name:'custom',system:true},{name:'pg_explicit',system:false}])),['public','pg_explicit']);
});
test('Selection persists and remounts',()=>{
  const storage = memory();
  controller.create({storage}).set('connection-a|endpoint-1',['payments'],catalog);
  assert.deepEqual(names(controller.create({storage}).get('connection-a|endpoint-1',catalog)),['payments']);
  assert.equal(JSON.parse(storage.getItem(key)).version,1);
});
test('Connection and endpoint scopes stay isolated',()=>{
  const c = controller.create({storage:memory()});
  c.set('a|host-1',['payments'],catalog);
  c.set('a|host-2',['audit'],catalog);
  c.set('b|host-1',[],catalog);
  assert.deepEqual(names(c.get('a|host-1',catalog)),['payments']);
  assert.deepEqual(names(c.get('a|host-2',catalog)),['audit']);
  assert.deepEqual(names(c.get('b|host-1',catalog)),[]);
});
test('Explicit empty selection survives remount and discovery',()=>{
  const storage = memory();
  controller.create({storage}).set('db',[],catalog);
  assert.deepEqual(names(controller.create({storage}).get('db',[...catalog,'new_schema'])),[]);
});
test('Null resets to defaults; persisted null is unset',()=>{
  const c = controller.create({storage:memory(JSON.stringify({version:1,scopes:{db:null}}))});
  assert.deepEqual(names(c.get('db',catalog)),['public','payments','audit']);
  c.set('db',[],catalog);
  assert.deepEqual(names(c.set('db',null,catalog)),['public','payments','audit']);
});
test('Newly discovered schemas are not added to explicit selections',()=>{
  const c = controller.create({storage:memory()});
  c.set('db',['payments'],catalog);
  assert.deepEqual(names(c.get('db',[...catalog,'new_schema'])),['payments']);
});
test('Unavailable selections disappear and return when catalog returns',()=>{
  const storage = memory();
  const c = controller.create({storage});
  c.set('db',['payments','audit'],catalog);
  assert.deepEqual(names(c.get('db',['public','audit'])),['audit']);
  assert.deepEqual(names(controller.create({storage}).get('db',catalog)),['payments','audit']);
});
test('Set removes unknown and stale names and deduplicates in catalog order',()=>{
  const c = controller.create({storage:memory()});
  assert.deepEqual(names(c.set('db',['unknown','audit','payments','audit',null],catalog)),['payments','audit']);
  assert.deepEqual(names(c.set('db',['payments','audit'],['audit'])),['audit']);
  assert.deepEqual(names(c.get('db',catalog)),['audit']);
});
test('System schema may be explicitly selected',()=>{
  assert.deepEqual(names(controller.create({storage:null}).set('db',['pg_catalog'],catalog)),['pg_catalog']);
});
test('Prototype-sensitive and Unicode scope/schema names remain literal',()=>{
  const storage = memory();
  const unusual = ['__proto__','constructor','toString','платежи','报价','weird name','PAYMENTS','payments'];
  const c = controller.create({storage});
  c.set('__proto__',unusual,unusual);
  assert.deepEqual(names(controller.create({storage}).get('__proto__',unusual)),unusual);
  assert.equal(Object.prototype.polluted,undefined);
});
test('Result and controller snapshots are immutable and detached from input',()=>{
  const c = controller.create({storage:memory()});
  const selected = ['payments'];
  const result = c.set('db',selected,catalog);
  selected.push('audit');
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(c),true);
  assert.equal(Object.isFrozen(controller),true);
  assert.throws(()=>result.push('audit'));
  assert.deepEqual(names(c.get('db',catalog)),['payments']);
});
for (const seed of ['{broken','null','[]',JSON.stringify({version:88,scopes:{db:[]}}),JSON.stringify({version:1,scopes:['wrong']}),JSON.stringify({version:1,scopes:{db:[null]}})]) {
  test('Invalid persisted state falls back safely: '+seed,()=>{
    assert.deepEqual(names(controller.create({storage:memory(seed)}).get('db',catalog)),['public','payments','audit']);
  });
}
test('Denied reads/writes preserve in-memory selection',()=>{
  const c = controller.create({storage:{getItem(){throw Error('denied');},setItem(){throw Error('quota');}}});
  assert.deepEqual(names(c.set('db',['audit'],catalog)),['audit']);
  assert.deepEqual(names(c.get('db',catalog)),['audit']);
});
test('Denied global storage getter does not throw',()=>{
  const window = {};
  Object.defineProperty(window,'localStorage',{get(){throw Error('denied');}});
  const c = api(window).create();
  assert.deepEqual(names(c.set('db',[],catalog)),[]);
});
test('Default storage path works',()=>{
  const storage = memory();
  api({localStorage:storage}).create().set('db',['audit'],catalog);
  assert.deepEqual(names(api({localStorage:storage}).create().get('db',catalog)),['audit']);
});
test('Malformed input has no persistence side effects',()=>{
  const storage = memory();
  const c = controller.create({storage});
  assert.deepEqual(names(c.set('',[],catalog)),['public','payments','audit']);
  assert.deepEqual(names(c.set('db',undefined,catalog)),['public','payments','audit']);
  assert.equal(storage.getItem(key),null);
  assert.deepEqual(names(c.get('db',[null,{},'',44,'public','public'])),['public']);
});
test('Only selection names/scopes/version are persisted',()=>{
  const storage = memory();
  controller.create({storage}).set('connection-id|endpoint-id',['public'],[{name:'public',password:'SECRET',sql:'select private;'}]);
  const persisted = storage.getItem(key);
  assert.equal(persisted.includes('SECRET'),false);
  assert.equal(persisted.includes('select private'),false);
  assert.deepEqual(JSON.parse(persisted),{version:1,scopes:{'connection-id|endpoint-id':['public']}});
});
const result = {
  scope:'Actual prototype schema preference module in Node VM. No database execution or live UI claim.',
  sourceHashes:{[file]:crypto.createHash('sha256').update(source).digest('hex')},
  passed:tests.filter(t=>t.pass).length,failed:tests.filter(t=>!t.pass).length,tests
};
const output = process.argv[2] || path.join(__dirname,'schema-filter-audit.json');
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,failed:result.failed,output}));
for (const failure of tests.filter(t=>!t.pass)) console.error(failure.name+'\n'+failure.error);
if (result.failed) process.exitCode=1;
