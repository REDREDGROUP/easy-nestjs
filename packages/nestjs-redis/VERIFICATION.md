# Verification record

The package is unpublished at version 0.0.0. A minor Changeset prepares a possible initial 0.1.0 release; it does not indicate publication. Operator-run disposable-server checks are recorded separately from socket/command-boundary tests. No npm publication or deployment was performed.

## Final operator verification after R3

The operator independently rebuilt the corrected source and reran the unchanged OS closed-port reproduction. With a 1,000 ms configured retry delay, both a 20 ms deadline and an explicit close produced zero remaining timers and no late reconnecting event. The two child processes exited naturally in 0.109 and 0.107 seconds, respectively, versus 1.134 and 1.158 seconds with a surviving timer before the fix. No forced child exit or timer unref was used. The independent pending-socket/clear reproduction also passed unchanged.

The operator then repeated every check listed in the pre-R3 table below against the R3 source: frozen installation, **45 unit tests (0 failed, 0 skipped)**, package nonmutating lint, strict types and CJS/declarations, real Redis 7.4.12 plain/atomic protocol, authentication, private-CA TLS, local pack, external installed-tarball strict TypeScript and Nest DI/Redis roundtrip, and all-six-package types and production builds. Every command exited 0. This supersedes the correction executor's pending protocol status below. The same isolated synthetic-authentication/database-2 fixtures and immutable image described below were used. Broader compatibility and failover/mTLS matrices remain unverified.

## R3 startup-retry correction

The SDK's internal retry delay did not accept the connection AbortSignal. Internal reconnectStrategy is now always false. The package retries the same official client only during startup, using Node's abortable timers/promises delay with the connection's lifetime signal. The SDK source confirms that a failed connect with reconnectStrategy=false resets isOpen before rejecting, permitting another public connect call. The exhaustion regression exercises those repeated calls through the actual SDK. The first attempt plus at most reconnect.attempts additional attempts share one total connection deadline, including waits. Close/deadline cancels an already-started wait; no background runtime reconnection, failover or write replay is added. Existing option validation is unchanged.

After a successful production build, `pnpm --filter @redredgroup/nestjs-redis exec node --test test/guard.test.cjs` initially produced **11 passes, 2 assertion failures**. Both deadline and explicit-close child cases retained one referenced retry timer and emitted one reconnecting event after public rejection, exiting naturally after approximately 1.1 seconds. After correction, the same command produced **13 passes, 0 failures**, with cancellation children returning in approximately 0.13 seconds. No import/compilation failure is counted as RED.

Five child regressions use the actual SDK and real unconnected Node Socket objects; only the TCP factory boundary injects a synthetic failure. They cover total deadline and explicit close during a 1,000 ms retry wait, three total attempts for attempts=2 with actual inter-attempt delays, default false and attempts=0. They assert no referenced timer after settlement, no late reconnecting event or additional attempt, rejection of subsequent connect calls, and natural child exit before the retry delay. They use neither forced successful exit nor signals, timer patches, unref or rejection suppression. The old configuration-only retry assertion now verifies disabled SDK retries, while these child tests verify the public startup retry contract.

| Command | Observed result after R3 |
| --- | --- |
| `pnpm --filter @redredgroup/nestjs-redis test` | Exit 0; production build, 18 primitive/socket/retry tests and 27 SDK/cache/Nest tests: 45 passed, 0 failed, 0 skipped. Includes the preceding 40 tests with the retry configuration expectation updated to the startup-only contract. |
| Package `lint`, `type-check`, `build:production` | Each exit 0. |
| `pnpm --filter @redredgroup/nestjs-redis exec tsc --noEmit --module Node16 --moduleResolution Node16` | Exit 0; consumer-resolution type check, not external consumer bootstrap. |
| Local `pnpm pack` into an OS temporary directory | Exit 0; prepack named-export/error-identity/portable-declaration checks passed. |

The supplied OS loopback reproduction was read but not executed by this correction executor. Actual closed-port measurement, real Redis plain/auth/TLS checks and external tarball consumer checks after R3 remain pending operator rerun. Previous operator results below are preserved as pre-R3 evidence. No server/container execution, dependency or runtime version changes, SDK modification, commit, push, PR or publication was performed in this correction.

## Operator verification after R1/R2 corrections (before R3)

