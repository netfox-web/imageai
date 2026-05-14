# AI Commerce Ad Studio

React + Express + SQLite MVP for generating ecommerce ad creatives. The app keeps `AI_PROVIDER=fake` for local demos and can switch to OpenAI, Gemini, Claude, external gateways, plus local/R2/S3 storage for staging.

## Quick Start

```bash
npm ci
npm run migrate
npm run seed
npm start
```

Local URLs:

- Frontend: http://localhost:3000/
- Dashboard: http://localhost:3000/dashboard
- Tasks: http://localhost:3000/tasks
- Assets: http://localhost:3000/assets
- Credits: http://localhost:3000/credits
- Admin: http://localhost:3000/admin

Seed admin:

- Quick test login: `admin` / `1234`
- Optional legacy email admin: `npm run make:admin -- admin@example.com password123`

## NPM Scripts

- `npm run dev`: start API and Vite dev server.
- `npm run build`: build the React app.
- `npm start`: run the Express server.
- `npm run migrate`: run SQLite migrations.
- `npm run seed`: seed tools, presets, formats, packages, prompts, and admin.
- `npm run reset`: reset the local SQLite database.
- `npm test`: run Vitest.
- `npm run worker`: process queued tasks in worker mode.
- `npm run make:admin -- email password`: promote or create an admin.
- `npm run smoke:staging`: run browserless staging smoke flow.
- `npm run storage:check`: verify local/S3/R2 storage.
- `npm run env:check`: validate staging/production environment variables.
- `npm run quality:review`: create a manual AI output review checklist.
- `npm run tasks:recover`: dry-run or recover stuck processing tasks.
- `npm run dev:reset`: non-production local reset, including DB, uploads, outputs, migrate, seed, and demo admin.
- `npm run cleanup:local`: dry-run local tmp/storage cleanup by default.
- `npm run export:demo-data`: export redacted demo data for handoff/debugging.
- `npm run devpilot:local`: run local DevPilot external API/client integration against a running server.
- `npm run rc:local`: run safe RC2-prep diagnostics and write `tmp/rc-local-report.json`.
- `npm run ai:ping`: live text ping for `fake`, `openai`, `gemini`, or `claude`.
- `npm run domain:check`: verify public domain health, HTTPS, admin page reachability, and optional admin login.
- `npm run domain:manual-guide`: print the manual NAS DNS / reverse proxy / certificate checklist.

## Environment

Copy `.env.example` to `.env` and set the values for your target environment.

Important values:

- `PORT`, `APP_URL`, `CORS_ORIGIN`
- `SESSION_SECRET`: required and strong for production.
- `AUTH_BYPASS=false`: never enable in production.
- `AI_PROVIDER=fake|openai|gemini|claude|external|devpilot-gateway`
- `ALLOW_FAKE_PROVIDER=false`: production blocks fake unless explicitly allowed for demos.
- `AI_STRICT_PROVIDER=false|true`
- `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_MODE=auto|edit|generate`
- `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-1.5-flash`
- `GEMINI_API_KEY` fallback order is `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, then `GOOGLE_API_KEY`.
- `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`, `CLAUDE_MODEL`
- `DEVPILOT_GATEWAY_BASE_URL`, `DEVPILOT_GATEWAY_API_KEY`, `DEVPILOT_GATEWAY_MODEL`
- `EXTERNAL_API_RATE_LIMIT_ENABLED=true`, `EXTERNAL_API_RATE_LIMIT_MAX=120`
- `FILESYSTEM_DISK=local|r2|s3`
- `STORAGE_PUBLIC_URL`
- `QUEUE_DRIVER=local|worker`
- `DATABASE_CLIENT=sqlite`; `postgres/mysql` are documented production targets but not fully implemented in this MVP runtime.

Run:

```bash
npm run env:check
```

`FAIL` exits with code `1`; `WARN` means the app can run but needs review.

## Fake Provider

Local demo mode:

```bash
AI_PROVIDER=fake
FILESYSTEM_DISK=local
QUEUE_DRIVER=local
npm start
```

Fake provider analyzes products with deterministic sample copy and creates placeholder/copy output images. It should remain usable for demos, CI, and fallback testing.

## OpenAI Provider

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_TEXT_MODEL=gpt-4.1-mini
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_MODE=auto
AI_STRICT_PROVIDER=false
npm start
```

`OPENAI_IMAGE_MODE=auto` prefers image edit/reference when an uploaded product image exists. If edit/reference is unavailable and `AI_STRICT_PROVIDER=false`, it falls back to prompt generation, then fake provider. If `AI_STRICT_PROVIDER=true`, provider errors throw and the task fails.

OpenAI image APIs may not support arbitrary platform sizes directly. The app generates the nearest supported size and uses Sharp post-processing to cover-crop/pad to the requested format.

## Provider Registry

RC1.14 adds a provider registry for `fake`, `openai`, `gemini`, `claude`, `external`, and `devpilot-gateway`.

Admin diagnostics:

- `http://localhost:3000/admin/providers`
- `GET /api/admin/providers`
- `GET /api/admin/providers/:provider/validate`
- `POST /api/admin/providers/:provider/ping`

The registry reports safe metadata only: provider name, label, configured status, available models, capabilities, image/text support, key presence, and config source. It never returns raw API keys.

