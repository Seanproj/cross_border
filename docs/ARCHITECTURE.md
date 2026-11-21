# Architecture & Data Model

## 1. 고수준 구조

```text
Web Client (Next.js)
   |
   v
Application/API Layer
   |----------------------|
   v                      v
Domain Services        AI Orchestrator
   |                      |
   v                      |---- Profile Extraction
Supabase/Postgres          |---- Retrieval (RAG)
   |                      |---- Answer Generation
   |                      |---- Next Best Action
   v                      |---- Output Validation
Official Source Store <---|
```

MVP는 모듈형 모놀리스로 구현합니다. 마이크로서비스는 도입하지 않습니다.

## 2. 권장 폴더 구조

```text
src/
  app/
    (auth)/
    dashboard/
    profile/
    checklist/
    timeline/
    assistant/
    evaluation/
    api/
  components/
    layout/
    dashboard/
    checklist/
    timeline/
    assistant/
    ui/
  features/
    profile/
    tasks/
    sources/
    recommendations/
    evaluation/
  lib/
    supabase/
    ai/
    validation/
    dates/
  server/
    repositories/
    services/
    ai/
      providers/
      prompts/
      retrieval/
      evaluators/
  types/
  tests/
docs/
  PRD.md
  ARCHITECTURE.md
  AI_EVALUATION.md
  ROADMAP.md
  DESIGN_GUIDE.md
```

## 3. 핵심 엔티티

### profiles
- id (uuid)
- user_id (uuid)
- origin_country (text)
- destination_country (text)
- move_purpose (text)
- target_move_date (date, nullable)
- household_type (text, nullable)
- housing_status (text, nullable)
- region_or_city (text, nullable)
- created_at, updated_at

### task_templates
- id (uuid)
- country_code (text)
- category (text)
- title (text)
- description (text)
- applicability_rules (jsonb)
- prerequisites (jsonb)
- required_documents (jsonb)
- official_sources (jsonb)
- deadline_rule (jsonb, nullable)
- verification_status (text)
- last_verified_at (date, nullable)

### user_tasks
- id (uuid)
- user_id (uuid)
- profile_id (uuid)
- template_id (uuid, nullable)
- title (text)
- status (not_started | in_progress | blocked | completed)
- target_date (date, nullable)
- notes (text, nullable)
- created_at, updated_at

### source_documents
- id (uuid)
- title (text)
- authority (text)
- url (text)
- country_code (text)
- region_scope (text, nullable)
- published_or_updated_at (date, nullable)
- checked_at (date)
- content_hash (text)
- trust_level (official | secondary)
- ingestion_status (text)

### document_chunks
- id (uuid)
- source_document_id (uuid)
- chunk_text (text)
- embedding (vector)
- metadata (jsonb)

### ai_runs
- id (uuid)
- user_id (uuid, nullable)
- feature (text)
- model_id (text)
- prompt_version (text)
- input_hash (text)
- output_json (jsonb)
- validation_status (text)
- created_at

### evaluation_cases
- id (uuid)
- case_key (text)
- feature (text)
- input_json (jsonb)
- expected_criteria (jsonb)
- severity (low | medium | high)

### evaluation_results
- id (uuid)
- evaluation_case_id (uuid)
- model_id (text)
- prompt_version (text)
- scores (jsonb)
- passed (boolean)
- notes (text)
- created_at

## 4. 보안
- Supabase RLS로 user_id 기반 데이터 접근을 강제합니다.
- 서비스 역할 키는 서버 환경변수에만 둡니다.
- AI 요청에 불필요한 개인정보를 포함하지 않습니다.
- 원문 문서는 출처 URL과 검증일을 함께 저장합니다.
- 사용자 입력과 검색된 문서는 프롬프트 인젝션 가능성이 있는 비신뢰 데이터로 취급합니다.

## 5. AI provider abstraction
서버 내부에 다음과 같은 계약을 둡니다.
- extractProfile(input) -> validated ProfileDraft
- answerWithSources(question, context) -> AnswerWithCitations
- recommendNextActions(profile, tasks) -> Recommendation[]
- evaluate(case, output) -> EvaluationScore

모델별 SDK 호출은 provider 구현체에 격리합니다.
