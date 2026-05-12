---
layout: post
title: "cardinality=1 단일컬럼 인덱스가 새 compound index를 무력화한다"
date: 2026-05-12 10:00:00 +0900
categories: [Database, Performance]
tags: [mysql, hikaricp, index, optimizer, incident]
lang: ko
slug: "077"
thumbnail: /assets/images/posts/077-cardinality-one-index/thumbnail-ko.jpg
image: /assets/images/posts/077-cardinality-one-index/thumbnail-ko.jpg
published: true
---

> 5/4 DB incident 시리즈
>
> 1. **cardinality=1 단일컬럼 인덱스가 새 compound index를 무력화한다**
> 2. [DB 풀 고갈 cascade: leak 출처 분산에 속지 말 것](/posts/078/)
> 3. [잠복 슬로우 쿼리 incident: "왜 하필 오늘?"의 답을 짚을 수 없는 이유](/posts/079/)
> 4. [anti-pattern 124곳 발견, DROP은 19개 — 나머지를 그대로 둔 이유](/posts/080/)
> 5. [JPA @Index ≠ prod DB index — Entity-DB drift 의 5가지 패턴](/posts/081/)

![잘못된 이정표가 좋은 인덱스를 지나치게 했다](/assets/images/posts/077-cardinality-one-index/thumbnail-ko.jpg){: width="700"}

## 도입

대형 테이블에 `WHERE col_a IN (...) AND flag=1 AND enabled=1` 같은 쿼리를 빠르게 만들기 위해 compound index 를 추가했다. 그런데 EXPLAIN 으로 보면 옵티마이저가 그 새 인덱스를 안 고른다. 대신 cardinality 가 1인 (값이 사실상 두 종류뿐인 boolean 컬럼에 붙어 있던) 단일컬럼 인덱스를 골라서 사실상 풀스캔에 가까운 실행을 한다.

이 글은 그 함정의 메커니즘과 처방을 정리한다. 실제 prod P0 incident 사후 분석에서 도출된 패턴이다.

## 배경 / 문제

수십만 row 규모의 카탈로그 테이블 한 곳에서 잠복하던 슬로우 쿼리가 운영시간 동시 호출에 풀(HikariPool 기본 20개) 을 모두 점유하면서 P0 가 됐다. 단일 쿼리가 50–391 초 동안 conn 을 잡았다. 12개 endpoint 가 cascade 로 circuit breaker OPEN.

원인 쿼리:

```sql
SELECT id, group_id, parent_id, order_index, name
FROM item_catalog
WHERE group_id IN (?, ?, ?, ?, ?, ?)
  AND leaf_flag = 1
  AND enabled = 1
ORDER BY group_id, parent_id, order_index;
```

테이블 기존 인덱스:

```
idx_group_id (group_id)                                       -- cardinality 8
idx_leaf_flag (leaf_flag)                                     -- cardinality 1
idx_catalog_roots (group_id, parent_id, enabled, order_index, id)
idx_catalog_children (parent_id, group_id, enabled, order_index, id)
```

`idx_leaf_flag` 는 boolean 컬럼에 붙은 단일 인덱스. 0/1 두 값뿐이라 cardinality 통계가 1. 일반적으로 이런 인덱스는 선택도가 낮아서 유용하지 않다. 그런데 이 케이스에서는 통계 오차, `ORDER BY`/filesort 비용 추정, 기존 인덱스 후보들의 비용 비교가 겹치면서 옵티마이저가 이 인덱스를 더 싼 경로로 판단했다. EXPLAIN 결과:

```
type: ref
key: idx_leaf_flag
rows: 293,871
Extra: Using where; Using filesort
```

![Optimizer path diagram](/assets/images/posts/077-cardinality-one-index/optimizer-path-diagram.svg){: width="700"}

## 해결 과정

### 1차 시도 — compound covering index 추가

쿼리의 필터와 정렬, 조회 컬럼을 맞춘 compound covering index 추가:

```sql
ALTER TABLE item_catalog
  ADD INDEX idx_catalog_group_leaf_enabled
  (group_id, leaf_flag, enabled, parent_id, order_index, id, name);
```

EXPLAIN 재확인 — 여전히 `idx_leaf_flag` 선택. 새 covering index 가 `possible_keys` 에 보이지만 옵티마이저가 안 골랐다.

