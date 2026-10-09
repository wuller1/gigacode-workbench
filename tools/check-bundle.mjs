// Read-only integrity checks. Does not execute scripts, repair hashes, or install anything.
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

async function localFile(base,relative) {
  if(typeof relative!=='string'||!relative||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error(`Unsafe relative path: ${relative}`);
  let file=base;
  for(const segment of relative.split('/')){file=path.join(file,segment);if((await fs.lstat(file)).isSymbolicLink())throw new Error(`Linked path: ${relative}`);}
  if(!(await fs.stat(file)).isFile())throw new Error(`Not a regular file: ${relative}`);
  return fs.readFile(file);
}
async function checked(label,fn) {try{return await fn();}catch(error){issues.push({check:label,error:error.message});return undefined;}}
async function inventory(directory,prefix='') {
  const files=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const relative=prefix+entry.name;
    if(entry.isSymbolicLink()){issues.push({check:'inventory',error:`Linked path: ${relative}`});continue;}
    if(entry.isDirectory())files.push(...await inventory(path.join(directory,entry.name),relative+'/'));
    else if(entry.isFile()&&relative!=='MANIFEST.txt')files.push(relative);
  }
  return files;
}

let scriptsChecked=0,manifestChecked=0,linksChecked=0;
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
  for(const file of await inventory(bundle))if(!listed.has(file))issues.push({check:'manifest inventory',error:`Unlisted file: ${file}`});
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
console.log(JSON.stringify({ok:issues.length===0,scriptsChecked,manifestChecked,linksChecked,issues},null,2));
process.exitCode=issues.length?1:0;
