# AGENTS.md

## Project Context

This repository is part of the 仿耀鏡 + adai.tw project.

The product direction is an AI content SaaS platform inspired by AutoIP-style workflows, including:

- AI studio dashboard
- Credit-based usage system
- AI generation job queue
- Generated works/media management
- Brand DNA profile
- Text-to-image
- Image mixing/compositing
- Image-to-video
- Post/content generator
- Subscription and credits
- Support/contact flows

## Primary Goals

When working in this repository, prioritize:

1. Building reusable SaaS architecture.
2. Keeping AI tools modular.
3. Avoiding one-off hardcoded flows.
4. Making future image/video/voice tools share the same job system.
5. Keeping user credits, media assets, and job status auditable.

## Suggested Architecture

Use these core concepts where applicable:

- `users`
- `brand_profiles`
- `ai_jobs`
- `media_assets`
- `credit_ledger`
- `subscriptions`
- `support_tickets`

AI tools should create jobs instead of blocking the request synchronously.

Recommended job states:

- `queued`
- `running`
- `completed`
- `failed`
- `refunded`

## AI Tool Types

Use stable internal tool identifiers:

- `text_to_image`
- `image_to_image`
- `image_mix`
- `image_to_video`
- `post_generator`
- `brand_dna`
- `voice_clone`
- `lip_sync`
- `avatar_video`

## Coding Rules

- Do not introduce unrelated dependencies.
- Do not rewrite large sections unless necessary.
- Prefer small, reviewable commits.
- Preserve existing public APIs unless explicitly asked to change them.
- Add comments only where behavior is non-obvious.
- Use clear naming for database columns, API routes, and job types.
- Never store secrets in source code.
- Use environment variables for API keys and provider credentials.

## Testing / Verification

Before proposing completion:

- Run available lint/typecheck/test commands if they exist.
- If no test command exists, inspect `package.json`, framework config, or README and report what was checked.
- For UI changes, make sure the route/component can render without obvious runtime errors.
- For backend changes, verify API input validation and error states.

## Provider / Task Guardrails

These rules are release blockers. Do not weaken them when changing providers, task jobs, artifacts, or credits.

### No Fake Success Rule

- Provider failure must not be converted into a successful fake artifact.
- Fake provider placeholders are allowed only when the task explicitly resolves to fake provider in dev/test mode.
- If the user requested/resolved provider is `openai`, `gemini`, `claude`, `external`, or `devpilot-gateway` and the provider fails or lacks capability, the task must fail/refund instead of creating fake success artifacts.

### Cutout / 智慧去背

- OpenAI cutout uses image edit with transparent PNG output.
- Safety, moderation, or content policy rejection must be `failed + refund`, not fallback fake.
- Output must be validated as PNG with alpha transparency.
- Opaque or non-transparent output must be `provider_output_invalid + failed + refund`.
- No fake output image should be stored for failed cutout.

### image_to_video

- OpenAI, Gemini, and Claude must not be treated as `image_to_video` providers unless the registry explicitly adds a real live capability in the future.
- Unsupported providers must result in `provider_capability_unsupported + failed + refund`.
- External provider `ok:false`, missing video, or server error must result in `external_provider_failed + failed + refund`.
- Fake video placeholder is allowed only for explicit fake provider/dev-test workflow.
- Live external success must create a video artifact with `provider/source=external` and private/default visibility.

### Sensitive Media

- `voice_clone`, `lip_sync`, `face_swap`, and `avatar_video` require consent validation.
- Artifacts are private-by-default.
- Audit log must be written.
- Provider Matrix must mark `consent_required=true` and `private_by_default=true`.

### Credit Ledger

- Success tasks consume credits.
- Failed tasks refund once.
- Failed task retry/duplicate must not double-refund.
- Any new provider failure path must be covered by credit ledger tests.

### Provider Matrix

- Any new provider/capability must update `AIProviderRegistry` and `ProviderCapabilityMatrix` together.
- Consumer frontend should choose tools, not technical capabilities.
- Admin Provider Playground may expose technical capabilities.
- `npm run rc:smoke` must remain green.

### Required Checks Before Claiming Done

- `npm test`
- `npm run build`
- `npm run rc:smoke`
- For external video changes: `npm run mock:external` + `npm run smoke:external-video`
- For provider/cutout changes: verify failed tasks do not create fake success artifacts.

## Product Priorities

When deciding implementation order, prefer:

1. Dashboard
2. Credit system
3. AI jobs queue
4. Works/media library
5. Brand DNA
6. Post generator
7. Image mix
8. Image-to-video
9. Subscription/credits page
10. Support/contact page

## Safety / Legal Notes

For features involving face swap, voice clone, lip sync, avatar video, or identity-like generation:

- Require user confirmation/consent flows.
- Avoid implementing flows that impersonate real people without consent.
- Add clear audit metadata where practical.
- Prefer private-by-default storage for sensitive generated media.

## PR Guidelines

When opening a PR:

- Explain what changed.
- Mention affected routes, tables, or APIs.
- Include test/lint result.
- Include migration notes if schema changed.
- Keep the PR focused on one feature or fix.
