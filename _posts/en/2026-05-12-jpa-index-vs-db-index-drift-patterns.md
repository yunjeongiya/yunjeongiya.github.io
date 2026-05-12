---
layout: post
title: "JPA @Index is not prod DB index — 5 Entity-DB drift patterns"
date: 2026-05-12 14:30:00 +0900
categories: [Database, Architecture]
tags: [jpa, hibernate, mysql, schema, drift]
lang: en
slug: "081-en"
thumbnail: /assets/images/posts/081-entity-db-drift/thumbnail-en.jpg
image: /assets/images/posts/081-entity-db-drift/thumbnail-en.jpg
published: true
---

> 5/4 DB incident series
>
> 1. [When a cardinality=1 single-column index beats the compound index](/posts/077-en/)
> 2. [DB pool exhaustion cascade: do not mistake victim traces for causes](/posts/078-en/)
> 3. [Latent slow query incident: why "why today?" may have no clean answer](/posts/079-en/)
> 4. [124 index anti-patterns found, 19 dropped — why the rest stayed](/posts/080-en/)
> 5. **JPA @Index is not prod DB index — 5 Entity-DB drift patterns**

![blueprint and prod DB drift apart](/assets/images/posts/081-entity-db-drift/thumbnail-en.jpg){: width="700"}

## Introduction

In a JPA project, it is easy to treat `@Index` as the schema source of truth. Entities define indexes, Hibernate can update schema, and production often runs validation.

But after years of production changes, direct hotfixes, renames, and manual cleanup, the entity model and the real database can drift apart.

## Cross-check

We compared entity-declared indexes with actual production indexes from `information_schema.STATISTICS`.

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

![Entity-DB drift diagram](/assets/images/posts/081-entity-db-drift/entity-db-drift-diagram.svg){: width="700"}

## Five Drift Patterns

### 1. Rename orphan

An index was renamed in the entity, but the old database index remained. Hibernate update behavior can add the new object without removing the old one.

### 2. Double UNIQUE

The same column was declared unique through two mechanisms:

```java
@Column(name = "dedup_key", nullable = false, unique = true, length = 200)
private String dedupKey;

@Table(indexes = {
    @Index(name = "idx_qn_dedup_key", columnList = "dedup_key", unique = true)
})
```

In our environment, production ended up with two unique indexes representing the same constraint.

### 3. Hotfix unsynced

During an incident, an index was added directly in prod, but the entity annotation was not updated.

Impact:

- prod worked
- dev regenerated the old index
- prod and dev `EXPLAIN` diverged

### 4. Name-column mismatch

The index name suggested one access pattern, but the columns represented another:

```text
INDEX_NAME: idx_user_event_status
COLUMNS:    occurred_at, status
```

The optimizer does not care about the name, but humans do. Misleading names mislead reviews.

### 5. FK protection orphan

The DB had an FK-protection index that was not declared in the entity. Dropping it failed with an FK constraint error. The fix was not to delete it, but to document it in the entity as an intentional index.

## Result

| Pattern | Count | Action |
|---|---|---|
| Rename orphan | 4 | drop after confirming zero usage |
| Double UNIQUE | 1 | drop one duplicate |
| Hotfix unsynced | 2 | entity sync commit |
| Name mismatch | 2 | drop or rename |
| FK orphan | 2 | add entity `@Index` |

![Five Entity-DB drift patterns](/assets/images/posts/081-entity-db-drift/drift-pattern-matrix.svg){: width="700"}

## Lessons

### Entity as source of truth has limits

Hibernate documentation itself recommends incremental migration scripts for production flexibility. If manual ALTER and entity annotations do not move together, drift accumulates.

### Sync immediately after hotfixes

The best time to create the entity sync commit is within 30 minutes of the production ALTER. After that, the schema change becomes tribal memory.

### Run cross-check audits quarterly

This audit is simple and catches the patterns that code review cannot see.

### Index names carry meaning

An index name is a human contract. Rename it when the leading columns change.

## Series close

The incident started as one bad index choice, but real prevention required a broader cleanup: execution plans, cascade interpretation, postmortem framing, audit classification, and finally schema source-of-truth hygiene.

## References

- Hibernate User Guide: [hbm2ddl.auto](https://docs.jboss.org/hibernate/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#configurations-hbm2ddl)
- Jakarta Persistence API: [`@Table.indexes`](https://jakarta.ee/specifications/persistence/4.0/apidocs/jakarta.persistence/jakarta/persistence/table)
- Jakarta Persistence API: [`@Index`](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/index)
- MySQL Reference Manual: [information_schema.STATISTICS](https://dev.mysql.com/doc/refman/8.0/en/information-schema-statistics-table.html)
- MySQL Reference Manual: [FOREIGN KEY Constraints — Indexing](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html)
