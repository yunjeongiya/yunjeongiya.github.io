---
layout: post
title: "JPA @Index ≠ prod DB index — Entity-DB drift 의 5가지 패턴"
date: 2026-05-12 14:30:00 +0900
categories: [Database, Architecture]
tags: [jpa, hibernate, mysql, schema, drift]
lang: ko
slug: "081"
thumbnail: /assets/images/posts/081-entity-db-drift/thumbnail-ko.jpg
image: /assets/images/posts/081-entity-db-drift/thumbnail-ko.jpg
published: true
---

> 5/4 DB incident 시리즈
>
> 1. [cardinality=1 단일컬럼 인덱스가 새 compound index를 무력화한다](/posts/077/)
> 2. [DB 풀 고갈 cascade: leak 출처 분산에 속지 말 것](/posts/078/)
> 3. [잠복 슬로우 쿼리 incident: "왜 하필 오늘?"의 답을 짚을 수 없는 이유](/posts/079/)
> 4. [anti-pattern 124곳 발견, DROP은 19개 — 나머지를 그대로 둔 이유](/posts/080/)
> 5. **JPA @Index ≠ prod DB index — Entity-DB drift 의 5가지 패턴**

![설계도와 prod DB가 어긋난다](/assets/images/posts/081-entity-db-drift/thumbnail-ko.jpg){: width="700"}

## 도입

JPA 프로젝트에서 `@Index` 어노테이션은 schema source of truth 로 작동한다 — 라는 게 일반적인 멘탈 모델이다. Hibernate `ddl-auto: update` 모드가 entity 선언을 따라 자동으로 인덱스를 만들고, prod 는 `validate` 모드로 주요 테이블/컬럼 불일치를 확인한다고 믿기 쉽기 때문이다.

그래서 코드 리뷰에서 `@Index` 만 보면 인덱스 상태를 알 수 있다고 생각하기 쉽다. 하지만 다년간 누적된 prod DB 와 entity 를 cross-check 해보면 그 가정이 무너진다.

이 글은 cleanup 과정에서 발견한 Entity-DB drift 의 5가지 패턴과 발견 방법을 정리한다.

## 배경 / 문제

cleanup 시작 전 sanity check: entity 에 선언된 `@Index` 목록 vs `information_schema.STATISTICS` 실제 DB 상태 cross-join.

```sql
SELECT TABLE_NAME, INDEX_NAME,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ? AND INDEX_NAME != 'PRIMARY'
GROUP BY TABLE_NAME, INDEX_NAME;
```

```bash
grep -rE '@Index\(name = "([^"]+)"' src/main/java \
  | sed -E 's/.*name = "([^"]+)".*/\1/' | sort -u
```

두 집합을 set difference 로 비교했더니 5가지 drift 패턴이 발견됐다.

![Entity-DB drift diagram](/assets/images/posts/081-entity-db-drift/entity-db-drift-diagram.svg){: width="700"}

## 5가지 drift 패턴

### 1. Entity 제거 / DB 잔존 (rename 후 orphan)

entity 에서 옛 인덱스 이름을 새 이름으로 rename 한 경우, Hibernate `update` 모드는 **새 인덱스만 추가하고 옛 인덱스는 안 지운다.** 결과적으로 DB 에 양쪽 다 남는다.

발견 케이스:
- entity declares: `idx_task_status (status)`
- DB has: `idx_task_status (status)` AND `idx_status (status)`

→ `idx_status` 는 이름만 다른 완전 중복. orphan.

다년간 누적되면 schema 변경 history 가 prod DB 인덱스 이름에 fossil 처럼 남는다. 어떤 인덱스가 현재 코드의 source 인지, 어떤 게 옛 잔재인지 구분하려면 entity grep 으로 cross-check 가 필수.

### 2. `@Column unique=true` + `@Index unique=true` 동일 컬럼 (double UNIQUE)

같은 컬럼에 두 가지 mechanism 으로 UNIQUE 선언:

```java
@Column(name = "dedup_key", nullable = false, unique = true, length = 200)
private String dedupKey;

@Table(indexes = {
    @Index(name = "idx_qn_dedup_key", columnList = "dedup_key", unique = true)
})
```

우리 환경에서는 prod 에 UNIQUE 인덱스가 2개 생성됐다:
- `dedup_key` (from `@Column unique=true`)
- `idx_qn_dedup_key` (from `@Index unique=true`)

같은 컬럼, 같은 UNIQUE 제약. 실제 제약 의미는 중복이라 둘 중 하나를 정리할 수 있다. 그런데:
- 어느 쪽이 "원본" 인지 코드만 보면 헷갈림
- 코드 리뷰에서 redundancy 가 안 보임 (`@Column` 과 `@Index` 가 떨어져 있어서)
- 둘 중 하나 DROP 했을 때 dev 재시작에서 Hibernate 가 다시 만드는지 안 만드는지 예측 어려움

