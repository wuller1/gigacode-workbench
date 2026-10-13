// Read-only integrity checks. Does not execute bundled scripts, repair hashes, or install anything.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundle=path.join(root,'workbench');
const issues=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected=new Map([
  ['prepare-scripts','prepare-scripts.ps1'],['workbench','workbench.ps1'],['install-user','install-user.ps1'],
  ['docs-impact','tools/docs-impact.ps1'],['design-metrics','tools/design-metrics.ps1'],['memory','tools/memory.ps1'],
  ...['test-workbench','test-docs-impact','test-design-metrics','test-install-user','test-memory','run-tests'].map(n=>[n,`tests/${n}.ps1`]),
].map(([source,target])=>[`source/${source}.txt`,target]));
const canonicalRoles=[
  'analyst','architect','backend','database','designer','devops','diagnostics','frontend','gigacode-ui','qa','reviewer','security','spec','technical-writer',
];

async function localFile(base,relative) {
  if(typeof relative!=='string'||!relative||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error(`Unsafe relative path: ${relative}`);
  let file=base;
  for(const segment of relative.split('/')){file=path.join(file,segment);if((await fs.lstat(file)).isSymbolicLink())throw new Error(`Linked path: ${relative}`);}
  if(!(await fs.stat(file)).isFile())throw new Error(`Not a regular file: ${relative}`);
  return fs.readFile(file);
}
async function checked(label,fn,scope='legacy') {try{return await fn();}catch(error){issues.push({scope,check:label,error:error.message});return undefined;}}
function issue(check,error,scope='suite'){issues.push({scope,check,error});}
function requireCondition(condition,check,error,scope='suite'){if(!condition)issue(check,error,scope);}
function duplicates(values){return [...new Set(values.filter((value,index)=>values.indexOf(value)!==index))];}
function compareExactSet(check,actual,expectedValues) {
  if(!Array.isArray(actual)){issue(check,'Expected an array');return;}
  const invalid=actual.filter(value=>typeof value!=='string'||!value);
  const repeated=duplicates(actual);
  const actualSet=new Set(actual);
  const expectedSet=new Set(expectedValues);
  const missing=expectedValues.filter(value=>!actualSet.has(value));
  const extra=[...actualSet].filter(value=>!expectedSet.has(value));
  if(invalid.length||repeated.length||missing.length||extra.length)issue(check,JSON.stringify({invalid,repeated,missing,extra}));
}
async function inventory(directory,prefix='') {
  const files=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const relative=prefix+entry.name;
    if(entry.isSymbolicLink()){issues.push({scope:'legacy',check:'inventory',error:`Linked path: ${relative}`});continue;}
    if(entry.isDirectory())files.push(...await inventory(path.join(directory,entry.name),relative+'/'));
    else if(entry.isFile()&&relative!=='MANIFEST.txt')files.push(relative);
  }
  return files;
}
async function regularNames(directory,suffix,check) {
  const names=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    if(entry.isSymbolicLink()){issue(check,`Linked path is not allowed: ${entry.name}`);continue;}
    if(entry.isFile()&&entry.name.endsWith(suffix))names.push(entry.name);
  }
  return names.sort();
}
async function readJson(base,relative,label,scope='suite') {
  return checked(label,async()=>JSON.parse((await localFile(base,relative)).toString('utf8')),scope);
}

