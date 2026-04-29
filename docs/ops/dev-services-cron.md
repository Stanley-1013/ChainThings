# Dev Services Worker — Cron Setup

## Why a periodic cron trigger is needed

The dev-services integration layer uses a fire-and-forget webhook intake model: incoming webhooks from GitHub, GitLab, and Jira are written to `chainthings_webhook_events` and acknowledged immediately so the upstream service is never blocked. A DB-driven background worker then processes those events asynchronously.

However, the worker is not always triggered in time:

- **Server restarts** — events queued just before a deploy or container restart won't have an in-process trigger.
- **Fire-and-forget network failures** — if the post-webhook trigger call fails silently, events sit in `received` state indefinitely.
- **Retry schedules** — events with a `next_retry_at` in the future need the worker to wake up and pick them up at the right time.

A periodic cron that POSTs to `/api/dev-services/worker` ensures the queue is always drained within a bounded window, regardless of how an event arrived.

## Recommended: once per minute

POST to `/api/dev-services/worker` every minute. The endpoint is idempotent — if the queue is empty it returns `{"processed":0}` immediately with minimal overhead.

```
POST /api/dev-services/worker
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json
{}
```

## Example: macOS crontab

```
* * * * * curl -s -X POST https://YOUR_APP/api/dev-services/worker -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{}' > /dev/null 2>&1
```

Add via `crontab -e`. Replace `YOUR_APP` with your app's public URL (e.g. the ngrok tunnel URL in `.env.local` as `NEXT_PUBLIC_APP_URL`).

## Alternatives

| Platform | Suggestion |
|----------|-----------|
| **Vercel Cron** | Add a `vercel.json` cron entry: `{ "crons": [{ "path": "/api/dev-services/worker", "schedule": "* * * * *" }] }`. Vercel automatically forwards `Authorization: Bearer <CRON_SECRET>` if you set the env var. |
| **GitHub Actions** | Use a scheduled workflow with `schedule: [cron: '* * * * *']` and a `curl` step using `${{ secrets.CRON_SECRET }}`. |
| **Supabase pg_cron** | `SELECT cron.schedule('dev-worker', '* * * * *', $$SELECT net.http_post(url := 'https://YOUR_APP/api/dev-services/worker', headers := '{"Authorization":"Bearer <CRON_SECRET>","Content-Type":"application/json"}', body := '{}')$$);` — requires the `pg_net` extension. |

## Security note

`CRON_SECRET` must never appear in application logs or be committed to source control. Ensure your cron runner stores it as a secret (GitHub Actions secret, Vercel environment variable, macOS Keychain, etc.) rather than inline in scripts or crontab files.
