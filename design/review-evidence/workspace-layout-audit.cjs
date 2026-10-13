const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const file=process.argv[2]||require('node:path').resolve(__dirname,'../suite-prototype-workspace-layout.js');
const source=fs.readFileSync(file,'utf8');
const block=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const base=block('  const uid=','  const create=');
const transitions=block('  function openingTree(id)','  function makeDivider(');
const scope=block('  function changeScope(event)','  document.addEventListener(\'suite:scope-change\'');
const c={localStorage:{getItem(){return null},setItem(){}},window:{SuitePrototype:{project:()=> 'A'}},console};
vm.createContext(c);
vm.runInContext(`const ids=['chat','code','browser','agent-browser','tasks','design','ops','data','scm'], valid=new Set(ids), names=Object.fromEntries(ids.map(id=>[id,id]));\n${base}\nconst document={activeElement:null,querySelector(){return this.modal||null}},scroller={clientWidth:1200,clientHeight:700,scrollLeft:12,scrollTop:23};let drag=null,resize=null;const containers=new Map(),groups=new Map(),geometry=new Map(),modal={open:false,close(){this.open=false}},strip={focus(){}};let renders=0,focuses=0,commits=0;const render=()=>{renders++},focusPanel=()=>{focuses++},announce=()=>{},endPointer=()=>{};function commit(){commits++;persist();render()}\n${transitions}\n${scope}\nglobalThis.audit={normalize,leaves,remove,insert,move,dock,panelGroup,migrateLayout,balanced,minimum,updateRatio,locationOf,checked,open,reveal,close,maximize,swap,arrange,openAll,reset,changeScope,defaults,ids,geometry,containers,groups,document,scroller,read:()=>JSON.parse(JSON.stringify({state,project,bank,renders,focuses,commits})),set:s=>state=checked(s),setTree:t=>state={layoutVersion:2,tree:t,active:leaves(t)[0]||null,maximized:null,locations:{}},zero:()=>{renders=focuses=commits=0}};`,c);
const A=c.audit;const plain=v=>JSON.parse(JSON.stringify(v));const tests=[];let opCount=0;function test(name,fn){try{fn();tests.push({name,pass:true})}catch(e){tests.push({name,pass:false,error:e.stack})}}
function invariant(tree,expected){const ls=plain(A.leaves(tree));assert.equal(new Set(ls).size,ls.length);assert.deepEqual([...ls].sort(),[...expected].sort());const seen=new Set();(function walk(n){if(!n)return;if(n.kind==='leaf'){assert(A.ids.includes(n.id));return}if(n.kind==='group'){assert(n.tabs.length>1);assert(!seen.has(n.id));seen.add(n.id);return;}assert.equal(n.kind,'split');assert(['x','y'].includes(n.axis));assert(Number.isFinite(n.ratio));assert(n.a&&n.b);assert(!seen.has(n.id));seen.add(n.id);walk(n.a);walk(n.b)})(tree)}
let seed=137;function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}const choose=a=>a[Math.floor(random()*a.length)];
test('balanced 1..8 panels unique/full; remove collapses branches and leaves no lost siblings',()=>{for(let n=1;n<=8;n++){const ids=plain(A.ids).slice(0,n),t=A.balanced(ids);invariant(t,ids);for(const id of ids){const before=JSON.stringify(t),next=A.remove(t,id);invariant(next,ids.filter(x=>x!==id));assert.equal(JSON.stringify(t),before);opCount++}}});
test('all source/target/5 edge combinations preserve membership + immutable original',()=>{const ids=plain(A.ids),trees=[A.balanced(ids),A.balanced(ids,'y')];for(const tree of trees)for(const from of ids)for(const to of ids)for(const edge of ['left','right','top','bottom','center']){const before=JSON.stringify(tree),result=A.move(tree,from,to,edge);invariant(result,ids);assert.equal(JSON.stringify(tree),before);if(from===to)assert.equal(result,tree);opCount++}});
test('10000 randomized open/remove/move/arrange steps retain each expected panel exactly once',()=>{let t=null,expected=[];for(let i=0;i<10000;i++){const closed=plain(A.ids).filter(x=>!expected.includes(x));switch(Math.floor(random()*4)){case 0:if(closed.length){const id=choose(closed);t=A.insert(t,id,choose(expected),choose(['left','right','top','bottom']));expected.push(id)}break;case 1:if(expected.length){const id=choose(expected);t=A.remove(t,id);expected=expected.filter(x=>x!==id)}break;case 2:if(expected.length>1)t=A.move(t,choose(expected),choose(expected),choose(['left','right','top','bottom','center']));break;case 3:t=A.balanced(expected,choose(['x','y']));break}invariant(t,expected);opCount++}});
test('normalize rejects invalid/duplicate leaves and malformed/deep trees',()=>{const t={kind:'split',axis:'bad',ratio:Infinity,a:{kind:'leaf',id:'chat'},b:{kind:'split',a:{kind:'leaf',id:'chat'},b:{kind:'leaf',id:'bogus'}}};invariant(A.normalize(t),['chat']);assert.equal(A.normalize(null),null);assert.equal(A.normalize({kind:'bad'}),null);let nested={kind:'leaf',id:'chat'};for(let i=0;i<30;i++)nested={kind:'split',a:nested,b:null};assert.equal(A.normalize(nested),null)});
test('move invalid/self source leaves tree unchanged',()=>{const t=A.balanced(['chat','data']);for(const args of [['bad','chat'],['data','bad'],['chat','chat']])assert.equal(A.move(t,...args,'right'),t)});
test('agent reveal opens once without changing active panel, focus or scroll',()=>{A.scroller.clientWidth=2200;A.scroller.clientHeight=1100;A.setTree(A.balanced(['chat','browser']));A.zero();const before=A.read().state.active;assert.equal(A.reveal('agent-browser'),true);assert.equal(A.read().state.active,before);assert.equal(A.read().focuses,0);assert.equal(A.scroller.scrollLeft,12);assert.equal(A.scroller.scrollTop,23);assert.equal(A.reveal('agent-browser'),true);invariant(A.read().state.tree,['chat','browser','agent-browser']);A.scroller.clientWidth=1200;A.scroller.clientHeight=700});
test('agent reveal defers while typing, modal, maximized other panel or tight viewport',()=>{A.setTree(A.balanced(['chat','browser']));const before=JSON.stringify(A.read().state);A.document.activeElement={closest:()=>true};assert.equal(A.reveal('agent-browser'),false);assert.equal(JSON.stringify(A.read().state),before);A.document.activeElement=null;A.document.modal={};assert.equal(A.reveal('agent-browser'),false);A.document.modal=null;A.maximize('browser');assert.equal(A.reveal('agent-browser'),false);A.maximize('browser');A.scroller.clientWidth=768;A.scroller.clientHeight=500;assert.equal(A.reveal('agent-browser'),false);A.scroller.clientWidth=1200;A.scroller.clientHeight=700});
test('open existing is idempotent; close last gives empty; reopen recovers panel',()=>{A.setTree(A.balanced(['chat','data']));A.open('data');A.open('data');invariant(A.read().state.tree,['chat','data']);A.close('data');A.close('chat');assert.equal(A.read().state.tree,null);assert.equal(A.read().state.active,null);A.open('data');invariant(A.read().state.tree,['data'])});
test('maximize/restore preserves exact layout; close maximized keeps remaining layout',()=>{A.setTree(A.balanced(['chat','data','code']));const before=JSON.stringify(A.read().state.tree);A.maximize('data');assert.equal(A.read().state.maximized,'data');assert.equal(JSON.stringify(A.read().state.tree),before);A.maximize('data');assert.equal(A.read().state.maximized,null);assert.equal(JSON.stringify(A.read().state.tree),before);A.maximize('code');A.close('code');invariant(A.read().state.tree,['chat','data']);assert.equal(A.read().state.maximized,null)});
test('closed panel remembers sibling edge; reopen no duplicate',()=>{A.setTree(A.insert({kind:'leaf',id:'chat'},'code','chat','left'));A.close('code');A.open('code');assert.deepEqual(plain(A.leaves(A.read().state.tree)),['code','chat']);invariant(A.read().state.tree,['chat','code'])});
test('same project/task/session notification does not render or focus',()=>{A.zero();A.changeScope({detail:{project:'A',task:'T2',session:'S2'}});assert.equal(A.read().renders,0);assert.equal(A.read().focuses,0)});
test('project changes isolate layout and restore without missing/duplicated panels',()=>{A.setTree(A.balanced(['chat','data','code']));const original=JSON.stringify(A.read().state.tree);A.changeScope({detail:{project:'B'}});invariant(A.read().state.tree,['chat','browser']);A.close('browser');A.open('tasks');A.changeScope({detail:{project:'A'}});assert.equal(JSON.stringify(A.read().state.tree),original);A.changeScope({detail:{project:'B'}});invariant(A.read().state.tree,['chat','tasks'])});
test('active project rename retains exact tree and removes old bank',()=>{const before=JSON.stringify(A.read().state.tree);A.changeScope({detail:{project:'B renamed',previousProject:'B'}});assert.equal(JSON.stringify(A.read().state.tree),before);assert(!Object.hasOwn(A.read().bank,'B'));assert(Object.hasOwn(A.read().bank,'B renamed'))});
test('layout minimum recursive sizes are finite positive, keep leaf minimums for 0..3200 viewport',()=>{function place(t,x,y,w,h){if(!t)return;if(t.kind==='leaf'){assert(Number.isFinite(w)&&Number.isFinite(h));const m=A.minimum(t);assert(w>=m.w-1e-9&&h>=m.h-1e-9);return}const a=A.minimum(t.a),b=A.minimum(t.b),isX=t.axis==='x',total=(isX?w:h)-7,first=Math.max(isX?a.w:a.h,Math.min(total-(isX?b.w:b.h),total*t.ratio));place(t.a,x,y,isX?first:w,isX?h:first);place(t.b,isX?x+first+7:x,isX?y:y+first+7,isX?total-first:w,isX?h:total-first)}for(let n=1;n<=8;n++){const t=A.balanced(plain(A.ids).slice(0,n)),min=A.minimum(t);for(const width of [0,1,320,768,1440,3200])for(const height of [0,1,240,720,1800]){place(t,0,0,Math.max(width,min.w),Math.max(height,min.h));opCount++}}});
test('source uses mounted same view node; scope same-project guard and explicit keyboard alternative present',()=>{assert(source.includes('wrap.append(view)'));assert(!/view\.(innerHTML|outerHTML)\s*=/.test(source));assert(!/cloneNode/.test(source));assert(source.includes("form.onsubmit"));assert(source.includes("bar.setAttribute('role','separator')"));assert(source.includes("'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'"))});