Gemini scaffold:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash
npm start
```

Gemini product-image analysis is wired through the Gemini `generateContent` REST shape and supports inline image data. Banner generation remains scaffolded and falls back to fake unless strict mode is enabled.

Claude scaffold:

```bash
AI_PROVIDER=claude
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-3-5-haiku-latest
npm start
```

Claude product-image analysis is wired through the Anthropic Messages REST shape. Banner image generation remains scaffolded and falls back to fake unless strict mode is enabled.

DevPilot Gateway scaffold:

```bash
AI_PROVIDER=devpilot-gateway
DEVPILOT_GATEWAY_BASE_URL=https://gateway.example.com
DEVPILOT_GATEWAY_API_KEY=...
DEVPILOT_GATEWAY_MODEL=devpilot-gateway
npm start
```

This is a gateway provider skeleton for a future routing service. Use `external` for a generic custom AI endpoint, or `devpilot-gateway` when the gateway owns model routing and policy.

## RC1.15-RC1.20 Pre-RC2 Additions

Gemini and Claude are now executable text-provider scaffolds with mocked-test coverage. They expose `ping`, `generateText`, `summarize`, `classify`, `rewrite`, `extract`, `plan`, and `promptRewrite`. Image generation/editing/variation remain marked as unsupported or future for these providers until RC2+ live contracts and keys are verified.

Task creation supports optional advanced provider selection fields: `provider`, `model`, `capability`, `strict_provider`, and `quality_review_required`. If a requested provider is not configured and `strict_provider=false`, the task safely falls back to fake and records requested/resolved provider metadata plus a fallback reason. If `strict_provider=true`, explicitly requested unconfigured providers fail safely.

Assets now support favorite, archived, tags, notes, and manifest export via `GET /api/assets/export-manifest?ids=1,2`. Quality review is persisted in `quality_reviews` and can mark outputs as approved or needing regeneration; it does not automatically rerun providers.

Admin staging pages added or expanded:

- `/admin/assets`
- `/admin/quality`
- `/admin/audit`
- `/admin/usage`
- `/admin/providers`

External DevPilot API rate limiting is source-scoped:

```powershell
$env:EXTERNAL_API_RATE_LIMIT_ENABLED="true"
$env:EXTERNAL_API_RATE_LIMIT_WINDOW_MS="60000"
$env:EXTERNAL_API_RATE_LIMIT_MAX="120"
```

Run the RC local diagnostic:

```powershell
$env:AI_PROVIDER="fake"
$env:FILESYSTEM_DISK="local"
$env:QUEUE_DRIVER="local"
$env:RC_LOCAL_REPORT_PATH="./tmp/rc-local-report.json"
npm run rc:local
```

The report includes env/storage/health/provider summaries and is redacted. It does not call live AI APIs or real R2/S3 buckets.

## RC2.1 Live Provider Ping

`npm run ai:ping` validates one live text provider without creating tasks, running workers, or touching storage. It writes a redacted report to `tmp/ai-ping-last.json` and optionally to `AI_PING_REPORT_PATH`. Admin `/admin/providers` displays the last ping summary.

Fake ping:

```powershell
$env:AI_PING_PROVIDER="fake"
$env:AI_PING_PROMPT="Return a short smoke-test response."
npm run ai:ping
```

Gemini live ping:

```powershell
$env:AI_PING_PROVIDER="gemini"
$env:GEMINI_API_KEY="<key>"
$env:AI_PING_MODEL="gemini-1.5-flash"
$env:AI_PING_REPORT_PATH="./tmp/gemini-ai-ping.json"
npm run ai:ping
```

Claude live ping:

```powershell
$env:AI_PING_PROVIDER="claude"
$env:ANTHROPIC_API_KEY="<key>"
$env:AI_PING_MODEL="claude-3-5-haiku-latest"
$env:AI_PING_REPORT_PATH="./tmp/claude-ai-ping.json"
npm run ai:ping
```

OpenAI text ping:

```powershell
$env:AI_PING_PROVIDER="openai"
$env:OPENAI_API_KEY="<key>"
$env:AI_PING_MODEL="gpt-4.1-mini"
npm run ai:ping
```

Diagnosis mapping:

- `credential_rejected`: provider returned 401/403 or equivalent credential error.
- `quota_or_rate_limit`: provider returned 429 or quota/rate pressure.
- `provider_server_error`: provider returned 5xx.
- `timeout_or_network_retryable`: timeout/network failure and safe to retry.

Reports and CLI output must not include API keys, secrets, or full base64 payloads.

## Storage

Local storage is used by default:

```bash
FILESYSTEM_DISK=local
npm run storage:check
```

R2:

```bash
FILESYSTEM_DISK=r2
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
STORAGE_PUBLIC_URL=https://cdn.example.com
npm run storage:check
```

R2 endpoint is `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`. Configure bucket/object permissions, CORS, and a public custom domain or public bucket URL.

S3:

```bash
FILESYSTEM_DISK=s3
S3_ENDPOINT=https://s3.example.com
S3_REGION=auto
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
STORAGE_PUBLIC_URL=https://cdn.example.com
npm run storage:check
```

Troubleshooting:

- Credentials: confirm access key has read/write/delete.
- Bucket permissions: output objects must be readable by `STORAGE_PUBLIC_URL`.
- CORS: allow GET from the app domain.
- Public URL: verify the exact object URL in the storage check report.
- Endpoint/region: R2 region should be `auto`.

Optional report:

```bash
STORAGE_CHECK_REPORT_PATH=./tmp/storage-check-report.json npm run storage:check
```

## Queue And Worker

Local mode runs jobs in the web process. Staging/production should use:

```bash
QUEUE_DRIVER=worker
npm start
npm run worker
```

Recover stuck tasks:

```bash
TASK_RECOVER_AFTER_MINUTES=15 TASK_RECOVER_DRY_RUN=true npm run tasks:recover
TASK_RECOVER_AFTER_MINUTES=15 TASK_RECOVER_DRY_RUN=false TASK_RECOVER_ACTION=requeue npm run tasks:recover
```

Retry policy:

- Provider/storage errors can be retried until `max_retries`.
- Validation/configuration errors fail without retry.
- Failed tasks refund once through `failure_refunded`.

## Local Acceptance Test

Use fake/local:

```bash
AI_PROVIDER=fake
FILESYSTEM_DISK=local
QUEUE_DRIVER=local
npm run migrate
npm run seed
npm start
```

Manual checklist:

- Login as `admin` / `1234`.
- Upload product image.
- Run AI auto-fill.
- Create a banner task.
- Confirm task completes.
- Confirm output visible and downloadable.
- Open `/dashboard`, `/tasks`, `/assets`, `/credits`.
- Open `/admin`, confirm task, metadata, provider, fallback badge, and safe raw response summary.

## RC1.5 Pre-API Checklist

Use this checklist immediately before switching to real OpenAI or R2/S3 credentials. It keeps the app in fake/local mode and should not call any paid API or external bucket.

Required local check, PowerShell:

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

Fake/local smoke, PowerShell:

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

## imageai.tw Domain Fix

Use [NAS_DOMAIN_FIX.md](./NAS_DOMAIN_FIX.md) for the non-engineer NAS runbook.

Short checklist:

- DNS A `@ -> 211.75.219.184`
- Cloudflare Proxy status: DNS only / gray cloud first
- Reverse proxy: `imageai.tw` HTTPS `443` -> HTTP `127.0.0.1:3050`
- Certificate: Let's Encrypt for `imageai.tw` plus SAN `www.imageai.tw`
- Verify with `npm run domain:check`

## RC4 Public Trial Checklist

RC4 adds public-domain diagnostics and admin trial tools while keeping the fake provider available.

PowerShell local sanity:

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

Domain / NAS diagnostics:

```powershell
$env:DOMAIN_CHECK_BASE_URL="https://imageai.tw"
$env:DOMAIN_CHECK_ADMIN_USER="admin"
$env:DOMAIN_CHECK_ADMIN_PASSWORD="<admin-password>"
$env:DOMAIN_CHECK_REPORT_PATH="./tmp/domain-check.json"
npm run domain:check
```

The domain report checks `/health`, `/health/deep`, `/`, `/admin`, optional admin login, HTTPS, cookie hints, CORS hints, APP_URL/PUBLIC_URL, and worker/storage/provider summaries. Reports redact admin password, cookies, tokens, API keys, secrets, and long base64-like strings.

### imageai.tw DNS / HTTPS Troubleshooting

For the full step-by-step NAS runbook, open [NAS_DOMAIN_FIX.md](./NAS_DOMAIN_FIX.md). Start with DNS only / gray cloud in Cloudflare; do not orange-cloud the record until Synology certificate and reverse proxy checks pass.

PowerShell DNS checks:

```powershell
nslookup imageai.tw
nslookup www.imageai.tw
```

PowerShell TCP checks:

```powershell
Test-NetConnection imageai.tw -Port 80
Test-NetConnection imageai.tw -Port 443
Test-NetConnection 211.75.219.184 -Port 3050
```

Header checks:

```powershell
curl.exe -I http://imageai.tw
curl.exe -I https://imageai.tw
curl.exe -I http://211.75.219.184:3050/health
```

NAS reverse proxy checklist:

- Source protocol: HTTPS
- Source hostname: `imageai.tw`
- Source port: `443`
- Destination protocol: HTTP
- Destination hostname: `127.0.0.1`
- Destination port: `3050`
- Certificate: Let's Encrypt issued for `imageai.tw`; optionally include `www.imageai.tw`
- Certificate auto renew: enabled
- Router: forward TCP `80` to NAS
- Router: forward TCP `443` to NAS
- Port `3050` can remain internal only after reverse proxy works
- Check whether ISP blocks inbound `80/443`
- Check NAS Web Station / reverse proxy conflicts

### Queue Driver Guidance

- `QUEUE_DRIVER=local`: recommended for the current public trial / single-process NAS demo.
- `QUEUE_DRIVER=worker`: use only after moving task state to a server-grade shared DB such as Postgres or MySQL.
- SQLite / sql.js local DB is not reliable with separate app and worker processes because each process can hold a separate in-memory view of the DB file.
- `npm run env:check` fails production `QUEUE_DRIVER=worker + DATABASE_CLIENT=sqlite/sqljs` and warns for production `QUEUE_DRIVER=local`.
- In Docker Compose, the worker service is behind the `worker` profile. Start it only with `docker compose --profile worker up -d` after DB readiness is solved.

New admin URLs:

- `/admin/system` - runtime summary, security warnings, and admin password change.
- `/admin/providers` - provider registry and last ping result.
- `/admin/provider-playground` - safe text capability playground for configured providers.
- `/admin/devpilot` - DevPilot external handoff dashboard.
- `/admin/devpilot-keys` - source-scoped External API keys, stored hash-only.
- `/admin/integration-toolbox` - downloadable integration resources.
- `/admin/assets`, `/admin/quality`, `/admin/audit`, `/admin/usage` - asset, review, audit, and usage operations.

Before public users:

- Change the default `admin / 1234` password from `/admin/system`.
- Use HTTPS and set `APP_URL` / `PUBLIC_URL` to the public domain.
- Keep `AUTH_BYPASS=false` on public deployments.
- Avoid wildcard CORS for authenticated production traffic.
- Keep provider keys in env/secret manager; do not use DevPilot External API keys as AI provider keys.
- SQLite remains acceptable for demo/staging only; plan Postgres/MySQL before production traffic.
- DevPilot Gateway execution is still a scaffold until a formal execution contract exists.

Manual browser URLs:

- http://localhost:3000/
- http://localhost:3000/dashboard
- http://localhost:3000/tasks
- http://localhost:3000/assets
- http://localhost:3000/credits
- http://localhost:3000/admin

Manual checks:

- Login as `admin` / `1234`.
- Create one fake/local banner task.
- Confirm result page output image loads and downloads.
- Confirm dashboard, tasks, assets, and credits pages do not crash with existing smoke data.
- Confirm admin task detail shows provider `fake`, storage `local`, metadata, and redacted raw response.
- Confirm `AUTH_BYPASS=false`; production must never run with `AUTH_BYPASS=true`.
- Confirm no real `OPENAI_API_KEY`, R2 secret, S3 secret, or full base64 is pasted into logs, reports, screenshots, or docs.

Local data cleanup guidance:

- Smoke tests create rows and small files under `server/storage`.
- Keep them if you want an audit trail for RC acceptance.
- To reset local demo data, run `npm run reset` only after confirming no useful local work needs to be preserved.
- Remove generated reports under `tmp/` when no longer needed; reports are diagnostic artifacts and should not contain secrets.

Expected RC1.5 result before RC2:

- `npm test`: pass
- `npm run build`: pass
- `npm run env:check`: pass in fake/local development mode
- `npm run storage:check`: pass with local disk
- `npm run smoke:staging`: pass with provider `fake`, storage `local`, output URL reachable

## Real Staging Verification

RC1.10 status: these OpenAI/R2 flows are documented for RC2 but have not been tested with a real `OPENAI_API_KEY` or real R2/S3 bucket yet. On Windows PowerShell, set environment variables with `$env:KEY="value"` before running each command; the compact inline examples below are shell-style shorthand.

Fake/local:

```bash
SMOKE_BASE_URL=http://localhost:3000 \
SMOKE_EXPECT_PROVIDER=fake \
SMOKE_EXPECT_STORAGE_DISK=local \
npm run smoke:staging
```

OpenAI/local RC2:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODE=auto
FILESYSTEM_DISK=local
QUEUE_DRIVER=local
AI_STRICT_PROVIDER=false
npm run env:check
npm start

SMOKE_BASE_URL=http://localhost:3000 \
SMOKE_EXPECT_PROVIDER=openai \
SMOKE_EXPECT_STORAGE_DISK=local \
SMOKE_REPORT_PATH=./tmp/openai-local-smoke.json \
npm run smoke:staging
```

