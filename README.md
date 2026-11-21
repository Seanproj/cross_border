# Cross-border Life OS
**AI-powered Relocation Assistant** — 한국 → 독일(베를린·프랑크푸르트) 이주 업무를 개인별 체크리스트, 선행 조건이 반영된 일정, 공식 출처 기반 AI 안내로 바꾸는 웹 애플리케이션입니다.

> 이 서비스는 일반 정보를 제공하며 법률·세무·비자 자문이 아닙니다.

## 이 프로젝트가 보여주려는 것
1. **AI가 사용자 상황을 구조화** — 자연어 → 검증된 프로필 (신뢰도·누락 정보 표시)
2. **공식 출처 기반 신뢰성** — 모든 업무·답변을 원문 인용문과 연결하고, 출처 없는 기한은 만들지 않음
3. **AI 결과의 정확성 테스트·개선** — 평가 케이스·지표·버전 비교를 공개

## 현재 상태 (Week 2)
| 단계 | 상태 |
|---|---|
| PRD v1.1, 결정 기록 | 완료 — `docs/PRD.md`, `docs/DECISIONS.md` |
| 공식 출처 14개, 업무 템플릿 30개, 평가 시드 10개 | 완료 (사람 검토 대기) — `data/`, `eval/`, `docs/SOURCE_REVIEW.md` |
| DB 스키마·RLS·시드·테스트 | 완료 — `supabase/migrations/`, `tests/` |
| UI · AI · 평가 화면 | 예정 — `docs/ROADMAP.md` |

## 개발 환경

필요한 것: Node.js 22, pnpm, Docker.

```bash
pnpm install          # 라이브러리 설치
cp .env.example .env  # 로컬 DB 주소 (비밀값 없음)

pnpm db:up            # 테스트용 Postgres(Supabase 이미지) 컨테이너 시작
pnpm db:migrate       # 테이블·권한 생성
pnpm db:seed          # data/, eval/ 의 YAML 검증 후 DB에 입력

pnpm dev              # http://localhost:3000
```

| 명령 | 하는 일 |
|---|---|
| `pnpm verify` | 타입 검사 + 린트 + 단위 테스트 + 데이터 검사 (커밋 전 실행) |
| `pnpm test` | 단위 테스트 (DB 불필요) |
| `pnpm test:db` | DB 테스트: 마이그레이션, 사용자별 접근 제한(RLS), 제약 조건, 시드 (`pnpm db:up` 필요) |
| `pnpm data:check` | 출처·템플릿·평가 케이스 YAML만 검사 |
| `pnpm db:down` | 테스트 DB 컨테이너 삭제 (데이터도 삭제) |

Supabase 전체 로컬 스택(로그인 포함)은 3주차부터 `npx supabase start`로 사용합니다. 클라우드 개발 환경에서는 `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`가 필요할 수 있습니다 (`docs/DECISIONS.md` D-13).

## 폴더 구조
```text
data/sources, data/templates   공식 출처와 업무 템플릿 (YAML, PR 리뷰 대상)
eval/cases                     AI 평가 케이스 (YAML)
supabase/migrations            DB 스키마 + RLS
src/lib/validation             Zod 스키마 (데이터 파일·AI 출력 공용)
src/server/domain              순수 도메인 규칙 (LLM 없음)
src/server/db, src/server/data DB 마이그레이션·시드, YAML 로더
scripts/                       CLI (db, curation)
tests/unit, tests/db           테스트
docs/                          PRD, 아키텍처, 결정 기록, 와이어프레임, 평가 계획
```

## 문서
`MASTER_PROMPT.md` (작업 원칙) · `docs/PRD.md` · `docs/ARCHITECTURE.md` · `docs/DATA_SPEC.md` · `docs/DECISIONS.md` · `docs/WIREFRAMES.md` · `docs/AI_EVALUATION.md` · `docs/ROADMAP.md` · `docs/SOURCE_REVIEW.md`
