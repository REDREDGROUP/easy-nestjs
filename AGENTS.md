# easy-nestjs contributor conventions

- This pnpm workspace contains reusable NestJS integration packages. Put new integrations under `packages/nestjs-<name>` and preserve existing package APIs.
- Follow the root README and packageManager: Node.js 24.13.0 and pnpm 10.11.1. Do not rewrite unrelated runtime pins or package versions as part of a feature.
- Follow the root Biome configuration. Use strict TypeScript, constructor injection and explicit named public exports. Keep implementations in named files, not export entry points.
- Use `forRoot` / `forRootAsync` for application-supplied configuration. Libraries must not read application environment files, import product code, or own application authentication/authorization policies.
- Validate connection options and keep credentials, connection strings and provider payloads out of logs and errors. Keep TLS certificate verification enabled by default.
- Separate ordinary cache operations from atomic Redis operations. Preserve explicit TTL units, key namespace/serialization contracts and connection ownership.
- Use test-first vertical changes. Exercise public Nest module initialization and shutdown, failure cleanup and real disposable local Redis where relevant; mocks alone do not establish protocol behavior.
- Do not connect tests to production services. Do not read local `.env` or credential files. Installation credentials belong to the operator, not source or fixtures.
- Keep changes scoped to the integration, its tests/docs/example, lockfile and Changeset. Do not migrate consumer repositories or refactor unrelated packages.
- Run relevant tests with watch mode disabled, lint, type-check, build and package-content/consumer checks before delivery. Distinguish baseline failures, skipped checks and mock-only evidence.
- Public package documentation is English. User-facing PR descriptions are Korean, preserving identifiers and commands.
- Commits, pushes and PR creation require user authorization. A normal PR request does not authorize npm publication, merging, deployment or remote data changes.
