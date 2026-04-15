-- 020: Add task-specific fields to memory_entries for batch operations
-- assignee: free-text for now, will become FK to team_members later
-- task_status: workflow state for tasks

alter table public.chainthings_memory_entries
  add column if not exists assignee text,
  add column if not exists task_status text default 'todo'
    check (task_status in ('todo', 'in_progress', 'done'));

create index if not exists idx_ct_memory_assignee
  on public.chainthings_memory_entries(tenant_id, assignee)
  where category = 'task';

create index if not exists idx_ct_memory_task_status
  on public.chainthings_memory_entries(tenant_id, task_status)
  where category = 'task';
