import { expect,it } from 'vitest';
import { revision } from '../../ide/extensions/workbench-bridge/src/revision';
it('keeps one revision for a shared model and rejects an old token after close/reopen at the same numeric version',()=>{
 const model={version:1};const token=revision(model);expect(revision(model)).toBe(token);
 model.version=2;expect(revision(model)).not.toBe(token);
 expect(revision({version:1})).not.toBe(token);
});
