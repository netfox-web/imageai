# RC Smoke Checklist

Use this checklist before RC handoff whenever provider, task, credit, artifact, or safety behavior changes.

## A. 基本啟動

- `npm run migrate`
- `npm run seed`
- `npm test`
- `npm run build`
- `npm run env:check`
- `npm run ai:ping`
- `npm run dev`
- Web: `http://localhost:5173`
- API: `http://localhost:3000/api/session`

## B. 智慧去背 cutout

- OpenAI 正常商品圖：應 `success`，輸出 PNG，有透明 alpha。
- OpenAI safety / moderation rejected：應 `failed + refund`，不 fallback fake。
- OpenAI 回 opaque PNG：應 `provider_output_invalid + failed + refund`。
- 任務詳情應顯示友善中文錯誤。
- 素材庫不應出現 fake 成功圖。

## C. image_to_video

- 明確 fake provider：dev/test placeholder 可 `success`。
- `openai/gpt-image-1`：應 `provider_capability_unsupported + failed + refund`。
- `external/devpilot-gateway` 未設定 live：應清楚顯示未設定或不可用。
- 不應有 fake success placeholder 誤導使用者。

## D. sensitive media

- `voice_clone` / `lip_sync` / `face_swap` / `avatar_video` 無 consent：應 blocked。
- 有 consent：artifact private-by-default。
- audit log 有記錄。
- Provider Matrix 顯示 `consent_required=true`、`private_by_default=true`。

## E. credit ledger

- success 任務扣點。
- failed 任務退點。
- 同一 failed 任務不重複退點。
- 任務詳情與點數明細一致。

## F. task_artifacts / asset library

- `post_generator` 文字結果進 task detail。
- video/audio/external result 進 task detail。
- artifact 可在素材庫看到。
- private artifact 不公開外洩。

## G. Provider Matrix

- `/admin/providers` 顯示「工具與供應商支援狀態」。
- OpenAI/Gemini/Claude 不宣告 `image_to_video`。
- Fake 顯示 `fake_only/live=false`。
- External/DevPilot Gateway 顯示 live/config dependent。
- sensitive media 標記正確。

## H. Brand DNA

- voice/audience/keywords/forbidden terms/pillars/sample posts 可保存。
- `post_generator` 可讀取 Brand DNA。
- forbidden terms 不應出現在生成貼文中，或至少有提示/檢查。

## I. External image_to_video local smoke

手動成功流程：

- Terminal A:
  - `$env:MOCK_EXTERNAL_MODE="success"`
  - `npm run mock:external`
- Terminal B:
  - `$env:EXTERNAL_AI_BASE_URL="http://localhost:3099"`
  - `npm run smoke:external-video`

Artifacts 回傳格式流程：

- Terminal A:
  - `$env:MOCK_EXTERNAL_MODE="artifacts"`
  - `npm run mock:external`
- Terminal B:
  - `$env:EXTERNAL_AI_BASE_URL="http://localhost:3099"`
  - `npm run smoke:external-video`

失敗流程：

- Terminal A 使用 `MOCK_EXTERNAL_MODE=fail` / `missing_video` / `server_error`
- Terminal B 重跑 `npm run smoke:external-video`
- Smoke 應看到 `failed + refund + no fake artifact`
- External 失敗後不得 fallback fake success

## J. Provider / Task Guardrail Regression Checks

- 任務 `failed` 時，不應有 fake success artifact。
- OpenAI 不支援 `image_to_video`，除非未來 registry 明確加入真實 live capability。
- Fake provider placeholder 只允許 explicit fake/dev workflow。
- External `missing_video` 應 `external_provider_failed + failed + refund`。
- Cutout opaque output 應 `provider_output_invalid + failed + refund`。
- Provider guardrail 工程文件：`docs/PROVIDER_TASK_GUARDRAILS.md`。

## K. Regression guard

- 前台不顯示 technical capability 下拉。
- 後台 Provider Playground 保留 technical capability。
- 失敗任務不應產 fake success artifact。
- console errors = 0。