test('normalize regenerates empty/duplicate persisted split IDs',()=>{const t={kind:'split',id:'same',axis:'x',ratio:.5,a:{kind:'split',id:'same',axis:'y',ratio:.5,a:{kind:'leaf',id:'chat'},b:{kind:'leaf',id:'code'}},b:{kind:'split',id:'',axis:'y',ratio:.5,a:{kind:'leaf',id:'data'},b:{kind:'leaf',id:'browser'}}};invariant(A.normalize(t),['chat','code','data','browser'])});
const domContext={localStorage:{getItem(){return null},setItem(){}},window:{SuitePrototype:{project:()=> 'A'},addEventListener(){}},console};vm.createContext(domContext);
const renderFns=block('  function makeDivider(','  const dragLayer=');
const pointerFns=block('  function endPointer(','  document.querySelectorAll(\'.rail-button');
vm.runInContext(`
const ids=['chat','code','browser','agent-browser','tasks','design','ops','data','scm'],valid=new Set(ids),names=Object.fromEntries(ids.map(id=>[id,id]));
${base}
class Node{constructor(tag='div',classes=''){this.tagName=tag;this.children=[];this.classes=new Set(classes.split(' ').filter(Boolean));this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),contains:x=>this.classes.has(x),toggle:(x,value)=>value?this.classes.add(x):this.classes.delete(x)};this.style={};this.dataset={};this.attrs={};this.events={};this._hidden=true;this.writes=[];this.removed=false;this.captured=null;this.focused=0;}get hidden(){return this._hidden}set hidden(x){this._hidden=x;this.writes.push(x)}setAttribute(k,v){this.attrs[k]=v}getAttribute(k){return this.attrs[k]}addEventListener(k,v){this.events[k]=v}append(...children){this.children.push(...children);children.forEach(n=>Object.defineProperty(n,'parentElement',{value:this,writable:true,configurable:true}))}replaceChildren(...children){this.children=[];this.append(...children)}matches(selector){if(selector.startsWith('.'))return this.classes.has(selector.slice(1));if(selector.startsWith('[')){const inner=selector.slice(1,-1),at=inner.indexOf('='),key=at<0?inner:inner.slice(0,at),raw=at<0?null:inner.slice(at+1),value=raw?.replace(/^['"]|['"]$/g,'');const actual=key.startsWith('data-')?this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:this.attrs[key];return at<0?actual!==undefined:String(actual)===value;}return this.tagName===selector}querySelectorAll(selector){return this.children.flatMap(n=>[...(n.matches(selector)?[n]:[]),...n.querySelectorAll(selector)])}querySelector(selector){return this.querySelectorAll(selector)[0]||null}closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null}focus(){this.focused++;document.activeElement=this}remove(){this.removed=true}setPointerCapture(id){this.captured=id}releasePointerCapture(id){if(this.captured===id)this.captured=null}getBoundingClientRect(){return {left:0,top:0}}}
const icons={close:'close'},containers=new Map(ids.map(id=>[id,new Node()])),dividers=new Map(),groups=new Map(),geometry=new Map(),splitGeometry=new Map(),empty=new Node(),canvas=new Node(),scroller={clientWidth:1440,clientHeight:900},create=(tag,classes)=>new Node(tag,classes),button=(label,path,fn,classes)=>{const n=new Node('button',classes);n.onclick=fn;n.setAttribute('aria-label',label);return n},syncControls=()=>{};let drag=null,resize=null,commits=0,focuses=0,dragCalls=0;const dragLayer=new Node(),document={body:{classList:{add(){},remove(){}}},events:{},activeElement:null,querySelector(){return null},addEventListener(k,v){this.events[k]=v}},focusPanel=()=>{focuses++},announce=()=>{},dragAt=()=>{dragCalls++},strip=new Node();function commit(){commits++;persist();render()}
${transitions}
${renderFns}
${pointerFns}
globalThis.dom={normalize,leaves,move,dock,group,minimum,balanced,render,endPointer,open,close,read:()=>JSON.parse(JSON.stringify({state,commits,focuses,dragCalls,drag,resize})),set:s=>state=checked(s),setTree:t=>state={layoutVersion:2,tree:t,active:leaves(t)[0]||null,maximized:null,locations:{}},size:(w,h)=>{scroller.clientWidth=w;scroller.clientHeight=h},max:id=>state.maximized=id,dividers,groups,containers,geometry,events:document.events,startDrag:(id,pointer,started,target,edge)=>{const owner=new Node();owner.setPointerCapture(pointer);drag={id,pointer,started,target,edge,owner};return owner}};`,domContext);
const D=domContext.dom;
test('actual render preserves visible leaf display across resizing, never temporarily hidden',()=>{D.size(1600,1100);D.setTree(D.balanced(['chat','data','code']));D.render();for(const n of D.containers.values())n.writes=[];D.size(1500,1000);D.render();for(const id of ['chat','data','code'])assert(!D.containers.get(id).writes.includes(true))});
test('actual render removes obsolete dividers after 200 moves; at most leaves-1 separators',()=>{D.size(16000,16000);let t=D.balanced(plain(A.ids));D.setTree(t);D.render();for(let i=0;i<200;i++){const from=choose(plain(A.ids)),to=choose(plain(A.ids));t=D.move(t,from,to,choose(['left','right','top','bottom','center']));D.setTree(t);D.render();const splits=n=>!n||n.kind!=='split'?0:1+splits(n.a)+splits(n.b);assert.equal(D.dividers.size,splits(t));for(const n of D.dividers.values())assert(!n.removed);opCount++}D.setTree(null);D.render();assert.equal(D.dividers.size,0)});
test('maximize hides separators but preserves their nodes, restore recovers them',()=>{D.setTree(D.balanced(['chat','data','code']));D.render();const before=new Map(D.dividers);D.max('data');D.render();assert.equal(D.dividers.size,2);for(const [id,n] of before){assert.equal(D.dividers.get(id),n);assert(n.hidden)}D.max(null);D.render();for(const [id,n] of before){assert.equal(D.dividers.get(id),n);assert(!n.hidden)}});
test('actual place creates finite positive geometry even 0x0; separators report numeric ARIA',()=>{for(const dims of [[0,0],[1,1],[768,720],[1440,900],[3200,1800]]){D.size(...dims);D.setTree(D.balanced(plain(A.ids)));D.render();for(const [id,g] of D.geometry){const m=D.minimum({kind:'leaf',id});assert(g.w>0&&g.h>0);const total=D.minimum(D.read().state.tree);assert(g.w<=Math.max(dims[0],total.w)&&g.h<=Math.max(dims[1],total.h));assert(Object.values(g).every(Number.isFinite))}for(const n of D.dividers.values()){assert(Number.isFinite(Number(n.attrs['aria-valuenow'])));assert(n.attrs['aria-orientation'])}}});
test('pointer owner rejects another pointer move/up; own up commits once and releases capture',()=>{D.setTree(D.balanced(['chat','data','code']));D.render();const start=D.read().commits,owner=D.startDrag('data',42,true,'chat','left');D.events.pointermove({pointerId:43});assert.equal(D.read().dragCalls,0);D.events.pointerup({pointerId:43});assert(D.read().drag);D.events.pointermove({pointerId:42});assert.equal(D.read().dragCalls,1);D.events.pointerup({pointerId:42});assert.equal(D.read().drag,null);assert.equal(owner.captured,null);assert.equal(D.read().commits,start+1);D.events.pointerup({pointerId:42});assert.equal(D.read().commits,start+1);invariant(D.read().state.tree,['chat','data','code'])});
test('lost capture cancels drag with no tree change; header click below threshold never moves',()=>{D.setTree(D.balanced(['chat','data']));D.render();const before=JSON.stringify(D.read().state.tree),start=D.read().commits;D.startDrag('data',7,true,'chat','left');D.events.lostpointercapture({pointerId:7});assert.equal(JSON.stringify(D.read().state.tree),before);assert.equal(D.read().commits,start);D.startDrag('data',8,false,null,null);D.events.pointerup({pointerId:8});assert.equal(JSON.stringify(D.read().state.tree),before);assert.equal(D.read().commits,start)});
test('actual separator captures pointer; wrong pointer ignored; cancel restores starting layout',()=>{D.size(1440,900);D.setTree(D.balanced(['chat','data']));D.render();const n=[...D.dividers.values()][0],before=JSON.stringify(D.read().state.tree);n.events.pointerdown({button:0,pointerId:19,clientX:600,clientY:10,preventDefault(){},stopPropagation(){}});assert.equal(n.captured,19);D.events.pointermove({pointerId:20,clientX:1000,clientY:10});assert.equal(JSON.stringify(D.read().state.tree),before);D.events.pointermove({pointerId:19,clientX:1000,clientY:10});assert.notEqual(JSON.stringify(D.read().state.tree),before);D.events.pointercancel({pointerId:19});assert.equal(JSON.stringify(D.read().state.tree),before);assert.equal(n.captured,null)});