let scriptsChecked=0,manifestChecked=0,linksChecked=0;
let planCardsChecked=0,acceptanceChecked=0,rolesChecked=0,workflowsChecked=0,uiKitFilesChecked=0,prototypeMarkersChecked=0;
await checked('scripts.json',async()=>{
  const map=JSON.parse((await localFile(bundle,'scripts.json')).toString('utf8'));
  if(map.schema_version!==1||!Array.isArray(map.scripts)||map.scripts.length!==expected.size)throw new Error('Expected schema version 1 and exactly 12 mappings');
  const seen=new Set();
  for(const entry of map.scripts)await checked(entry.source||'script mapping',async()=>{
    if(seen.has(entry.source)||expected.get(entry.source)!==entry.target||!/^[a-f0-9]{64}$/.test(entry.sha256))throw new Error('Unexpected or duplicate script mapping');
    seen.add(entry.source);
    const source=await localFile(bundle,entry.source),target=await localFile(bundle,entry.target);
    if(sha(source)!==entry.sha256||sha(target)!==entry.sha256)throw new Error('Source or ready PS1 differs from declared SHA-256');
    if(!source.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])))throw new Error('PowerShell source must preserve UTF-8 BOM');
    scriptsChecked++;
  });
});
await checked('MANIFEST.txt',async()=>{
  const text=(await localFile(bundle,'MANIFEST.txt')).toString('utf8');
  const listed=new Set();
  for(const line of text.split(/\r?\n/).filter(Boolean))await checked('manifest entry',async()=>{
    const match=/^([a-f0-9]{64})  (.+)$/.exec(line);
    if(!match)throw new Error('Malformed manifest line');
    const [,digest,relative]=match;
    if(relative==='MANIFEST.txt'||listed.has(relative))throw new Error(`Invalid duplicate/self entry: ${relative}`);
    listed.add(relative);
    if(sha(await localFile(bundle,relative))!==digest)throw new Error(`Hash mismatch: ${relative}`);
    manifestChecked++;
  });
  for(const file of await inventory(bundle))if(!listed.has(file))issues.push({scope:'legacy',check:'manifest inventory',error:`Unlisted file: ${file}`});
});
const documents=['README.md',...(await fs.readdir(path.join(root,'docs'))).filter(n=>n.endsWith('.md')).map(n=>'docs/'+n)];
for(const relative of documents)await checked(`links: ${relative}`,async()=>{
  const text=(await localFile(root,relative)).toString('utf8');
  for(const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target=match[1].replace(/^<|>$/g,'').split('#')[0];
    if(!target||/^[a-z][a-z0-9+.-]*:/i.test(target))continue;
    const resolved=path.resolve(root,path.dirname(relative),decodeURIComponent(target));
    if(!resolved.startsWith(root+path.sep))throw new Error('Documentation link escapes repository');
    await fs.access(resolved);linksChecked++;
  }
});

