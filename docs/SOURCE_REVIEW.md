# 출처 수집 결과 및 검토 요청 — Week 1

> 수집일: 2026-11-21 · 수집 방식: AI 자동 수집 + 원문 대조 (`checked_by: ai_fetch`)
> 검사: `scripts/curation/verify_data.py` — 인용문 50/50개가 수집한 원문에 그대로 존재, 구조 오류 0건

## 1. 요약

| 항목 | 결과 |
|---|---|
| 업무 템플릿 | 30개 (주거 5, 체류·행정 8, 금융·세금 3, 보험 5, 통신 3, 운전 6) |
| 공식 출처 인용이 있는 템플릿 (`needs_review`) | 20개 |
| 공식 출처 미확보 (`draft`) | 10개 |
| 사람 검토 완료 (`verified`) | 0개 — 아래 §3 검토 필요 |
| 공식 출처 | 14개 페이지 (연방 부처·기관 7, 베를린 5, 프랑크푸르트 지역 2) |
| 평가 시드 케이스 | 10개 (구조화 4, Q&A 4, 다음 행동 2) |

## 2. 수집 중 발견한 것

### 2.1 출처 해석 오류 사례 (평가 케이스로 등록)
웹 검색 요약은 "한국 국적자는 취업 목적이면 국가 비자로 입국해야 한다"고 답했습니다. 그러나 베를린 외국인청 원문을 직접 확인하니, 비자 없이 입국 후 체류허가를 신청할 수 있는 국가 목록에서 "취업 체류허가 제외" 각주(1)는 안도라·브라질 등 6개국에만 붙어 있고 **한국에는 없었습니다**. 요약 모델이 각주를 잘못 적용한 것입니다.
→ `eval/cases/rag_answer/seed.yaml` 의 `rag.conflict.korea_visa_free` (심각도 high). 이 제품의 RAG가 같은 실수를 하지 않는지 측정합니다.

### 2.2 자동 접속이 막힌 공식 사이트

| 사이트 | 상태 | 영향 |
|---|---|---|
| gesetze-im-internet.de (연방 법령) | 연결 거부 | 법 조문(BMG §17·§19, FeV §29·Anlage 11, AufenthV §41) 직접 인용 불가 |
| frankfurt.de | 봇 차단 (403) | 프랑크푸르트 시청 절차는 연방 행정 포털(verwaltung.bund.de)로 대체 |
| arbeitsagentur.de | 봇 검증 페이지 | 자녀수당(Kindergeld) 출처 미확보 |
| make-it-in-germany.com | 스크립트로 렌더링 | 본문 추출 불가 |
| safedriving.or.kr | 메뉴가 스크립트로 동작 | 국제운전면허 안내 페이지 URL 미확인 |

이 사이트들은 브라우저로는 정상적으로 열립니다. 검토하실 때 직접 확인해 주시면 됩니다.

## 3. 검토 요청 (사람 확인)

각 항목의 링크를 열고, 템플릿의 `excerpt`(인용문)가 페이지에 있는지와 한국어 `description`이 그 의미를 정확히 옮겼는지 확인해 주세요. 맞으면 해당 템플릿을 `verified`로, 출처를 `checked_by: human`으로 바꿉니다(말씀만 해주시면 제가 수정합니다).

**우선순위 높음 — 제품 핵심 흐름과 평가에 쓰임**
- [ ] `de.registration.address.berlin` — [service.berlin.de/dienstleistung/120686](https://service.berlin.de/dienstleistung/120686/): 14일 기한, 온라인 등록은 독일·EU 시민만, 수수료 없음
- [ ] `de.registration.address.frankfurt` — [연방 포털 '거주지 등록'](https://verwaltung.bund.de/leistungsverzeichnis/de/leistung/99115005104000): 2주 이내 직접 방문
- [ ] `de.residence.entry_visa_free_kr` — [베를린 외국인청 '장기 체류 입국'](https://www.berlin.de/einwanderung/einreise/visumverfahren/laengerer-aufenthalt/): **각주 1이 한국에 없는지** 화면에서 확인
- [ ] `de.license.conversion.berlin` — [service.berlin.de/dienstleistung/327537](https://service.berlin.de/dienstleistung/327537/): 서류·수수료 37.50/45.10유로
- [ ] `de.license.foreign_validity` / `de.license.conversion.frankfurt` — [연방 포털 프랑크푸르트 면허 전환](https://verwaltung.bund.de/leistungsverzeichnis/DE/leistung/99108047050002/herausgeber/HE-8963049/region/064120000000): 6개월 규정 (페이지 갱신일 2017년 — 오래됨)

**보통**
- [ ] `de.housing.landlord_confirmation`, `de.housing.rundfunkbeitrag`, `de.tax.id_receive`, `de.insurance.health_mandatory`, `de.residence.permit.berlin`, `de.residence.employment_declaration.berlin`, `de.family.kita_voucher.berlin`, `de.telecom.prepaid_sim`

**출처 보강 필요 (직접 찾아주시거나, 허용 도메인 추가 후 제가 수집)**
- [ ] 한국이 FeV Anlage 11(면허 시험 면제 국가)에 포함되는지 — 법령 사이트
- [ ] 자녀수당(Kindergeld), 은행 계좌, 국제운전면허증, 한국 건강보험 출국 처리, 차량 등록

## 4. 재수집 방법
```bash
SNAPSHOT_DIR=/tmp/snapshots scripts/curation/fetch.sh berlin_anmeldung https://service.berlin.de/dienstleistung/120686/
python3 -I scripts/curation/verify_data.py . /tmp/snapshots   # 스냅샷 파일명은 verify_data.py 의 MAP 참고
```
원문 스냅샷은 저작권과 용량 때문에 저장소에 넣지 않고, `content_hash`로 변경 여부만 추적합니다. 2주차에 같은 검사를 TypeScript 시드 스크립트로 옮깁니다.
