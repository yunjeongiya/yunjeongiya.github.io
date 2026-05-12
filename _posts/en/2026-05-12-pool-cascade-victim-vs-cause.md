---
layout: post
title: "DB pool exhaustion cascade: do not mistake victim traces for causes"
date: 2026-05-12 10:30:00 +0900
categories: [Database, Debugging]
tags: [hikaricp, incident, debugging, postmortem]
lang: en
slug: "078-en"
thumbnail: /assets/images/posts/078-pool-cascade/thumbnail-en.jpg
image: /assets/images/posts/078-pool-cascade/thumbnail-en.jpg
published: true
---

> 5/4 DB incident series
>
> 1. [When a cardinality=1 single-column index beats the compound index](/posts/077-en/)
> 2. **DB pool exhaustion cascade: do not mistake victim traces for causes**
> 3. [Latent slow query incident: why "why today?" may have no clean answer](/posts/079-en/)
> 4. [124 index anti-patterns found, 19 dropped — why the rest stayed](/posts/080-en/)
> 5. [JPA @Index is not prod DB index — 5 Entity-DB drift patterns](/posts/081-en/)

![one cause many victim leak warnings](/assets/images/posts/078-pool-cascade/thumbnail-en.jpg){: width="700"}

## Introduction

When `Apparent connection leak detected` warnings fire from eight services, the intuitive reaction is: "we have eight leaks." In a single-pool cascade, that intuition is often wrong. One path can be the cause; the rest can be victims.

This post describes how we separated cause from victim during the incident review.

## Background / Problem

At the P0 moment, leak warnings appeared across eight service paths:

| Source | Warning count |
|---|---|
| User progress lookup | 20 |
| Catalog tree lazy load | 11 |
| Virtual task aggregation | 6 |
| Integrated status aggregation | 4 |
| User list lookup | 3 |
| Calendar schedule | 2 |
| Auth login / refresh | 4 |
| Notification scheduler | 1 |

The first instinct was to audit transaction leaks in every domain. That would have turned into several days of unnecessary work.

## Mechanism

HikariCP `leakDetectionThreshold` defaults to `0`, meaning disabled. Our setting was 30 seconds.

The warning means: a borrowed connection has not been returned within the threshold. It does not necessarily mean the code forgot to close a connection.

In this incident:

- Several concurrent executions of the same slow path held connections for too long.
- The pool became saturated.
- Other requests waited for connections or ran under heavy DB CPU pressure.
- Normal queries also crossed the 30-second threshold.
- Those normal paths emitted their own stack traces as leak warnings.

![Connection pool cascade diagram](/assets/images/posts/078-pool-cascade/pool-cascade-diagram.svg){: width="700"}

## Cause / Victim Rule

For each warning source:

```sql
EXPLAIN [that query];
-- then measure standalone runtime on prod-like data
```

- Fast alone: victim of the cascade.
- Slow alone: possible independent cause.

The result was simple: one slow query was the cause; the rest were victims. Fixing the one index problem removed the entire warning spread the next day, even with higher traffic.

![Cause victim check loop](/assets/images/posts/078-pool-cascade/cause-victim-check-loop.svg){: width="700"}

## Lessons

### Distributed signals do not imply distributed causes

The same incident can generate many stack traces. Treat them as evidence, not as separate tickets by default.

### Validate standalone behavior first

Before starting code changes in seven domains, measure each query alone. Thirty minutes of diagnosis can save days of false cleanup.

### The word "leak" is misleading

Read the warning as "borrow time exceeded threshold." It can still reveal a real leak, but it can also reveal slow work under a saturated pool.

## Next

After root cause and cascade structure were clear, the next question was: why did it happen today? [The next post](/posts/079-en/) covers latent incidents where that question has no clean trigger answer.

## References

- HikariCP: [leakDetectionThreshold](https://github.com/brettwooldridge/HikariCP#frequently-used)
- Useful pool metrics during review: `pool_active`, `pool_pending`, `pool_idle`
- Resilience4j circuit breakers as a first containment layer during pool exhaustion