해결: `@Index` 만 사용하거나 `@Column unique=true` 만 사용. **둘 다 쓰지 않기**. 컨벤션 선택은 프로젝트마다 다르지만, 한 가지로 통일해야 drift 안 쌓인다.

### 3. 핫픽스로 prod 직접 추가 + entity 미반영

incident 사후 긴급 fix 로 prod DB 에 인덱스를 직접 추가한 후 entity 동기화 누락:

```sql
-- 핫픽스 (prod 직접 실행)
ALTER TABLE catalog DROP INDEX idx_leaf_flag;
ALTER TABLE catalog
  ADD INDEX idx_catalog_group_leaf_enabled
  (group_id, leaf_flag, enabled, parent_id, order_index, id, name);
```

entity 는 옛 `@Index(idx_leaf_flag)` 만 남고 새 compound 는 미선언.

영향:
- **prod**: entity validate 통과 (적어도 이 인덱스 drift 는 잡지 못함)
- **dev**: `ddl-auto: update` 가 entity 기준으로 인덱스 생성 → `idx_leaf_flag` 를 다시 만들지만 새 compound 는 안 만듦
- → dev-prod 인덱스 불일치 → dev EXPLAIN 결과가 prod 와 다름

이 drift 는 **dev 에서 testing 안 됨** 위험 신호. 다음 incident 분석 시 EXPLAIN 이 prod 와 달라 가설 추적 시간 낭비.

해결: 핫픽스 직후 entity 동기화 commit 별도로 만들기. PR 에 "ALTER 실행 완료 + entity sync" 둘 다 포함. incident postmortem checklist 에 항목 추가.

### 4. 이름과 컬럼 불일치 (rename leftover)

이름은 `idx_user_*` 인데 컬럼은 (occurred_at, status) 인 인덱스 발견:

```text
INDEX_NAME: idx_user_event_status
COLUMNS:    occurred_at, status      ← user_id 없음
```

이름의 `user_*` 접두사는 옛 schema 에서 user_id 가 leading column 이던 시절의 흔적. 누군가 entity refactor 후 컬럼 순서를 바꿨지만 인덱스 이름은 그대로 두고 떠난 상태.

이런 인덱스의 문제:
- 발견 어려움 — 이름만 보면 user 쿼리에 쓰일 것처럼 보임
- 옵티마이저는 컬럼만 보지 이름은 안 봄 → 실 사용 패턴은 이름과 무관
- 코드 리뷰에서 misleading

해결: 이름 변경 (`idx_event_occurred_status`) 으로 컬럼 의미 정확히 반영. 또는 entity refactor 시 인덱스도 같이 rename 하는 습관.

### 5. FK 보호 orphan (entity 미선언, FK 의존)

FK 제약 컬럼에 leading prefix 인덱스가 필요한데, entity 에 그 인덱스 `@Index` 선언이 없는 경우.

발견 케이스:
- DB: `idx_org_date (org_id)` 존재
- entity: `@Index` 선언 0개에 org_id-leading 없음
- FK: `fk_op_tasks_org (org_id → org.id)` 존재 → `idx_org_date` 가 leading prefix 로 FK 보호 중

이 인덱스를 DROP 하려고 하면 MySQL 이 거부 (ERROR 1553).

위험 시나리오:
- entity 만 보면 "FK 인덱스 미선언" 같지만 실제로는 DB orphan 인덱스가 그 역할
- 누군가 "entity 에 이 인덱스 없네, 정리하자" 라며 DROP 시도하면 명시적 ERROR 를 만남
- 다른 FK-leading 인덱스를 먼저 만들지 않고는 안전하게 교체할 수 없음

해결: FK 보호 인덱스를 entity `@Index` 에 명시 추가. **source-of-truth 일관성 확보**. ddl 모드 무관하게 코드만 봐도 FK 인덱스 존재 이유가 명확해진다.

## 검증 방법 — Entity-DB cross-check audit

cleanup 작업 전 자동 audit 절차:

1. **모든 prod 인덱스 dump**

```sql
SELECT TABLE_NAME, INDEX_NAME,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ? AND INDEX_NAME != 'PRIMARY'
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;
```

2. **entity @Index 추출**

```bash
grep -rE '@Index\(name = "([^"]+)"' src/main/java \
  | sed -E 's/.*name = "([^"]+)".*/\1/' | sort -u
```

3. **Set difference 분석**
- entity 에만 있음 (DB 에 안 만들어짐) → 길이 제약 / 컬럼 type 비호환 등 Hibernate 가 못 만든 케이스
- DB 에만 있음 (entity 미선언) → 5가지 drift 패턴 후보

