-- ChainThings: idempotent storage bucket seed
--
-- 005_storage.sql performs a plain INSERT which fails if the bucket already
-- exists (e.g. CLI test stack re-applying migrations). This migration re-runs
-- the same seed with ON CONFLICT (id) DO NOTHING so it is safe to apply on
-- any instance — fresh prod deploys create the bucket here; existing prod
-- instances (where 005 already ran) see this as a no-op.

insert into storage.buckets (id, name, public, file_size_limit)
values ('chainthings-uploads', 'chainthings-uploads', false, 524288000)
on conflict (id) do nothing;
