# GigaCode Enterprise UI Kit — reference starter

This directory is a **source starter**, not a finished production design system. It gives a corporate team a versionable foundation that can be moved into a dedicated Git or Bitbucket-compatible repository and expanded without copying third-party products or brand assets.

What is included now:

- DTCG-like source tokens for shared foundations and light, dark, and high-contrast semantic themes;
- semantic CSS and reference React/TypeScript components;
- machine-readable component, icon, template, CI, and repository-policy registries;
- a small original SVG icon family and Workbench brand-source set with explicit provenance;
- enterprise screen templates expressed as stable slot/state contracts;
- contribution, release, migration, security, and asset-provenance rules.

What is deliberately not claimed:

- this starter has not completed corporate brand, legal, security, browser, or assistive-technology approval;
- only the components marked `reference-source` in `registry/components.json` have source skeletons; entries marked `specified` are contracts for later implementation;
- no package has been published and no signing identity is configured;
- example repository bindings contain no credentials or real corporate addresses.

## Layout

```text
ui-kit/
  src/                 public package source
  tokens/              DTCG-like source of truth
  icons/               original 24 px SVG source assets
  brand/               original scalable + optical Workbench mark sources
  templates/           screen composition contracts
  registry/            discoverable catalog and state matrices
  governance/          repository, review, release and security policy
```

Token sources are merged in this order: `tokens/core.tokens.json`, then exactly one theme file. Semantic aliases in a theme reference the merged `core` namespace. Applications consume semantic names only; raw palette names are implementation details.

## Move to a corporate repository

1. Copy this directory into an empty, access-controlled repository while preserving history from the first accepted commit.
2. Replace example owners and repository IDs in `governance/repository-policy.example.json`; keep secrets in the forge/CI vault.
3. Protect `main`, require the checks in `governance/ci-contract.json`, require design-system and accessibility ownership review, and disable force push.
4. Configure the package registry, artifact registry, signing identity, provenance attestation, and SBOM upload in CI.
5. Publish an initial `0.x` canary only after the source, rendered gallery, visual baselines, keyboard paths, accessibility checks, package contents, provenance, and consumer fixture pass.
6. Bind the repository to Workbench with a `UiKitRepositoryBinding`. Bound users and agents may use enabled capabilities without a modal for every call; administrators can disable a connection or individual capability centrally.

The repository host is intentionally abstract. A GitHub, GitLab, Bitbucket, or internal forge adapter maps the same branch, pull request, review, check, tag, package, and release contracts.

## Version and channels

- SemVer describes compatibility: patch for compatible fixes, minor for additive changes, major for breaking contract or token changes.
- `canary` is built from reviewed pull requests for isolated evaluation.
- `next` is a release candidate tested by named consumer fixtures.
- `stable` is the approved organization default.
- Consumers pin an exact version or an approved bounded range. A channel label is discovery metadata and must not silently rewrite a production lockfile.

Each release carries a changelog, migration notes when needed, package manifest, SPDX or CycloneDX SBOM, source commit, checksums, signature/attestation, visual baseline identifier, and compatibility results.

## Local reference checks

The package declares `typecheck` and `check:catalog` commands. They validate source and catalog shape; they do not replace browser, visual, accessibility, or consumer tests. A corporate CI implementation should satisfy `governance/ci-contract.json` before publishing.

## Copyright boundary

All SVGs under `icons/` and `brand/` were created for this starter and are registered as `origin: original`. The proposed Workbench mark remains prototype-only and awaits user plus organization brand/trademark approval; existing production app assets are intentionally unchanged. This starter contains no Sber, vendor, competitor, screenshot, font binary, or copied design-system asset. Inspiration may be recorded as a functional reference in documentation, never embedded as pixels, paths, source, or brand styling. See `brand/ICON.md` and `governance/ASSET-PROVENANCE.md`.
