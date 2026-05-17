# AGENTS.md

## Project Context

This repository is the current implementation target for the 仿耀鏡 + adai.tw plan.

The existing app is an AI Commerce Ad Studio MVP built with React, Vite, Express, SQLite/sql.js, AI provider adapters, local/R2/S3-compatible storage, queued tasks, generated assets, credits, admin diagnostics, and staging checks.

Do **not** restart the project from scratch. Extend the current architecture and preserve existing routes, provider registry, task queue, assets, credits, admin, and storage behavior unless the task explicitly says otherwise.

## Product Direction

Evolve this repo from an ecommerce ad creative MVP into an AI content SaaS platform inspired by the AutoIP-style workflow analysis.

Core product modules:

- Dashboard / AI studio home
- Credit-based usage system
- AI job/task queue
- Generated works and media asset library
- Brand DNA profile
- Post/content generator
- Text-to-image
- Image-to-image
- Image mixing/compositing
- Image-to-video
- Voice / avatar / lip-sync features later
- Subscription and credit packages
- Support/contact flow
- Admin diagnostics and provider management

## Current Architecture to Preserve

The README indicates the app already has these important pieces:

- Frontend routes: `/`, `/dashboard`, `/tasks`, `/assets`, `/credits`, `/admin`
- Express server entry: `server/index.js`
- Worker entry: `server/worker.js`
- SQLite migrations and seed scripts
- Provider registry for `fake`, `openai`, `gemini`, `claude`, `external`, and `devpilot-gateway`
- Local/R2/S3-style storage configuration
- Task recovery, environment checks, staging smoke checks, provider diagnostics, and domain checks

Prefer adapting these systems instead of introducing parallel abstractions.

## Implementation Priorities

When asked to continue the current plan, implement in this order unless the issue/task says otherwise:

1. Dashboard improvements for AI studio navigation
2. Credits and credit ledger hardening
3. Unified AI task/job model
4. Generated works/media asset library
5. Brand DNA profile
6. Post/content generator
7. Image mixing/compositing
8. Text-to-image and image-to-image refinements
9. Image-to-video scaffolding
10. Subscription/package page
11. Support/contact page
12. Admin tools and provider health diagnostics
13. Voice, avatar, lip-sync, and face/identity-like features only after consent and audit flows exist

## Data Model Guidance

Prefer the existing database/migration style. When new tables or fields are needed, use clear names and keep them auditable.

Recommended durable concepts:

- `users`
- `brand_profiles`
- `tasks` or `ai_jobs`
- `assets` or `media_assets`
- `credit_ledger`
- `credit_packages`
- `subscriptions`
- `support_tickets`
- `provider_runs` or provider metadata where useful

Recommended AI task states:

- `queued`
- `processing` or `running`
- `completed`
- `failed`
- `refunded`
- `cancelled` if cancellation is implemented

Every credit-consuming AI action should be traceable to a task/job and a credit ledger entry.

## AI Tool Identifiers

Use stable internal identifiers for tools and avoid user-facing labels as database enums.

Suggested identifiers:

- `post_generator`
- `brand_dna`
- `text_to_image`
- `image_to_image`
- `image_mix`
- `image_to_video`
- `voice_clone`
- `lip_sync`
- `avatar_video`
- `face_swap`

Early-stage high-cost or high-risk tools should be hidden behind feature flags, admin settings, or explicit availability checks.

## Credit Rules

AI generation should generally follow this pattern:

1. Validate input.
2. Estimate or determine credit cost.
3. Verify the user has enough credits.
4. Create task/job record.
5. Create pending/debit ledger entry or atomic debit.
6. Process through local queue or worker.
7. Store result assets.
8. Mark task completed.
9. Refund or compensate credits on eligible failures.

Never make a provider call that can incur cost without a clear task record and credit behavior.

## Provider Rules

Use the existing provider registry and environment configuration where possible.

- Keep `fake` provider useful for demos, tests, and local development.
- Do not expose raw API keys in API responses, logs, UI, or test snapshots.
- Respect `AI_STRICT_PROVIDER` behavior.
- Keep OpenAI, Gemini, Claude, external, and devpilot-gateway adapters modular.
- For new providers, add diagnostics and safe metadata similar to existing provider registry behavior.

## UI Rules

The UI should feel like an AI studio, not only an ad generator.

Prioritize:

- Clear tool cards
- Credit cost visibility before submission
- Task status visibility after submission
- Asset previews and reusable generated works
- Brand DNA context reuse across tools
- Admin-only diagnostics clearly separated from user features

Avoid:

- Dead buttons
- Hidden destructive actions
- One-off screens that bypass task/assets/credits patterns
- Provider-specific UI leaking implementation details to normal users

## Safety and Consent

For face swap, voice clone, lip sync, avatar video, identity-like generation, or user-uploaded portraits:

- Add consent language before generation.
- Store audit metadata where practical.
- Prefer private-by-default output visibility.
- Do not implement impersonation-oriented flows without explicit consent checks.
- Avoid making these tools available before abuse controls, support handling, and admin review paths are in place.

## Coding Rules

- Use the existing framework and module style.
- Keep changes focused and reviewable.
- Do not introduce unrelated dependencies.
- Do not rewrite large parts of the app unless the task explicitly requires it.
- Preserve existing public APIs unless the task requires a migration.
- Use environment variables for all secrets and provider credentials.
- Add comments only for non-obvious behavior.
- Prefer shared utilities/components over duplicated logic.
- Keep fake/local modes working.

## Verification Commands

Use the scripts in `package.json` when relevant:

```bash
npm ci
npm run migrate
npm run seed
npm test
npm run build
npm run env:check
npm run storage:check
npm run ai:ping
npm run worker
npm run smoke:staging
npm run rc:local
```

For most code changes, at minimum run or explain why you could not run:

```bash
npm test
npm run build
```

For database or queue changes, also consider:

```bash
npm run migrate
npm run seed
npm run tasks:recover
```

For provider/config changes, also consider:

```bash
npm run env:check
npm run ai:ping
```

## PR Guidelines

When preparing a PR or final implementation summary, include:

- What changed
- Affected routes/components/APIs/tables
- Credit/task/provider behavior changes
- Migration or environment notes
- Test/build/check results
- Known limitations or follow-up tasks

Keep PRs focused on one feature or one coherent slice of the plan.
