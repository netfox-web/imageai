# Provider / Task Guardrails

## Purpose

This project uses task/job execution, provider selection, task artifacts, and a credit ledger to keep AI generation auditable. Provider failures must stay visible as failed tasks with refunds. A failed live provider must never be hidden by a fake success artifact.

Use this document when changing provider registry entries, task execution, media artifact writing, failure policy, credit refunds, or frontend error display.

## Core Rules

### No Fake Success

- The no fake success rule is mandatory for every live provider path.
- Provider failure must not be converted into a successful fake artifact.
- Fake provider placeholders are allowed only when the task explicitly resolves to fake provider in dev/test mode.
- If the requested/resolved provider is `openai`, `gemini`, `claude`, `external`, or `devpilot-gateway` and the provider fails or lacks capability, the task must fail/refund instead of creating fake success artifacts.

### Cutout / 智慧去背

- OpenAI cutout uses image edit with transparent PNG output.
- Safety, moderation, or content policy rejection must be `failed + refund`, not fallback fake.
- Output must be validated as PNG with alpha transparency.
- Opaque or non-transparent output must be `provider_output_invalid + failed + refund`.
- No fake output image should be stored for failed cutout.

### image_to_video

- OpenAI, Gemini, and Claude must not be treated as `image_to_video` providers unless `AIProviderRegistry` explicitly adds a real live capability in the future.
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

## Guardrail Table

| Scenario | Expected status | Error code | Refund? | Fake artifact allowed? | Required tests |
| --- | --- | --- | --- | --- | --- |
| OpenAI cutout safety rejected | `failed` | `provider_rejected` or provider safety code | Yes | No | Safety/moderation rejection fails, refunds, no fake output |
| OpenAI cutout opaque PNG | `failed` | `provider_output_invalid` | Yes | No | Transparent PNG validator rejects opaque output, no fake output |
| `image_to_video` unsupported provider | `failed` | `provider_capability_unsupported` | Yes | No | OpenAI/Gemini/Claude unsupported provider path fails/refunds |
| External `image_to_video` missing video | `failed` | `external_provider_failed` | Yes | No | `ok:false`, missing video, and server error fail/refund |
| External `image_to_video` success | `success` | None | No | No | Video artifact exists, `provider/source=external`, private visibility |
| Fake `image_to_video` dev placeholder | `success` | None | No | Yes, explicit fake only | Requested/resolved provider is explicit `fake` |
| Sensitive media missing consent | Blocked before task success | Validation/consent error | No task charge should be finalized | No | Consent validation blocks `voice_clone`, `lip_sync`, `face_swap`, `avatar_video` |
| Sensitive media success | `success` | None | No | No fake sensitive artifact unless explicit fake dev/test | Consent is recorded, artifact private, audit log written |

## Required Checks Before Claiming Done

- `npm test`
- `npm run build`
- `npm run rc:smoke`
- For external video changes: `npm run mock:external` + `npm run smoke:external-video`
- For provider/cutout changes: verify failed tasks do not create fake success artifacts.
