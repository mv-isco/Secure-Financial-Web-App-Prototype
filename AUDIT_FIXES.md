# Audit repair record

Date: 2026-10-06. The original audit is preserved outside the project. This file maps its identifiers to the implemented changes.

| Findings | Resolution |
| --- | --- |
| C1 | Signed, expiring, persistent, single-use password challenges are required at 2FA verification. Subject comes from verified claims. A supplied mismatched userId is rejected. Preauth has a separate signing key. |
| C2 | Automatic demo seeding, fixed public secrets, demo passwords, prefills and credential startup logs removed. All accounts start empty. |
| C3 | Audit requests always use the authenticated user's ID. Caller-supplied user filters cannot widen access. Pagination is bounded; metadata excludes emails/IPs/raw inputs. |
| H1, M6 | Refresh cookie path includes logout. Access/refresh tokens belong to a revocable persistent session. Refresh tokens are SHA-256 hashes with rotation history; reuse revokes their session and every descendant access/refresh token. Logout-all and session listing added. |
| H2 | Persistent idempotency records have a composite user/key primary key and canonical payload fingerprint. Ownership precedes lookup. Different payloads return 409. Fresh and replayed results share the same DTO/status. Deterministic business failures are cached. Atomic database locking serializes in-flight retries. |
| H3 | Each user has a persistent last accepted TOTP step. Older/equal steps are rejected. Five failures lock verification for 15 minutes across challenges and IPs. No neighboring code window is accepted. |
| H4, M4, M9 | Strict decimal/type validation, exact string-to-cent conversion and constrained integer-cent balances/ledger. API amounts are converted only at the boundary. Arrays, booleans, exponent strings and extra precision fail. Bcrypt's byte limit is also enforced. |
| H5 | Canonical unique 12-digit account numbers. Recipient is resolved before debit; unknown/external recipients are rejected. Completed transfers always have both debit and credit records plus balancing ledger rows. |
| H6 | Registration/login both trim and lowercase emails without deleting Gmail dots or plus tags. A database unique constraint enforces identity uniqueness. |
| H7 | Retry keys originate at review. User-scoped session storage preserves pending details through navigation/reload; an opaque persistent key recovers results after closed tabs. A caller-scoped result endpoint, ref guards and cross-tab Web Locks prevent another debit for the same unresolved intent. |
| H8 | App factory, injected isolated stores, no listen-on-import, no shared test limiter exhaustion and no obsolete CSRF dependency. Security and money regressions exercise real routes. Rate-limit-enabled tests exercise separate persistent buckets. |
| H9, P1, P2 | Durable SQLite replaces process-local Maps. BEGIN IMMEDIATE, conditional debit, constraints and one atomic transaction protect balances, ledger, rolling totals, records, audit, step-up and retry results. File reopening and independent-process concurrency tests pass. This is a single-host database design; horizontal deployment requires a server database. |
| H10 | New accounts start at zero. Local test funding is explicit and has a balancing treasury entry. The funding command refuses production execution. There is no public money-minting endpoint. |
| M1, P7 | Removed global input rewriting, xss filters, SQL keyword heuristics and Mongo sanitization. Secrets are preserved, types validated, SQL parameterized, and displayed text escaped by React. |
| M2 | Real bcrypt dummy hash at matching cost. Registration returns identical public responses and queues email verification for every address. No account/secret is exposed before mailbox ownership proof. Existing-account proofs do not modify credentials. |
| M3 | Malformed JSON returns 400, oversized JSON 413, and validators reject wrong input types before route processing. Generic server errors exclude raw request content. |
| M5 | Archived csurf removed. Bearer routes authenticate first. Cookie-authenticated refresh/logout require an exact trusted Origin/Referer and a custom request header. Strict HttpOnly cookies remain. Unused CSRF config removed. |
| M7, M8 | Sessions, challenges, OTP counters, route/IP/account limits, outbox and audit are persisted. Separate register/login/refresh/transfer buckets. Expired transient rows are swept without per-key timers. Financial/audit/idempotency history is retained in durable storage. Proxy trust is explicit. |
| M10 | Fake PIN replaced with real server-side TOTP step-up. False FDIC, SOC 2, fraud-monitoring, TLS-strength and end-to-end encryption claims removed. |
| M11 | Email proof plus the initiating password leads to a restricted enrollment challenge and real QR. Enrollment creates a verified session and offline recovery codes. Resuming unfinished enrollment requires a fresh emailed proof, rotates the secret and invalidates older challenges. Password-only login returns no setup secret. |
| M12 | Upgraded dependencies/lockfiles. Speakeasy replaced with current otplib; csurf, xss, express-mongo-sanitize, morgan, winston, uuid, old rate limiter and obsolete build dependencies removed. Native crypto creates UUIDs. Both npm audits report zero vulnerabilities. |
| L1, P6 | UI and memory tokens clear even on logout failure. Silent refresh is serialized across tabs with Web Locks; generation checks block stale session restoration. BroadcastChannel propagates sign-out. Final protected-route 401 responses expire the UI session. Authentication failures do not launch refresh loops. |
| L2 | Removed the dead TOTP resend/countdown control. Recovery codes are an actual alternate verification path. |
| L3 | ESLint flat config and compatible lint command, with React hook checks. |
| L4, L5 | Minimal liveness response, separate database readiness, generic origin errors. |
| L6, L7 | All transaction reads/retries use masked DTOs. No raw recipient numbers/userIds in transaction responses; no emails, IPs or raw input snippets in audit/operational logs. |
| L8, L9 | Four distinct random 32-byte hex secrets, production validation, private environment file support, local keys/data outside the project. Old project .env secrets removed and replaced by guidance. Encryption protects stored TOTP secrets and email proofs. |
| L10 | Importing app/server binds no port. Entry point closes HTTP connections, maintenance, mail transport and database on shutdown. No force-exit test workaround. |
| L11 | Outgoing limits use a rolling 24-hour SQL sum, avoiding calendar/timezone reset ambiguity. |
| L12 | Unicode letters/combining marks accepted in names. |
| L13, P3 | Actual frame/CSP headers from Express/proxy; invalid frame meta removed. Generated style blocks moved to static CSS. Explicit CSP style allowance supports React style attributes; scripts remain restricted to self. Browser smoke found no CSP violations. |
| L14 | Mandatory 2FA, one-use hashed recovery codes, password-bound recovery and audited operator-assisted reset. Enabled setup cannot be repeated; no API disables mandatory protection. |
| L15 | Both UI/API enforce the same 12-digit account format. |
| L16 | JWT reserved subject, type, issuer, audience and token ID cannot be overridden through extras. |
| P4 | Docker build, HTTPS proxy/Compose deployment, persistent volume, CI, liveness/readiness, admin metrics, consistent backup command and operational guidance. |
| P5 | Recipient-name confirmation, production cooling-off period, source/recipient/user status checks, mandatory step-up and persistent velocity/amount controls. A real fraud/settlement program remains an operational integration. |

