---
layout: post
title: "JPA에서 여러 컬렉션을 JOIN FETCH하면 안 되는 이유 — Cartesian Product 버그 실전 사례"
date: 2026-03-25 09:00:00 +0900
categories: [Backend, Spring Boot]
tags: [JPA, Hibernate, JOIN FETCH, Cartesian Product, BatchSize, Spring Boot, 버그픽스]
lang: ko
slug: "042"
thumbnail: /assets/images/posts/042-jpa-cartesian-product-bug/invoice-detail-duplicated.png
---

Spring Boot + JPA 프로젝트에서 청구서 목록 조회 시 **항목이 2배, 3배로 뻥튀기되는 버그**를 만났다. DB 데이터는 정상인데 API 응답에서만 중복이 발생하는, 디버깅하기 까다로운 유형의 버그였다.

원인은 하나의 JPQL 쿼리에서 **두 개의 `@OneToMany` 컬렉션을 동시에 `JOIN FETCH`**한 것이었다. 이 글에서는 문제의 원인, 왜 `DISTINCT`로도 해결되지 않는지, 그리고 올바른 해결법을 정리한다.

## 증상: "데이터는 맞는데 화면이 이상해요"

학원 관리 시스템에서 4월 청구서를 생성한 후, 목록에서 이상한 점이 발견됐다.

![청구서 목록 — 반 이름이 2번씩 표시되고, 금액이 2배](/assets/images/posts/042-jpa-cartesian-product-bug/invoice-list-duplicated.png)

모든 학생의 반 이름이 2번씩 반복되고, 금액도 정확히 2배였다. 상세 화면을 열어보면 더 명확했다:

![청구서 상세 — 같은 반이 2개씩 표시됨](/assets/images/posts/042-jpa-cartesian-product-bug/invoice-detail-duplicated.png)

- 고3 A반 ₩520,000 × **2개**
- 미적분 판서 ₩250,000 × **2개**
- 청구 금액: ₩1,460,000 (뻥튀기된 금액)

그런데 흥미로운 단서가 하나 있었다:

![결제 링크 금액은 정상 (₩690,000)](/assets/images/posts/042-jpa-cartesian-product-bug/invoice-detail-billlink-correct.png)

**결제 링크 금액은 ₩690,000으로 정상**이었다. 이건 DB에 저장된 실제 값이다.

## 디버깅 과정

### 1단계: DB 데이터 확인

DB를 직접 조회했다.

```sql
SELECT ili.id, ili.class_name, ili.base_tuition
FROM invoice_line_item ili
WHERE ili.invoice_id = 369;
```

| id  | class_name   | base_tuition |
|-----|-------------|-------------|
| 385 | 고3 A반      | 520,000     |
| 386 | 미적분 판서    | 250,000     |

**2개뿐이다.** DB에는 중복이 없다.

### 2단계: 프론트엔드 확인

React 컴포넌트를 확인했다. 단순히 `invoice.lineItems.map()`으로 렌더링하고 있었다. 프론트엔드 문제가 아니다.

### 3단계: API 응답이 문제

DB → API 응답 사이에서 중복이 발생한다는 뜻이다. JPA 쿼리를 확인했다.

## 원인: 두 컬렉션의 Cartesian Product

문제의 쿼리:

```java
@Query("SELECT i FROM Invoice i " +
       "LEFT JOIN FETCH i.lineItems " +        // @OneToMany List
       "LEFT JOIN FETCH i.appliedDiscounts " +  // @OneToMany Set
       "JOIN FETCH i.studentProfile sp " +
       "JOIN FETCH sp.user u " +
       "WHERE i.campus.id = :campusId " +
       "AND i.billingYear = :year AND i.billingMonth = :month " +
       "ORDER BY u.name")
List<Invoice> findAllByCampusAndMonth(...);
```

`lineItems`(`List`)와 `appliedDiscounts`(`Set`)를 **동시에 JOIN FETCH**하고 있다.

### SQL 실행 결과

이 JPQL이 실제로 생성하는 SQL을 보면:

```sql
SELECT i.*, ili.*, iad.*
FROM invoice i
LEFT JOIN invoice_line_item ili ON ili.invoice_id = i.id
LEFT JOIN invoice_applied_discount iad ON iad.invoice_id = i.id
WHERE ...
```

Invoice 369에 lineItem 2개, appliedDiscount 2개가 있으면:

| i.id | ili.id | ili.class_name | iad.id | iad.policy_name |
|------|--------|---------------|--------|----------------|
| 369  | 385    | 고3 A반        | 2      | 기존 재원생 할인  |
| 369  | 385    | 고3 A반        | 3      | 중복수강할인      |
| 369  | **386**| **미적분 판서**  | 2      | 기존 재원생 할인  |
| 369  | **386**| **미적분 판서**  | 3      | 중복수강할인      |

