import { describe,it,expect } from 'vitest';
import { recoverLayout } from '../../ide/extensions/workbench-bridge/src/layout-recovery';
describe('IDE backend lifetime recovery',()=>{
 it('preserves editor state, starts fresh user shells and never replays completed task commands',()=>{
  const editor={constructionOptions:{factoryId:'editor-preview-widget',options:{uri:'file:///project/main.ts'}},innerWidgetState:JSON.stringify({cursor:42})};
  const terminal={constructionOptions:{factoryId:'terminal',options:{created:'terminal',cwd:'file:///project',shellPath:'powershell.exe',shellArgs:['-Command','deploy']}},innerWidgetState:JSON.stringify({terminalId:123,titleLabel:'My shell',hasUserTitle:true})};
  const task={constructionOptions:{factoryId:'terminal',options:{kind:'task',shellArgs:['deploy']}},innerWidgetState:JSON.stringify({terminalId:-1})};
  const recovery=recoverLayout(JSON.stringify({main:{widgets:[editor]},bottom:{widgets:[terminal,task]}}));
  const restored=JSON.parse(recovery.value);
  expect(restored.main.widgets[0]).toEqual(editor);
  expect(restored.bottom.widgets).toHaveLength(1);
  expect(JSON.parse(restored.bottom.widgets[0].innerWidgetState).terminalId).toBeUndefined();
  expect(restored.bottom.widgets[0].constructionOptions.options.shellArgs).toEqual([]);
  expect(recovery).toMatchObject({freshTerminals:1,discardedTaskTerminals:1});
 });
 it('handles perspective layouts and nested serialized widget data',()=>{
  const terminal={constructionOptions:{factoryId:'terminal',options:{}},innerWidgetState:'{"terminalId":1}'};
  const nested={layouts:{development:JSON.stringify({container:{innerWidgetState:JSON.stringify({widgets:[terminal]})}})}};
  const recovered=recoverLayout(nested);expect(recovered.freshTerminals).toBe(1);
  expect(JSON.stringify(recovered.value)).not.toContain('terminalId');
 });
});