Read `./tmp/openai-local-smoke.json` after the run. It records `provider`, `fallback_used`, `fallback_reason`, `image_mode`, `latency_ms`, and `cost`. If OpenAI fails and `AI_STRICT_PROVIDER=false`, fake fallback is allowed and will be visible in the report. If `AI_STRICT_PROVIDER=true`, OpenAI failures should fail the task instead of silently passing with fake output. Never paste or commit `OPENAI_API_KEY`.

R2 storage RC2:

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

The report includes `write_ok`, `read_ok`, `exists_ok`, `delete_ok`, `public_url_ok`, `test_key`, `error_summary`, and `suggestions`. If public URL validation fails, check bucket permission, custom domain, CORS, and `STORAGE_PUBLIC_URL`. Reports must not include secrets.

OpenAI/R2 with worker RC2:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
FILESYSTEM_DISK=r2
QUEUE_DRIVER=worker
AI_STRICT_PROVIDER=false
npm start
npm run worker

SMOKE_BASE_URL=https://staging.example.com \
SMOKE_EMAIL=admin@example.com \
SMOKE_PASSWORD=... \
SMOKE_EXPECT_PROVIDER=openai \
SMOKE_EXPECT_STORAGE_DISK=r2 \
SMOKE_REPORT_PATH=./tmp/openai-r2-smoke.json \
npm run smoke:staging
```

External staging:

```bash
SMOKE_BASE_URL=https://staging.example.com \
SMOKE_EMAIL=admin@example.com \
SMOKE_PASSWORD=... \
SMOKE_EXPECT_PROVIDER=openai \
SMOKE_EXPECT_STORAGE_DISK=r2 \
SMOKE_REPORT_PATH=./tmp/smoke-report.json \
npm run smoke:staging
```

Smoke output verifies:

- health/session
- register or login
- image analyze
- task creation
- polling to success/failed
- output URL reachability
- metadata provider/model/image_count/latency/cost/fallback

Smoke reports include `task_id`, `status`, `output_count`, `output_urls_reachable_count`, `provider`, `storage_disk`, `fallback_used`, `fallback_reason`, `latency_ms`, `cost`, `failed_step`, `error_summary`, and `suggestions`. If worker mode is enabled but no worker is running, smoke should time out at `poll task` and suggest checking the worker process and `QUEUE_DRIVER`.

If smoke fails it prints failed step, HTTP status, response summary, task id, and suggested checks.

## External AI Handoff API

RC1.11 adds a side-effect-free DevPilot external handoff API for external systems. These endpoints only create and read manual handoff records. They do not update task status, project status, phase/progress/next steps, approval requests, workers, or AI providers.

### Configure keys

Recommended for local/staging: open `http://localhost:3000/admin/devpilot-keys`, enter a `source_system` and API key, then save. The app stores only a one-way SHA-256 hash plus a short fingerprint. The raw key is cleared after saving and cannot be viewed by anyone, including admins.

