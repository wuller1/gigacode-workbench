/* Shared, local-only syntax presentation for the review prototype.
 * highlight.js 11.12.0, BSD-3-Clause: vendor/highlightjs/LICENSE.
 * Textarea remains the editable source; highlights never become executable HTML.
 */
(() => {
  'use strict';
  const escape = text => String(text).replace(/[&<>"'\r]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','\r':'&#13;'}[c]));
  const aliases = {text:'plaintext',plain:'plaintext',js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',html:'xml',svg:'xml',sh:'bash',shell:'bash',yml:'yaml',md:'markdown',postgresql:'pgsql',postgres:'pgsql',log:'workbench-log'};
  const MAX_HIGHLIGHT = 120000;
  const cache = new WeakMap(), editors = new WeakMap();
  if(window.hljs)hljs.registerLanguage('workbench-log', () => ({
    name:'Workbench log', contains:[
      {className:'ansi',begin:/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/},
      {className:'meta',begin:/\d{4}-\d\d-\d\d[T ][\d:.]+(?:Z|[+-]\d\d:?\d\d)?\b|\b\d\d:\d\d:\d\d(?:\.\d+)?\b/},
      {className:'log-error',begin:/\b(?:ERROR|FATAL|CRITICAL|SEVERE|FAILED)\b/},
      {className:'log-warn',begin:/\b(?:WARN|WARNING)\b/},
      {className:'log-info',begin:/\b(?:INFO|SUCCESS|PASSED|DEBUG|TRACE)\b/},
      {className:'title.class',begin:/\b[\w.$]+(?:Exception|Error)\b/},
      {className:'meta',begin:/\bat\s+[\w.$]+\([^\n)]*\)|\bCaused by:/},
      {begin:/\{/,end:/\}/,subLanguage:'json',contains:['self']},
      {className:'string',begin:/"/,end:/"/,contains:[{begin:/\\./}]},
      {className:'attr',begin:/\b[\w.-]+(?==)/},
      {className:'number',begin:/\b\d+(?:\.\d+)?(?:ms|s|MB|GB|KiB|MiB)?\b/}
    ]
  }));
  if(window.hljs)hljs.registerLanguage('promql', h=>({name:'PromQL (lexical)',keywords:'by without on ignoring group_left group_right bool offset and or unless sum avg min max count stddev stdvar topk bottomk quantile',contains:[h.QUOTE_STRING_MODE,h.HASH_COMMENT_MODE,{className:'number',begin:/\b\d+(?:\.\d+)?(?:ms|s|m|h|d|w|y)?\b/},{className:'built_in',begin:/\b\w+(?=\()/},{className:'attr',begin:/\b[a-zA-Z_]\w*(?=\s*(?:=~|!~|!=|=))/}]}));
  function language(name){const key=String(name||'plaintext').toLowerCase().replace(/^language-/, '');return aliases[key]||key;}
  function infer(text){
    const t=text.trim();
    if(/^(?:\{|\[)[\s\S]*[}\]]$/.test(t)){try{JSON.parse(t);return 'json'}catch{}}
    if(/^(?:diff --git|@@|--- )/m.test(t))return 'diff';
    if(/^(?:apiVersion|kind|metadata|spec):/m.test(t))return 'yaml';
    if(/^(?:GET|POST|PUT|DELETE|PATCH|HTTP\/)\b/.test(t))return 'http';
    if(/\b(?:INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b|Exception:\s|\[demo\]/.test(t))return 'log';
    if(/^(?:SELECT|WITH|CREATE|ALTER|INSERT|UPDATE|DELETE|EXPLAIN|BEGIN|COPY)\b/i.test(t))return 'sql';
    if(/^\s*(?:import |export |const |async function |function )/m.test(t))return 'typescript';
    if(/^\s*<(?:!doctype|svg|html|div|section|button)\b/i.test(t))return 'xml';
    return 'plaintext';
  }
  function render(text,name='plaintext'){
    const source=String(text),lang=language(name);
    if(!window.hljs||!hljs.getLanguage(lang)||source.length>MAX_HIGHLIGHT)return escape(source);
    try{return hljs.highlight(source,{language:lang,ignoreIllegals:true}).value.replace(/\r/g,'&#13;')}catch{return escape(source)}
  }
  // Split the highlighted tokens by original line lengths, retaining diff/line-number wrappers.
  function fillPreservingLines(target,html){
    const template=document.createElement('template');template.innerHTML=html;const runs=[];
    function walk(node,classes=[]){
      if(node.nodeType===3){runs.push({text:node.textContent,classes});return}
      for(const child of node.childNodes)walk(child,node.nodeType===1&&node.className?[...classes,node.className]:classes);
    }
    walk(template.content);let index=0,offset=0;
    function take(length){let result='';while(length>0&&index<runs.length){const run=runs[index],size=Math.min(length,run.text.length-offset);if(!size){index++;offset=0;continue}const part=escape(run.text.slice(offset,offset+size));result+=run.classes.map(cls=>'<span class="'+escape(cls)+'">').join('')+part+'</span>'.repeat(run.classes.length);length-=size;offset+=size;if(offset===run.text.length){index++;offset=0}}return result;}
    for(const node of [...target.childNodes]){
      const colored=take(node.textContent.length);
      if(node.nodeType===1)node.innerHTML=colored;
      else {const part=document.createElement('template');part.innerHTML=colored;node.replaceWith(part.content)}
    }
  }
  function highlightElement(element,name){
    if(!element||element.closest('[data-syntax-layer]')||element.dataset.syntax==='off')return;
    const target=element.querySelector(':scope > code')||element,source=target.textContent;
    const lang=language(name||element.dataset.language||target.dataset.language||[...target.classList].find(c=>c.startsWith('language-'))||infer(source));
    const old=cache.get(element);
    if(old?.source===source&&old.lang===lang&&old.html===target.innerHTML)return;
    const top=element.scrollTop,left=element.scrollLeft;
    const html=render(source,lang);
    if(target.querySelector(':scope > .line, :scope > .add, :scope > .remove, :scope > .di-line-added, :scope > .di-line-removed'))fillPreservingLines(target,html);
    else target.innerHTML=html;
    element.classList.add('wb-syntax');element.dataset.syntaxLanguage=lang;
    element.dataset.syntaxState=source.length>MAX_HIGHLIGHT?'plain-large':window.hljs&&hljs.getLanguage(lang)?'highlighted':'plain';
    cache.set(element,{source,lang,html:target.innerHTML});element.scrollTop=top;element.scrollLeft=left;
  }
  function upgradeEditor(t,name){
    if(editors.has(t)){editors.get(t).resume();return}
    if(!t.parentElement||t.tagName!=='TEXTAREA')return;
    const before=getComputedStyle(t),stretch=Number(before.flexGrow)>0,wrapper=document.createElement('div'),layer=document.createElement('pre');
    wrapper.className='wb-code-editor';wrapper.style.flex=before.flex;wrapper.style.gridColumn=before.gridColumn;wrapper.style.alignSelf=before.alignSelf;
    wrapper.style.minWidth='0';wrapper.style.width=before.width==='0px'?'0':'100%';wrapper.style.margin=before.margin;
    layer.className='wb-syntax wb-editor-layer';layer.dataset.syntaxLayer='true';layer.setAttribute('aria-hidden','true');
    t.before(wrapper);wrapper.append(layer,t);t.classList.add('wb-editor-input');t.spellcheck=false;
    t.style.margin='0';t.style.width='100%';t.style.flex='none';
    if(stretch){t.style.height='100%';t.style.minHeight='0'}
    let previous=null,frame=0;
    function syncScroll(){layer.scrollTop=t.scrollTop;layer.scrollLeft=t.scrollLeft;const gutter=wrapper.parentElement?.querySelector('.di-gutter');if(gutter)gutter.scrollTop=t.scrollTop;}
    function metrics(){
      const style=getComputedStyle(t);
      for(const prop of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textAlign','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderRadius','boxSizing'])layer.style[prop]=style[prop];
      layer.style.whiteSpace=t.wrap==='off'?'pre':style.whiteSpace;layer.style.overflowWrap=style.overflowWrap;
      layer.style.height=(t.clientHeight+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth))+'px';layer.style.width=(t.clientWidth+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth))+'px';
      syncScroll();
    }
    function paint(){
      if(!t.isConnected)return;
      const lang=language(t.dataset.language||name),key=lang+'\0'+t.value;
      if(key!==previous){layer.innerHTML=render(t.value,lang)+(t.value.endsWith('\n')?' ': '');previous=key;layer.dataset.syntaxLanguage=lang}
      metrics();
    }
    function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(paint)}
    t.addEventListener('input',schedule);t.addEventListener('change',schedule);t.addEventListener('scroll',syncScroll);
    // Existing prototype code assigns .value directly (format/restore/suggest). Refresh just that editor.
    const descriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
    Object.defineProperty(t,'value',{configurable:true,get(){return descriptor.get.call(this)},set(value){descriptor.set.call(this,value);schedule()}});
    const resize=new ResizeObserver(paint);let observing=true;resize.observe(t);
    editors.set(t,{paint,resume(){if(!observing&&t.isConnected){resize.observe(t);observing=true}paint()},destroy(){resize.disconnect();observing=false;cancelAnimationFrame(frame)}});paint();
  }
  const pending=new Set();let frame=0;
  function scan(root){
    if(root.nodeType!==1&&root.nodeType!==9)return;
    if(root.matches?.('pre:not([data-syntax-layer]),code[data-language],textarea[data-language]'))pending.add(root);
    root.querySelectorAll('pre:not([data-syntax-layer]),code[data-language],textarea[data-language]').forEach(n=>pending.add(n));
    if(!frame)frame=requestAnimationFrame(flush);
  }
  function flush(){frame=0;const nodes=[...pending];pending.clear();for(const node of nodes){if(!node.isConnected||node.closest('[data-syntax-layer]')||(node.tagName==='CODE'&&node.closest('pre')))continue;if(node.tagName==='TEXTAREA')upgradeEditor(node,node.dataset.language);else highlightElement(node)}}
  const observer=new MutationObserver(records=>{
    for(const mutation of records){
      const parent=mutation.target.nodeType===1?mutation.target:mutation.target.parentElement;
      if(parent?.closest('[data-syntax-layer]'))continue;
      const pre=parent?.closest('pre,code[data-language]');if(pre)pending.add(pre);
      if(mutation.type==='attributes')scan(parent);
      for(const node of mutation.addedNodes||[])scan(node);
      for(const node of mutation.removedNodes||[]){if(node.nodeType!==1||node.isConnected)continue;for(const t of [node,...node.querySelectorAll('textarea')])if(editors.has(t)&&!t.isConnected)editors.get(t).destroy();}
    }
    if(pending.size&&!frame)frame=requestAnimationFrame(flush);
  });
  window.SuiteSyntax={render,highlightElement,upgradeEditor,language,infer,refresh:scan,maxHighlight:MAX_HIGHLIGHT};
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-language']});scan(document);
})();
