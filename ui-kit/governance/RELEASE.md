# Release and distribution policy

## SemVer and channels

`major.minor.patch` describes API and visual contract compatibility. Prerelease versions use SemVer identifiers, for example `1.4.0-canary.7` and `1.4.0-next.2`.

| Channel | Purpose | Required evidence |
| --- | --- | --- |
| `canary` | Isolated evaluation of an approved PR commit | source checks, catalog, unit, a11y, visual, package contents |
| `next` | Release candidate in named consumer fixtures | all canary evidence, migration rehearsal, consumer compatibility, SBOM and signing rehearsal |
| `stable` | Organization default | protected release approval, immutable commit/tag, all checks, signed package/provenance, rollback and changelog |

Channels are pointers for discovery. Production consumers use a committed lockfile and never receive an unreviewed channel update.

## Release object

Every publication records repository, commit, protected branch, tag, version, channel, package digest, token bundle digest, icon registry digest, visual baseline ID, test run IDs, SBOM reference, signature/provenance reference, reviewers, release notes and migration reference. A failed or unknown remote publication is reconciled against the registry before any retry.

## Promotion

Promotion does not rebuild source. It promotes the exact verified digest, reruns policy checks, verifies signatures, and records new approval. `stable` requires at least one representative consumer for each supported framework/runtime class. Consumers behind a security release get a visible advisory; the kit never edits their lockfiles without a reviewable change.

## Rollback and yank

- Publish a compatible corrective patch when possible.
- Mark a compromised or unusable version as deprecated/yanked in registry metadata without deleting audit evidence.
- Rollback points to a previously verified digest and includes consumer impact.
- Rotating signing credentials and invalidating attestations follows the security incident process.