Environment keys are still supported for deployment automation:

```env
DEVPILOT_EXTERNAL_API_KEYS=external-system-a:dev-key-a,external-system-b:dev-key-b
DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES=0
```

If both `DEVPILOT_EXTERNAL_API_KEYS` and the Admin-managed key table are empty, all external API endpoints return `403`.

### Required headers

- `X-DevPilot-Source-System`: source name configured in Admin DevPilot Keys or `DEVPILOT_EXTERNAL_API_KEYS`
- `X-DevPilot-Api-Key`: key for that source
- `X-DevPilot-Request-Id`: optional request trace id, stored as metadata
- `X-DevPilot-Idempotency-Key`: optional create idempotency key

Raw API keys are never returned by the API. Payload summaries redact secret-like fields and long base64 strings.

### Endpoints

- `POST /api/external/tasks/:task_id/handoffs`
- `GET /api/external/ai-handoffs`
- `GET /api/external/handoffs/:handoff_id`

### PowerShell local example

Terminal 1:

```powershell
$env:DEVPILOT_EXTERNAL_API_KEYS="external-system-a:dev-key-a"
$env:DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES="0"
$env:AI_PROVIDER="fake"
$env:FILESYSTEM_DISK="local"
npm start
```

Create a handoff:

```powershell
$body = @{
  from_agent = "external-system-a"
  to_agent = "devpilot-reviewer"
  reason = "Manual review needed before continuing."
  next_step = "Review the external ticket and decide the handoff outcome."
  risk_level = "medium"
  external_ref = "external-ticket-123"
  actor_type = "system"
  actor_id = "external-system-a"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/api/external/tasks/1/handoffs" `
  -Headers @{
    "X-DevPilot-Source-System" = "external-system-a"
    "X-DevPilot-Api-Key" = "dev-key-a"
    "X-DevPilot-Request-Id" = "req-123"
    "X-DevPilot-Idempotency-Key" = "idem-123"
  } `
  -ContentType "application/json" `
  -Body $body