// Validate the machine-readable suite plan and its complete acceptance mapping without loading executable code.
const plan=await readJson(root,'suite/implementation-plan.json','suite plan JSON');
const acceptanceText=await checked('suite acceptance document',async()=>(await localFile(root,'docs/suite/ACCEPTANCE.md')).toString('utf8'),'suite');
let planAcceptance=[];
if(plan) {
  requireCondition(plan.schemaVersion===1,'suite plan schema','Expected schemaVersion 1');
  requireCondition(plan.statusLegend&&typeof plan.statusLegend==='object'&&!Array.isArray(plan.statusLegend),'suite plan schema','statusLegend must be an object');
  requireCondition(Array.isArray(plan.cards)&&plan.cards.length>0,'suite plan schema','cards must be a non-empty array');
  const cards=Array.isArray(plan.cards)?plan.cards:[];
  const ids=cards.map(card=>card?.id);
  for(const repeated of duplicates(ids))issue('suite plan card IDs',`Duplicate card ID: ${repeated}`);
  const idSet=new Set(ids.filter(id=>typeof id==='string'));
  const validStatuses=new Set(Object.keys(plan.statusLegend??{}));
  for(const [index,card] of cards.entries()) {
    const label=typeof card?.id==='string'?card.id:`card[${index}]`;
    requireCondition(card&&typeof card==='object'&&!Array.isArray(card),'suite plan card',`${label}: card must be an object`);
    if(!card||typeof card!=='object'||Array.isArray(card))continue;
    requireCondition(/^[A-Z][A-Z0-9]*-\d{2}$/.test(card.id??''),'suite plan card',`${label}: invalid ID`);
    requireCondition(typeof card.title==='string'&&card.title.trim().length>0,'suite plan card',`${label}: title must be non-empty`);
    requireCondition(validStatuses.has(card.status),'suite plan card',`${label}: unknown status ${card.status}`);
    requireCondition(typeof card.outcome==='string'&&card.outcome.trim().length>0,'suite plan card',`${label}: outcome must be non-empty`);
    for(const field of ['dependsOn','docs','acceptance','evidence'])requireCondition(Array.isArray(card[field]),'suite plan card',`${label}: ${field} must be an array`);
    const dependencies=Array.isArray(card.dependsOn)?card.dependsOn:[];
    const docRefs=Array.isArray(card.docs)?card.docs:[];
    const acceptance=Array.isArray(card.acceptance)?card.acceptance:[];
    requireCondition(docRefs.length>0,'suite plan card',`${label}: docs must not be empty`);
    requireCondition(acceptance.length>0,'suite plan card',`${label}: acceptance must not be empty`);
    for(const repeated of duplicates(dependencies))issue('suite plan dependency',`${label}: duplicate dependency ${repeated}`);
    for(const dependency of dependencies) {
      requireCondition(typeof dependency==='string','suite plan dependency',`${label}: dependency must be a string`);
      requireCondition(dependency!==card.id,'suite plan dependency',`${label}: self dependency`);
      requireCondition(idSet.has(dependency),'suite plan dependency',`${label}: missing dependency ${dependency}`);
    }
    for(const repeated of duplicates(docRefs))issue('suite plan docs',`${label}: duplicate doc ${repeated}`);
    for(const docRef of docRefs)await checked(`suite plan doc: ${label}`,async()=>{await localFile(root,docRef);},'suite');
    for(const repeated of duplicates(acceptance))issue('suite plan acceptance',`${label}: duplicate acceptance ID ${repeated}`);
    for(const acceptanceId of acceptance)requireCondition(/^[A-Z][A-Z0-9]*-\d+$/.test(acceptanceId),'suite plan acceptance',`${label}: invalid acceptance ID ${acceptanceId}`);
    planAcceptance.push(...acceptance);
    planCardsChecked++;
  }
  const visiting=new Set(),visited=new Set();
  let cycleReported=false;
  const cardsById=new Map(cards.filter(card=>card&&typeof card.id==='string').map(card=>[card.id,card]));
  const visit=(id,trail=[])=>{
    if(visiting.has(id)){
      if(!cycleReported)issue('suite plan dependency DAG',`Cycle: ${[...trail,id].join(' -> ')}`);
      cycleReported=true;
      return;
    }
    if(visited.has(id))return;
    visiting.add(id);
    for(const dependency of cardsById.get(id)?.dependsOn??[])if(cardsById.has(dependency))visit(dependency,[...trail,id]);
    visiting.delete(id);visited.add(id);
  };
  for(const id of cardsById.keys())visit(id);
}
if(acceptanceText!==undefined) {
  const defined=[...acceptanceText.matchAll(/\*\*([A-Z][A-Z0-9]*-\d+):\*\*/g)].map(match=>match[1]);
  requireCondition(defined.length>0,'suite acceptance mapping','No acceptance IDs found');
  for(const repeated of duplicates(defined))issue('suite acceptance mapping',`Duplicate definition: ${repeated}`);
  const definedSet=new Set(defined),mappedSet=new Set(planAcceptance);
  for(const id of mappedSet)if(!definedSet.has(id))issue('suite acceptance mapping',`Plan references undefined acceptance ID: ${id}`);
  for(const id of definedSet)if(!mappedSet.has(id))issue('suite acceptance mapping',`Acceptance ID is not mapped to a plan card: ${id}`);
  acceptanceChecked=defined.length;
}