test('explicit splits remain visible and keep exact tree across narrow and wide viewports',()=>{
 const tree={kind:'split',id:'root',axis:'x',ratio:.5,a:{kind:'leaf',id:'chat'},b:{kind:'split',id:'tools',axis:'y',ratio:.5,a:{kind:'leaf',id:'browser'},b:{kind:'leaf',id:'code'}}};D.set({tree,active:'code',layoutVersion:2});const before=JSON.stringify(D.read().state.tree);
 for(const size of [[1232,598],[768,500],[1800,1100],[320,240]]){D.size(...size);D.render();assert.equal(D.geometry.size,3);assert.equal([...D.groups.values()].filter(n=>!n.hidden).length,0);assert.equal(JSON.stringify(D.read().state.tree),before);}
});
test('only explicit tab groups hide siblings, and resizing never splits them apart',()=>{
 const tree=D.group(plain(A.ids));D.set({tree,active:'ops',layoutVersion:2});
 for(const size of [[768,500],[2200,1600]]){D.size(...size);D.render();assert.deepEqual([...D.geometry.keys()],['ops']);invariant(D.read().state.tree,plain(A.ids));const active=[...D.groups.values()].filter(n=>!n.hidden);assert.equal(active.length,1);assert.equal(active[0].querySelectorAll('[role=tab]').length,A.ids.length);assert.equal(active[0].querySelector('[aria-selected=true]').dataset.swTab,'ops');}
});

