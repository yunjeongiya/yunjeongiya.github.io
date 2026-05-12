---
layout: post
title: "anti-pattern 124곳 발견, DROP은 19개 — 나머지를 그대로 둔 이유"
date: 2026-05-12 14:00:00 +0900
categories: [Database, Performance]
tags: [mysql, index, audit, cleanup, postmortem]
lang: ko
slug: "080"
thumbnail: /assets/images/posts/080-index-cleanup-decision/thumbnail-ko.jpg
image: /assets/images/posts/080-index-cleanup-decision/thumbnail-ko.jpg
published: true
---

> 5/4 DB incident 시리즈
>
> 1. [cardinality=1 단일컬럼 인덱스가 새 compound index를 무력화한다](/posts/077/)
> 2. [DB 풀 고갈 cascade: leak 출처 분산에 속지 말 것](/posts/078/)
> 3. [잠복 슬로우 쿼리 incident: "왜 하필 오늘?"의 답을 짚을 수 없는 이유](/posts/079/)
> 4. **anti-pattern 124곳 발견, DROP은 19개 — 나머지를 그대로 둔 이유**
> 5. [JPA @Index ≠ prod DB index — Entity-DB drift 의 5가지 패턴](/posts/081/)

![발견 먼저 분류 다음 DROP은 마지막](/assets/images/posts/080-index-cleanup-decision/thumbnail-ko.jpg){: width="700"}

## 도입

[이전 글](/posts/077/)에서 cardinality=1 단일컬럼 인덱스가 옵티마이저를 misleading 하여 P0 incident 를 만든 케이스와 그 fix 를 다뤘다. fix 직후 같은 DB 전체를 audit 한 결과 동일 anti-pattern 이 91건 더 발견됐고 정기 audit cron 으로 미리 잡자고 결론냈다.

그런데 발견된 124곳을 일괄 DROP 할 수는 없었다. 실제 cleanup 을 돌려보니 즉시 DROP 19건, deferred 57건, KEEP 2건, case-by-case 46건 으로 분리됐다. **발견과 정리는 별개의 의사결정**이다.

이 글은 audit 결과를 분류하고 cleanup 우선순위를 정한 4가지 결정 기준과 그 근거를 정리한다.

## 배경 / 문제

audit 1회 prod 실행 결과:
- Cardinality ≤ 2 단일컬럼 인덱스: **92건**
- 중복 prefix 인덱스 (compound 가 prefix 로 cover): **32건**
- FK 컬럼에 인덱스 없는 케이스: 0건

총 124곳 의심. 그대로 보면 "anti-pattern 이 124곳, 다 DROP 하면 된다" 결론에 도달하기 쉽다. 하지만 실제 분류는 더 미묘하다.

## 해결 과정 — 4가지 결정 기준

![Index cleanup decision tree](/assets/images/posts/080-index-cleanup-decision/cleanup-decision-tree.svg){: width="700"}

### 1. FK 제약: DROP 불가 또는 compound 교체

MySQL InnoDB 는 FK 제약 컬럼에 leading prefix 인덱스를 요구한다. 어떤 인덱스가 그 prefix 역할을 하면, 그 인덱스를 DROP 하려면 다른 prefix 인덱스가 있어야 한다. 없으면 DROP rejected (ERROR 1553).

cleanup 에서 만난 케이스:

```sql
-- 시도
ALTER TABLE operator_task DROP INDEX idx_template;
-- ERROR 1553 (HY000): Cannot drop index 'idx_template':
-- needed in a foreign key constraint
```

`operator_task.template_id` 는 `task_template.id` 에 FK. `idx_template` 이 유일한 template_id-leading 인덱스. DROP 하려면 compound `(template_id, ...)` 인덱스를 먼저 만들어야 한다.

비용 vs 가치:
- 새 compound 만들기 → 스토리지 증가 + 정당화할 쿼리 패턴이 있어야 함
- 그냥 KEEP → cardinality 가 낮은 단일 인덱스지만 FK 보호 인덱스로 활용

**결정 기준**: 단독으로 anti-pattern 형태라도 FK 보호 역할이면 KEEP (또는 compound 로 교체할 정당화 가능 시에만 교체). 코딩 컨벤션에 "cardinality ≤ 2 단일컬럼 인덱스 금지" 룰이 있어도 **FK 보호 인덱스는 예외**로 등록한다.