### 2차 시도 — `ANALYZE TABLE`

통계 갱신:

```sql
ANALYZE TABLE item_catalog;
```

다시 EXPLAIN — 그대로. 옵티마이저 비용 추정 모델 자체가 `idx_leaf_flag` 를 더 싸게 보고 있었다.

### 3차 시도 — anti-pattern 인덱스 DROP

```sql
ALTER TABLE item_catalog DROP INDEX idx_leaf_flag;
```

EXPLAIN 즉시 변경:

```
type: range
key: idx_catalog_group_leaf_enabled
rows: ~200K (추정, 실제 sub-100K)
Extra: Using where; Using index    ← covering, row lookup 없음
```

쿼리 시간: **391초 → <50ms**.

![Before and after index plan](/assets/images/posts/077-cardinality-one-index/before-after-plan.svg){: width="700"}

## 결과

- 풀 회복 (active 20 → idle 14)
- 13:09 UTC 이후 leak 경고 0건, 503 0건
- 다음 날 같은 endpoint 트래픽 +6% 였지만 incident 없음 — 인덱스가 단일 root cause 였음을 검증

## 배운 점

### cardinality ≤ 2 단일컬럼 인덱스는 anti-pattern

값이 거의 없는(boolean/flag) 단일 컬럼 인덱스는 본질적으로 존재 가치가 없다. 인덱스 seek 후 거의 전체 row 를 table lookup 하기 때문이다. 그런데도 옵티마이저가 통계를 잘못 읽고 이걸 고르는 케이스가 있다. **존재 자체가 다른 좋은 인덱스를 misleading 한다.**

발견 쿼리:

```sql
SELECT TABLE_NAME, INDEX_NAME, CARDINALITY
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ? AND CARDINALITY <= 2 AND SEQ_IN_INDEX = 1
ORDER BY TABLE_NAME;
```

이 쿼리로 prod 전체 audit 했더니 같은 패턴 91건이 더 발견됐다. 빙산의 일각이었다.

### `ANALYZE TABLE` 만으로는 부족

통계 갱신만으로 옵티마이저 선택이 바뀌지 않는 케이스가 있다. 이론상 `FORCE INDEX` 같은 우회도 가능하지만, 이번에는 실제 가치가 낮고 오판만 유발하던 단일 인덱스를 제거하는 쪽이 가장 깔끔했다.

### 검증 체크리스트 (새 `@Index` 추가 시)

- 추가하려는 컬럼의 distinct value 수 추정 (cardinality 예상치)
- boolean/flag 컬럼은 절대 단일 인덱스 X — compound 안의 부속 컬럼으로만 둠
- DDL 후 EXPLAIN 으로 옵티마이저 선택 확인 — `possible_keys` 에 떴다고 끝이 아니다, `key` 가 새 인덱스여야 함
- prod-like 데이터로 EXPLAIN — dev 의 작은 데이터로는 옵티마이저가 다른 선택을 함

### 잠복 인덱스 정리는 정기 audit 영역

incident 후에야 비로소 다른 91건이 드러난다. 이걸 사후 발견하는 게 아니라 정기 audit (월 1회) 으로 미리 잡는 게 옳다. cron 으로 위 쿼리를 돌려서 결과 0건을 유지하는 방향.

## 다음 글

이 글이 root cause 를 다뤘다면, [다음 글](/posts/078/)은 같은 incident 가 왜 8개 leak 경고처럼 보였는지 다룬다. 분산된 stack trace 를 원인 목록으로 착각하지 않는 방법이다.

## References

- MySQL Reference Manual: [Optimizer Cost Constants](https://dev.mysql.com/doc/refman/8.0/en/cost-model.html)
- MySQL Reference Manual: [InnoDB and MyISAM Index Statistics Collection](https://dev.mysql.com/doc/refman/8.4/en/index-statistics.html)
- MySQL Reference Manual: [ANALYZE TABLE Statement](https://dev.mysql.com/doc/refman/8.0/en/analyze-table.html)
- HikariCP: [leakDetectionThreshold](https://github.com/brettwooldridge/HikariCP#frequently-used)
- `EXPLAIN FORMAT=JSON` 으로 옵티마이저 선택의 비용 추정치를 직접 들여다보기
