# RC1 Release Checklist

Last verified: 2026-05-13

## 1. Repository And Install

- [x] `npm ci --dry-run`
- [x] `package.json` scripts match README.
- [x] PM2 deployment docs include the host prerequisite: `npm install -g pm2`.

## 2. README Command Verification

Short-running commands verified with a temporary SQLite database:

- [x] `npm run migrate`
- [x] `npm run seed`
- [x] `npm run make:admin -- rc1-admin@example.com password123`
- [x] `npm run quality:review`
- [x] `npm run tasks:recover`
- [x] `npm run reset`

Build/test/diagnostic commands verified:

- [x] `npm test`
- [x] `npm run build`
- [x] `npm run env:check`
- [x] `npm run storage:check`
- [x] `npm run smoke:staging`

Long-running commands:

- [x] `npm start` exercised by the fake/local smoke test.
- [x] `npm run worker` covered by automated worker tests; run manually for worker-mode staging.
- [ ] `npm run dev` manual developer convenience command; not required for RC acceptance.
- [ ] `pm2 start ecosystem.config.cjs` requires PM2 installed on the deployment host.

## 3. Diagnostics Clarity

- [x] `env:check` prints PASS/WARN/FAIL with suggestions.
- [x] Production `AUTH_BYPASS=true` fails clearly.
- [x] Production `AI_PROVIDER=fake` fails unless `ALLOW_FAKE_PROVIDER=true`.
- [x] `storage:check` with missing R2 env prints missing variables and suggestions, without stack trace.
- [x] `smoke:staging` with an unreachable base URL reports `failed step: health check`.

## 4. Fake/Local Acceptance

Environment:

```bash
AI_PROVIDER=fake
FILESYSTEM_DISK=local
QUEUE_DRIVER=local
SMOKE_BASE_URL=http://localhost:3000
SMOKE_EXPECT_PROVIDER=fake
SMOKE_EXPECT_STORAGE_DISK=local
npm run smoke:staging
```

Acceptance coverage:

- [x] health/session check
- [x] register/login
- [x] upload/analyze product image
- [x] create generation task
- [x] poll task to success
- [x] verify provider metadata is `fake`
- [x] verify output URL reachable

## 5. Security And Redaction

- [x] `/api/admin/*` requires admin role through automated tests.
- [x] Normal user cannot access admin routes through automated tests.
- [x] Production startup blocks `AUTH_BYPASS=true`.
- [x] API key is not exposed through frontend bootstrap tests.
- [x] `raw_response_json` redacts `b64_json` and long base64-like strings.
- [x] Upload validation rejects unsupported type and over-size files.

## 6. RC1 Results

- [x] `npm test`: 64/64 passed
- [x] `npm run build`: passed
- [x] `npm run env:check`: passed
- [x] `npm run storage:check`: passed
- [x] fake/local `npm run smoke:staging`: passed

## 7. Known RC1 Caveats

- [ ] True OpenAI credentials were not used in RC1.
- [ ] True R2/S3 bucket was not used in RC1.
- [ ] SQLite remains demo/staging only; production should move to Postgres/MySQL.
- [ ] Image edit/reference improves product preservation, but human QA is still required.
- [ ] PM2 was not installed on this local machine during RC1; install it on the deployment host before using PM2 commands.

## 8. RC1.5 Pre-API Checklist

This checkpoint is intentionally fake/local only. Do not set a real OpenAI key or real R2/S3 credentials in this phase.

### Required Local Check

PowerShell:

```powershell
cd "C:\Users\home\Documents\New project 9"

$env:NODE_ENV="development"
$env:AI_PROVIDER="fake"
$env:FILESYSTEM_DISK="local"
$env:QUEUE_DRIVER="local"
$env:AUTH_BYPASS="false"
$env:OPENAI_API_KEY=""
$env:R2_ACCESS_KEY_ID=""
$env:R2_SECRET_ACCESS_KEY=""
$env:S3_ACCESS_KEY_ID=""
$env:S3_SECRET_ACCESS_KEY=""

npm test
npm run build
npm run env:check
npm run storage:check
```

Acceptance:

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run env:check` passes in fake/local development mode.
- [ ] `npm run storage:check` passes with local disk.
- [ ] No command output includes API keys, secrets, or complete base64.

### Fake/Local Smoke

PowerShell:

```powershell
# Terminal 1
$env:AI_PROVIDER="fake"
$env:FILESYSTEM_DISK="local"
$env:QUEUE_DRIVER="local"
npm start