test('close active grouped panel selects adjacent tool instead of jumping to chat',()=>{A.set({tree:A.balanced(['chat','browser','code','data']),active:'code'});A.groups.set('tools',{hidden:false,dataset:{members:'browser|code|data'}});A.close('code');assert.equal(A.read().state.active,'data');A.groups.clear();});
test('agent reveal cannot switch an already-open but hidden working tab',()=>{A.setTree(A.balanced(['chat','browser']));A.containers.set('browser',{hidden:true});const before=JSON.stringify(A.read().state);assert.equal(A.reveal('browser'),false);assert.equal(JSON.stringify(A.read().state),before);A.containers.clear();});
test('agent presentation does not regroup or shrink user surfaces when available space is insufficient',()=>{A.setTree(A.balanced(['chat','browser']));A.scroller.clientWidth=1232;A.scroller.clientHeight=598;const before=JSON.stringify(A.read().state);assert.equal(A.reveal('agent-browser'),false);assert.equal(JSON.stringify(A.read().state),before);});

function groupedTools(active='code'){
  D.endPointer(true);D.size(768,500);
  D.set({tree:D.group(['browser','code','data']),active,locations:{},layoutVersion:2});D.render();
  return [...D.groups.values()].find(n=>!n.hidden);
}
function clickEvent(){return {stopped:0,prevented:0,stopPropagation(){this.stopped++},preventDefault(){this.prevented++}};}
test('each grouped tab has a separate accessible close button without nested buttons',()=>{
  const group=groupedTools();
  for(const id of ['browser','code','data']){
    const tab=group.querySelector('[data-sw-tab="'+id+'"]'),close=group.querySelector('[data-sw-close="'+id+'"]');
    assert(tab&&close);assert.equal(tab.parentElement,close.parentElement);assert.equal(tab.parentElement.attrs.role,'presentation');assert.equal(close.attrs['aria-label'],'Закрыть вкладку '+id);assert.equal(tab.querySelectorAll('button').length,0);
  }
});
test('active grouped tab cross invokes actual close handler and focuses adjacent survivor',()=>{
  const group=groupedTools('code'),close=group.querySelector('[data-sw-close="code"]'),event=clickEvent(),commits=D.read().commits;
  close.onclick(event);assert.equal(event.stopped,1);assert.equal(D.read().commits,commits+1);assert.equal(D.read().state.active,'data');invariant(D.read().state.tree,['browser','data']);assert.equal(D.containers.get('code').hidden,true);
  const survivor=[...D.groups.values()].find(n=>!n.hidden)?.querySelector('[data-sw-tab="data"]');assert(survivor);assert.equal(survivor.focused,1);
});
test('background grouped tab cross closes only its panel and preserves active selection',()=>{
  const group=groupedTools('code'),close=group.querySelector('[data-sw-close="browser"]');
  close.onclick(clickEvent());assert.equal(D.read().state.active,'code');invariant(D.read().state.tree,['code','data']);assert.equal(D.containers.get('code').hidden,false);assert.equal(D.containers.get('browser').hidden,true);
});
test('grouped close pointerdown does not capture pointer or begin drag; title still drags',()=>{
  const group=groupedTools('code'),close=group.querySelector('[data-sw-close="browser"]'),event={...clickEvent(),button:0,pointerId:71,clientX:120,clientY:12};
  close.onpointerdown(event);assert.equal(event.stopped,1);assert.equal(close.captured,null);assert.equal(D.read().drag,null);
  const tab=group.querySelector('[data-sw-tab="browser"]');tab.onpointerdown({...clickEvent(),button:0,pointerId:72,clientX:120,clientY:12});assert.equal(tab.captured,72);assert.equal(D.read().drag.id,'browser');D.events.pointerup({pointerId:72});assert.equal(D.read().drag,null);assert.equal(tab.captured,null);
});
test('Delete closes focused grouped tab and arrow navigation remains usable',()=>{
  let group=groupedTools('code'),tab=group.querySelector('[data-sw-tab="code"]'),event={...clickEvent(),key:'Delete'};
  tab.onkeydown(event);assert.equal(event.prevented,1);assert.equal(event.stopped,1);assert.equal(D.read().state.active,'data');invariant(D.read().state.tree,['browser','data']);
  group=[...D.groups.values()].find(n=>!n.hidden);tab=group.querySelector('[data-sw-tab="data"]');tab.onkeydown({...clickEvent(),key:'ArrowLeft'});assert.equal(D.read().state.active,'browser');assert(group.querySelector('[data-sw-tab="browser"]').focused>0);
});