// Keep role definitions synchronized across the distributable bundle, adapters, capabilities, and workflows.
const bundleDescriptor=await readJson(bundle,'bundle.json','role catalog: bundle.json');
const capabilityPolicy=await readJson(bundle,'config/profile-capabilities.json','role catalog: profile-capabilities.json');
if(bundleDescriptor)compareExactSet('role catalog: bundle',bundleDescriptor.profiles,canonicalRoles);
const profileNames=await checked('role catalog: profile files',async()=>(await regularNames(path.join(bundle,'profiles'),'.md','role catalog: profile files')).map(name=>name.slice(0,-3)),'suite');
if(profileNames)compareExactSet('role catalog: profile files',profileNames,canonicalRoles);
const adapterNames=await checked('role catalog: adapter files',async()=>(await regularNames(path.join(bundle,'adapters/gigacode/agents'),'.md','role catalog: adapter files')).map(name=>name.replace(/^workbench-|\.md$/g,'')),'suite');
if(adapterNames)compareExactSet('role catalog: adapter files',adapterNames,canonicalRoles);
if(capabilityPolicy)compareExactSet('role catalog: capability entries',Object.keys(capabilityPolicy.profiles??{}),canonicalRoles);
for(const role of canonicalRoles) {
  await checked(`role profile: ${role}`,async()=>{
    const profile=(await localFile(bundle,`profiles/${role}.md`)).toString('utf8');
    if(!profile.trim())throw new Error('Profile is empty');
  },'suite');
  await checked(`role adapter: ${role}`,async()=>{
    const adapter=(await localFile(bundle,`adapters/gigacode/agents/workbench-${role}.md`)).toString('utf8');
    if(!new RegExp(`^name:\\s*workbench-${role.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*$`,'m').test(adapter))throw new Error('Frontmatter name does not match role');
    if(!adapter.includes(`profiles/${role}.md`))throw new Error('Adapter does not reference its profile');
  },'suite');
  const capability=capabilityPolicy?.profiles?.[role];
  if(capability) {
    for(const field of ['allowed_potential','read_only_default']) {
      requireCondition(Array.isArray(capability[field]),'role capability entry',`${role}: ${field} must be an array`);
      for(const repeated of duplicates(Array.isArray(capability[field])?capability[field]:[]))issue('role capability entry',`${role}: duplicate ${field} value ${repeated}`);
    }
    const allowed=new Set(Array.isArray(capability.allowed_potential)?capability.allowed_potential:[]);
    for(const readCapability of Array.isArray(capability.read_only_default)?capability.read_only_default:[])if(!allowed.has(readCapability))issue('role capability entry',`${role}: read-only default is absent from allowed_potential: ${readCapability}`);
  }
  rolesChecked++;
}
const workflowNames=await checked('role catalog: workflow files',async()=>(await regularNames(path.join(bundle,'workflows'),'.json','role catalog: workflow files')).map(name=>name.slice(0,-5)),'suite');
if(bundleDescriptor&&workflowNames)compareExactSet('workflow catalog',bundleDescriptor.workflows,workflowNames);
const workflowRoleRefs=[];
for(const workflowName of workflowNames??[]) {
  const workflow=await readJson(bundle,`workflows/${workflowName}.json`,`workflow: ${workflowName}`);
  if(!workflow)continue;
  requireCondition(workflow.schema_version===1,'workflow schema',`${workflowName}: expected schema_version 1`);
  requireCondition(workflow.id===workflowName,'workflow schema',`${workflowName}: id does not match filename`);
  requireCondition(Array.isArray(workflow.stages)&&workflow.stages.length>0,'workflow schema',`${workflowName}: stages must be a non-empty array`);
  for(const [index,stage] of (Array.isArray(workflow.stages)?workflow.stages:[]).entries()) {
    const ref=stage?.profile;
    requireCondition(typeof ref==='string'&&ref.length>0,'workflow role reference',`${workflowName} stage ${index}: missing profile`);
    if(typeof ref==='string'){
      workflowRoleRefs.push(ref);
      if(!canonicalRoles.includes(ref))issue('workflow role reference',`${workflowName} stage ${index}: unknown profile ${ref}`);
    }
  }
  workflowsChecked++;
}
for(const role of canonicalRoles)if(!workflowRoleRefs.includes(role))issue('workflow role coverage',`No workflow stage references canonical role: ${role}`);