# Terminal 2
$env:SMOKE_BASE_URL="http://localhost:3000"
$env:SMOKE_EXPECT_PROVIDER="fake"
$env:SMOKE_EXPECT_STORAGE_DISK="local"
$env:SMOKE_REPORT_PATH="./tmp/rc15-fake-local-smoke.json"
npm run smoke:staging
```

Acceptance:

- [ ] Smoke completes successfully.
- [ ] Smoke report shows provider `fake`.
- [ ] Smoke report shows storage disk `local`.
- [ ] `output_count` is greater than zero.
- [ ] `output_urls_reachable_count` matches output count.
- [ ] `failed_step` is empty/null.

### Manual Browser And Admin Checks

- [ ] http://localhost:3000/ loads.
- [ ] http://localhost:3000/dashboard loads.
- [ ] http://localhost:3000/tasks loads.
- [ ] http://localhost:3000/assets loads.
- [ ] http://localhost:3000/credits loads.
- [ ] http://localhost:3000/admin loads for `admin` / `1234`.
- [ ] Admin task detail shows provider, storage, metadata, and redacted raw response.
- [ ] Normal user cannot access admin routes.
- [ ] Production startup blocks `AUTH_BYPASS=true`.

### Data Cleanup Before RC2

- [ ] Decide whether to keep smoke-generated tasks/files as RC acceptance evidence.
- [ ] If local demo data should be cleared, run `npm run reset` only after confirming no useful local work must be preserved.
- [ ] Remove temporary reports under `tmp/` if they are no longer needed.
- [ ] Confirm generated reports do not contain `OPENAI_API_KEY`, R2/S3 secrets, or complete base64 strings.

### RC1.5 Exit Criteria

- [ ] Fake provider remains usable.
- [ ] Local storage remains usable.
- [ ] Smoke output URL is reachable.
- [ ] README and this checklist match the commands actually run.
- [ ] True OpenAI and true R2/S3 remain untested until RC2.

## 9. RC2 True Service Readiness

RC1.10 note: this section is preparation only. True OpenAI and true R2/S3 have not been tested yet. On Windows PowerShell, use `$env:KEY="value"` before the command; the assignment blocks below are shorthand runbook values to set in your shell/session.

### OpenAI Local Smoke

Terminal 1:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODE=auto
AI_STRICT_PROVIDER=false
FILESYSTEM_DISK=local
QUEUE_DRIVER=local
npm run env:check
npm start
```

Terminal 2:

```bash
SMOKE_BASE_URL=http://localhost:3000
SMOKE_EXPECT_PROVIDER=openai
SMOKE_EXPECT_STORAGE_DISK=local
SMOKE_REPORT_PATH=./tmp/openai-local-smoke.json
npm run smoke:staging
```

Acceptance:

- [ ] `provider=openai` in smoke report, or fallback clearly shown.
- [ ] If fallback happens, `fallback_used=true` and `fallback_reason` is present.
- [ ] `AI_STRICT_PROVIDER=true` failure is not masked by fake fallback.
- [ ] Smoke report does not include `OPENAI_API_KEY`, secrets, or full base64.

### R2 Storage Check

```bash
FILESYSTEM_DISK=r2
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
STORAGE_PUBLIC_URL=https://assets.example.com
STORAGE_CHECK_REPORT_PATH=./tmp/r2-storage-check.json
npm run storage:check
```

Acceptance:

- [ ] Report contains `write_ok`.
- [ ] Report contains `read_ok`.
- [ ] Report contains `exists_ok`.
- [ ] Report contains `delete_ok`.
- [ ] Report contains `public_url_ok`.
- [ ] Public URL failures suggest checking bucket permission, custom domain, CORS, and `STORAGE_PUBLIC_URL`.
- [ ] Missing env fails cleanly without stack trace.
- [ ] Report does not include R2/S3 secrets.

### OpenAI + R2 Staging Smoke