The operator independently reran the following on the corrected source with Node.js 24.13.0, pnpm 10.11.1, TypeScript 6.0.3 and NestJS 11.1.21. Real protocol checks used owned loopback-only Redis 7.4.12 fixtures, synthetic passwords, URL database 2 and a separate private-CA TLS fixture. The Redis image was `redis@sha256:8da19c7399dca900c6822a1cf30f9d2285585e2c4b457ff4095b0f4500054d3f`. No production service or consumer repository was used.

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Exit 0; manifest and lockfile synchronized. |
| `pnpm --filter @redredgroup/nestjs-redis test` | Exit 0; 40 tests, 0 failed, 0 skipped. |
| Package `lint`, `type-check`, `build:production` | Each exited 0; nonmutating lint and actual CJS/declaration artifacts. |
| `pnpm --filter @redredgroup/nestjs-redis test:integration` | Exit 0; real cache/atomic operations, TTL, namespace isolation, URL database, failed connection and shutdown ownership. |
| `pnpm --filter @redredgroup/nestjs-redis test:auth` | Exit 0; authenticated roundtrip and incorrect/missing password rejection. |
| `pnpm --filter @redredgroup/nestjs-redis test:tls` | Exit 0; trusted-CA roundtrip, untrusted CA, hostname mismatch and downgrade rejection. |
| Local `pnpm pack` and `test:consumer` | Each exited 0; actual tarball installed outside the workspace, strict Node16-resolution TypeScript without skipLibCheck, named CommonJS/dynamic-import exports and real Nest constructor injection/Redis roundtrip. |
| Root `pnpm type-check` and `pnpm build:production` | Each exited 0; all six workspace packages. |

The unchanged independent socket/clear reproduction also exited 0: pending socket destroyed=true and escaped unhandled rejections=0. These results supersede historical pending statuses below. The real Redis single-winner case exercises concurrent calls through one SDK client, not a multi-process fencing test. Broader Node/Nest/Redis/TLS matrices, Cluster/Sentinel, server failover and mTLS remain unverified. Root-wide tests and root-wide mutating lint were not run; existing runtime pins, Vite overrides and package APIs were preserved.

## R1/R2 correction checks

The correction changes only pending-socket cancellation and namespace clear failure handling, with regressions and documentation. Runtime pins, package versions and lockfile were not changed in this correction.

After a successful production build, the targeted guard/cache tests first produced **9 passes and 6 failures** (15 total): four pending TCP/TLS sockets survived deadline/close, and two strict child processes exited on unhandled UNLINK rejections while a subsequent SCAN was pending or rejected. The additional SCAN-failure-only control passed. These were runtime assertion failures, not missing imports or compilation failures. After the fixes, the same command, `pnpm --filter @redredgroup/nestjs-redis exec node --test test/guard.test.cjs test/cache.test.cjs`, produced **15 passes, 0 failures**.

The socket regressions use the actual official SDK through its TCP/TLS factory boundary and real Node Socket objects with only transport completion withheld. They assert destruction on total deadline and explicit close, then emit a stale connect/secureConnect event and verify no handshake writes, ready state or initialization. The clear regressions use actual SDK clients, OwnedRedisStore, Keyv and cache-manager, replacing only SCAN/UNLINK commands. Child processes run with `--unhandled-rejections=strict`, without rejection-suppression listeners. Sequential deletion now rejects the caller generically before a second SCAN is requested after a failed UNLINK; a separate successful-UNLINK/failed-SCAN case also verifies generic rejection. These are transport/command-boundary checks, not server protocol or atomicity evidence.

The unchanged independent reproduction script was also executed before and after correction. Before: exit 1, pending socket destroyed=false, scan calls=2, escaped unhandled rejections=1, and PromiseRejectionHandledWarning. After: exit 0, pending socket destroyed=true, scan calls=1, escaped unhandled rejections=0, without that warning.

| Command from the workspace root | Observed result after R1/R2 correction |
| --- | --- |
| `pnpm --filter @redredgroup/nestjs-redis test` | Exit 0: production build, 13 primitive/socket tests and 27 SDK/cache/Nest tests; 40 passed, 0 failed, 0 skipped. |
| `pnpm --filter @redredgroup/nestjs-redis lint` | Exit 0; nonmutating Biome check. |
| `pnpm --filter @redredgroup/nestjs-redis type-check` | Exit 0. |
| `pnpm --filter @redredgroup/nestjs-redis build:production` | Exit 0; also run by the complete test command. |
| `pnpm --filter @redredgroup/nestjs-redis exec node test/package-content.cjs` | Exit 0; named exports, shared error identity and portable declarations. |
| `pnpm --filter @redredgroup/nestjs-redis exec tsc --noEmit --module Node16 --moduleResolution Node16` | Exit 0; strict consumer-resolution check. |
| `pnpm --filter @redredgroup/nestjs-redis exec pnpm pack --pack-destination <temporary-directory>` | Exit 0; prepack checks passed, tarball contains 13 JavaScript files, 13 declarations, package.json, README and VERIFICATION. No installation or Redis bootstrap was attempted. |