### 2. 옵티마이저가 한 번도 안 쓰는 인덱스: 즉시 DROP

EXPLAIN 으로 검증할 때 `possible_keys` 에 후보로 떠도 옵티마이저가 한 번도 선택하지 않는 인덱스가 있다. 이런 건 단순히 anti-pattern 을 넘어 **storage / maintenance overhead 만 발생시키는 dead weight**.

검증 절차:
1. 해당 인덱스가 사용될 만한 모든 query 패턴을 코드베이스 grep
2. 각 query EXPLAIN 으로 `key` 컬럼 확인
3. 한 번도 안 뜨면 → DROP 후보

예시 EXPLAIN:

```text
EXPLAIN SELECT * FROM article
        WHERE org_id = 1 AND source_type = 'MANUAL' AND active = TRUE;

possible_keys: idx_article_org, idx_article_source_type
key:           idx_article_org             ← 항상 이거
```

`idx_article_source_type` 는 후보로만 보이고 실 선택 0건. 코드의 모든 source_type 쿼리도 `org_id` 와 같이 사용 — `org_id` 의 selectivity 가 더 높아 옵티마이저가 거기서부터 좁힌다. → 즉시 DROP.

주의: 통계가 prod-like 데이터로 갱신된 상태에서 EXPLAIN. dev 의 작은 데이터로는 옵티마이저가 다른 선택을 한다. **prod 또는 prod-snapshot 으로 검증해야 함**.

### 3. 중복 prefix: 검증 후 DROP

compound 인덱스가 동일 prefix 를 가지면 단일 인덱스는 redundant. MySQL 은 prefix lookup 을 compound 로 처리할 수 있다.

```text
compound: idx_user_date_status (user_id, target_date, status)
single:   idx_user_id (user_id)
→ idx_user_id 는 redundant. DROP 후 user_id lookup 은 compound prefix 사용
```

audit query 로 자동 검출 가능:

```sql
SELECT s1.TABLE_NAME, s1.INDEX_NAME AS redundant,
       s2.INDEX_NAME AS covers_it
FROM information_schema.STATISTICS s1
JOIN information_schema.STATISTICS s2
  ON s1.TABLE_SCHEMA = s2.TABLE_SCHEMA
 AND s1.TABLE_NAME   = s2.TABLE_NAME
 AND s1.COLUMN_NAME  = s2.COLUMN_NAME
 AND s2.SEQ_IN_INDEX = 1
 AND s1.INDEX_NAME  != s2.INDEX_NAME
WHERE s1.TABLE_SCHEMA = ?
  AND s1.SEQ_IN_INDEX = 1
  AND s1.INDEX_NAME NOT IN (   -- s1 must be single-column
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? AND SEQ_IN_INDEX = 2
  )
  AND s2.INDEX_NAME IN (        -- s2 must be compound (≥2 cols)
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ? AND SEQ_IN_INDEX = 2
  )
  AND s1.NON_UNIQUE = 1
  AND s2.NON_UNIQUE = 1;
```

이 패턴이 발견되면 거의 항상 안전한 DROP. EXPLAIN before / after 로 fallback 검증만 하면 된다. compound 가 prefix lookup 을 잘 처리하는지 확인.

### 4. 빈 테이블 (cardinality=0): deferred

audit 에서 cardinality=0 인 인덱스 57건 — 모두 prod 가동 안 된 신규 feature 의 빈 테이블이었다. 인덱스 자체는 anti-pattern 형태지만 row 가 0 이면 통계가 잘못 잡힐 일이 없다.

결정:
- 지금 DROP → feature ship 시점에 row 누적 시작하면 cardinality 자연 상승. 그 때 compound 로 교체할지 단일 KEEP 할지 데이터 기반으로 결정 가능
- 지금 DROP 하면 feature ship 시 다시 추가해야 함 (왕복 비용)

→ **feature 가동 시점에 결정**. deployment checklist 에 "1주 후 EXPLAIN 으로 인덱스 선택 재확인" 항목 추가.

## 결과

분류 결과 표:

| 분류 | 건수 | 액션 |
|---|---|---|
| FK 보호 KEEP | 2 | 그대로 유지 (anti-pattern 예외) |
| 옵티마이저 미사용 DROP | 3 | 즉시 정리 |
| 중복 prefix DROP | 16 | EXPLAIN 검증 후 정리 |
| 빈 테이블 deferred | 57 | feature ship 시점에 결정 |
| **계** | **78** | 19 DROP, 57 deferred, 2 KEEP |

