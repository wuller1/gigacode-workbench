import {it} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {AcpConnection,redact} from '../electron/acp';

// No credential files, dotenv loading, raw frames or log files. Keys remain in inherited env.
const secrets=Object.entries(process.env).filter(([key,value])=>/key|token|secret|password|credential/i.test(key)&&value&&value.length>=6).map(([,value])=>value!);
const safe=(value:unknown)=>{let text=String(value??'');for(const secret of secrets)text=text.split(secret).join('[redacted]');return redact(text).slice(0,1000);};
const must=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
function choices(option:any):any[] {
  const result:any[]=[];
  for(const entry of Array.isArray(option?.options)?option.options:[]) {
    if(Array.isArray(entry?.options))result.push(...entry.options);else result.push(entry);
  }
  return result;
}
function metadata(initialized:any,session:any) {
  return {
    protocolVersion:initialized?.protocolVersion,
    agent:{name:safe(initialized?.agentInfo?.name),version:safe(initialized?.agentInfo?.version)},
    capabilityKeys:Object.keys(object(initialized?.agentCapabilities)).sort().map(safe),
    authenticationMethods:(Array.isArray(initialized?.authMethods)?initialized.authMethods:[]).slice(0,20).map((m:any)=>({id:safe(m.id),name:safe(m.name)})),
    configOptionsTruncated:Array.isArray(session?.configOptions)&&session.configOptions.length>30,
    configOptions:(Array.isArray(session?.configOptions)?session.configOptions:[]).slice(0,30).map((o:any)=>({
      id:safe(o.id),name:safe(o.name),category:safe(o.category),type:safe(o.type),currentValue:safe(o.currentValue),
      choicesTruncated:choices(o).length>100,
      options:choices(o).slice(0,100).map((v:any)=>({value:safe(v.value),name:safe(v.name)})),
    })),
    legacyModels:session?.models?{
      currentModelId:safe(session.models.currentModelId),
      availableModels:(Array.isArray(session.models.availableModels)?session.models.availableModels:[]).slice(0,100).map((m:any)=>({id:safe(m.modelId??m.id),name:safe(m.name)})),
    }:undefined,
  };
}
type Lane={label:string;connection:AcpConnection;sessionId?:string;text:string;updates:number;wrongSession:boolean;toolCalls:number;permissions:number;diagnosticChunks:number;cancelRequested:boolean;startedAt?:number;endedAt?:number};