## Verification

- Backend: **127 passing tests**. They cover the original findings plus password-bound email proof and fresh enrollment, caller-scoped result recovery, encryption-key readiness/startup, mail expiry/leases/draining, schema upgrades, backup guards, reconciliation, append-only transaction records, configuration validation and a real disposable production-mode server.
- Frontend: **21 passing tests** covering password challenges, safe logout/restoration, stale email claims, enrollment responses, transfer recovery across unmounts and lost tab data, immediate double submissions, pending-payment conflicts, rejected-transfer editing, cooling-off completion, failed-page retry and complete-history filtering.
- Frontend lint/build: pass.
- Headless Edge regressions: built pages, CSS/CSP, login, exact-cent transfers, deliberately lost committed responses, navigation/reload retry, closed-tab result recovery, failed history-page retry, concurrent tabs, cross-tab logout, mobile width, email/password proof, QR enrollment and recovery-code display.
- Backend/frontend npm audit: **0 vulnerabilities**, including development dependencies at verification.
- No existing-user funds were moved and no external emails/deployments were sent during verification. Tests use throwaway users and stores.
- Final verification uses a checksum-verified Node **24.21.0** runtime. Docker/CI/runtime declarations now match it. See [REAUDIT_FIXES.md](REAUDIT_FIXES.md) for follow-up severity, evidence and operating limits.

## Operating boundaries

SQLite is an intentional durable single-host implementation, rather than an unprovisioned PostgreSQL dependency. Multiple processes must use the same local file. The application rejects external transfers and public production funding until verified settlement adapters exist. Mail requires a configured SMTP service in production; local registration uses the operator-only development mailbox. The Docker/HTTPS/SMTP/backup schedules and remote CI need validation in the target environment. Back up data and the matching encryption key, monitor disk/mail delivery, and define financial-record archival before long-term operation. Banking identity checks, compliance approval and a staffed fraud program are not supplied by application code.