test('center drop creates a real tab group; right drop separates it and preserves siblings',()=>{
 let tree=A.balanced(['chat','code','browser']);tree=A.move(tree,'browser','code','center');assert.equal(A.panelGroup(tree,'code').kind,'group');assert.deepEqual(plain(A.panelGroup(tree,'code').tabs),['code','browser']);
 tree=A.move(tree,'browser','code','right');assert.equal(A.panelGroup(tree,'code').kind,'leaf');assert.equal(A.panelGroup(tree,'browser').kind,'leaf');invariant(tree,['chat','code','browser']);
});
test('drop on a group edge splits beside the entire group, not inside its selected tab',()=>{
 const grouped=A.move(A.balanced(['code','browser','data']),'browser','code','center'),tree=A.move(grouped,'data','code','bottom'),node=A.panelGroup(tree,'code');assert.deepEqual(plain(node.tabs),['code','browser']);assert.equal(tree.axis,'y');assert.equal(tree.a.kind,'group');assert.equal(tree.b.id,'data');
});
test('rail docking can open a closed tool and cannot duplicate an open tool',()=>{
 let tree=A.balanced(['chat','code']);tree=A.dock(tree,'data','code','right');invariant(tree,['chat','code','data']);tree=A.dock(tree,'data','code','center');invariant(tree,['chat','code','data']);assert.equal(A.leaves(tree).filter(id=>id==='data').length,1);
});
test('new tools join active tool group instead of inferring split direction from width',()=>{
 A.setTree(A.balanced(['chat','code']));A.open('code');A.open('data');assert.deepEqual(plain(A.panelGroup(A.read().state.tree,'code').tabs),['code','data']);A.open('browser');assert.deepEqual(plain(A.panelGroup(A.read().state.tree,'code').tabs),['code','data','browser']);
});
test('closing and reopening a grouped tool restores its group without changing neighbouring split',()=>{
 A.set({tree:A.move(A.balanced(['chat','code','data']),'data','code','center'),active:'data',layoutVersion:2});A.close('data');A.open('data');assert.deepEqual(plain(A.panelGroup(A.read().state.tree,'code').tabs),['code','data']);invariant(A.read().state.tree,['chat','code','data']);
});
test('legacy collapsed layout materializes tabs once without losing panels',()=>{
 const tree=A.balanced(['chat','code','browser','data']),migrated=A.migrateLayout(tree,768,500);assert.equal(migrated.kind,'group');invariant(migrated,['chat','code','browser','data']);const restored=A.checked({tree:migrated,active:'code',layoutVersion:2});assert.deepEqual(plain(restored.tree),plain(migrated));assert.equal(restored.layoutVersion,2);
});
test('normalization cleans duplicate and invalid tabs without losing valid siblings',()=>{
 const tree=A.normalize({kind:'split',id:'same',a:{kind:'group',id:'same',tabs:['code','code','bogus','data']},b:{kind:'group',id:'same',tabs:['data','browser']}});invariant(tree,['code','data','browser']);
});

