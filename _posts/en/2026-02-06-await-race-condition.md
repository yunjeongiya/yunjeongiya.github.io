---
layout: post
title: "One Missing await Broke Production — Debugging a Race Condition from Sentry Alert to Root Cause"
date: 2026-02-06 11:00:00 +0900
categories: [Development, Debugging]
tags: [race-condition, async-await, mysql, sentry, debugging, spring-boot, react]
lang: en
slug: "032-en"
thumbnail: /assets/images/posts/032-await-race-condition/diagram-en.svg
---

![Race condition timing diagram](/assets/images/posts/032-await-race-condition/diagram-en.svg){: width="700"}

11 AM. Sentry alert.

```
NonUniqueResultException: Query did not return a unique result: 2 results were returned
```

84 times. Escalating. The entire seat map — a real-time attendance dashboard — was down. The failing endpoint was `GET /attendance/status`.

A query expecting a single result returned two. That means duplicate data existed in the database that shouldn't have been there. But here's the thing — the service already had overlap validation. Every create and update path checked for time conflicts and threw an exception if one was found.

So how did duplicate data get past the validation?

## Step 1: Finding the Duplicate

First, I queried the database directly for overlapping schedules.

```sql
SELECT a.id, b.id, a.user_id, a.day_of_week,
       a.start_time, a.end_time, b.start_time, b.end_time
FROM weekly_schedule a
JOIN weekly_schedule b
  ON a.user_id = b.user_id AND a.campus_id = b.campus_id
  AND a.day_of_week = b.day_of_week AND a.id < b.id
  AND a.start_time < b.end_time AND b.start_time < a.end_time
WHERE a.schedule_type = 'CAMPUS_SEAT'
  AND b.schedule_type = 'CAMPUS_SEAT';
```

Exactly one hit. One student had two overlapping attendance schedules on Friday.

| id | Time | Note |
|----|------|------|
| 651 | 09:00–22:00 | History exists |
| 656 | 11:00–18:00 | **No history** |

## Step 2: Following the Trail

id 651 had a normal creation history record. id 656 had none at all.

Digging through the history table revealed a clue.

```
482 | CREATE | Fri 09:00-22:00        | 05:40:08.684 | schedule_id=651
484 | CREATE | Mon,Wed,Fri 11:00-18:00 | 05:40:08.690 | schedule_id=652
```

History 484 says "Mon, Wed, Fri 11:00–18:00" but only recorded `schedule_id=652` (Monday). The bulk creation API created three schedules at once (Mon/Wed/Fri), but only logged the first one. id 656 (Friday) was the third schedule in that same bulk operation — invisible in the audit trail.

And look at the timestamps. The gap between the two history records is **0.006 seconds**.

## Step 3: The 0.006-Second Gap

No human clicks twice in 0.006 seconds. The code sent parallel requests.

I checked the frontend code. There it was.

```typescript
// WeeklyScheduleDialog.tsx — before fix
for (let i = 0; i < timeSlots.length; i++) {
  onSave(bulkRequest, i === 0 && isEditMode);  // no await
}
```

`onSave` is an async function, called without `await`. In a `for` loop, calling an async function without `await` fires all invocations nearly simultaneously. It's effectively the same as `Promise.all`.

Here's what happened on the server.

```
Thread 1 (Fri 09:00-22:00):
  ① Overlap check → "Any overlap on Friday?" → None ✅
  ② INSERT (id=651)
  ③ COMMIT

Thread 2 (Mon/Wed/Fri 11:00-18:00):
  ① Overlap check → "Any overlap on Friday?" → None ✅  ← THE PROBLEM
  ② INSERT (id=652, 655, 656)
  ③ COMMIT
```

When Thread 2 ran its overlap check, Thread 1 hadn't committed yet. Under MySQL's default isolation level, REPEATABLE READ, **uncommitted data from other transactions is invisible**. So Thread 2's validation saw "no overlapping schedules" and passed.

```
Thread 1: [──validate──][──save──][commit]
Thread 2:    [──validate──][────save────][commit]
                  ↑
            Thread 1 not committed yet
```