// Mirror the UI kit catalog's static checks here; never execute repository-provided checker code.
const uiKit=path.join(root,'ui-kit');
const uiKitJsonFiles=[
  'tokens/core.tokens.json','tokens/themes/light.tokens.json','tokens/themes/dark.tokens.json','tokens/themes/high-contrast.tokens.json',
  'registry/components.json','registry/icons.json','registry/templates.json','governance/ci-contract.json','governance/repository-policy.example.json',
];
const uiKitJson=new Map();
for(const relative of uiKitJsonFiles) {
  const value=await readJson(uiKit,relative,`UI kit JSON: ${relative}`);
  if(value!==undefined){uiKitJson.set(relative,value);uiKitFilesChecked++;}
}
const componentRegistry=uiKitJson.get('registry/components.json');
if(componentRegistry) {
  compareExactSet('UI kit required themes',componentRegistry.requiredThemes,['light','dark','high-contrast']);
  requireCondition(Array.isArray(componentRegistry.components)&&componentRegistry.components.length>0,'UI kit components','components must be a non-empty array');
  const ids=(componentRegistry.components??[]).map(component=>component?.id);
  for(const repeated of duplicates(ids))issue('UI kit components',`Duplicate component ID: ${repeated}`);
  for(const component of componentRegistry.components??[]) {
    requireCondition(typeof component?.id==='string'&&component.id.length>0,'UI kit components','Component ID must be non-empty');
    requireCondition(Array.isArray(component?.states),'UI kit components',`${component?.id}: states must be an array`);
    if(component?.kind==='interactive'&&!component.states?.includes('focus-visible'))issue('UI kit components',`${component.id}: missing focus-visible state`);
    for(const source of component?.sourceRefs??[])await checked(`UI kit component source: ${component?.id}`,async()=>{await localFile(uiKit,source);},'suite');
  }
}
const iconRegistry=uiKitJson.get('registry/icons.json');
if(iconRegistry) {
  requireCondition(Array.isArray(iconRegistry.icons)&&iconRegistry.icons.length>0,'UI kit icons','icons must be a non-empty array');
  const ids=(iconRegistry.icons??[]).map(icon=>icon?.id);
  for(const repeated of duplicates(ids))issue('UI kit icons',`Duplicate icon ID: ${repeated}`);
  if(iconRegistry.family?.licenseFile)await checked('UI kit icon license',async()=>{await localFile(uiKit,iconRegistry.family.licenseFile);},'suite');
  for(const icon of iconRegistry.icons??[])await checked(`UI kit icon: ${icon?.id??'unknown'}`,async()=>{
    if(icon.origin!=='original')throw new Error('non-original origin is not allowed in the starter');
    if(!/^[a-f0-9]{64}$/.test(icon.sha256??''))throw new Error('invalid declared SHA-256');
    const source=await localFile(uiKit,icon.source);
    if(sha(source)!==icon.sha256)throw new Error('SHA-256 mismatch');
    if(!source.toString('utf8').includes('viewBox="0 0 24 24"'))throw new Error('unexpected viewBox');
    uiKitFilesChecked++;
  },'suite');
}
const templateRegistry=uiKitJson.get('registry/templates.json');
if(templateRegistry) {
  requireCondition(Array.isArray(templateRegistry.templates)&&templateRegistry.templates.length>0,'UI kit templates','templates must be a non-empty array');
  const ids=(templateRegistry.templates??[]).map(template=>template?.id);
  for(const repeated of duplicates(ids))issue('UI kit templates',`Duplicate template ID: ${repeated}`);
  for(const template of templateRegistry.templates??[]) {
    const source=await readJson(uiKit,template.source,`UI kit template: ${template?.id??'unknown'}`);
    if(source){requireCondition(source.id===template.id,'UI kit templates',`${template.id}: registry/source ID mismatch`);uiKitFilesChecked++;}
  }
}
for(const [relative,value] of uiKitJson)if(relative.includes('tokens/')) {
  requireCondition(typeof value?.$schema==='string'&&value.$schema.includes('designtokens.org'),'UI kit tokens',`${relative}: missing Design Tokens schema`);
  requireCondition(relative.includes('/themes/')?Boolean(value.semantic):Boolean(value.core),'UI kit tokens',`${relative}: missing token root`);
}

// Keep the interactive prototype's minimum accessibility contract visible in source.
const prototype=await checked('suite prototype',async()=>(await localFile(root,'design/suite-workspace-prototype.html')).toString('utf8'),'suite');
if(prototype!==undefined) {
  const markers=[
    ['aria-label',/\baria-label\s*=/i],
    ['focus-visible',/:focus-visible\b/i],

  ];
  const motionScript=(await localFile(root,'design/suite-prototype-motion.js')).toString('utf8');
  const motionStyle=(await localFile(root,'design/suite-prototype-motion.css')).toString('utf8');
  const reducedContract=/matchMedia\(['"]\(prefers-reduced-motion: ?reduce\)['"]\)/.test(motionScript) && motionStyle.includes('[data-motion-effective=reduced]');
  requireCondition(reducedContract,'suite prototype accessibility','Missing effective reduced-motion policy');
  prototypeMarkersChecked+=reducedContract?1:0;
  for(const [name,pattern] of markers){const found=pattern.test(prototype);requireCondition(found,'suite prototype accessibility',`Missing ${name} contract marker`);prototypeMarkersChecked+=found?1:0;}
}

const legacyIssues=issues.filter(entry=>entry.scope==='legacy');
const suiteIssues=issues.filter(entry=>entry.scope==='suite');
console.log(JSON.stringify({
  ok:issues.length===0,
  scriptsChecked,manifestChecked,linksChecked,
  suite:{ok:suiteIssues.length===0,planCardsChecked,acceptanceChecked,rolesChecked,workflowsChecked,uiKitFilesChecked,prototypeMarkersChecked},
  legacyIssues,suiteIssues,issues,
},null,2));
process.exitCode=issues.length?1:0;
