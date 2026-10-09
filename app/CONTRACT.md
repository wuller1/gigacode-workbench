# Implementation contract

Target Windows 10/11, Windows PowerShell 5.1. Host: Electron + TypeScript, UI React + Vite. Do not modify Qwen/Giga CLI. No real credentials in source, fixtures, snapshots, logs or published repository. Runtime userData is outside package/repo. Builtin Workbench lives at ../workbench (full original package, 12 ready PS1, docs/assets/profiles).

Renderer bridge window.workbench.invoke(method, params), subscribe(event) is sole IPC. Shared types in shared/types.ts. All methods return JSON-compatible values or reject with readable error. No globals active session in backend. Events state.changed (snapshot should be fetched), terminal.data {id,data}, terminal.exit {id,exitCode}, browser.changed {id,url,title,loading}. UI refresh on events without click; coalesce snapshot refresh. Empty initial state: no fake sessions/results.

Backend WorkbenchService constructor options {dataDir, bundleDir, emit, mcpServersForSession?}. async init(), snapshot():AppState, async invoke(method,params):any, async dispose(). Owns persistent projects/tasks/sessions/settings/profiles/queue/messages/todos/questions/artifacts + CLI ACP. Implement these methods:

- state.get {}
- project.create {name,path}; project.update {id,name?,archived?}; project.delete {id} (metadata only, no source deletion; reject active descendants)
- task.create {projectId,title,description?}; task.update {id,title?,description?,archived?}; task.delete {id}
- session.create {taskId,title?,profileId?,parentId?}; session.update {id,title?,profileId?,model?,reasoning?,archived?,unread?}; session.delete {id}; session.send {id,text}; session.cancel {id}; session.recover {id,summary?} (explicit new ACP session, previous history preserved); session.compact {id} (host-owned short handoff/new session, never claim rewrite opaque CLI history)
- queue.update {sessionId,id,text}; queue.delete {sessionId,id}; queue.move {sessionId,id,index}; queue.resume {sessionId}
- settings.update {patch:Partial<Settings>}; profile.save {id?,name,description,prompt}; profile.delete {id} (custom only)
- question.answer {id,optionId?,text?}; todo.replace {sessionId,items:Todo[]}; artifact.register {taskId,path,name?,kind?}; artifact.list {taskId}
- session.config {id,configId,value}: only actual discovered ACP config option, preserve busy capture
- diagnostics.export {} => {path}; memory.read {} => {text}; memory.write {text}

Use shared type fields exactly. Add optional backend-specific fields locally or to persisted extensions, do not change public required shapes. Session.config supported actual metadata, no generic reasoning tiers magically applied. Config settings.model default may pass through known launch args; choose actual flags from Qwen docs. Do not silently replay potentially sent prompts. At least unit/contract tests for isolation, unknown outcome, persistence, queue/cancel and malformed frames.

Main process (root agent) adds:
- app.info {} => {version,platform,dataDir,bundleDir}; app.chooseProject {} => Project|null (native dialog + service.create)
- app.chooseCli {} => {path}|null; window.minimize/maximize/close/new {}
- fs.list {projectId,path?} => [{name,path,directory,size}]; fs.read {projectId,path} => {text,path,mtime}; fs.write {projectId,path,text,expectedMtime?} => {mtime}; fs.create {projectId,path,directory?}; fs.rename {projectId,path,newPath}; fs.trash {projectId,path} (native trash only)
- git.status {projectId} => {branch,changes:[{path,status}],diff}; git.diff {projectId,path?} => {text}
- terminal.shells {} => [{id,name,path,args}]; terminal.create {projectId,shellId?} => {id,title}; terminal.list {} => [{id,title,projectId}]; terminal.write {id,data}; terminal.resize {id,cols,rows}; terminal.close {id}
- browser.create {sessionId?,projectId?,url?} => {id,url,title}; browser.list {}; browser.navigate {id,url}; browser.back/forward/reload/close {id}; browser.bounds {id,x,y,width,height,visible}; browser.zoom {id,factor}; browser.emulate {id,width,height,deviceScaleFactor?,mobile?}; browser.external {id}; browser.capture {id,taskId?} => {path}; browser.inspect {id} => {url,title,text}; browser.act {id,action:'click'|'fill',selector,value?}
- artifact.open {id} => {text?,url?,path,kind}; artifact.export {id}; external.open {url}; clipboard.write {text}

Browser uses native WebContentsView; placeholder area ResizeObserver sends physical logical Electron bounds in CSS px (not device-scaled). Hide all native views while modal/settings overlay covers area; restore on close. Browser network remote page must never receive app preload/IPC. Root owns actual browser/terminal services. UI can use textarea editor first, no fake LSP. Runnable HTML artifact must be isolated, unprivileged and explicit preview.

All app state initial values come from backend, no demo success. Browser-only preview may show clearly marked unavailable host + empty UI, not fictional working backend. UI framework packages root handles: react/react-dom, react-markdown, remark-gfm, @xterm/xterm/@xterm/addon-fit; icons reuse own SVG assets from ../workbench/assets. Frontend agent owns app/src/* only. Backend agent owns app/electron/service.ts, store.ts, acp.ts and app/tests/* (except root tests). Main/preload/browser/workspace/terminal/build config root owns. Qwen test agent owns work/qwen-runtime and work/live-qwen-tests only.