it('manual ACP initialize/configuration; exactly two host prompts only with explicit paid opt-in',async()=>{
  const executable=process.env.WORKBENCH_LIVE_CLI;
  must(executable&&path.isAbsolute(executable),'Set WORKBENCH_LIVE_CLI to an absolute CLI .js/.exe path. No PATH lookup or bundled fallback is used.');
  must((await fs.stat(executable!).catch(()=>null))?.isFile(),'The explicitly selected CLI file does not exist.');
  let args:unknown;
  try{args=JSON.parse(process.env.WORKBENCH_LIVE_ARGS_JSON??'');}catch{throw new Error('Set WORKBENCH_LIVE_ARGS_JSON to the verified CLI ACP argument array.');}
  must(Array.isArray(args)&&args.length<=50&&args.every(a=>typeof a==='string'&&a.length<=4096&&!/[\r\n\0]/.test(a)),'CLI arguments must be a bounded JSON array of strings.');
  must(!(args as string[]).some(a=>/^(?:--api[-_]key|--token|--password|--secret)(?:=|$)/i.test(a)||secrets.some(s=>a.includes(s))),'Never put credentials in CLI arguments; inherit provider environment instead.');
  const allowPaid=process.env.WORKBENCH_LIVE_ALLOW_PAID==='1';
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-acp-probe-'));
  const lanes:Lane[]=[];
  let dispatched=0;
  const summary:any={probe:'manual-acp',platform:process.platform,node:process.versions.node,paidOptIn:allowPaid,hostPromptDispatches:0,rawLogsWritten:false};
  try {
    for(const label of ['A','B']) {
      const cwd=path.join(temporary,label);await fs.mkdir(cwd);
      const lane={} as Lane;
      Object.assign(lane,{label,text:'',updates:0,wrongSession:false,toolCalls:0,permissions:0,diagnosticChunks:0,cancelRequested:false});
      lane.connection=new AcpConnection({executable:executable!,args:args as string[],cwd,startupTimeoutMs:20000,
        onDiagnostic:()=>{lane.diagnosticChunks++;},
        onPermission:async()=>{lane.permissions++;return{outcome:{outcome:'cancelled'}};},
        onUpdate:params=>{
          lane.updates++;
          if(lane.sessionId&&params?.sessionId&&params.sessionId!==lane.sessionId)lane.wrongSession=true;
          const update=params?.update;
          if(update?.sessionUpdate==='agent_message_chunk'&&update.content?.type==='text')lane.text+=String(update.content.text??'');
          if(update?.sessionUpdate==='tool_call')lane.toolCalls++;
          if((lane.toolCalls||lane.text.length>4096)&&lane.sessionId&&!lane.cancelRequested){lane.cancelRequested=true;try{lane.connection.cancel(lane.sessionId);}catch{/* closing is handled below */}}
        },
      });
      lanes.push(lane);
    }
    const initialized=await Promise.all(lanes.map(l=>l.connection.start()));
    const sessions=await Promise.all(lanes.map((l,i)=>l.connection.newSession({cwd:path.join(temporary,l.label),mcpServers:[]}).then(s=>{l.sessionId=s.sessionId;return s;})));
    summary.connections=lanes.map((l,i)=>({label:l.label,sessionCreated:!!l.sessionId,...metadata(initialized[i],sessions[i])}));
    summary.identityRule='Transport connection + returned sessionId. Equal sessionId strings from different processes do not by themselves violate ACP.';
    must(initialized.every(r=>r.protocolVersion===1),'Both connections must initialize ACP protocol version 1.');

    // Optional exact setter probe. No guessed config IDs/values and no model prompt.
    if(process.env.WORKBENCH_LIVE_SET_CONFIG_JSON) {
      let selected:any;
      try{selected=JSON.parse(process.env.WORKBENCH_LIVE_SET_CONFIG_JSON);}catch{throw new Error('WORKBENCH_LIVE_SET_CONFIG_JSON must be {"id":"offered-id","value":"offered-value"}.');}
      must(typeof selected?.id==='string'&&typeof selected?.value==='string','Config selection requires string id/value.');
      const offered=sessions[0].configOptions?.find((o:any)=>o.id===selected.id);
      must(offered&&choices(offered).some(c=>c.value===selected.value),'Selected config id/value was not offered by session A; no setter request was sent.');
      const changed=await lanes[0].connection.setConfigOption(lanes[0].sessionId!,selected.id,selected.value);
      const observed=changed?.configOptions?.find((o:any)=>o.id===selected.id);
      must(observed,'Config setter did not return a matching option; application is not confirmed.');
      summary.configReadback={requested:{id:safe(selected.id),value:safe(selected.value)},observedValue:safe(observed.currentValue),exactMatch:observed.currentValue===selected.value,note:'A default alias may normalize to a concrete tier; read the observed value.'};
      summary.connections[0].configOptions=metadata(initialized[0],changed).configOptions;
    }

    if(allowPaid) {
      const markers=lanes.map(l=>`WORKBENCH_${l.label}_${randomUUID().replaceAll('-','').slice(0,12)}`);
      const prompts=lanes.map((lane,i)=>{
        must(dispatched<2,'Two-prompt hard limit exceeded.');dispatched++;
        lane.startedAt=performance.now();
        return lane.connection.prompt(lane.sessionId!,`This is a short transport test in an empty temporary directory. Do not call any tools, read/write files, run commands, browse, delegate, or ask questions. Reply with exactly this one marker and nothing else: ${markers[i]}`).then(result=>{lane.endedAt=performance.now();return result;});
      });
      let timer:ReturnType<typeof setTimeout>|undefined;
      let results:any[];
      try{results=await Promise.race([Promise.all(prompts),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Paid probe timed out. Outcome is unknown; do not automatically repeat it.')),60000);})]);}
      finally{if(timer)clearTimeout(timer);}
      for(let i=0;i<lanes.length;i++) {
        const lane=lanes[i];
        must(results[i]?.stopReason==='end_turn',`Session ${lane.label} did not report end_turn.`);
        must(lane.text.trim()===markers[i],`Session ${lane.label} did not return its exact marker; model output is deliberately omitted.`);
        must(!lane.text.includes(markers[1-i])&&!lane.wrongSession,`Session ${lane.label} failed the isolation check.`);
        must(lane.toolCalls===0&&lane.permissions===0,`Session ${lane.label} attempted a tool/permission operation; probe is not a clean marker-only pass.`);
      }
      const overlap=Math.max(...lanes.map(l=>l.startedAt!))<Math.min(...lanes.map(l=>l.endedAt!));
      must(overlap,'Prompt request lifetimes did not overlap.');
      summary.paidResult={status:'passed',exactMarkers:true,requestLifetimesOverlap:overlap,toolCalls:0,permissionRequests:0};
    } else summary.paidResult={status:'not_requested',note:'No session/prompt RPC was sent. CLI startup/session creation may still use network or write its own normal state.'};
    summary.hostPromptDispatches=dispatched;
    summary.observations=lanes.map(l=>({label:l.label,updates:l.updates,diagnosticChunks:l.diagnosticChunks}));
    console.log(JSON.stringify(summary,null,2));
  } catch(error) {
    // Never expose raw provider frames or Error.cause through Vitest's reporter.
    console.log(JSON.stringify({probe:'manual-acp',status:'failed',hostPromptDispatches:dispatched,paidOptIn:allowPaid,error:safe(error instanceof Error?error.message:'Unclassified probe failure')}));
    throw new Error(`Manual ACP probe failed after ${dispatched} host prompt dispatches. See the sanitized summary; do not replay an unknown request automatically.`);
  } finally {
    await Promise.allSettled(lanes.map(l=>l.connection.dispose()));
    await fs.rm(temporary,{recursive:true,force:true});
  }
});
