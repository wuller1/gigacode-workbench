# Asset provenance and copyright gate

The starter accepts an asset only when the registry records origin, authoring context, license decision, source path and content hash. CI recomputes hashes and rejects unregistered files.

Allowed origins:

- `original`: created for this design system and reviewed for accidental brand/trademark resemblance;
- `organization-owned`: supplied with an internal ownership record and permitted scope;
- `oss`: exact upstream source, SPDX license, version/commit, required notices and modification record;
- `licensed`: contract/reference and usage limits recorded outside the repository, with a non-secret identifier here.

This reference starter uses only `original`. It contains no Sber/Plasma/SDDS, competitor, vendor, copied screenshot, third-party logo, proprietary font, stock illustration or traced icon asset. Its proposed Workbench mark uses original work-surface/leg/W-brace geometry and is registered in `registry/assets.json`; it still requires user and organization brand/trademark review before production wiring. Corporate style can be expressed through approved semantic tokens and original geometry after brand review; a company name is never proof of reuse rights.

Reject:

- assets copied from a product UI or image search;
- SVG paths with unknown origin;
- generated output trained or prompted to reproduce a named brand asset;
- a font binary without redistribution rights;
- an OSS asset whose license/notice cannot be preserved in every distribution;
- a screenshot containing credentials, personal data or confidential systems.

Before publishing, legal/brand owners choose the repository/package license and confirm that the contributor agreement or employment policy covers original submissions. The MIT text in `icons/LICENSE.txt` covers this starter icon and proposed brand-source family; a corporate fork may retain it or replace it through an explicit legal review before accepting new contributions. CI checks both `registry/icons.json` and `registry/assets.json`, hashes every SVG and rejects unregistered files.