**2 × 2 = 4행.** 이것이 cartesian product다.

### Hibernate의 컬렉션 처리 방식

Hibernate는 이 4행을 엔티티로 변환할 때:
- **`Set` (appliedDiscounts)**: `equals`/`hashCode` 기반으로 자동 중복 제거 → 2개 (정상)
- **`List` (lineItems)**: bag semantics — **중복 제거하지 않음** → 4개 (ili.id 385, 385, 386, 386)

`List`는 순서가 있는 컬렉션이고, Hibernate는 SQL 결과의 각 행을 List에 그대로 추가한다. 같은 엔티티가 여러 행에 걸쳐 나타나면, 같은 객체가 List에 여러 번 들어간다.

## `DISTINCT`로는 해결되지 않는다

첫 번째 시도로 `SELECT DISTINCT`를 추가해봤다:

```java
@Query("SELECT DISTINCT i FROM Invoice i " +
       "LEFT JOIN FETCH i.lineItems " +
       "LEFT JOIN FETCH i.appliedDiscounts " + ...)
```

**효과 없음.** 이유:

Hibernate 6에서 JPQL `DISTINCT`는 **root entity(Invoice)의 중복**을 제거한다. 결과 리스트에 같은 Invoice 객체가 여러 번 나타나는 것을 방지하는 것이다.

하지만 **Invoice 내부의 lineItems `List` 중복**은 건드리지 않는다. Invoice 369는 결과에 1번만 나타나지만, 그 Invoice의 lineItems는 이미 4개가 채워진 상태다.

## 해결: 컬렉션 FETCH 분리

**근본 원칙: 하나의 쿼리에서 여러 `@OneToMany` 컬렉션을 JOIN FETCH하지 않는다.**

### 적용한 해결법: `@BatchSize`

```java
// Invoice.java
@OneToMany(mappedBy = "invoice", cascade = CascadeType.ALL, orphanRemoval = true)
@BatchSize(size = 50)  // 별도 IN 쿼리로 배치 로딩
private Set<InvoiceAppliedDiscount> appliedDiscounts = new LinkedHashSet<>();
```

```java
// InvoiceRepository.java — appliedDiscounts JOIN FETCH 제거
@Query("SELECT DISTINCT i FROM Invoice i " +
       "LEFT JOIN FETCH i.lineItems " +
       // LEFT JOIN FETCH i.appliedDiscounts — 제거!
       "JOIN FETCH i.studentProfile sp " +
       "JOIN FETCH sp.user u " +
       "WHERE i.campus.id = :campusId ...")
List<Invoice> findAllByCampusAndMonth(...);
```

이제 실행 흐름:
1. **쿼리 1**: Invoice + lineItems JOIN FETCH → lineItem 수만큼 행 (중복 없음)
2. **쿼리 2** (자동): `SELECT * FROM invoice_applied_discount WHERE invoice_id IN (?, ?, ..., ?)` → 최대 50개씩 배치

쿼리가 1개에서 2개로 늘었지만, cartesian product가 사라져 **정확한 데이터**가 반환된다.

### 대안들

| 방법 | 장점 | 단점 |
|------|------|------|
| **`@BatchSize`** (채택) | 기존 코드 변경 최소, N+1 방지 | 쿼리 1개 추가 |
| `List` → `Set` 전환 | cartesian product 자체 해결 | equals/hashCode 구현 필요, 순서 보장 안 됨 |
| `@Fetch(SUBSELECT)` | N+1 완전 방지 | 전역 설정이라 세밀 제어 어려움 |
| 쿼리 분리 (2개 쿼리) | 가장 명시적 | 서비스 계층 코드 복잡도 증가 |

## 핵심 정리

```
하나의 쿼리에서 여러 @OneToMany 컬렉션을 JOIN FETCH하면
SQL Cartesian Product → List(bag) 컬렉션 중복 → 데이터 뻥튀기
```

- **DB는 정상, API만 이상** → JPA 쿼리의 컬렉션 FETCH 확인
- **`DISTINCT`는 root entity 중복만 제거**, List 내부 중복은 해결 못 함
- **`Set`은 자동 중복 제거**, `List`(bag)는 안 됨
- **해결**: 한 쿼리에 하나의 컬렉션만 FETCH + 나머지는 `@BatchSize`

## 참고

- [Hibernate User Guide — Fetching](https://docs.jboss.org/hibernate/orm/6.4/userguide/html_single/Hibernate_User_Guide.html#fetching)
- [Vlad Mihalcea — MultipleBagFetchException](https://vladmihalcea.com/hibernate-multiplebagfetchexception/)
- [Baeldung — JPA and Hibernate FetchType](https://www.baeldung.com/hibernate-fetchtype-eager-lazy)
