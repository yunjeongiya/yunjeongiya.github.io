---
layout: post
title: "When a cardinality=1 single-column index beats the compound index"
date: 2026-05-12 10:00:00 +0900
categories: [Database, Performance]
tags: [mysql, hikaricp, index, optimizer, incident]
lang: en
slug: "077-en"
thumbnail: /assets/images/posts/077-cardinality-one-index/thumbnail-en.jpg
image: /assets/images/posts/077-cardinality-one-index/thumbnail-en.jpg
published: true
---

> 5/4 DB incident series
>
> 1. **When a cardinality=1 single-column index beats the compound index**
> 2. [DB pool exhaustion cascade: do not mistake victim traces for causes](/posts/078-en/)
> 3. [Latent slow query incident: why "why today?" may have no clean answer](/posts/079-en/)
> 4. [124 index anti-patterns found, 19 dropped — why the rest stayed](/posts/080-en/)
> 5. [JPA @Index is not prod DB index — 5 Entity-DB drift patterns](/posts/081-en/)

![wrong signpost beats the better road](/assets/images/posts/077-cardinality-one-index/thumbnail-en.jpg){: width="700"}

## Introduction

We added a compound index to speed up a query shaped like `WHERE col_a IN (...) AND flag=1 AND enabled=1`. But `EXPLAIN` showed that the optimizer ignored the new index. Instead, it chose an old single-column index on a boolean-like column whose cardinality was effectively 1, producing an execution plan close to a full scan.

This post records the trap, the mechanism, and the fix from a real prod P0 incident review.

## Background / Problem

A latent slow query in a catalog table with hundreds of thousands of rows exhausted the Hikari pool during business-hour concurrency. Individual executions held a connection for 50 to 391 seconds. Twelve endpoints cascaded into circuit breaker OPEN.

The causal query:

```sql
SELECT id, group_id, parent_id, order_index, name
FROM item_catalog
WHERE group_id IN (?, ?, ?, ?, ?, ?)
  AND leaf_flag = 1
  AND enabled = 1
ORDER BY group_id, parent_id, order_index;
```

Existing indexes:

```text
idx_group_id (group_id)                                       -- cardinality 8
idx_leaf_flag (leaf_flag)                                     -- cardinality 1
idx_catalog_roots (group_id, parent_id, enabled, order_index, id)
idx_catalog_children (parent_id, group_id, enabled, order_index, id)
```

`idx_leaf_flag` was a single-column index on a boolean-like field. In general, this kind of index has poor selectivity and little independent value. In this case, statistics error, `ORDER BY`/filesort cost estimates, and cost comparison between candidate indexes combined badly, and the optimizer judged the single-column path cheaper.

```text
type: ref
key: idx_leaf_flag
rows: 293,871
Extra: Using where; Using filesort
```

![Optimizer path diagram](/assets/images/posts/077-cardinality-one-index/optimizer-path-diagram.svg){: width="700"}

## Resolution

### First attempt: add a compound covering index

We added an index aligned with filtering, ordering, and selected columns:

```sql
ALTER TABLE item_catalog
  ADD INDEX idx_catalog_group_leaf_enabled
  (group_id, leaf_flag, enabled, parent_id, order_index, id, name);
```

`EXPLAIN` still chose `idx_leaf_flag`. The new index appeared in `possible_keys`, but that did not mean it was actually selected.

### Second attempt: ANALYZE TABLE

We refreshed statistics:

```sql
ANALYZE TABLE item_catalog;
```

The plan did not change.

### Third attempt: drop the misleading index

```sql
ALTER TABLE item_catalog DROP INDEX idx_leaf_flag;
```

The plan changed immediately:

```text
type: range
key: idx_catalog_group_leaf_enabled
rows: ~200K estimated, sub-100K actual
Extra: Using where; Using index
```

Query time went from **391 seconds to under 50 ms**.

![Before and after index plan](/assets/images/posts/077-cardinality-one-index/before-after-plan.svg){: width="700"}

## Lessons

### Low-cardinality single-column indexes are suspicious

A boolean or flag column should rarely stand alone as an index. It can still belong inside a compound index, but as a supporting column, not as the leading standalone route.

### ANALYZE TABLE is not always enough

Statistics refresh can fail to change the optimizer's choice. `FORCE INDEX` is one possible escape hatch, but in this case the old index had little value and actively misled planning, so dropping it was cleaner.

### Audit the latent index surface

After the incident, the same audit found 91 more candidates. That changed the task from "fix one query" to "maintain an index hygiene loop."

## Next

This post covered the root cause. [The next post](/posts/078-en/) covers why the same incident looked like eight separate leak warnings, and how to avoid turning victim traces into root-cause lists.

## References

- MySQL Reference Manual: [Optimizer Cost Constants](https://dev.mysql.com/doc/refman/8.0/en/cost-model.html)
- MySQL Reference Manual: [InnoDB and MyISAM Index Statistics Collection](https://dev.mysql.com/doc/refman/8.4/en/index-statistics.html)
- MySQL Reference Manual: [ANALYZE TABLE Statement](https://dev.mysql.com/doc/refman/8.0/en/analyze-table.html)
- HikariCP: [leakDetectionThreshold](https://github.com/brettwooldridge/HikariCP#frequently-used)