Terminal 1:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODE=auto
AI_STRICT_PROVIDER=false
FILESYSTEM_DISK=r2
QUEUE_DRIVER=worker
npm start
```

Terminal 2:

```bash
npm run worker
```

Terminal 3:

```bash
SMOKE_BASE_URL=https://staging.example.com
SMOKE_EMAIL=admin@example.com
SMOKE_PASSWORD=...
SMOKE_EXPECT_PROVIDER=openai
SMOKE_EXPECT_STORAGE_DISK=r2
SMOKE_REPORT_PATH=./tmp/openai-r2-smoke.json
npm run smoke:staging
```

Acceptance:

- [ ] Report contains `task_id`, `status`, `output_count`, `output_urls_reachable_count`.
- [ ] Report contains `provider`, `storage_disk`, `fallback_used`, `fallback_reason`.
- [ ] Report contains `latency_ms` and `cost`.
- [ ] Failed report contains `failed_step`, `error_summary`, and `suggestions`.
- [ ] Worker-not-running case times out at `poll task` with worker/`QUEUE_DRIVER` suggestions.

### Quality Review

```bash
QUALITY_RECENT_LIMIT=10
QUALITY_REVIEW_PATH=./tmp/quality-review.md
npm run quality:review
```

Human review criteria:

- [ ] Product subject is preserved.
- [ ] Logo/packaging/color/shape/proportions are not altered.
- [ ] No garbled text or fake text.
- [ ] Output dimensions are correct.
- [ ] Composition is commercially usable.
- [ ] Regeneration decision is recorded.
- [ ] Fallback fake usage is recorded.
## RC1.6-RC1.10 Local Hardening Checklist

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run env:check`
- [ ] `npm run storage:check`
- [ ] `SMOKE_BASE_URL=http://localhost:3000 SMOKE_EXPECT_PROVIDER=fake SMOKE_EXPECT_STORAGE_DISK=local npm run smoke:staging`
- [ ] Verify `/dashboard`, `/tasks`, `/assets`, `/credits` render with fake/local data.
- [ ] Verify `/admin`, `/admin/tasks`, `/admin/storage`, `/admin/quality`, `/admin/system` require admin.
- [ ] Verify `AUTH_BYPASS=true` is blocked in production.
- [ ] Verify `npm run dev:reset` is blocked in production.
- [ ] Verify `npm run cleanup:local` defaults to dry run.
- [ ] Verify `npm run export:demo-data` does not include passwords, secrets, or full base64.
- [ ] Verify `/health` and `/health/deep` do not expose secrets.
- [ ] Confirm true OpenAI and true R2/S3 are still untested until RC2.

### RC1.6-RC1.10 Environment Additions

```env
REGISTRATION_ENABLED=true
FREE_CREDITS_ON_SIGNUP=100
FAKE_TASK_COST=0
OPENAI_TASK_ESTIMATED_COST_CREDITS=10
GEMINI_TASK_ESTIMATED_COST_CREDITS=8
CLAUDE_TASK_ESTIMATED_COST_CREDITS=8
MIN_CREDITS_TO_CREATE_TASK=1
REFUND_ON_TASK_FAILED=true
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
MAX_UPLOAD_MB=10
ALLOWED_IMAGE_TYPES=image/png,image/jpeg,image/webp,image/bmp
ALLOW_SQLITE_IN_PRODUCTION=false
CLEANUP_TMP=true
CLEANUP_STORAGE_DAYS=7
CLEANUP_DRY_RUN=true
ALLOW_PRODUCTION_CLEANUP=false
DEMO_EXPORT_PATH=tmp/demo-export.json
```

## RC1.11 External Handoff API Checklist

- [ ] Configure DevPilot source keys in `/admin/devpilot-keys` or set `DEVPILOT_EXTERNAL_API_KEYS=external-system-a:dev-key-a`.
- [ ] Verify saved Admin keys only show source/fingerprint/status; raw keys are never displayed again.
- [ ] Leave `DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES=0` for normal source isolation.
- [ ] `POST /api/external/tasks/:task_id/handoffs` creates a pending manual handoff.
- [ ] Reusing `X-DevPilot-Idempotency-Key` returns `idempotent_replay=true` and does not duplicate records.
- [ ] `GET /api/external/ai-handoffs` only returns the authenticated source by default.
- [ ] `GET /api/external/handoffs/:handoff_id` returns 404 for another source unless allow-all is enabled and requested.
- [ ] Responses do not include raw API keys, secrets, or full base64.
- [ ] External API does not modify task status, project status, phase/progress, next steps, approval requests, AI providers, or workers.
- [ ] Error responses use `{ "ok": false, "error": "..." }`.
- [ ] `npm run devpilot:local` passes against a running fake/local server.

PowerShell quick check:

