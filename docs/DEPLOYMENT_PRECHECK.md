# Deployment Precheck

Use this checklist before deploying RC9 to a public trial, staging host, or production-like environment.

## Environment Checklist

- `APP_URL`: public app URL, including protocol.
- `PORT`: API/server port.
- `DATABASE` / `DATABASE_URL` / `DB_DATABASE`: database target.
- `DATABASE_CLIENT`: `sqlite` for local/public trial, Postgres/MySQL before production scale.
- `AI_PROVIDER`: selected provider; avoid `fake` outside dev/test unless explicitly approved for a demo.
- `OPENAI_API_KEY`: required for OpenAI live image generation/editing.
- `EXTERNAL_AI_BASE_URL`: required for live external `image_to_video`.
- `EXTERNAL_AI_API_KEY`: set when the external provider requires authentication.
- `FILESYSTEM_DISK`: `local`, `r2`, or `s3`.
- `QUEUE_DRIVER`: `local` for single-process trial; `worker` only with a production-grade database.
- `SESSION_SECRET`: long random value; never use the dev default in production.

## Admin And Security Checks

- Confirm default admin password is disabled or changed before public release.
- Check `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD`.
- Confirm `AUTH_BYPASS=false`.
- Confirm `DEBUG=false` for public/production runtime.
- Confirm HTTPS termination and proxy trust settings.
- If behind reverse proxy, review `TRUST_PROXY` and `FORCE_HTTPS`.

## Storage Checks

- For local storage, back up `server/storage/uploads` and `server/storage/outputs`.
- For R2/S3, confirm bucket credentials and public/private URL behavior.
- Confirm `STORAGE_PUBLIC_URL` when generated images must be publicly reachable.
- Confirm private sensitive media artifacts are not exposed via public share links.

## Backup Checks

- Back up `server/storage/database.sqlite`.
- Back up uploads and outputs.
- Save a copy of the active `.env`.
- Record the git commit or tag deployed.

## Commands

Run these before deploy:

```powershell
npm run env:check
npm run rc:smoke
npm test
npm run build
```

Optional external video smoke:

```powershell
$env:MOCK_EXTERNAL_MODE="success"
npm run mock:external

$env:EXTERNAL_AI_BASE_URL="http://localhost:3099"
npm run smoke:external-video
```

