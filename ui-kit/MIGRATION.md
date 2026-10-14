# Migration notes

No published version exists yet.

For every future breaking release, add a section containing:

1. affected token, component, icon, template, and CSS names;
2. before/after examples and an automated codemod when it is safe;
3. required manual decisions;
4. compatibility window and deprecation removal date;
5. rollback version and verification steps;
6. consumer projects tested before promotion to `stable`.

Deprecations remain discoverable in the registry for at least one minor release unless a documented security incident requires faster removal.

## Additive desktop source update

Existing exports remain. Button now defaults to `type="button"`; form submit actions explicitly pass `type="submit"`. All formerly specified component entries reference real source. IDs remain stable; use `exportName`, not display-name guesses. Theme belongs on `html` for native-dialog portals.

Do not mass-replace workplace components. Compare actual appearance, keyboard, errors and draft retention first. Preserve host store/session/layout owners and better existing implementations. Wire durable/CAS callbacks for cell edits, queue edits and task moves; UI is not persistence or permission authority. Text vision bridge observations are advisory and bound to exact screenshot metadata. No corporate endpoint is invented and the CLI is not modified.
