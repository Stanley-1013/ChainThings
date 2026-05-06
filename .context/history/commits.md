# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-05-06 | migration-policy-exception | — | Migration append-only policy exception: `0119_rag_search_tuning.sql` renamed from `012_rag_search_tuning.sql` to avoid CLI numeric-prefix collision with `012_notification_enhancements.sql`; `005_storage.sql` reverted to plain INSERT, idempotent seed moved to new `026_storage_bucket_idempotent.sql`. | Rename is a one-time CLI-compatibility exception; rule remains append-only for all future migrations. | CLI would reject duplicate "012" prefix as duplicate primary key in schema_migrations. | Low — lexical sort preserved; apply order unchanged. See docs/ops/integration-tests.md. |
