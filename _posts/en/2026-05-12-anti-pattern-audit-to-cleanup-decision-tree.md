---
layout: post
title: "124 index anti-patterns found, 19 dropped — why the rest stayed"
date: 2026-05-12 14:00:00 +0900
categories: [Database, Performance]
tags: [mysql, index, audit, cleanup, postmortem]
lang: en
slug: "080-en"
thumbnail: /assets/images/posts/080-index-cleanup-decision/thumbnail-en.jpg
image: /assets/images/posts/080-index-cleanup-decision/thumbnail-en.jpg
published: true
---

> 5/4 DB incident series
>
> 1. [When a cardinality=1 single-column index beats the compound index](/posts/077-en/)
> 2. [DB pool exhaustion cascade: do not mistake victim traces for causes](/posts/078-en/)
> 3. [Latent slow query incident: why "why today?" may have no clean answer](/posts/079-en/)
> 4. **124 index anti-patterns found, 19 dropped — why the rest stayed**
> 5. [JPA @Index is not prod DB index — 5 Entity-DB drift patterns](/posts/081-en/)

![findings first then classify then drop](/assets/images/posts/080-index-cleanup-decision/thumbnail-en.jpg){: width="700"}

## Introduction

After the index incident, we audited the database and found 124 suspicious indexes. The tempting conclusion was simple: drop them all.

Reality was more careful: 19 immediate drops, 57 deferred decisions, 2 keeps, and 46 case-by-case items. Discovery and cleanup are separate decisions.

## Audit Result

- Cardinality <= 2 single-column indexes: **92**
- Redundant prefix indexes: **32**
- Foreign-key columns without an index: 0

## Decision Criteria

![Index cleanup decision tree](/assets/images/posts/080-index-cleanup-decision/cleanup-decision-tree.svg){: width="700"}

### 1. Foreign-key protection

InnoDB requires an index where the foreign-key columns appear as a leading prefix. If a suspicious index is the only index satisfying that requirement, dropping it is rejected.

```sql
ALTER TABLE operator_task DROP INDEX idx_template;
-- ERROR 1553 (HY000): Cannot drop index 'idx_template':
-- needed in a foreign key constraint
```

Decision: keep it, or replace it only when a justified compound index can take over the FK prefix role.

### 2. Never chosen by the optimizer

If an index appears in `possible_keys` but is never selected as `key` across real query patterns, it is pure maintenance overhead.

Decision: drop after prod-like `EXPLAIN` verification.

### 3. Redundant prefix

If a compound index starts with the same column as a single-column non-unique index, the single-column index is often redundant.

```text
compound: idx_user_date_status (user_id, target_date, status)
single:   idx_user_id (user_id)
```

Decision: usually drop after before/after `EXPLAIN` verification.

### 4. Empty table

Many cardinality=0 indexes belonged to not-yet-active feature tables. With zero rows, there is no real optimizer behavior to judge yet.

Decision: defer until after the feature ships and data accumulates.

## Result

| Classification | Count | Action |
|---|---|---|
| FK protection KEEP | 2 | keep |
| Never chosen DROP | 3 | drop |
| Redundant prefix DROP | 16 | drop after verification |
| Empty table deferred | 57 | decide after ship |
| Case-by-case | 46 | later phase |

Only 19 of 124 findings were immediate drops. That ratio is the point: audit rules find candidates; humans still classify risk.

![Cleanup classification result](/assets/images/posts/080-index-cleanup-decision/cleanup-result-bars.svg){: width="700"}

## Lessons

### Classification first, DDL second

DDL is the last step. First decide whether the index protects an FK, is actually used, is redundant, or needs more data.

### False positives must become explicit exceptions

If the coding convention says "no low-cardinality single-column indexes," it must also say "except FK-protection indexes."

### Run prod DDL sequentially

Parallel `ALTER TABLE DROP INDEX` saved almost no time and made an error easy to miss in truncated output. Production DDL deserves one command, one response, one confirmation.

## Next

Index cleanup naturally leads to the next question: does the entity model still match the real production schema? [The next post](/posts/081-en/) covers five Entity-DB drift patterns.

## References

- MySQL Reference Manual: [FOREIGN KEY Constraints — Indexing](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html)
- MySQL Reference Manual: [Optimizer Statistics](https://dev.mysql.com/doc/refman/8.0/en/optimizer-statistics.html)
- MySQL Reference Manual: [information_schema.STATISTICS](https://dev.mysql.com/doc/refman/8.0/en/information-schema-statistics-table.html)