```

List handoffs:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:3000/api/external/ai-handoffs?status=pending&risk=medium" `
  -Headers @{
    "X-DevPilot-Source-System" = "external-system-a"
    "X-DevPilot-Api-Key" = "dev-key-a"
  }
```

`curl.exe` equivalent:

```powershell
curl.exe -X POST "http://localhost:3000/api/external/tasks/1/handoffs" `
  -H "Content-Type: application/json" `
  -H "X-DevPilot-Source-System: external-system-a" `
  -H "X-DevPilot-Api-Key: dev-key-a" `
  -H "X-DevPilot-Idempotency-Key: idem-123" `
  --data "{\"from_agent\":\"external-system-a\",\"to_agent\":\"devpilot-reviewer\",\"reason\":\"Manual review needed before continuing.\",\"next_step\":\"Review the external ticket.\",\"risk_level\":\"medium\"}"
```

### Idempotency

When `X-DevPilot-Idempotency-Key` is provided, create checks for an existing non-hidden handoff with:

- `conversation_ref = ai-task:<task_id>`
- `api_payload.source_system = authenticated source`
- `api_payload.idempotency_key = header value`

If found, the API returns `200` with `idempotent_replay=true` and does not create another record. Invalid historical `api_payload` JSON is ignored safely.

### Source isolation

By default, each authenticated source can only read records created by that source. If `DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES=1` and the query includes `include_all_sources=true`, cross-source reads are allowed. Otherwise, any `source_system` query is forced back to the authenticated source.

Supported list filters:

- `q`
- `from_agent`
- `to_agent`
- `status`
- `risk` / `risk_level`
- `source_system`
- `external_ref`

### Error format

External API errors use:

```json
{ "ok": false, "error": "..." }
```

Expected statuses:

- `400`: invalid request or missing fields
- `403`: API disabled, unknown source, or invalid API key
- `404`: task or handoff not found

### Production integration checklist

- Configure one key per source system.
- Rotate keys outside git and deployment artifacts.
- Keep `DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES=0` unless a trusted aggregator requires cross-source reads.
- Send `X-DevPilot-Idempotency-Key` on create retries.
- Treat returned handoff records as manual-review metadata only; this API intentionally never triggers task execution.
- Monitor `403` and `400` rates for integration mistakes.

### Local client/server integration test

Terminal 1:

```powershell
$env:DEVPILOT_EXTERNAL_API_KEYS="external-system-a:dev-key-a,external-system-b:dev-key-b"
$env:DEVPILOT_EXTERNAL_API_ALLOW_ALL_SOURCES="0"
$env:AI_PROVIDER="fake"
$env:FILESYSTEM_DISK="local"
npm start
```

