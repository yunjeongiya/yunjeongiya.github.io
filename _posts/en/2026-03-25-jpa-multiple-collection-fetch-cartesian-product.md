---
layout: post
title: "Why You Should Never JOIN FETCH Multiple Collections in JPA — A Cartesian Product Bug in Practice"
date: 2026-03-25 09:00:00 +0900
categories: [Backend, Spring Boot]
tags: [JPA, Hibernate, JOIN FETCH, Cartesian Product, BatchSize, Spring Boot, bugfix]
lang: en
slug: "042-en"
thumbnail: /assets/images/posts/042-jpa-cartesian-product-bug/thumb-en.png
---

In a Spring Boot + JPA project, I encountered a bug where **order line items were duplicated 2x or 3x** in the API response. The DB data was perfectly fine — the duplication only appeared in the API layer. A tricky one to debug.

The root cause: **two `@OneToMany` collections were `JOIN FETCH`ed in a single JPQL query**. This post covers why it happens, why `DISTINCT` doesn't fix it, and the proper solution.

## Symptoms: "The data is correct, but the UI is wrong"

After generating April orders in a SaaS subscription management system, something was off in the list view:

![Order list — product names duplicated, amounts doubled](/assets/images/posts/042-jpa-cartesian-product-bug/mock-list-duplicated-en.png)

Every customer's product names appeared twice, and amounts were exactly doubled. The detail view made it even clearer:

![Order detail — same products listed twice](/assets/images/posts/042-jpa-cartesian-product-bug/mock-detail-duplicated-en.png)

- Premium Plan $52.00 × **2**
- Cloud Storage $25.00 × **2**
- Total: $146.00 (inflated)

But here's the interesting clue:

![Payment link shows correct amount ($69.00)](/assets/images/posts/042-jpa-cartesian-product-bug/mock-detail-billlink-en.png)

**The payment link showed $69.00 — the correct amount.** This value was stored directly in the DB.

## Debugging

### Step 1: Check the DB

Queried the database directly.

```sql
SELECT oli.id, oli.product_name, oli.price
FROM order_line_item oli
WHERE oli.order_id = 369;
```

![DB query result](/assets/images/posts/042-jpa-cartesian-product-bug/table-db-result-en.png)

**Only 2 rows.** No duplicates in the DB.

### Step 2: Check the frontend

The React component was simply doing `order.lineItems.map()`. It renders whatever data it receives. Not the culprit.

### Step 3: The API response is the problem

Duplication happens between DB and API response. Time to check the JPA query.

## Root Cause: Cartesian Product from Two Collections

The problematic query:

```java
@Query("SELECT o FROM Order o " +
       "LEFT JOIN FETCH o.lineItems " +        // @OneToMany List
       "LEFT JOIN FETCH o.appliedDiscounts " +  // @OneToMany Set
       "JOIN FETCH o.customer c " +
       "WHERE o.billingYear = :year AND o.billingMonth = :month " +
       "ORDER BY c.name")
List<Order> findAllByMonth(...);
```

`lineItems` (`List`) and `appliedDiscounts` (`Set`) are **JOIN FETCHed simultaneously**.

### The SQL Result

The generated SQL looks like:

```sql
SELECT o.*, oli.*, oad.*
FROM orders o
LEFT JOIN order_line_item oli ON oli.order_id = o.id
LEFT JOIN order_applied_discount oad ON oad.order_id = o.id
WHERE ...
```

With 2 lineItems and 2 appliedDiscounts for Order 369:

![Cartesian Product SQL result](/assets/images/posts/042-jpa-cartesian-product-bug/table-cartesian-product-en.png)

**2 × 2 = 4 rows.** This is a cartesian product.

### How Hibernate Handles the Collections

When Hibernate maps these 4 rows back to entities:
- **`Set` (appliedDiscounts)**: Auto-deduplicates via `equals`/`hashCode` → 2 entries (correct)
- **`List` (lineItems)**: Bag semantics — **no deduplication** → 4 entries (oli.id 385, 385, 386, 386)

`List` is an ordered collection. Hibernate adds each SQL row's line item to the List as-is. When the same entity appears in multiple rows, the same object gets added multiple times.

## `DISTINCT` Doesn't Fix It

First attempt — add `SELECT DISTINCT`:

```java
@Query("SELECT DISTINCT o FROM Order o " +
       "LEFT JOIN FETCH o.lineItems " +
       "LEFT JOIN FETCH o.appliedDiscounts " + ...)
```

**No effect.** Here's why:

In Hibernate 6, JPQL `DISTINCT` deduplicates the **root entity (Order)** in the result list. It prevents the same Order object from appearing multiple times.

But it doesn't touch the **lineItems `List` inside each Order**. Order 369 appears once in the result, but its lineItems collection already has 4 entries.

## Solution: Separate the Collection Fetches

**Core principle: Never JOIN FETCH multiple `@OneToMany` collections in a single query.**

### The Fix: `@BatchSize`

```java
// Order.java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
@BatchSize(size = 50)  // Loaded via separate IN query
private Set<OrderAppliedDiscount> appliedDiscounts = new LinkedHashSet<>();
```

```java
// OrderRepository.java — removed appliedDiscounts JOIN FETCH
@Query("SELECT DISTINCT o FROM Order o " +
       "LEFT JOIN FETCH o.lineItems " +
       // LEFT JOIN FETCH o.appliedDiscounts — removed!
       "JOIN FETCH o.customer c " +
       "WHERE o.billingYear = :year AND o.billingMonth = :month ...")
List<Order> findAllByMonth(...);
```

Now the execution flow:
1. **Query 1**: Order + lineItems JOIN FETCH → rows = number of lineItems (no duplication)
2. **Query 2** (automatic): `SELECT * FROM order_applied_discount WHERE order_id IN (?, ?, ..., ?)` → batches of 50

One query became two, but the cartesian product is eliminated and **data is accurate**.

### Alternatives

![Comparison of approaches](/assets/images/posts/042-jpa-cartesian-product-bug/table-alternatives-en.png)

## Key Takeaways

```
JOIN FETCHing multiple @OneToMany collections in one query
→ SQL Cartesian Product → List(bag) duplication → inflated data
```

- **DB is fine, API is wrong** → Check JPA collection fetch strategy
- **`DISTINCT` only deduplicates root entities**, not List contents
- **`Set` auto-deduplicates**, `List` (bag) does not
- **Fix**: Fetch one collection per query + `@BatchSize` for the rest

## References

- [Hibernate User Guide — Fetching](https://docs.jboss.org/hibernate/orm/6.4/userguide/html_single/Hibernate_User_Guide.html#fetching)
- [Vlad Mihalcea — MultipleBagFetchException](https://vladmihalcea.com/hibernate-multiplebagfetchexception/)
- [Baeldung — JPA and Hibernate FetchType](https://www.baeldung.com/hibernate-fetchtype-eager-lazy)