During the correction itself, fixtures remained operator-owned and the correction executor did not run real-server or external-consumer checks. The independent operator subsequently reran them successfully as recorded above. No service/container manipulation, installation network workaround, commit, push, PR, publication or deployment was performed by the correction executor. Other packages' historical checks below are supplemented by the final all-six-package checks above.

## Historical implementation checks

Observed environment: Node.js 24.13.0, pnpm 10.11.1, TypeScript 6.0.3 and NestJS 11.1.21. Installed APIs were inspected directly: @redis/client 5.12.1, @keyv/redis 5.0.0, Keyv 5.5.0 and cache-manager 7.2.0.

| Command from the workspace root | Observed result |
| --- | --- |
| `pnpm --filter @redredgroup/nestjs-redis test` | Exit 0: 9 preserved primitive tests plus 24 built-CJS SDK/cache/Nest tests; 33 passed, 0 failed, 0 skipped. No test warnings. |
| `pnpm --filter @redredgroup/nestjs-redis lint` | Exit 0; nonmutating Biome check. |
| `pnpm --filter @redredgroup/nestjs-redis type-check` | Exit 0; strict TypeScript, no skipLibCheck. |
| `pnpm --filter @redredgroup/nestjs-redis build:production` | Exit 0; actual CJS and portable declarations generated with tsc. |
| `pnpm --filter @redredgroup/nestjs-redis exec tsc --noEmit --module Node16 --moduleResolution Node16` | Exit 0; additional Node16-resolution check. |
| `pnpm --filter '!@redredgroup/nestjs-redis' -r type-check` | Exit 0; all five existing integration packages. |
| `pnpm --filter '!@redredgroup/nestjs-redis' -r build:production` | Exit 0; all five existing integration packages, JS and declarations. |

Local pnpm pack also succeeded into an OS temporary directory. Its prepack checks passed for named CJS exports, shared error identity and portable declarations. Inspecting the tarball showed 13 JavaScript files, 13 declaration files, package.json, README, VERIFICATION and LICENSE. This is static package-content evidence, not an external installed-consumer bootstrap.

Root-wide tests/lint were not run. The root Vite override and other package APIs, versions and runtime pins were preserved.

## Executed test-first recovery

The original unverified SDK/cache/module/atomic prototype was replaced with executable scaffolds. No old implementation was retained as a reference copy. The following tests ran only after a successful real CJS/declaration build; no import, compiler or command-not-found failure is counted as behavior RED.

For each slice, build with `pnpm --filter @redredgroup/nestjs-redis build:production`, then run the listed command:

| Slice and command | Observed RED | Observed GREEN |
| --- | --- | --- |
| `pnpm --filter @redredgroup/nestjs-redis exec node --test test/cache.test.cjs` — first JSON/null/miss/delete contract | 0 passed, 1 assertion failed: returned undefined instead of JSON | 1 passed |
| Same command — add TTL validation, default/zero TTL, wrap coalescing and clear isolation | 1 passed, 3 assertions failed: missing TTL rejection, five loader calls instead of one, entry survived clear | 4 passed |
| `pnpm --filter @redredgroup/nestjs-redis exec node --test test/modules.test.cjs` — real public Nest factories/DI, ownership, startup rollback/deadline, TLS/retry options | 0 passed, 5 assertions failed | 5 passed |
| Same command — add actual adapter/Keyv/cache-manager transport failures for get/set/del/clear/wrap | 5 passed, 5 assertions failed: swallowed reads/clear, unclosed connections and loader executed after failed read | 10 passed |
| `pnpm --filter @redredgroup/nestjs-redis exec node --test test/atomic.test.cjs` — SDK command/failure boundaries, expiry validation, shutdown | 0 passed, 6 assertions failed: missing expected rejections | 6 passed |

Four additional lifecycle regression cases cover command timeout, a scan completing after timeout without reopening its owned socket, configuration-factory failure before socket startup, and rollback isolation between Nest contexts. The complete SDK/cache/Nest suite finishes with 24 passes.

A clear-event regression was also observed (23 passed, 1 failed): cache-manager emits no argument on successful clear and the raw error on failure, unlike its structured get/set/del events. The listener was corrected and the full suite passed. An intermediate generic-type compile failure and an initial test diagnostic TypeError were corrected; neither counts as assertion RED.

### Preserved primitive history

