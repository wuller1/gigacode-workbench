/** Stage a self-contained platform IDE; caches, credentials and developer history are excluded. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardenIdeDependencies } from '../../ide/tools/harden-dependencies.mjs';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), ide=path.resolve(app,'../ide');
await hardenIdeDependencies(ide);
const stage=path.join(app,'runtime/.ide-package');
const lock=JSON.parse(await fs.readFile(path.join(ide,'node-runtime-lock.json'),'utf8'));
const platform=`${process.platform}-${process.arch}`;
const nodeRoot=path.join(app,'runtime/ide-node',`node-${lock.version}-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);
const binding=JSON.parse(await fs.readFile(path.join(app,'runtime/ide-tools/bindings.json'),'utf8'))[platform];
if(!binding)throw new Error('Managed SDK missing; run npm run setup:ide');
await fs.stat(path.join(ide,'lib/frontend/index.html'));
await fs.rm(stage,{recursive:true,force:true}); await fs.mkdir(path.join(stage,'ide'),{recursive:true});
for(const name of ['lib','src-gen','node_modules','plugins','extensions'])await fs.cp(path.join(ide,name),path.join(stage,'ide',name),{recursive:true,dereference:true,filter:source=>!source.includes(`${path.sep}.cache${path.sep}`)});
for(const name of ['package.json','package-lock.json','plugins-lock.json','toolchains-lock.json','node-runtime-lock.json'])await fs.copyFile(path.join(ide,name),path.join(stage,'ide',name));
await fs.cp(nodeRoot,path.join(stage,'ide-node',path.basename(nodeRoot)),{recursive:true,dereference:true});
for(const relative of [binding.javaHome,binding.mavenHome,binding.sourceArchive].filter(Boolean)) {
  // Preserve the entire macOS JDK bundle as well as all distribution licenses.
  const bundled=process.platform==='darwin'&&relative.endsWith('Contents/Home')?path.dirname(path.dirname(relative)):relative;
  await fs.mkdir(path.dirname(path.join(stage,'ide-tools',bundled)),{recursive:true});
  await fs.cp(path.join(app,'runtime/ide-tools',bundled),path.join(stage,'ide-tools',bundled),{recursive:true,dereference:true});
}
await fs.writeFile(path.join(stage,'ide-tools/bindings.json'),JSON.stringify({[platform]:binding},null,2));
console.log('Self-contained IDE staged for '+platform+'. Build installers on their actual target platform.');