Terminal 2:

```powershell
$env:DEVPILOT_API_BASE_URL="http://localhost:3000"
$env:DEVPILOT_SOURCE_SYSTEM="external-system-a"
$env:DEVPILOT_API_KEY="dev-key-a"
$env:DEVPILOT_SECOND_SOURCE_SYSTEM="external-system-b"
$env:DEVPILOT_SECOND_API_KEY="dev-key-b"
npm run devpilot:local
```

The script uses `server/clients/DevPilotHandoffClient.js` over real HTTP and verifies:

- create handoff
- idempotency replay
- list read
- detail read
- source isolation returns 404 for another source
- output summary does not include API keys

## Staging Smoke Test Checklist

- `fake + local + local queue`: product analysis, task creation, task result page.
- `openai + local`: analyze and banner generation finish; fallback is visible if used.
- `openai + R2`: output image writes, public URL opens in browser.
- `worker mode`: task moves from queued/processing to completed/failed; frontend polling updates every 3 seconds.

## Quality Review

Generate a manual review sheet:

```bash
QUALITY_RECENT_LIMIT=10 QUALITY_REVIEW_PATH=./tmp/quality-review.md npm run quality:review
QUALITY_TASK_IDS=1,2,3 QUALITY_REVIEW_PATH=./tmp/quality-review.md npm run quality:review
```

The checklist includes product preservation, garbled text, composition, size, commercial quality, and notes.

Manual OpenAI review standards:

- Product subject is preserved.
- Logo, packaging, color, shape, and proportions are not altered.
- No garbled or fake text.
- Output size matches the requested platform format.
- Composition is commercially usable.
- Decide whether regeneration is required.
- Note whether fake fallback was used.

## Admin Operations

Admin pages:

- `/admin`: summary, failure and fallback rates.
- `/admin/users`: search, pagination, role/status/credits.
- `/admin/tasks`: provider/model/image mode/storage/fallback/latency.
- `/admin/tasks/:id`: user info, request summary, outputs, output URLs, metadata debug, redacted raw response.

Admin actions:

- Retry failed task.
- Mark stuck processing task failed.
- Adjust credits with a note.

All `/api/admin/*` routes require `role=admin`.

## PM2 Deployment

```bash
npm install -g pm2 # one-time host prerequisite if pm2 is not installed
npm ci
npm run env:check
npm run migrate
npm run seed
npm run build
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs
pm2 restart all
```

The PM2 config starts:

- `ad-studio-web`
- `ad-studio-worker`

Docker is not the primary deployment path for this MVP; PM2 is the documented staging path.

## Database Production Path

SQLite/sql.js is suitable for demo and staging validation. Production should move to Postgres or MySQL with:

- a real DB adapter/ORM layer
- migration review for SQLite-specific syntax/checks
- backups
- connection pooling
- zero-downtime migration strategy

`DATABASE_CLIENT=postgres|mysql` currently emits a warning from `env:check`; it is reserved for the production migration path.

## Production Readiness Checklist

Environment:

- Do not commit `OPENAI_API_KEY` or secrets.
- Set strong `SESSION_SECRET`.
- Keep `AUTH_BYPASS=false`.
- Prefer `AI_STRICT_PROVIDER=true` in production, or explicitly accept fake fallback risk.
- Set `STORAGE_PUBLIC_URL` to the final CDN/custom domain.

Storage:

- Verify bucket permissions, CORS, public URL, lifecycle cleanup.
- Run `npm run storage:check`.

Queue:

- Use `QUEUE_DRIVER=worker`.
- Run worker under PM2/systemd/container restart policy.

Database:

- SQLite is demo/staging only.
- Plan Postgres/MySQL migrations and backups.

Security:

- Upload type and 10MB size validation.
- Rate limits for analyze/task creation/auth.
- Production errors hide stack traces.
- API keys are never sent to frontend bootstrap.
- Raw response/base64 is redacted.

Observability:

- Monitor task error logs, provider latency, estimated cost, fallback rate, failed rate.

AI quality:

- Image edit/reference improves product consistency but still needs human QA.
- Prompt-only generation may alter product details.

Deployment:

- `npm ci`
- `npm run env:check`
- `npm run migrate`
- `npm run seed`
- `npm run build`
- `npm start`
- `npm run worker`
- `npm run smoke:staging`
- `npm run storage:check`

## Final Local Acceptance

```bash
npm ci
npm run migrate
npm run seed
npm test
npm run build
npm run env:check
npm run storage:check
npm start
SMOKE_BASE_URL=http://localhost:3000 SMOKE_EXPECT_PROVIDER=fake SMOKE_EXPECT_STORAGE_DISK=local npm run smoke:staging
```

Then run the manual browser checklist against the URLs at the top of this README.
## RC1.6-RC1.10 Local Product Hardening

This round keeps `AI_PROVIDER=fake` and `FILESYSTEM_DISK=local` as the safe demo path while adding staging-management surfaces and maintenance tools.

### Product demo pages

- Frontend: `http://localhost:3000/`
- Dashboard: `http://localhost:3000/dashboard`
- Tasks: `http://localhost:3000/tasks`
- Assets: `http://localhost:3000/assets`
- Credits: `http://localhost:3000/credits`
- Admin: `http://localhost:3000/admin`
- Admin Storage: `http://localhost:3000/admin/storage`
- Admin Quality Review: `http://localhost:3000/admin/quality`
- Admin System: `http://localhost:3000/admin/system`

