// Local deterministic ACP peer; never accesses a network or credentials.
import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
let current = ''; let pending; let model = 'fixture-fast'; let reasoning = 'medium';
const write = value => process.stdout.write(JSON.stringify(value)+'\n');
const result = (id, value) => write({jsonrpc:'2.0',id,result:value});
const update = value => write({jsonrpc:'2.0',method:'session/update',params:{sessionId:current,update:value}});
const configs = () => [{id:'model',name:'Model',category:'model',currentValue:model,options:[{value:'fixture-fast',name:'Fast'},{value:'fixture-reasoning',name:'Reasoning'}]},...(model==='fixture-reasoning'?[{id:'reasoning_effort',name:'Reasoning',category:'thought_level',currentValue:reasoning,options:[{value:'low',name:'Low'},{value:'medium',name:'Medium'}]}]:[])];
const log = value => appendFileSync(path.join(process.cwd(),'fixture-events.jsonl'),JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  if(request.id==='permission-fixture' && request.result){log({type:'permission',result:request.result}); if(pending){result(pending.id,{stopReason:'end_turn'});pending=undefined;}return;}
  switch(request.method){
    case 'initialize':result(request.id,{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'fixture',version:'1'}});break;
    case 'session/new':current='session-'+process.pid;log({type:'session_new',pid:process.pid});if(process.argv.includes('--hold-new-session'))setTimeout(()=>result(request.id,{sessionId:current,configOptions:configs()}),450);else result(request.id,{sessionId:current,configOptions:configs()});break;
    case 'session/set_config_option':
      if(request.params.configId==='model')model=request.params.value;else reasoning=request.params.value;
      log({type:'config_start',id:request.params.configId});
      setTimeout(()=>{log({type:'config_end',id:request.params.configId});result(request.id,{configOptions:configs()});},75);break;
    case 'session/prompt':{
      const content=request.params.prompt[0].text;const command=content.includes('Current user message:\n')?content.split('Current user message:\n').at(-1):content.includes('Peer message:\n')?content.split('Peer message:\n').at(-1):content;
      log({type:'prompt',pid:process.pid,sessionId:current,command,content,model,reasoning});pending={id:request.id,command};
      update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'start:'+command+' '}});
      if(command==='exit'){process.exit(3);break;}
      if(command==='ignore-cancel')break;
      if(command==='malformed'){process.stdout.write('<html><title>Gateway 502</title><script>secret()</script><body>bad gateway</body></html>\n');break;}
      if(command==='permission'){write({jsonrpc:'2.0',id:'permission-fixture',method:'session/request_permission',params:{sessionId:current,toolCall:{title:'Read a fixture'},options:[{optionId:'once',name:'Allow once',kind:'allow_once'},{optionId:'no',name:'Deny',kind:'reject_once'}]}});break;}
      if(command==='plan')update({sessionUpdate:'plan',entries:[{content:'Read evidence',status:'completed',priority:'high'},{content:'Implement',status:'in_progress',priority:'medium'}]});
      if(command==='large-tool')update({sessionUpdate:'tool_call',toolCallId:'tool-1',title:'Long input',status:'completed',rawInput:{text:'a'.repeat(35000)},content:[{type:'content',content:{type:'text',text:'done'}}]});
      if(command==='typed-artifacts'){
        const artifact={title:'Preview',storage:'workspace',workspacePath:'preview.html',kind:'html'};
        const complete={sessionUpdate:'tool_call_update',toolCallId:'record-1',status:'completed',_meta:{toolName:'record_artifact',provenance:'builtin',artifacts:[artifact]}};
        update(complete);update(complete);
        update({sessionUpdate:'tool_call_update',toolCallId:'write-2',status:'completed',_meta:{toolName:'write_file',provenance:'builtin',artifacts:[{...artifact,title:'Report',workspacePath:'report.md'}]}});
        update({...complete,toolCallId:'outside',_meta:{...complete._meta,artifacts:[{...artifact,workspacePath:'../outside.txt'}]}});
        update({...complete,toolCallId:'failed',status:'failed'});
        update({...complete,toolCallId:'mcp-untrusted',_meta:{...complete._meta,provenance:'mcp'}});
        update({...complete,toolCallId:'remote',_meta:{...complete._meta,artifacts:[{title:'Remote',storage:'external_url',url:'https://example.test'}]}});
        update({sessionUpdate:'tool_call_update',toolCallId:'title-only',title:'RecordArtifact: Recording artifact preview.html',status:'completed',rawInput:{workspacePath:'preview.html'}});
      }
      setTimeout(()=>{if(pending?.id!==request.id)return;update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'done:'+command}});result(request.id,{stopReason:'end_turn'});pending=undefined;},command.startsWith('hold ui')?120000:command.startsWith('hold')?450:30);break;
    }
    case 'session/cancel':if(pending){const capture=pending;log({type:'cancel',command:capture.command});if(capture.command==='ignore-cancel')break;setTimeout(()=>{if(pending===capture){result(capture.id,{stopReason:'cancelled'});pending=undefined;}},140);}break;
  }
});