남은 46건은 활성 테이블 cardinality=1 단일컬럼이지만 옵티마이저가 실제 사용 중. 비즈니스 영향 분석 후 case-by-case 결정 필요. 별도 cleanup phase 로 분리.

지표 변화:
- Cardinality ≤ 2 단일컬럼: 92 → 80 (-12)
- 중복 prefix: 32 → 16 (-16)
- FK 누락: 0 → 0 (유지)

**audit 1회로 발견한 124건 중 즉시 DROP 은 19건 (15%)**. audit rule 별 카운트는 서로 겹칠 수 있어서 위 지표 변화와 액션 건수는 1:1 로 더해지지 않는다. 발견-정리 비율이 100% 가 아닌 이유는 FK 제약 / 옵티마이저 사용 패턴 / 데이터 누적 시기 / 코드 변경 비용 등 여러 직교 변수가 얽혀 있기 때문.

![Cleanup classification result](/assets/images/posts/080-index-cleanup-decision/cleanup-result-bars.svg){: width="700"}

## 배운 점

### 결정 기준의 직교성

anti-pattern 발견은 자동화 가능 (위 SQL 한 줄). 결정은 자동화 어려움 — 4가지 기준이 서로 영향 안 주고 독립적으로 작용해서 매 케이스마다 따로 평가해야 한다.

> 발견은 1시간, 분류는 반나절, 정리는 1주.

### FK 보호 인덱스를 룰 예외로 등록

backend.md / 코딩 컨벤션에 "cardinality ≤ 2 단일컬럼 인덱스 금지" 룰이 있어도 FK 보호 인덱스는 예외다. **룰을 등록할 때 예외 케이스도 같이 등록**해야 한다. 그렇지 않으면 다음 audit 에서 또 false positive 로 등장한다.

### "발견 후 즉시 정리" 압박은 안 좋은 시그널

incident 후 audit 이 발견한 124곳을 보면 "큰일 났다 다 정리해야 한다" 압박이 자연스러운 반응이다. 하지만 그 압박으로 무차별 DROP 하면:
- FK 제약 실패 출력 누락 (parallel 실행 시 출력이 잘리면 못 본다)
- 옵티마이저가 실제 사용 중인 인덱스 DROP → 다른 쿼리 회귀
- 빈 테이블 정리 → ship 시 다시 추가하는 왕복

오히려 **분류 → 우선순위 → 단계별 정리**로 가는 게 즉시 정리 압박을 견디는 방법.

### 빈 테이블 정리는 deployment checklist 로 미루기

cardinality=0 정리는 지금 안 하는 게 옳다. 대신 deployment checklist (feature ship 시) 항목으로:
- ship 1주 후 EXPLAIN 재확인
- cardinality 상승 폭에 따라 compound 교체 결정
- 매번 인덱스 audit 자동화 트리거

이게 incident 재발 방지의 ROI 가 더 좋다. "지금 발견했으니 지금 정리" 보다 **"가동 후 데이터 기반으로 정리"** 가 옳은 시점.

### parallel ALTER 실행은 실패 출력 누락 함정

ALTER TABLE DROP INDEX 4건을 parallel 로 돌렸을 때 1건이 FK 제약으로 실패했다. MySQL 은 명시적으로 ERROR 를 냈지만, 실행 스크립트 출력이 잘리면서 (`tail -3`) 못 봤고 최종 STATISTICS 재조회로 발견했다. **prod DDL 은 1건씩 순차적으로 돌리고 각 응답 확인**. parallel 은 1초 절약하려다 사고 만든다.

## 다음 글

인덱스를 정리하다 보면 자연스럽게 다음 질문으로 넘어간다. "Entity 에 선언된 인덱스와 prod DB 의 실제 인덱스가 정말 같은가?" [다음 글](/posts/081/)은 이 Entity-DB drift 의 패턴을 정리한다.

## References

- MySQL Reference Manual: [FOREIGN KEY Constraints — Indexing](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html)
- MySQL Reference Manual: [Optimizer Index Selection](https://dev.mysql.com/doc/refman/8.0/en/optimizer-statistics.html)
- `information_schema.STATISTICS` — audit 자동화의 기반
- 이전 글: [cardinality=1 단일컬럼 인덱스가 새 compound index 를 무력화한다](/posts/077/)