Demo admin:

```powershell
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=password123 npm run make:admin
```

### New maintenance scripts

```powershell
npm run dev:reset
npm run cleanup:local
npm run export:demo-data
```

- `dev:reset` is blocked in production, clears local DB/uploads/outputs, runs migrate/seed, and recreates `admin@example.com`.
- `cleanup:local` defaults to dry run. Use `CLEANUP_DRY_RUN=false` only in development unless `ALLOW_PRODUCTION_CLEANUP=true` is explicitly set.
- `export:demo-data` writes a safe JSON summary to `tmp/demo-export.json` and redacts base64/secrets.

### Credits and registration policy

```env
REGISTRATION_ENABLED=true
FREE_CREDITS_ON_SIGNUP=100
FAKE_TASK_COST=0
OPENAI_TASK_ESTIMATED_COST_CREDITS=10
GEMINI_TASK_ESTIMATED_COST_CREDITS=8
CLAUDE_TASK_ESTIMATED_COST_CREDITS=8
MIN_CREDITS_TO_CREATE_TASK=1
REFUND_ON_TASK_FAILED=true
```

Fake provider tasks cost `0` credits by default but still require a positive minimum balance to keep staging demos controlled. This is a demo ledger, not a production billing system.

## RC5 Trial Acceptance

Use this pass before giving the public trial to customers:

- Login and change the default admin password.
- Create a task with the fake provider.
- View task outputs and task metadata.
- Download an asset.
- Favorite/archive an asset.
- Create and open an asset share link.
- Review quality status.
- Adjust demo credits with a reason.
- Run Provider Playground with `fake`.
- Run a DevPilot handoff UI test.
- Check audit and usage pages for redacted records.
- Run `npm run rc:local`.
- Run `npm run domain:check` only when explicitly validating the domain.
- Run public fake smoke when the HTTPS domain is expected to be available.

Trial diagnostic:

```powershell
npm run trial:check
```

The command writes `tmp/trial-check.json` with health, admin-system-safe, provider registry, storage, queue mode, default admin password warning, and secret-redaction checks.

## RC6 Live Services + Production Readiness

Admin password hardening:

- Trial/dev may temporarily keep `admin / 1234`, but diagnostics must classify it as Testing only / WARN.
- Production must set a strong `ADMIN_BOOTSTRAP_PASSWORD`; empty, `1234`, `admin`, `password`, `test`, `demo`, and `changeme` are treated as weak.
- `/admin/system` and `npm run trial:check` never show the raw admin password.
- Production release remains No-Go while the admin bootstrap password is missing or weak.

Live provider pings do not create tasks and do not call image generation:

```powershell
$env:AI_PING_PROVIDER="openai"
$env:OPENAI_API_KEY="<key>"
$env:AI_PING_MODEL="gpt-4.1-mini"
npm run ai:ping

$env:AI_PING_PROVIDER="gemini"
$env:GEMINI_API_KEY="<key>"
$env:AI_PING_MODEL="gemini-1.5-flash"
npm run ai:ping

$env:AI_PING_PROVIDER="claude"
$env:ANTHROPIC_API_KEY="<key>"
$env:AI_PING_MODEL="claude-3-5-haiku-latest"
npm run ai:ping
```

If a provider key is missing, `ai:ping` records `missing_api_key` and exits as a safe skip. Reports are written to `tmp/ai-ping-last.json` and are redacted. `/admin/providers` displays the last ping summary.

R2 live storage check:

```powershell
$env:FILESYSTEM_DISK="r2"
$env:R2_ACCOUNT_ID="<account-id>"
$env:R2_BUCKET="<bucket>"
$env:R2_ACCESS_KEY_ID="<access-key-id>"
$env:R2_SECRET_ACCESS_KEY="<secret>"
$env:STORAGE_PUBLIC_URL="https://assets.example.com"
npm run storage:check
```

S3 live storage check uses `FILESYSTEM_DISK=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `STORAGE_PUBLIC_URL`. The check writes, reads, verifies existence, deletes cleanup objects, and validates public URL GET when a public URL is configured.

Production DB and queue plan:

- Public trial: `QUEUE_DRIVER=local` with SQLite/sql.js is acceptable for a small single-process trial.
- Production: use `DATABASE_CLIENT=postgres` or `DATABASE_CLIENT=mysql`, `QUEUE_DRIVER=worker`, and shared server-grade DB state for app plus worker.
- Migration plan: export/backup current SQLite data, prepare schema mapping for users/tasks/images/credits/audit/handoffs/assets, run a dry migration into staging DB, verify smoke and `trial:check`, keep the SQLite backup for rollback, then switch app and worker together.

Public Trial Go/No-Go:

- Public trial: Conditional Go is allowed while `admin / 1234` is intentionally kept for internal testing only.
- Production release: No-Go while `admin / 1234` is active. Change it before external/public release.
- Go: `https://imageai.tw/health` returns 200, public smoke passed, `trial:check` has no critical fail, `env:check` passes, `storage:check` passes, fake fallback works, reports are redacted, rate limits and upload limits are enabled.
- No-Go: `AUTH_BYPASS=true`, exposed API key, production stack trace, domain health failure, storage public URL failure, default admin password in production release, or worker plus SQLite production mode.

