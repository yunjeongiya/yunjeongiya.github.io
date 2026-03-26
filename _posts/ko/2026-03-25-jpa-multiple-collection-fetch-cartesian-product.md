---
layout: post
title: "JPA에서 여러 컬렉션을 JOIN FETCH하면 안 되는 이유 — Cartesian Product 버그 실전 사례"
date: 2026-03-25 09:00:00 +0900
categories: [Backend, Spring Boot]
tags: [JPA, Hibernate, JOIN FETCH, Cartesian Product, BatchSize, Spring Boot, 버그픽스]
lang: ko
slug: "042"
thumbnail: /assets/images/posts/042-jpa-cartesian-product-bug/thumb-ko.png
---

> **이전 글**: [청구서 금액이 2배로 나왔다 — 데이터베이스가 곱셈을 해버린 이야기](/posts/043/)에서 "두 장의 엑셀 시트를 동시에 합치면 곱셈이 일어난다"는 비유로 이 버그를 설명했다. 이번 글에서는 JPA/Hibernate 관점에서 정확히 왜 이런 일이 생기는지, `DISTINCT`로는 왜 안 되는지, 올바른 해결법은 무엇인지를 다룬다.

증상을 요약하면: DB에는 주문 항목이 2개뿐인데 API 응답에서 4개로 뻥튀기됐다. 원인은 하나의 JPQL 쿼리에서 **두 개의 `@OneToMany` 컬렉션을 동시에 `JOIN FETCH`**한 것이다.

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
SELECT o.*, oli.*, oad.*
FROM orders o
LEFT JOIN order_line_item oli ON oli.order_id = o.id
LEFT JOIN order_applied_discount oad ON oad.order_id = o.id
WHERE ...
```

Order 369에 lineItem 2개, appliedDiscount 2개가 있으면:

![Cartesian Product SQL 결과](/assets/images/posts/042-jpa-cartesian-product-bug/table-cartesian-product.png)

**2 × 2 = 4행.** 이것이 cartesian product다.

### Hibernate의 컬렉션 처리 방식

Hibernate는 이 4행을 엔티티로 변환할 때:
- **`Set` (appliedDiscounts)**: `equals`/`hashCode` 기반으로 자동 중복 제거 → 2개 (정상)
- **`List` (lineItems)**: bag semantics — **중복 제거하지 않음** → 4개 (oli.id 385, 385, 386, 386)

`List`는 순서가 있는 컬렉션이고, Hibernate는 SQL 결과의 각 행을 List에 그대로 추가한다. 같은 엔티티가 여러 행에 걸쳐 나타나면, 같은 객체가 List에 여러 번 들어간다.

"그럼 `List` 대신 `Set`으로 바꾸면 되지 않나?" 주문 항목은 **입력 순서대로 표시**해야 한다. `Set`은 순서를 보장하지 않기 때문에 `List`를 쓸 수밖에 없었다. 올바른 자료구조 선택이 cartesian product와 만나면서 예상치 못한 버그가 된 것이다.

### MultipleBagFetchException은 왜 안 터졌나?

Hibernate 5 이전 버전이었다면, 두 개의 `List` 컬렉션을 동시에 FETCH할 때 `MultipleBagFetchException`을 던지며 서버가 시작되지 않았을 것이다. 하지만 이 코드에서는 하나가 `List`, 다른 하나가 `Set`이기 때문에 예외 없이 통과한다. 에러 없이 데이터만 뻥튀기되므로 오히려 더 위험하다.

## `DISTINCT`로는 해결되지 않는다

첫 번째 시도로 `SELECT DISTINCT`를 추가해봤다:

```java
@Query("SELECT DISTINCT o FROM Order o " +
       "LEFT JOIN FETCH o.lineItems " +
       "LEFT JOIN FETCH o.appliedDiscounts " + ...)
```

**효과 없음.** 이유:

Hibernate 6에서 JPQL `DISTINCT`는 **root entity(Order)의 중복**을 제거한다. 결과 리스트에 같은 Order 객체가 여러 번 나타나는 것을 방지하는 것이다.

하지만 **Order 내부의 lineItems `List` 중복**은 건드리지 않는다. Order 369는 결과에 1번만 나타나지만, 그 Order의 lineItems는 이미 4개가 채워진 상태다.

## 해결: 컬렉션 FETCH 분리

**근본 원칙: 하나의 쿼리에서 여러 `@OneToMany` 컬렉션을 JOIN FETCH하지 않는다.**

### 적용한 해결법: `@BatchSize`

```java
// Order.java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
@BatchSize(size = 50)  // 별도 IN 쿼리로 배치 로딩
private Set<OrderAppliedDiscount> appliedDiscounts = new LinkedHashSet<>();
```

```java
// OrderRepository.java — appliedDiscounts JOIN FETCH 제거
@Query("SELECT DISTINCT o FROM Order o " +
       "LEFT JOIN FETCH o.lineItems " +
       // LEFT JOIN FETCH o.appliedDiscounts — 제거!
       "JOIN FETCH o.customer c " +
       "WHERE o.billingYear = :year AND o.billingMonth = :month ...")
List<Order> findAllByMonth(...);
```

이제 실행 흐름:
1. **쿼리 1**: Order + lineItems JOIN FETCH → lineItem 수만큼 행 (중복 없음)
2. **쿼리 2** (자동): `SELECT * FROM order_applied_discount WHERE order_id IN (?, ?, ..., ?)` → 최대 50개씩 배치

쿼리가 1개에서 2개로 늘었지만, cartesian product가 사라져 **정확한 데이터**가 반환된다.

매번 엔티티마다 `@BatchSize`를 붙이기 번거롭다면, `application.yml`에서 프로젝트 전체에 기본값을 설정할 수도 있다:

```yaml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
```

### 대안들

![대안 비교](/assets/images/posts/042-jpa-cartesian-product-bug/table-alternatives.png)

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