Admin UI setup:

```text
http://localhost:3000/admin/devpilot-keys
source_system = external-system-a
api_key = paste once, then save
```

The API key is stored as a one-way hash. The raw key cannot be read back from UI or API responses.

Env-only setup is also supported:

```powershell
$env:DEVPILOT_EXTERNAL_API_KEYS="external-system-a:dev-key-a"
$env:DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES="0"
npm start
```

```powershell
$body = @{
  from_agent = "external-system-a"
  to_agent = "devpilot-reviewer"
  reason = "Manual review needed before continuing."
  next_step = "Review the external ticket."
  risk_level = "medium"
  external_ref = "external-ticket-123"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/external/tasks/1/handoffs" `
  -Headers @{
    "X-DevPilot-Source-System" = "external-system-a"
    "X-DevPilot-Api-Key" = "dev-key-a"
    "X-DevPilot-Idempotency-Key" = "external-ticket-123"
  } `
  -ContentType "application/json" `
  -Body $body
```

Local client/server integration:

```powershell
$env:DEVPILOT_EXTERNAL_API_KEYS="external-system-a:dev-key-a,external-system-b:dev-key-b"
$env:DEVPILOT_API_BASE_URL="http://localhost:3000"
$env:DEVPILOT_SOURCE_SYSTEM="external-system-a"
$env:DEVPILOT_API_KEY="dev-key-a"
$env:DEVPILOT_SECOND_SOURCE_SYSTEM="external-system-b"
$env:DEVPILOT_SECOND_API_KEY="dev-key-b"
npm run devpilot:local
```

## RC1.14 Provider Registry Checklist

- [ ] Verify `/admin/providers` requires admin and renders all providers.
- [ ] Verify `GET /api/admin/providers` returns `fake`, `openai`, `gemini`, `claude`, `external`, and `devpilot-gateway`.
- [ ] Verify provider metadata only contains configured/key-present booleans and never raw keys.
- [ ] Verify `AI_PROVIDER=fake` still resolves the fake provider.
- [ ] Verify `AI_PROVIDER=gemini` and `AI_PROVIDER=claude` fail `env:check` when keys are missing.
- [ ] Verify `AI_PROVIDER=devpilot-gateway` fails `env:check` when `DEVPILOT_GATEWAY_BASE_URL` is missing.
- [ ] Keep Gemini/Claude/DevPilot Gateway in scaffold or mock mode until RC2 credentials are available.

PowerShell examples:

```powershell
$env:AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="..."
$env:GEMINI_MODEL="gemini-1.5-flash"
npm run env:check
```

```powershell
$env:AI_PROVIDER="claude"
$env:ANTHROPIC_API_KEY="..."
$env:CLAUDE_MODEL="claude-3-5-haiku-latest"
npm run env:check
```

```powershell
$env:AI_PROVIDER="devpilot-gateway"
$env:DEVPILOT_GATEWAY_BASE_URL="https://gateway.example.com"
$env:DEVPILOT_GATEWAY_API_KEY="..."
npm run env:check
```

## RC1.15-RC1.20 Pre-RC2 Checklist

- [ ] Verify Gemini text scaffold with mocked/live-safe ping only; real key is not required before RC2.
- [ ] Verify Claude text scaffold with mocked/live-safe ping only; real key is not required before RC2.
- [ ] Verify `/api/bootstrap` exposes safe provider metadata and never raw keys.
- [ ] Verify task Advanced Options can request provider/model/capability and records requested/resolved metadata.
- [ ] Verify unconfigured requested provider with `strict_provider=false` falls back to fake.
- [ ] Verify unconfigured requested provider with `strict_provider=true` fails safely.
- [ ] Verify `/assets` shows outputs and supports favorite/archive/tags/notes plus manifest export.
- [ ] Verify `/admin/assets`, `/admin/quality`, `/admin/audit`, `/admin/usage` require admin.
- [ ] Verify `quality_reviews` can mark `approved` and `needs_regeneration` without rerunning providers.
- [ ] Verify external API source rate limit returns safe `429` and audit logs do not include raw API keys or hashes.
- [ ] Verify `npm run rc:local` writes a redacted report and does not call live AI or R2/S3.

PowerShell local RC command:

```powershell
$env:NODE_ENV="development"
$env:AI_PROVIDER="fake"
$env:FILESYSTEM_DISK="local"
$env:QUEUE_DRIVER="local"
$env:RC_LOCAL_REPORT_PATH="./tmp/rc-local-report.json"
npm run rc:local
```

RC2 risk notes:

- Real Gemini key has not been validated in this RC unless explicitly checked later.
- Real Claude key has not been validated in this RC unless explicitly checked later.
- Real R2/S3 has not been validated in this RC unless explicitly checked later.
- DevPilot Gateway remains a scaffold until a formal execution contract exists.

## RC2.1 Live Provider Validation

- [ ] Run `npm run ai:ping` with `AI_PING_PROVIDER=fake` first.
- [ ] Run Gemini live ping only when a real key is intentionally provided.
- [ ] Run Claude live ping only when a real key is intentionally provided.
- [ ] Confirm `tmp/ai-ping-last.json` and any custom `AI_PING_REPORT_PATH` do not contain API keys, secrets, or full base64.
- [ ] Confirm `/admin/providers` displays last ping result without exposing keys.
- [ ] If status is 401/403, classify as `credential_rejected`.
- [ ] If status is 429, classify as `quota_or_rate_limit`.
- [ ] If status is 5xx, classify as `provider_server_error`.
- [ ] If timeout/network, classify as retryable.

Gemini:

```powershell
$env:AI_PING_PROVIDER="gemini"
$env:GEMINI_API_KEY="<key>"
$env:AI_PING_MODEL="gemini-1.5-flash"
$env:AI_PING_REPORT_PATH="./tmp/gemini-ai-ping.json"
npm run ai:ping
```

Claude:

```powershell
$env:AI_PING_PROVIDER="claude"
$env:ANTHROPIC_API_KEY="<key>"
$env:AI_PING_MODEL="claude-3-5-haiku-latest"
$env:AI_PING_REPORT_PATH="./tmp/claude-ai-ping.json"
npm run ai:ping
```

## RC2.2 Provider Live Ping Acceptance Record

Status: `RC2.2_ACCEPTANCE_COMPLETE_OPENAI_ONLY_PROVIDER_KEY_WIRING_SKIPPED`

RC2.2 acceptance verification completed with partial provider coverage.

OpenAI: passed

- Current shell / Node runtime had `OPENAI_API_KEY=present`.
- `npm run ai:ping` successfully called OpenAI.
- Model: `gpt-4.1-mini`.
- Output: `AI_PING_OK`.
- No `401`, `403`, or `429` observed.

Gemini: skipped

- The `ai:ping` runtime did not have any Gemini provider env var:
  - `GEMINI_API_KEY`
  - `GOOGLE_GENERATIVE_AI_API_KEY`
  - `GOOGLE_API_KEY`
- Gemini was not called.

Claude: skipped

- The `ai:ping` runtime did not have any Claude provider env var:
  - `ANTHROPIC_API_KEY`
  - `CLAUDE_API_KEY`
- Claude was not called.

Important clarification:

- DevPilot External API Keys are not AI provider API keys.
- DevPilot External API Keys are source-scoped auth keys for `/api/external/*`.
- They are stored hash-only.
- They cannot be read back as raw keys.
- They cannot be injected into Gemini / Claude provider runtime.

Therefore:

- This is not a Gemini model failure.
- This is not a Claude model failure.
- This is not credential rejection.
- This is not quota exhaustion.
- This is not provider server error.
- This should be marked as key/config wiring skipped.

Minimum next step:

For local verification, explicitly set provider keys in the shell before rerunning `ai:ping`:

```powershell
$env:GEMINI_API_KEY="..."
$env:ANTHROPIC_API_KEY="..."
npm run ai:ping
```

If `.env` support is desired, add explicit dotenv loading or load `.env` into `process.env` before running npm scripts.

Do not use the current hash-only DevPilot External API Keys table for provider secret storage. If provider keys need admin management later, design a separate encrypted provider-secret storage or secret-manager integration.

## RC4 Public Trial Acceptance

Status marker: `RC4_PUBLIC_TRIAL_READY_FOR_REVIEW`

Run locally before deploying or updating NAS:

```powershell
$env:NODE_ENV="development"
$env:AI_PROVIDER="fake"
$env:FILESYSTEM_DISK="local"
$env:QUEUE_DRIVER="local"
npm test
npm run build
npm run env:check
npm run storage:check
npm run rc:local
```

Run against the public domain:

```powershell
$env:DOMAIN_CHECK_BASE_URL="https://imageai.tw"
$env:DOMAIN_CHECK_ADMIN_USER="admin"
$env:DOMAIN_CHECK_ADMIN_PASSWORD="<admin-password>"
$env:DOMAIN_CHECK_REPORT_PATH="./tmp/domain-check.json"
npm run domain:check
```

Optional public fake smoke:

```powershell
$env:SMOKE_BASE_URL="https://imageai.tw"
$env:SMOKE_EXPECT_PROVIDER="fake"
$env:SMOKE_EXPECT_STORAGE_DISK="local"
npm run smoke:staging
```

Admin review URLs:

- `https://imageai.tw/admin/system`
- `https://imageai.tw/admin/providers`
- `https://imageai.tw/admin/provider-playground`
- `https://imageai.tw/admin/devpilot`
- `https://imageai.tw/admin/devpilot/handoffs`
- `https://imageai.tw/admin/devpilot-keys`
- `https://imageai.tw/admin/integration-toolbox`
- `https://imageai.tw/admin/credits`
- `https://imageai.tw/admin/assets`
- `https://imageai.tw/admin/quality`
- `https://imageai.tw/admin/audit`
- `https://imageai.tw/admin/usage`

Production safety checks:

- Default `admin / 1234` password changed before production release.
- `ADMIN_BOOTSTRAP_PASSWORD` is strong and not empty, `1234`, `admin`, `password`, `test`, `demo`, or `changeme`.
- `AUTH_BYPASS=false`.
- Public domain uses HTTPS.
- Behind reverse proxy, `TRUST_PROXY=true` and `FORCE_HTTPS=true`.
- `APP_URL` and `PUBLIC_URL` match the domain.
- CORS is not wildcard for authenticated production traffic.
- Reports do not contain API keys, cookies, secrets, passwords, or full base64.
- DevPilot External API keys remain hash-only and are not used as AI provider keys.
- DevPilot Gateway execution remains disabled/scaffolded until a formal contract exists.
- SQLite is demo/staging only; plan Postgres/MySQL for production traffic.

## RC9 Production Hardening

### Secure Admin Bootstrap

```env
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=
ALLOW_DEFAULT_ADMIN_PASSWORD=false
REQUIRE_SECURE_ADMIN_PASSWORD=true
```

- [ ] Trial/dev may keep `admin / 1234` only as Testing only / WARN.
- [ ] Production with empty admin password is No-Go.
- [ ] Production with weak admin password is No-Go.
- [ ] Weak values include `1234`, `admin`, `password`, `test`, `demo`, and `changeme`.
- [ ] `ALLOW_DEFAULT_ADMIN_PASSWORD=true` is never accepted as a production Go condition.
- [ ] Reports and diagnostics do not output raw admin passwords.

### HTTPS Redirect / Proxy Trust

```env
TRUST_PROXY=true
FORCE_HTTPS=true
HTTPS_REDIRECT_STATUS=308
```

- [ ] `TRUST_PROXY=true` is enabled behind Synology/Nginx/Cloudflare reverse proxy.
- [ ] `FORCE_HTTPS=true` redirects HTTP `GET`/`HEAD` to HTTPS.
- [ ] HTTP `POST`/mutation requests return `400 {"ok":false,"error":"https_required"}` instead of redirecting.
- [ ] `FORCE_HTTPS=false` leaves local/dev routes unchanged.

### Production Go Gate

- [ ] Secure admin bootstrap passed.
- [ ] HTTPS redirect/proxy trust accepted.
- [ ] `trial:check` has no FAIL.
- [ ] `env:check` passed.
- [ ] `storage:check` passed.
- [ ] Reports redacted.

### RC9 Status

- Public trial remains Conditional Go.
- Production release remains No-Go until external blockers are resolved.

## imageai.tw Domain Fix

Full manual guide: `NAS_DOMAIN_FIX.md`.

Required first-pass settings:

- DNS A `@ -> 211.75.219.184`
- Cloudflare Proxy status: DNS only / gray cloud first
- Reverse proxy `imageai.tw` HTTPS `443` -> HTTP `127.0.0.1:3050`
- Certificate for `imageai.tw` with SAN `www.imageai.tw`
- Run `npm run domain:check`

## imageai.tw DNS / HTTPS Troubleshooting

PowerShell:

```powershell
nslookup imageai.tw
nslookup www.imageai.tw
Test-NetConnection imageai.tw -Port 80
Test-NetConnection imageai.tw -Port 443
Test-NetConnection 211.75.219.184 -Port 3050
curl.exe -I http://imageai.tw
curl.exe -I https://imageai.tw
curl.exe -I http://211.75.219.184:3050/health
```

NAS reverse proxy expected settings:

- Source: `HTTPS`, host `imageai.tw`, port `443`
- Destination: `HTTP`, host `127.0.0.1`, port `3050`
- Certificate: Let's Encrypt for `imageai.tw`, plus SAN `www.imageai.tw`
- Router/firewall: TCP `80` and `443` forwarded to NAS
- After reverse proxy works, TCP `3050` can be internal-only
- Cloudflare: keep records DNS only / gray cloud until NAS HTTPS passes

If `npm run domain:check` reports `fetch failed`, inspect:

- DNS A record `@ -> 211.75.219.184`
- DNS propagation
- NAS reverse proxy source host/port
- Destination `http://127.0.0.1:3050`
- Let's Encrypt certificate status
- Router/firewall `80/443`
- ISP inbound port blocking
- Wrong redirect host
- NAS Web Station / reverse proxy conflicts

## Queue / DB Readiness

- Current public trial setting: `QUEUE_DRIVER=local`.
- Do not use `QUEUE_DRIVER=worker` with SQLite/sql.js for public trial.
- Worker mode requires shared server-grade DB state, preferably Postgres or MySQL.
- `npm run env:check` fails production `QUEUE_DRIVER=worker + sqlite/sqljs` and warns for production `QUEUE_DRIVER=local`.
- Docker Compose keeps the worker behind the `worker` profile; enable it only after DB readiness is solved.

## RC5 Trial Acceptance

Manual product checks:

- [ ] Login.
- [ ] Change default admin password.
- [ ] Create task with fake provider.
- [ ] View outputs.
- [ ] Download asset.
- [ ] Favorite/archive asset.
- [ ] Create share link.
- [ ] Review quality.
- [ ] Adjust credits with a reason.
- [ ] Provider playground fake run.
- [ ] DevPilot handoff test.
- [ ] Audit/usage check.
- [ ] `npm run rc:local`.
- [ ] `npm run trial:check`.
- [ ] `npm run domain:check` when domain validation is in scope.
- [ ] Public `npm run smoke:staging` when HTTPS domain is expected to be available.

Command block:

```powershell
npm test
npm run build
npm run env:check
npm run storage:check
npm run rc:local
npm run trial:check
```

Public smoke, when in scope:

```powershell
$env:SMOKE_BASE_URL="https://imageai.tw"
$env:SMOKE_EXPECT_PROVIDER="fake"
$env:SMOKE_EXPECT_STORAGE_DISK="local"
npm run smoke:staging
```

## RC6 Live Services + Production Readiness

### Admin Password Mandatory Hardening

- [ ] Internal testing only: `admin / 1234` may remain temporarily active when `/admin/system` clearly marks it as Testing only.
- [ ] Confirm `npm run trial:check` keeps `default_admin_password_warning` as a trial warning and does not block public trial.
- [ ] Change the seeded `admin / 1234` password before external/public release or production release.
- [ ] Confirm production release remains No-Go while the default password is active.

### Live Provider Ping Acceptance

OpenAI:

```powershell
$env:AI_PING_PROVIDER="openai"
$env:OPENAI_API_KEY="<key>"
$env:AI_PING_MODEL="gpt-4.1-mini"
npm run ai:ping
```

Gemini:

```powershell
$env:AI_PING_PROVIDER="gemini"
$env:GEMINI_API_KEY="<key>"
$env:AI_PING_MODEL="gemini-1.5-flash"
npm run ai:ping
```

Claude:

```powershell
$env:AI_PING_PROVIDER="claude"
$env:ANTHROPIC_API_KEY="<key>"
$env:AI_PING_MODEL="claude-3-5-haiku-latest"
npm run ai:ping
```

Acceptance:

- [ ] Success report normalizes output/usage/latency.
- [ ] Missing key is recorded as `missing_api_key` / safe skip.
- [ ] 401/403 maps to `credential_rejected`.
- [ ] 429 maps to `quota_or_rate_limit`.
- [ ] 5xx maps to `provider_server_error`.
- [ ] Timeout/network maps to `timeout_or_network_retryable`.
- [ ] Report and `/admin/providers` do not expose keys.

### R2/S3 Live Storage Acceptance

R2:

```powershell
$env:FILESYSTEM_DISK="r2"
$env:R2_ACCOUNT_ID="<account-id>"
$env:R2_BUCKET="<bucket>"
$env:R2_ACCESS_KEY_ID="<access-key-id>"
$env:R2_SECRET_ACCESS_KEY="<secret>"
$env:STORAGE_PUBLIC_URL="https://assets.example.com"
npm run storage:check
```

S3 requires `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `STORAGE_PUBLIC_URL`.

- [ ] write/read/exists/delete passed.
- [ ] public URL GET passed.
- [ ] CORS/public URL failures include suggestions.
- [ ] Report contains no secret or full base64.

### Queue / DB Production Plan

- [ ] Public trial keeps `QUEUE_DRIVER=local`.
- [ ] SQLite/sql.js is accepted only for public trial/staging.
- [ ] Production uses Postgres or MySQL.
- [ ] Production uses `QUEUE_DRIVER=worker`.
- [ ] App and worker share the same server-grade DB.
- [ ] Migration dry run completed.
- [ ] Backup/export created.
- [ ] Rollback plan documented.

### Public Trial Go/No-Go

Go:

- [ ] `https://imageai.tw/health` returns 200.
- [ ] Public trial status is Conditional Go if `admin / 1234` is intentionally kept for testing.
- [ ] Public smoke passed.
- [ ] `trial:check` has no critical fail.
- [ ] `env:check` passed.
- [ ] `storage:check` passed.
- [ ] Fake provider fallback working.
- [ ] Reports redacted.
- [ ] Rate limits enabled.
- [ ] Upload limits enabled.

No-Go:

- [ ] Production release with `admin / 1234` still active.
- [ ] `AUTH_BYPASS=true`.
- [ ] API key exposed.
- [ ] Production stack trace visible.
- [ ] Domain health fails.
- [ ] Storage public URL fails.
- [ ] Worker + SQLite production mode.

## RC8 Trial Operations & User Testing

### Trial User Flow

1. Open `https://imageai.tw`
2. Login / register with invite code
3. Create task
4. Upload product image
5. Analyze product
6. Generate banner
7. Download output
8. Save/favorite asset
9. Share asset
10. Submit feedback

### Trial Admin Flow

1. Check `/admin/system`
2. Check `/admin/trial`
3. Check `/admin/feedback`
4. Check `/admin/tasks`
5. Check `/admin/assets`
6. Check `/admin/usage`
7. Check `/admin/audit`
8. Run `npm run trial:check`
9. Run `npm run trial:cleanup` dry run

### Trial Settings

```env
TRIAL_MODE=true
TRIAL_MODE_MESSAGE="目前為測試站，資料與圖片可能會被清理。"
INVITE_CODE_ENABLED=true
TRIAL_INVITE_CODE=
INVITE_CODE_LABEL="Trial invite code"
TRIAL_CLEANUP_DRY_RUN=true
TRIAL_CLEANUP_OLDER_THAN_DAYS=7
TRIAL_CLEANUP_INCLUDE_OUTPUTS=false
```

- [ ] Trial banner visible on frontend and admin.
- [ ] Invite gate enabled or users are admin-approved.
- [ ] Invite code is not returned by API/report.
- [ ] Feedback form works from `/feedback`, task detail, and share page.
- [ ] `/admin/trial` shows trial analytics without secrets.
- [ ] `/admin/feedback` can mark reports reviewing/resolved/ignored.
- [ ] `npm run trial:cleanup` writes a redacted dry-run report.

### Known Trial Limitations

- `admin / 1234` may remain during internal testing only.
- `QUEUE_DRIVER=local`.
- local storage.
- no R2 live yet.
- no Gemini/Claude live yet.
- DevPilot Gateway execution not implemented.
- HTTP redirect not fixed yet.
- SQLite/sql.js not production-grade.

### Go/No-Go

Trial Go:

- [ ] HTTPS works.
- [ ] smoke passes.
- [ ] invite gate enabled or admin-approved users only.
- [ ] feedback works.
- [ ] trial warning visible.
- [ ] reports redacted.

Production No-Go:

- [ ] default admin password active.
- [ ] no server-grade DB.
- [ ] no R2/S3.
- [ ] no provider live validation except OpenAI.
- [ ] no production monitoring.