## RC8 Trial Operations

Trial mode:

```env
TRIAL_MODE=true
TRIAL_MODE_MESSAGE="目前為測試站，資料與圖片可能會被清理。"
INVITE_CODE_ENABLED=true
TRIAL_INVITE_CODE=
INVITE_CODE_LABEL="Trial invite code"
```

During internal testing, `admin / 1234` may remain temporarily active only when it is clearly marked as Testing only. Change it before external/public release or production launch. The invite code is never returned by bootstrap, admin status, trial reports, or feedback responses.

Trial user flow:

1. Open `https://imageai.tw`
2. Login or register with invite code
3. Create task
4. Upload product image
5. Analyze product
6. Generate banner
7. Download output
8. Save or favorite asset
9. Share asset
10. Submit feedback

Trial admin flow:

1. Check `/admin/system`
2. Check `/admin/trial`
3. Check `/admin/feedback`
4. Check `/admin/tasks`
5. Check `/admin/assets`
6. Check `/admin/usage`
7. Check `/admin/audit`
8. Run `npm run trial:check`
9. Run `npm run trial:cleanup`

Trial cleanup is dry run by default:

```powershell
$env:TRIAL_CLEANUP_DRY_RUN="true"
$env:TRIAL_CLEANUP_OLDER_THAN_DAYS="7"
$env:TRIAL_CLEANUP_INCLUDE_OUTPUTS="false"
npm run trial:cleanup
```

Known trial limitations: `admin / 1234` may remain during internal testing only, `QUEUE_DRIVER=local`, local storage, no R2 live yet, no Gemini/Claude live yet, DevPilot Gateway execution is not implemented, HTTP redirect is not fixed yet, and SQLite/sql.js is not production-grade.

Trial Go: HTTPS works, smoke passes, invite gate enabled or admin-approved users only, feedback works, trial warning is visible, and reports are redacted.

Production No-Go: default admin password active, no server-grade DB, no R2/S3, no provider live validation except OpenAI, or no production monitoring.

## RC9 Production Hardening

Secure admin bootstrap:

```env
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=
ALLOW_DEFAULT_ADMIN_PASSWORD=false
REQUIRE_SECURE_ADMIN_PASSWORD=true
```

Trial/dev can temporarily use `admin / 1234` only as a clearly marked Trial Only account. Production must configure a strong `ADMIN_BOOTSTRAP_PASSWORD`; weak values include empty, `1234`, `admin`, `password`, `test`, `demo`, and `changeme`. Diagnostics and reports only show configured/weak/redacted status and never print the raw password.

HTTPS redirect and proxy trust:

```env
TRUST_PROXY=true
FORCE_HTTPS=true
HTTPS_REDIRECT_STATUS=308
```

When the app runs behind Synology, Nginx, Cloudflare, or another reverse proxy, enable `TRUST_PROXY=true` so Express can honor forwarded HTTPS state. `FORCE_HTTPS=true` redirects HTTP `GET` and `HEAD` requests to `https://host + originalUrl`; non-idempotent HTTP requests return `{ "ok": false, "error": "https_required" }` instead of redirecting.

Production gates:

- Public trial remains Conditional Go while `admin / 1234` is intentionally kept for testing.
- Production release remains No-Go until admin password, R2/S3, Gemini/Claude, server-grade DB/queue, DevPilot Gateway execution contract, and HTTP redirect/proxy behavior are all accepted.
- Reports do not output raw secrets, admin passwords, API keys, or full base64 payloads.

### Rate limit and upload guardrails

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
MAX_UPLOAD_MB=10
ALLOWED_IMAGE_TYPES=image/png,image/jpeg,image/webp,image/bmp
```

### Database production path

SQLite is still the local/demo/staging default. Production should move to Postgres or MySQL before real traffic. `npm run env:check` blocks production SQLite unless `ALLOW_SQLITE_IN_PRODUCTION=true` is set for a controlled demo.

### Docker deployment

PM2 remains the preferred deployment path for this RC, but a Docker skeleton is available:

```powershell
$env:HOST_PORT="3050"
docker build -t ad-studio-ai .
docker compose up --build
docker compose logs -f
docker compose down
```

The compose file starts `app` and `worker`, mounts local storage, reads `.env`, maps `${HOST_PORT:-3000}:3000`, and health-checks `/health`.
For public trial with SQLite/sql.js, use the default app-only compose profile and keep `QUEUE_DRIVER=local`. Enable the worker profile only after moving to Postgres/MySQL:

```powershell
docker compose --profile worker up --build -d
```

## Windows Troubleshooting

If port `3000` is occupied in PowerShell:

```powershell
netstat -ano | findstr :3000
Stop-Process -Id <PID> -Force
```

Then restart:

```powershell
$env:PORT="3000"
npm start
```

### Health checks

- `GET /health`: app status, version, env, uptime.
- `GET /health/deep`: DB/config/provider/storage summary without secrets and without calling true OpenAI or R2/S3 APIs.

### Final local acceptance

```powershell
npm ci
npm run migrate
npm run seed
npm test
npm run build
npm run env:check
npm run storage:check
npm start
```

Then in another terminal:

```powershell
$env:SMOKE_BASE_URL="http://localhost:3000"
$env:SMOKE_EXPECT_PROVIDER="fake"
$env:SMOKE_EXPECT_STORAGE_DISK="local"
npm run smoke:staging
```
