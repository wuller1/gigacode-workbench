# UI kit security policy

## Trust boundaries

Treat component props, Markdown/HTML, icon uploads, template data, design imports, repository metadata and CI artifacts as untrusted. Reference components do not use `dangerouslySetInnerHTML`. URL-bearing components must allowlist protocols and keep external navigation explicit.

Secrets never live in this repository, token JSON, examples, visual baselines or browser captures. Repository/package credentials are secret references resolved by the OS or CI vault. Logs redact authorization headers, cookies, private keys, connection strings and personal data.

## Supply chain

- Pin CI actions/tools by immutable digest where the forge supports it.
- Use a locked dependency graph and review every new production dependency.
- Run dependency, license, secret and vulnerable-version scanning, including the configured Sprut adapter when available.
- Produce SPDX or CycloneDX SBOM and signed provenance for a release.
- Sign immutable package digests; promotion reuses the same digest.
- Restrict publish rights to the CI identity and protected release environment.
- Retain build/test/provenance evidence according to corporate policy.

## Repository and agent permissions

A configured project binding grants enabled capabilities without a per-call permission modal. Access remains least-privilege at the connection/service account. Administrators can disable a whole connection or a capability such as `package.publish`; protected branches and release environments enforce reviewer policy. High-impact external actions remain reviewable through the central operation policy.

An agent release flow exposes proposal, preview, execute, result, verify and evidence. It cannot treat an HTTP success alone as publication proof: it reads the registry/tag/package digest back and attaches the remote correlation ID.

## Reporting and response

Configure a private security-contact address in the destination repository. Do not place a real address in this portable starter. The response record includes affected versions, exploitability, mitigations, fixed version, consumer notification, key/credential actions and evidence retention. Public disclosure timing follows organization policy.
