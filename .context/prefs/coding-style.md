# Coding Style Guide

> 此文件定义团队编码规范，所有 LLM 工具在修改代码时必须遵守。
> 提交到 Git，团队共享。

## General
- Prefer small, reviewable changes; avoid unrelated refactors.
- Keep functions short (<50 lines); avoid deep nesting (≤3 levels).
- Name things explicitly; no single-letter variables except loop counters.
- Handle errors explicitly; never swallow errors silently.

## Language-Specific

### TypeScript (Next.js 16 / React 19)
- Strict mode is enabled — no `any` without a comment justifying it.
- Prefer `interface` for object shapes that may be extended; `type` for unions/aliases.
- Path alias: `@/*` → `./src/*`. Use it instead of long relative paths.
- Server components by default; opt into `"use client"` only when needed (state, effects, browser APIs).
- Tailwind utility classes inline; avoid creating wrapper component just to bundle classes.

### Supabase / Database
- Always use `tenant_id` filtering in queries — RLS is the safety net, not the primary guard.
- Service-role client (`@/lib/supabase/admin`) is for trusted server paths only; never expose to client.
- Migrations are append-only and numbered (`NNN_name.sql`); never edit a merged migration — write a new one.

## Git Commits
- Conventional Commits, imperative mood, English subject line.
- Atomic commits: one logical change per commit.
- Body explains *why*, not *what* (the diff already shows what).

## Testing
- Every feat/fix MUST include corresponding tests.
- Coverage must not decrease.
- Fix flow: write failing test FIRST, then fix code.
- Mock factories live in `src/__tests__/mocks/`; extend the chainable mock rather than ad-hoc rewrites.

## Security
- Never log secrets (tokens/keys/cookies/JWT).
- Validate inputs at trust boundaries (API routes, webhook handlers).
- Webhook handlers must verify HMAC + timestamp before any DB write.
- AI-generated workflows must pass the n8n node-type whitelist before push.
