-- Cross-border Life OS — core schema (Week 2)
-- ERD: docs/PHASE0_ANALYSIS.md §3, 데이터 규칙: docs/DATA_SPEC.md
-- 원칙: 사용자 데이터는 RLS로 본인만, 참조 데이터(템플릿·출처)는 읽기 전용, 평가 결과는 공개 읽기.

create extension if not exists vector with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- 공통: updated_at 자동 갱신
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 사용자 프로필 (FR-01). 민감 식별정보 컬럼 없음.
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  origin_country text not null default 'KR' check (origin_country = 'KR'),
  destination_country text not null default 'DE' check (destination_country = 'DE'),
  move_purpose text not null check (move_purpose in
    ('employment', 'job_seeking', 'study', 'family_reunion', 'self_employed', 'other')),
  target_move_date date,
  arrival_date date,
  move_in_date date,
  household_type text check (household_type in ('single', 'couple', 'family_with_children')),
  housing_status text check (housing_status in ('none', 'temporary', 'permanent')),
  state_code text check (state_code ~ '^DE-[A-Z]{2}$'),
  city text not null check (char_length(btrim(city)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 공식 출처 (data/sources/*.yaml 에서 시드)
-- ─────────────────────────────────────────────────────────────
create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (source_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  title text not null,
  authority text not null,
  url text not null unique check (url ~ '^https://'),
  language text not null check (language in ('de', 'en', 'ko')),
  country_code text not null check (country_code in ('DE', 'KR')),
  region_scope text not null check (region_scope ~ '^(federal|national_kr|state:DE-[A-Z]{2}|city:[a-z_]+)$'),
  trust_level text not null check (trust_level in ('official', 'secondary')),
  published_or_updated_at date,
  checked_at date not null,
  checked_by text not null check (checked_by in ('ai_fetch', 'human')),
  content_hash text check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  ingestion_status text not null default 'pending'
    check (ingestion_status in ('pending', 'ingested', 'failed', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger source_documents_updated_at before update on public.source_documents
  for each row execute function public.set_updated_at();

-- RAG 청크. 임베딩 컬럼은 임베딩 모델 확정(D-07, 8주차) 후 추가.
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.source_documents (id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  chunk_text text not null,
  fts tsvector generated always as (to_tsvector('simple', chunk_text)) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_document_id, chunk_index)
);
create index document_chunks_fts_idx on public.document_chunks using gin (fts);

-- ─────────────────────────────────────────────────────────────
-- 업무 템플릿 (data/templates/*.yaml 에서 시드)
-- ─────────────────────────────────────────────────────────────
create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique check (template_key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  version int not null default 1 check (version >= 1),
  category text not null check (category in
    ('housing_registration', 'residence_admin', 'finance_tax', 'insurance', 'telecom', 'driving_vehicle')),
  title text not null,
  description text not null,
  region_scope text not null check (region_scope ~ '^(federal|national_kr|state:DE-[A-Z]{2}|city:[a-z_]+)$'),
  applicability jsonb not null,
  required_documents jsonb not null default '[]'::jsonb check (jsonb_typeof(required_documents) = 'array'),
  deadline_rule jsonb check (deadline_rule is null or (
    deadline_rule ? 'anchor' and deadline_rule ? 'offset_days' and deadline_rule ? 'source_key'
    and deadline_rule ->> 'anchor' in ('arrival_date', 'move_in_date', 'target_move_date'))),
  estimated_duration text,
  verification_status text not null check (verification_status in ('draft', 'needs_review', 'verified')),
  last_verified_at date,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (verification_status <> 'verified' or last_verified_at is not null)
);
create trigger task_templates_updated_at before update on public.task_templates
  for each row execute function public.set_updated_at();

create table public.template_prerequisites (
  template_id uuid not null references public.task_templates (id) on delete cascade,
  prerequisite_template_id uuid not null references public.task_templates (id) on delete cascade,
  kind text not null check (kind in ('hard', 'soft')),
  primary key (template_id, prerequisite_template_id),
  check (template_id <> prerequisite_template_id)
);

create table public.template_sources (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.task_templates (id) on delete cascade,
  source_document_id uuid not null references public.source_documents (id) on delete restrict,
  supports text[] not null check (cardinality(supports) > 0
    and supports <@ array['existence', 'deadline', 'documents', 'fee', 'procedure']),
  excerpt text not null check (char_length(excerpt) between 1 and 600)
);
create index template_sources_template_idx on public.template_sources (template_id);

-- 선행 관계 순환 금지 (AC-03-5)
create or replace function public.prevent_prerequisite_cycle()
returns trigger language plpgsql as $$
begin
  if exists (
    with recursive reach(id) as (
      select new.prerequisite_template_id
      union
      select p.prerequisite_template_id
      from public.template_prerequisites p join reach r on p.template_id = r.id
    )
    select 1 from reach where id = new.template_id
  ) then
    raise exception 'prerequisite cycle detected for template %', new.template_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger template_prerequisites_no_cycle
  before insert or update on public.template_prerequisites
  for each row execute function public.prevent_prerequisite_cycle();

-- 템플릿 출처 규칙 (AC-02-5, DATA_SPEC §2). 트랜잭션 끝에 검사.
--  - needs_review/verified 는 existence 출처 1개 이상
--  - verified 는 사람 검토된 출처(checked_by = human)만 사용
--  - deadline_rule 의 source_key 는 supports 에 deadline 포함
create or replace function public.check_template_integrity()
returns trigger language plpgsql as $$
declare
  t public.task_templates;
  tid uuid;
begin
  -- 같은 함수를 두 테이블에서 쓰므로 컬럼은 jsonb 로 꺼낸다 (plpgsql 은 없는 필드 참조를 오류로 처리).
  if tg_table_name = 'task_templates' then
    tid := (to_jsonb(new) ->> 'id')::uuid;
  else
    tid := (to_jsonb(new) ->> 'template_id')::uuid;
  end if;
  select * into t from public.task_templates where id = tid;
  if not found then
    return null;
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
create constraint trigger task_templates_integrity
  after insert or update on public.task_templates
  deferrable initially deferred
  for each row execute function public.check_template_integrity();
create constraint trigger template_sources_integrity
  after insert or update on public.template_sources
  deferrable initially deferred
  for each row execute function public.check_template_integrity();

-- ─────────────────────────────────────────────────────────────
-- 사용자 업무 (FR-02, FR-03)
-- target_date 는 사용자 설정일만 저장. 공식 기한은 템플릿 규칙+프로필로 계산 (저장하지 않음).
-- ─────────────────────────────────────────────────────────────
create table public.user_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null,
  template_id uuid references public.task_templates (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'completed')),
  applicability text not null default 'applies' check (applicability in ('applies', 'needs_review')),
  is_excluded boolean not null default false,
  target_date date,
  blocked_reason text check (char_length(blocked_reason) <= 500),
  notes text check (char_length(notes) <= 2000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, user_id) references public.profiles (id, user_id) on delete cascade,
  unique (profile_id, template_id),
  unique (id, user_id),
  check ((status = 'completed') = (completed_at is not null))
);
create index user_tasks_user_idx on public.user_tasks (user_id);

create or replace function public.user_tasks_before_write()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger user_tasks_before_write before insert or update on public.user_tasks
  for each row execute function public.user_tasks_before_write();

create table public.user_task_dependencies (
  user_id uuid not null,
  task_id uuid not null,
  depends_on_task_id uuid not null,
  primary key (task_id, depends_on_task_id),
  foreign key (task_id, user_id) references public.user_tasks (id, user_id) on delete cascade,
  foreign key (depends_on_task_id, user_id) references public.user_tasks (id, user_id) on delete cascade,
  check (task_id <> depends_on_task_id)
);

-- ─────────────────────────────────────────────────────────────
-- AI 실행 기록 (모든 AI 호출). 원문 개인정보 대신 input_hash.
-- ─────────────────────────────────────────────────────────────
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  feature text not null check (feature in ('profile_extraction', 'rag_answer', 'next_action', 'eval_judge')),
  model_id text not null,
  prompt_version text not null,
  input_hash text not null,
  output_json jsonb,
  validation_status text not null check (validation_status in ('valid', 'invalid', 'repaired', 'error')),
  error_code text,
  latency_ms int check (latency_ms >= 0),
  input_tokens int check (input_tokens >= 0),
  output_tokens int check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index ai_runs_user_idx on public.ai_runs (user_id);

-- ─────────────────────────────────────────────────────────────
-- Q&A 대화 (FR-04)
-- ─────────────────────────────────────────────────────────────
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  answer_json jsonb,
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (thread_id, user_id) references public.chat_threads (id, user_id) on delete cascade
);
create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- Next Best Action 추천 (FR-05)
-- ─────────────────────────────────────────────────────────────
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_task_id uuid not null,
  reason text not null check (char_length(reason) <= 1000),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed', 'expired')),
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (user_task_id, user_id) references public.user_tasks (id, user_id) on delete cascade,
  check ((status in ('accepted', 'dismissed')) = (decided_at is not null))
);
create index recommendations_user_idx on public.recommendations (user_id, status);

-- ─────────────────────────────────────────────────────────────
-- 평가 (FR-06). 공개 리포트용으로 누구나 읽기 가능.
-- ─────────────────────────────────────────────────────────────
create table public.evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  feature text not null check (feature in ('profile_extraction', 'rag_answer', 'next_action')),
  scenario text,
  severity text not null check (severity in ('low', 'medium', 'high')),
  tags text[] not null default '{}',
  input_json jsonb not null,
  expected_json jsonb not null,
  forbidden jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger evaluation_cases_updated_at before update on public.evaluation_cases
  for each row execute function public.set_updated_at();

create table public.evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  model_id text not null,
  prompt_version text not null,
  git_sha text not null check (git_sha ~ '^[0-9a-f]{7,40}$'),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.evaluation_results (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null references public.evaluation_runs (id) on delete cascade,
  evaluation_case_id uuid not null references public.evaluation_cases (id) on delete cascade,
  ai_run_id uuid references public.ai_runs (id) on delete set null,
  scores jsonb not null default '{}'::jsonb,
  passed boolean not null,
  failure_type text,
  review_source text not null check (review_source in ('auto', 'llm_judge', 'human')),
  notes text,
  created_at timestamptz not null default now(),
  unique (evaluation_run_id, evaluation_case_id, review_source)
);

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.source_documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.task_templates enable row level security;
alter table public.template_prerequisites enable row level security;
alter table public.template_sources enable row level security;
alter table public.user_tasks enable row level security;
alter table public.user_task_dependencies enable row level security;
alter table public.ai_runs enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.recommendations enable row level security;
alter table public.evaluation_cases enable row level security;
alter table public.evaluation_runs enable row level security;
alter table public.evaluation_results enable row level security;

-- 본인 데이터: 읽기/쓰기 모두 user_id = auth.uid()
create policy "own profile" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own tasks" on public.user_tasks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own task dependencies" on public.user_task_dependencies for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own threads" on public.chat_threads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own messages" on public.chat_messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own recommendations" on public.recommendations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- AI 실행 기록: 본인 것 읽기만. 쓰기는 서버(service_role)만.
create policy "read own ai runs" on public.ai_runs for select to authenticated
  using (user_id = (select auth.uid()));

-- 참조 데이터: 로그인 사용자 읽기 전용. 쓰기 정책 없음 → service_role 만 가능.
create policy "read sources" on public.source_documents for select to authenticated using (true);
create policy "read chunks" on public.document_chunks for select to authenticated using (true);
create policy "read templates" on public.task_templates for select to authenticated using (true);
create policy "read template prerequisites" on public.template_prerequisites for select to authenticated using (true);
create policy "read template sources" on public.template_sources for select to authenticated using (true);

-- 평가: 공개 읽기 (AC-06-4). 쓰기는 service_role 만.
create policy "public read eval cases" on public.evaluation_cases for select to anon, authenticated using (true);
create policy "public read eval runs" on public.evaluation_runs for select to anon, authenticated using (true);
create policy "public read eval results" on public.evaluation_results for select to anon, authenticated using (true);

-- 명시적 권한 (환경마다 기본 권한이 달라도 동일하게 동작하도록)
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on public.evaluation_cases, public.evaluation_runs, public.evaluation_results to anon;
revoke insert, update, delete on public.evaluation_cases, public.evaluation_runs, public.evaluation_results from anon;