The validation logic was correct. Within a single transaction. The problem was cross-transaction visibility.

## Reproducing It

Theory confirmed. Time to reproduce.

On production (before deploying the fix), I opened the schedule dialog for the same student, added two time slots, and hit save. In the browser's Network tab, two requests fired almost simultaneously. Both returned success.

```
PUT  /weekly-schedule/replace  → 200 (Wed,Fri 11:00-18:00)
POST /weekly-schedule/bulk     → 201 (Fri 09:00-23:00)
```

Friday 11:00–18:00 and 09:00–23:00 clearly overlap. Both passed validation.

I tried again with completely identical schedules — Saturday 09:00–10:00 entered as two separate time slots:

```
POST /weekly-schedule/bulk  → 201 (id=1249, Sat 09:00-10:00)
POST /weekly-schedule/bulk  → 201 (id=1250, Sat 09:00-10:00)
```

Two 100% identical schedules created. The validation bypass was not dependent on server speed — it reproduced consistently on EC2 t3.small.

## The Fix

### Root Cause: Sequential Frontend Requests

```typescript
// WeeklyScheduleDialog.tsx — after fix
for (let i = 0; i < timeSlots.length; i++) {
  await onSave(bulkRequest, i === 0 && isEditMode);  // await added
}
```

One word: `await`. The first request commits before the second one starts. Now the backend overlap validation works as designed.

The same pattern existed elsewhere. A paste-to-create feature used `Promise.allSettled` for parallel execution:

```typescript
// Before — parallel execution
const results = await Promise.allSettled(
  schedules.map(s => api.createWeeklySchedule(s))
);

// After — sequential execution
for (const schedule of schedules) {
  await api.createWeeklySchedule(schedule);
}
```

### Defense in Depth: Backend Defensive Query

The frontend fix addresses the root cause, but I also hardened the backend for unexpected scenarios.

Changed the crashing query's return type from `Optional<WeeklySchedule>` to `List<WeeklySchedule>`. If duplicates are detected, a Sentry WARNING is sent instead of crashing the service.

```java
List<WeeklySchedule> schedules = repository
    .findCurrentCampusSeatSchedule(userId, campusId, dayOfWeek, time);

if (schedules.size() > 1) {
    Sentry.captureMessage("Duplicate CAMPUS_SEAT schedule detected - userId: " + userId,
                          SentryLevel.WARNING);
}

return schedules.isEmpty() ? null : schedules.get(0);
```

Now even if duplicate data somehow exists, the service stays up and sends an alert for manual cleanup.

### Side Fix: Bulk History

During the investigation, the missing history for id 656 slowed down root cause analysis significantly. Fixed the bulk creation to record history for every schedule, not just the first one.

## Lessons Learned

**1. Validation only holds within a single transaction.**

Even well-implemented overlap validation is useless across concurrent transactions under REPEATABLE READ. Validation doesn't mean safety if requests are parallel.

**2. `await` in loops must be intentional.**

ESLint's `no-await-in-loop` rule recommends removing `await` from loops for performance. But when **ordering matters for correctness**, `await` is mandatory. Know the trade-off between parallelism and data integrity, and choose deliberately.

**3. Log everything, especially in bulk operations.**

Recording history for "just the first item" in a bulk operation makes the rest untraceable. This literally blocked our root cause analysis.

**4. Defensive queries are insurance.**

Receiving a `List` instead of `Optional` for queries that expect a single result prevents service crashes from unexpected data. Alert instead of crash.

## References

- [MySQL InnoDB Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [JavaScript async and await in loops — Zell Liew](https://zellwk.com/blog/async-await-in-loops/)
- [RepeatableRead Concurrency Issues (Korean)](https://www.blog.ecsimsw.com/entry/%EB%8F%99%EC%8B%9C%EC%84%B1-%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%99%80-%ED%95%B4%EA%B2%B0-%EB%B0%A9%EC%95%88)
- [Race Condition: The Silent Bug That Breaks Production Systems](https://www.steve-bang.com/blog/race-condition-silent-bug-breaks-production)
- [ESLint no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop)