수동 audit 이지만 한 번 돌리면 패턴 1, 4, 5 는 즉시 발견된다. 패턴 2, 3 은 prod 직접 비교가 필요 (`@Column unique=true` 검사, hotfix 이력과 대조).

## 결과

cleanup 과정에서 5가지 패턴 모두 발견:

| 패턴 | 발견 건수 | 조치 |
|---|---|---|
| 1. Rename orphan | 4건 | DROP (실 쿼리 0건 확인) |
| 2. Double UNIQUE | 1건 | 중복 UNIQUE 한 쪽 DROP |
| 3. Hotfix unsync | 2건 | entity sync commit |
| 4. 이름 불일치 | 2건 | DROP (실 쿼리 0건 확인) |
| 5. FK orphan | 2건 | entity `@Index` 추가 |

cleanup 후 schema dump (`mysqldump --no-data`) 를 docs repo 의 `schema.sql` 에 commit 해서 다음 분석 시 baseline 확보.

![Five Entity-DB drift patterns](/assets/images/posts/081-entity-db-drift/drift-pattern-matrix.svg){: width="700"}

## 배운 점

### Entity = source of truth 가정의 한계

`ddl-auto: update` 는 운영 schema 관리 도구로 쓰기에는 한계가 크다. Hibernate 문서도 production 에서는 incremental migration script 로 schema 를 관리하는 편이 더 유연하다고 설명한다. entity 가 source of truth 로 작동하려면 (1) 새 인덱스 추가만 발생하거나 (2) DROP 시 수동 ALTER + entity 양쪽 다 갱신해야 한다. 실제로는 2번 누락이 자주 발생 → drift 누적.

### 핫픽스 직후 sync commit 이 가장 중요

incident 직후 prod 에 ALTER 친 직후 30분 안에 entity sync commit 을 만드는 게 drift 방지의 핵심. 시간 지나면 잊혀진다. **incident 마무리 checklist 에 "entity sync" 항목** 을 명시 추가하는 게 가장 작은 비용으로 가장 큰 효과.

### Cross-check audit 은 분기마다

5가지 drift 패턴은 어느 정도 시간이 지나면 누적된다. 분기마다 entity vs DB cross-check 한 번 돌리는 게 좋다 (자동화 X 해도 1시간이면 도는 수동 audit). incident 사후가 아니라 평시에 발견해야 비용 0.

### 인덱스 이름은 의미 보존 책임이 있다

`idx_user_*` 같은 도메인 접두사 이름은 일종의 contract — 그 도메인 쿼리에 쓰이는 인덱스로 읽힘. refactor 시 이름을 안 바꾸면 후임 개발자가 misleading 당한다. **인덱스 rename 은 컬럼 변경과 한 commit 에** 가 좋은 습관.

### `@Column unique=true` 와 `@Index unique=true` 둘 다 쓰지 말 것

두 mechanism 이 동일 컬럼에 같이 쓰이면 provider/dialect 조합에 따라 중복 UNIQUE 가 생길 수 있다. 컨벤션 하나를 정해서 (`@Table` 의 `uniqueConstraints`/`indexes` 로 모으거나, 단순 컬럼 unique 만 쓰거나) 일관 적용한다.

## 시리즈를 마치며

이 incident 의 핵심은 인덱스 하나였지만, 실제 재발 방지는 훨씬 넓었다. 실행 계획을 고치고, cascade 신호를 해석하고, "왜 오늘"이라는 질문을 다루고, audit 후보를 분류하고, 마지막으로 entity 와 prod DB 의 source-of-truth 를 맞춰야 했다. 장애 하나를 닫는다는 건 root cause 하나를 지우는 일이 아니라, 다음 분석이 덜 흐려지도록 시스템의 기억을 정리하는 일이다.

## References

- Hibernate User Guide: [hbm2ddl.auto](https://docs.jboss.org/hibernate/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#configurations-hbm2ddl)
- Jakarta Persistence API: [`@Table.indexes`](https://jakarta.ee/specifications/persistence/4.0/apidocs/jakarta.persistence/jakarta/persistence/table)
- Jakarta Persistence API: [`@Index`](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/index)
- MySQL Reference Manual: [information_schema.STATISTICS](https://dev.mysql.com/doc/refman/8.0/en/information-schema-statistics-table.html)
- MySQL Reference Manual: [FOREIGN KEY Constraints — Indexing](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html)
- 이전 글: [cardinality=1 단일컬럼 인덱스가 새 compound index 를 무력화한다](/posts/077/)
- 이전 글: [anti-pattern 124곳 발견, DROP 은 19개](/posts/080/)
