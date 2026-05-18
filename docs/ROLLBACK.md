# Rollback

Use this guide when RC9 needs to be reverted locally, on staging, or on a public-trial host.

## Local Rollback

1. Inspect the current worktree:

```powershell
git status
git log --oneline -10
```

2. Choose the rollback path:

- Use `git revert <release-commit>` when the release commit was already shared.
- Use `git checkout <previous-tag-or-commit>` only for local/manual rollback where detached HEAD is acceptable.
- Avoid destructive reset commands unless the operator explicitly approves them and backups exist.

## Database Restore

1. Stop the app and worker processes.
2. Back up the current `server/storage/database.sqlite`.
3. Restore the previous `database.sqlite` backup.
4. Do not manually delete migration data unless a tested migration rollback exists.

## Storage Restore

1. Back up current `server/storage/uploads`.
2. Back up current `server/storage/outputs`.
3. Restore the matching uploads/outputs snapshot from the same release point as the database.
4. For R2/S3, restore from bucket versioning or a known-good backup.

## Dev Server Restart

```powershell
npm run migrate
npm run seed
npm run dev
```

For API-only verification:

```powershell
npm run env:check
npm run rc:smoke
npm run build
```

## Verification After Rollback

- Open Web: `http://localhost:5173`
- Open API: `http://localhost:3000/api/session`
- Confirm login/admin access.
- Confirm Provider Matrix loads.
- Create or inspect a safe test task.
- Confirm failed tasks do not create fake success artifacts.
- Confirm credit ledger did not double-refund failed tasks.
- Confirm console errors = 0.