Before the recovery, configuration scaffolding produced 1 pass/2 assertion failures, then 3 passes; expanded validation produced 3 passes/2 failures, then 5 passes. The operation-guard scaffold produced 0 passes/3 assertion failures, then 3 passes. Adding shutdown cancellation gave 9 passing primitive tests. The original commands used `node --experimental-strip-types --test` with the then-existing options.test.ts and guard.test.ts files. A prior strip-only syntax failure was excluded from RED evidence.

Those same assertions now run against built CJS with `pnpm --filter @redredgroup/nestjs-redis test:unit`. Their semantics were preserved while removing TypeScript module autodetection warnings and the runtime strip-types dependency.

## Evidence boundaries

- Cache value, TTL and coalescing unit tests use real cache-manager and Keyv with in-memory stores. Their clear test establishes independence between assigned stores, not Redis namespace protocol behavior.
- Public-module tests use real built exports, official SDK client objects, @keyv/redis, Keyv, cache-manager and actual Nest contexts. Only connection/transport failure behavior is mocked; no socket is opened. They verify a cache-only connection, optional atomic ownership, async factory injection, failed Redis startup cleanup and deadlines.
- Atomic unit tests replace SDK command calls only with synthetic failures. They verify SDK dispatch, argument/prefix boundaries, validation and safe failure propagation. They do not manufacture command success or establish server atomicity, Lua results, single-winner contention or expiration.
- Installed cache-manager get catches backend errors and returns a miss; wrap catches store-read errors without an event. Adapter/Keyv handlers invalidate the guard before these paths return. The owned adapter overrides public getClient to prevent lazy reopening and now overrides public clear to await each SDK SCAN/UNLINK batch sequentially, closing the guard and throwing a generic error on failure.
- Shared initialization rollback covers this package's registered Redis connections. It cannot close unrelated application providers or intercept later failures in application-owned lifecycle hooks. Applications must close their retained Nest application on init/listen failures. This is not an application-wide rollback guarantee.
- At the end of the original implementation worker's checks, real Redis protocol, authenticated success, TLS and external tarball Nest bootstrap were unexecuted. Subsequent operator passes and the post-correction rerun boundary are recorded above. No broader Redis/TLS/compatibility matrix is claimed.

## Historical blockers, superseded by current checks

Initially registry queries failed with ENOTFOUND and offline resolution failed with ERR_PNPM_NO_OFFLINE_META. SDK/Nest tests, types/build and pack could not run successfully; missing fixtures were not counted as integration passes. An operator subsequently installed the dependencies successfully.

The first installed run exposed a Vitest 4.1.6 startup failure with the existing root-forced Vite 5.0.4 (missing module-runner export), a redis 5.8.2 versus @redis/client 5.12.1 private-class type conflict, and inferred RedisStack declaration errors TS2883/TS7056. Those were tooling/type failures, not behavior RED. The package now uses Node's built-in runner, one official minimal SDK version, explicit RedisClientType/RedisConnection declarations and a direct TypeScript build. No any casts, declaration stubs or diagnostic suppression were added to hide those failures.

## Required operator protocol and consumer verification

Use Node.js 24.13.0 and pnpm 10.11.1 from the workspace root. See README for exact environment-variable contracts. Supply only disposable loopback fixtures; the scripts never start services, configure authentication or load environment files.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @redredgroup/nestjs-redis test
pnpm --filter @redredgroup/nestjs-redis lint
pnpm --filter @redredgroup/nestjs-redis type-check
pnpm --filter @redredgroup/nestjs-redis build:production
REDIS_PACK_DIR="$(mktemp -d)"
pnpm --filter @redredgroup/nestjs-redis exec pnpm pack --pack-destination "$REDIS_PACK_DIR"
export REDIS_TEST_TARBALL="$REDIS_PACK_DIR/redredgroup-nestjs-redis-0.0.0.tgz"
pnpm --filter @redredgroup/nestjs-redis test:integration
pnpm --filter @redredgroup/nestjs-redis test:auth
pnpm --filter @redredgroup/nestjs-redis test:tls
pnpm --filter @redredgroup/nestjs-redis test:consumer
```

Before protocol commands, export REDIS_TEST_URL (nonzero database), REDIS_TEST_CLOSED_PORT, REDIS_TEST_TLS_URL, REDIS_TEST_TLS_CA and optionally REDIS_TEST_TLS_SERVERNAME. General protocol tests accept a no-password fixture. Authentication success still requires the separate test:auth command with a password-protected fixture and an explicit synthetic fixture password in REDIS_TEST_URL; missing authentication inputs fail rather than skip. Connection counts require isolated fixtures and CLIENT LIST access. TLS requires a private CA absent from system trust and a matching certificate SAN. The consumer installs the actual tarball outside the workspace and needs registry access for dependencies.
