# Data Spec — 업무 템플릿 · 출처 · 평가 케이스

이 문서는 `data/` 와 `eval/` 아래 YAML 파일의 형식을 정의합니다. 2주차에 같은 내용을 Zod 스키마로 옮기고, 시드 스크립트는 스키마를 통과하지 못한 파일이 있으면 실패합니다.

## 1. 출처 (`data/sources/*.yaml`)

```yaml
- source_key: berlin.service.anmeldung        # 고유 키 (소문자, 점 구분)
  title: "Anmeldung einer Wohnung"            # 원문 제목 그대로
  authority: "Land Berlin – Service-Portal"   # 발행 기관
  url: "https://service.berlin.de/..."
  language: de                                # de | en | ko
  country_code: DE
  region_scope: city:berlin                   # federal | state:DE-BE | state:DE-HE | city:berlin | city:frankfurt
  trust_level: official                       # official | secondary
  published_or_updated_at: null               # 페이지에 표기된 경우만
  checked_at: 2026-11-21                      # 사람이 직접 열어 확인한 날
```

규칙
- `url`은 고유해야 한다.
- `trust_level: official`은 정부·지자체·공공기관·법정 보험기관 도메인만.
- `checked_at`은 실제로 페이지를 열어 내용을 확인한 날짜. 추정 금지.

## 2. 업무 템플릿 (`data/templates/<category>.yaml`)

```yaml
- template_key: de.registration.address        # 고유, 변경 금지
  version: 1
  category: housing_registration
  title: "거주지 등록 (Anmeldung)"
  description: "..."                            # 출처 내용을 요약한 한국어 설명
  region_scope: city:berlin
  applicability:                                # §3 규칙 DSL
    all:
      - { field: city, op: eq, value: berlin }
  prerequisites:
    - { template_key: de.housing.secure_residence, kind: hard }
  required_documents:
    - { name: "여권", source_key: berlin.service.anmeldung }
  deadline_rule:                                # 없으면 null
    anchor: move_in_date                        # arrival_date | move_in_date | target_move_date
    offset_days: 14
    source_key: berlin.service.anmeldung        # 반드시 supports에 deadline 포함
  estimated_duration: null                      # 출처가 있을 때만
  sources:
    - source_key: berlin.service.anmeldung
      supports: [existence, deadline, documents, procedure]
      excerpt: "..."                            # 근거 문장 (원문, 짧게)
  verification_status: verified                 # draft | verified | needs_review
  last_verified_at: 2026-11-21
```

> 위 예시의 기한 값은 **형식 설명용**입니다. 실제 값은 1주차 수집 시 출처로 확인한 값만 넣습니다.

검증 규칙 (시드 시 자동 검사)
| 규칙 | 실패 시 |
|---|---|
| `verified`이면 `supports`에 `existence`가 있는 출처가 1개 이상 | 시드 실패 |
| `deadline_rule`이 있으면 그 `source_key`의 `supports`에 `deadline` 포함 | 시드 실패 |
| `required_documents`의 `source_key`가 있으면 그 출처의 `supports`에 `documents` 포함 | 시드 실패 |
| `prerequisites`의 `template_key`가 존재 | 시드 실패 |
| 선행 관계 그래프에 순환 없음 | 시드 실패 |
| 모든 `source_key`가 `data/sources`에 존재 | 시드 실패 |
| `last_verified_at`이 90일 초과 | 경고 (화면에 "재확인 필요") |

`move_in_date`는 v1.1 프로필 필드에 없으므로, 이 기준일을 쓰는 업무는 사용자 목표일 입력 또는 업무 상세에서 입주일을 받는 방식으로 2주차에 결정합니다 (열린 질문 Q-01).

## 3. 적용 규칙 DSL

```yaml
applicability:
  all:            # 모두 만족 (any: 도 가능, 중첩 가능)
    - { field: move_purpose, op: in, value: [employment, job_seeking] }
    - { field: household_type, op: eq, value: family_with_children }
```

- `field`: 프로필 필드명
- `op`: `eq` | `neq` | `in` | `not_in` | `is_set`
- 평가 결과는 3값: `true`(applies), `false`(제안 안 함), `unknown`(필요한 필드가 `null` → `needs_review`)
- `region_scope`는 DSL과 별도로 먼저 필터링: `federal`은 모두, `city:*`/`state:*`는 프로필 지역이 일치할 때만

## 4. 평가 케이스 (`eval/cases/<feature>/*.yaml`)

```yaml
case_key: profile.s5.missing_info
feature: profile_extraction          # profile_extraction | rag_answer | next_action
scenario: S5
severity: medium                     # low | medium | high
tags: [missing_info]
input:
  text: "독일 가요, 뭐 해야 해요?"
expected:
  status: needs_clarification
  missing_fields_include: [move_purpose, city]
  fields: {}                         # 기대 필드값 (명시된 것만 채점)
forbidden:
  - "추측한 도시명을 채움"
notes: "정보 부족 시 질문해야 함"
```

feature별 `expected` 키
| feature | 자동 채점 키 |
|---|---|
| profile_extraction | `fields`, `missing_fields_include`, `status` |
| rag_answer | `answer_status`, `must_cite_source_keys`, `must_include_facts`, `must_not_include` |
| next_action | `must_recommend_any`, `must_not_recommend`, `must_not_use_terms` |

## 5. 열린 질문
- Q-01: 입주일(`move_in_date`)을 프로필에 추가할지, 업무별 기준일로 받을지
- Q-02: 보조 출처(`secondary`)를 어디까지 허용할지 (예: 공공기관이 아닌 보험사 안내 페이지)
