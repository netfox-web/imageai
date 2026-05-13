# External Project Admin Integration Instructions

This document is a safe placeholder guide for connecting an external project to DevPilot through the External Handoff API.

Do not paste provider secrets into this document. Do not use OpenAI, Gemini, Claude, R2, S3, or other provider keys as DevPilot External API keys.

## Purpose

External systems can submit manual handoff records to DevPilot for admin review. These calls create or read handoff records only. They must not execute workers, call AI providers, deploy infrastructure, or mutate project/task phase state.

## Required Environment Variables

Configure these on the external project's server runtime only:

```env
DEVPILOT_API_BASE_URL=https://your-devpilot-domain.example
DEVPILOT_SOURCE_SYSTEM=your-source-system
DEVPILOT_API_KEY=replace-with-devpilot-external-api-key
```

Optional sample project metadata:

```env
EXTERNAL_PROJECT_ID=ai-commerce-ad-generator
PROJECT_NAME=AI 電商廣告素材生成平台
APP_URL=https://your-project-domain.example
PRIMARY_DOMAIN=your-project-domain.example
```

## Required Headers

```http
X-DevPilot-Source-System: your-source-system
X-DevPilot-Api-Key: replace-with-devpilot-external-api-key
X-DevPilot-Request-Id: stable-request-id
X-DevPilot-Idempotency-Key: stable-idempotency-key
```

Never log `X-DevPilot-Api-Key`.

## Create Manual Handoff

```http
POST /api/external/tasks/{task_id}/handoffs
Content-Type: application/json
```

```json
{
  "from_agent": "your-source-system",
  "to_agent": "devpilot-reviewer",
  "reason": "Manual review needed before continuing.",
  "next_step": "Review the external ticket and decide the handoff outcome.",
  "risk_level": "medium",
  "external_ref": "external-ticket-123",
  "actor_type": "system",
  "actor_id": "your-source-system"
}
```

Expected behavior:

- New handoff returns `201`.
- Idempotent replay returns `200`.
- `execution_allowed` remains `false`.
- Task/project workflow state is not changed.

## Read Handoffs

```http
GET /api/external/ai-handoffs
GET /api/external/handoffs/{handoff_id}
```

By default, a source can only read handoffs created by the same authenticated source.

## JavaScript Example

```js
import crypto from "node:crypto";

const baseUrl = process.env.DEVPILOT_API_BASE_URL.replace(/\/+$/, "");
const sourceSystem = process.env.DEVPILOT_SOURCE_SYSTEM;
const apiKey = process.env.DEVPILOT_API_KEY;

export async function createDevPilotHandoff(taskId, externalRef) {
  const response = await fetch(`${baseUrl}/api/external/tasks/${encodeURIComponent(taskId)}/handoffs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DevPilot-Source-System": sourceSystem,
      "X-DevPilot-Api-Key": apiKey,
      "X-DevPilot-Request-Id": crypto.randomUUID(),
      "X-DevPilot-Idempotency-Key": `${sourceSystem}:${taskId}:${externalRef}:handoff`
    },
    body: JSON.stringify({
      from_agent: sourceSystem,
      to_agent: "devpilot-reviewer",
      reason: "Manual review needed before continuing.",
      next_step: "Review the external ticket and decide the handoff outcome.",
      risk_level: "medium",
      external_ref: externalRef,
      actor_type: "system",
      actor_id: sourceSystem
    })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `DevPilot request failed with ${response.status}`);
  return payload;
}
```

## Safety Checklist

- Use a DevPilot External API key, not provider API keys.
- Keep all keys server-side.
- Do not print request headers, raw API keys, provider secrets, or base64 payloads.
- Use idempotency keys for retryable create calls.
- Start with a staging DevPilot endpoint before production.
- Confirm DevPilot admin can see the created handoff or project record.
