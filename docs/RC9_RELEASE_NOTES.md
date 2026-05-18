# RC9 Release Notes

## Scope

RC9 packages the current React + Express + SQLite release candidate for local/public-trial handoff.

- React + Express + SQLite architecture
- `/studio/tasks` multi-tool task pipeline
- Queue/job execution and credit ledger
- `task_artifacts` for text, video, audio, and external results
- Brand DNA profile and post generation support
- Provider Registry / Provider Matrix
- No fake success guardrails
- OpenAI cutout image edit with transparent PNG validation
- `image_to_video` external provider interface
- External mock provider and external video smoke command
- Sensitive media consent, audit log, and private-by-default artifacts
- `npm run rc:smoke` and RC smoke checklist

## Key User Flows

- 智慧去背: OpenAI image edit, safety rejection handling, transparent PNG validation, failed + refund on invalid output.
- 圖生影片: explicit fake dev placeholder, live external provider success, unsupported provider failed + refund.
- 社群貼文 / `post_generator`: Brand DNA-aware text artifacts in task detail and asset surfaces.
- 敏感媒體任務: `voice_clone`, `lip_sync`, `face_swap`, and `avatar_video` require consent and audit metadata.
- 素材庫: generated images and task artifacts can be inspected without exposing private sensitive media.
- 點數明細: successful tasks consume credits; failed tasks refund once.
- Provider Admin: provider registry, capability matrix, and admin playground stay separate from consumer tool choice.

## Guardrails

See `docs/PROVIDER_TASK_GUARDRAILS.md` for the full engineering contract.

- No fake success: provider failures must not become fake success artifacts.
- Failed + refund: provider safety, capability, or output failures must fail the task and refund credits once.
- `provider_output_invalid`: opaque/non-transparent cutout outputs are rejected.
- `provider_capability_unsupported`: unsupported `image_to_video` providers are rejected.
- `external_provider_failed`: external video provider missing/invalid/error responses are rejected.
- `consent_required`: sensitive media tools require consent, private artifacts, and audit logs.

## Verification

Run before claiming RC9 readiness:

- `npm run migrate`
- `npm run seed`
- `npm test`
- `npm run build`
- `npm run env:check`
- `npm run rc:smoke`
- Optional: `npm run mock:external` + `npm run smoke:external-video`
- Browser manual check: Web `http://localhost:5173`, API `http://localhost:3000/api/session`, console errors = 0

## Known Limitations

- Live `image_to_video` requires `EXTERNAL_AI_BASE_URL` and, when needed, `EXTERNAL_AI_API_KEY`.
- Fake provider is for dev/test only.
- OpenAI safety rejection is determined by provider policy and may change.
- SQLite/local queue is not suitable for production scale.
- Sensitive media live execution requires configured external or DevPilot Gateway provider support.

## Rollback

- Revert the release commit with `git revert` or return to the previous tag.
- Do not manually delete migration data without a `database.sqlite` backup.
- Back up local storage, uploads, and outputs before deployment changes.
- Confirm `.env` before production or public-trial restart.
- After rollback, rerun `npm run env:check`, `npm run rc:smoke`, and a browser smoke pass.