test('reset and subsequent moves persist the new format and cannot trigger legacy regrouping',()=>{
 A.reset();A.open('code');const tree=A.move(A.read().state.tree,'code','browser','top');A.set({tree,active:'code',layoutVersion:2});A.open('code');const saved=A.read().bank[A.read().project];assert.equal(saved.layoutVersion,2);assert.deepEqual(plain(saved.tree),plain(tree));assert.equal(A.panelGroup(saved.tree,'code').kind,'leaf');
});
test('open all uses one explicit tool group beside chat, rather than a guessed mosaic',()=>{
 A.openAll();const tree=A.read().state.tree;assert.equal(tree.kind,'split');assert.equal(tree.a.id,'chat');assert.equal(tree.b.kind,'group');invariant(tree,plain(A.ids));
});


// Execute the actual pointer hit-test, independently of the transform and render tests.
const hitContext={localStorage:{getItem(){return null},setItem(){}},window:{SuitePrototype:{project:()=> 'A'}},console};vm.createContext(hitContext);
const hitFns=block('  function dropEdge(','  function endPointer(');
vm.runInContext(`
const ids=['chat','code','browser','agent-browser','tasks','design','ops','data','scm'],valid=new Set(ids),names=Object.fromEntries(ids.map(id=>[id,id]));
${base}
const box=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height}),panels=new Map(),groups=new Map(),containers=panels;
let drag=null;const document={body:{classList:{add(){}}}},dragLayer={},preview={style:{}},targets={style:{},querySelectorAll(){return ['left','right','top','bottom','center'].map(edge=>({dataset:{edge},classList:{toggle(){}}}))}},dragNote={};
${hitFns}
globalThis.hit={group,leaf,split,box,panels,groups,read:()=>({target:drag.target,edge:drag.edge,hidden:preview.hidden,note:dragNote.textContent}),configure:(tree,id,visible,tabbar)=>{state.tree=tree;panels.clear();groups.clear();for(const [key,rect] of visible)panels.set(key,{hidden:false,getBoundingClientRect:()=>rect});if(tabbar)groups.set(tabbar.id,{getBoundingClientRect:()=>tabbar.rect});drag={id,x:0,y:0,started:true};},at:(x,y)=>dragAt({clientX:x,clientY:y})};`,hitContext);
const H=hitContext.hit;
test('actual hit-test gives the same four edges and center for different panel sizes',()=>{
 for(const [w,h] of [[320,220],[850,600],[1500,900]]){
  const r=H.box(50,60,w,h);H.configure(H.split('x',H.leaf('code'),H.leaf('browser')),'code',[['browser',r]]);
  for(const [edge,x,y] of [['left',.05,.5],['right',.95,.5],['top',.5,.05],['bottom',.5,.95],['center',.5,.5]]){H.at(r.left+w*x,r.top+h*y);assert.equal(H.read().edge,edge);assert.equal(H.read().target,'browser');assert.equal(H.read().hidden,false);}
 }
});
test('dragging a selected grouped tool can split out of its own group; group tab strip is a valid target',()=>{
 const tree=H.group(['code','browser'],'tools'),r=H.box(50,92,600,500);H.configure(tree,'code',[['code',r]],{id:'tools',rect:H.box(50,60,600,32)});H.at(350,65);assert.equal(H.read().target,'browser');assert.equal(H.read().edge,'top');H.at(640,300);assert.equal(H.read().edge,'right');
});
test('closed rail tool uses the same target zones; dropping outside has no destination',()=>{
 const tree=H.leaf('code');H.configure(tree,'data',[['code',H.box(50,60,600,500)]]);H.at(350,300);assert.equal(H.read().target,'code');assert.equal(H.read().edge,'center');H.at(20,20);assert.equal(H.read().target,null);assert.equal(H.read().hidden,true);
});
test('single source panel is not a drop target for itself',()=>{
 H.configure(H.leaf('code'),'code',[['code',H.box(50,60,600,500)]]);H.at(350,300);assert.equal(H.read().target,null);assert.equal(H.read().hidden,true);
});

const result={source:file,sha256:crypto.createHash('sha256').update(source).digest('hex'),tests:tests.length,passed:tests.filter(x=>x.pass).length,operations:opCount,results:tests,limits:['VM executes actual transform/lifecycle functions. Geometry recurrence mirrors place formula; no browser rendering or pointer event timing.','DOM and pointer tests use mocked nodes/events with actual render/place/pointer functions. Native browser pointer capture, focus, IME and CSS rendering still require live QA.']};if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(result.passed!==result.tests)process.exitCode=1;
