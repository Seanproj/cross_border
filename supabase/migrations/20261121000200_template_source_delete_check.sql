-- Review fix (2026-11-21): deleting a template's source citation was not re-checked,
-- so a needs_review/verified template could end up with no existence source.
-- Re-run the integrity check (at commit) for DELETE on template_sources as well.

create or replace function public.check_template_integrity()
returns trigger language plpgsql as $$
declare
  t public.task_templates;
  tid uuid;
  rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name = 'task_templates' then
    tid := (rec ->> 'id')::uuid;
  else
    tid := (rec ->> 'template_id')::uuid;
  end if;
  select * into t from public.task_templates where id = tid;
  if not found then
    return null; -- template itself was deleted (cascade)
  end if;

  if t.verification_status in ('needs_review', 'verified') and not exists (
    select 1 from public.template_sources ts
     where ts.template_id = t.id and 'existence' = any (ts.supports)) then
    raise exception 'template % (%) requires an existence source', t.template_key, t.verification_status
      using errcode = 'check_violation';
  end if;

  if t.verification_status = 'verified' and exists (
    select 1 from public.template_sources ts
      join public.source_documents sd on sd.id = ts.source_document_id
     where ts.template_id = t.id and sd.checked_by <> 'human') then
    raise exception 'verified template % uses a source not reviewed by a human', t.template_key
      using errcode = 'check_violation';
  end if;

  if t.deadline_rule is not null and not exists (
    select 1 from public.template_sources ts
      join public.source_documents sd on sd.id = ts.source_document_id
     where ts.template_id = t.id
       and sd.source_key = t.deadline_rule ->> 'source_key'
       and 'deadline' = any (ts.supports)) then
    raise exception 'deadline_rule of % is not backed by a deadline source', t.template_key
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger template_sources_integrity_on_delete
  after delete on public.template_sources
  deferrable initially deferred
  for each row execute function public.check_template_integrity();
