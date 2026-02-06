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

84 times. Escalating. The entire meeting room booking dashboard was down. The failing endpoint was `GET /rooms/status`.

A query expecting a single result returned two. That means duplicate data existed in the database that shouldn't have been there. This wasn't just a bug — it meant the system's fundamental invariant, "no overlapping bookings for the same room," had been violated.

But here's the thing — the service already had overlap validation. Every create and update path checked for time conflicts and threw an exception if one was found.

So how did duplicate data get past the validation?

## Step 1: Finding the Duplicate

First, I queried the database directly for overlapping bookings.

```sql
SELECT a.id, b.id, a.room_id, a.day_of_week,
       a.start_time, a.end_time, b.start_time, b.end_time
FROM room_booking a
JOIN room_booking b
  ON a.room_id = b.room_id
  AND a.day_of_week = b.day_of_week AND a.id < b.id
  AND a.start_time < b.end_time AND b.start_time < a.end_time
WHERE a.booking_type = 'MEETING_ROOM'
  AND b.booking_type = 'MEETING_ROOM';
```

Exactly one hit. Room 3A had two overlapping bookings on Friday.

| id | Time | Note |
|----|------|------|
| 301 | 09:00–12:00 | History exists |
| 309 | 10:00–11:30 | **No history** |

## Step 2: Following the Trail

id 301 had a normal creation history record. id 309 had none at all.

Digging through the history table revealed a clue.

```
201 | CREATE | 3A [Fri] 09:00-12:00           | 05:40:08.684 | booking_id=301
203 | CREATE | 3A [Mon,Wed,Fri] 10:00-11:30   | 05:40:08.690 | booking_id=305
```

History 203 says "Mon, Wed, Fri 10:00–11:30" but only recorded `booking_id=305` (Monday). The recurring booking API created three bookings at once (Mon/Wed/Fri), but only logged the first one. id 309 (Friday) was the third booking in that same operation — invisible in the audit trail.

And look at the timestamps. The gap between the two history records is **0.006 seconds**.

## Step 3: The 0.006-Second Gap

No human clicks twice in 0.006 seconds. The code sent parallel requests.

I checked the frontend code. There it was.

```typescript
// BookingDialog.tsx — before fix
for (let i = 0; i < timeSlots.length; i++) {
  onSave(bulkRequest, i === 0 && isEditMode);  // no await
}
```

`onSave` is an async function, called without `await`. In a `for` loop, calling an async function without `await` fires all invocations nearly simultaneously. It's effectively the same as `Promise.all`.

Here's what happened on the server.

```
Thread 1 (Fri 09:00-12:00):
  ① Overlap check → "Any overlap on Friday?" → None ✅
  ② INSERT (id=301)
  ③ COMMIT

Thread 2 (Mon/Wed/Fri 10:00-11:30):
  ① Overlap check → "Any overlap on Friday?" → None ✅  ← THE PROBLEM
  ② INSERT (id=305, 308, 309)
  ③ COMMIT
```

When Thread 2 ran its overlap check, Thread 1 hadn't committed yet. Under MySQL's default isolation level, REPEATABLE READ, **uncommitted data from other transactions is invisible**. More precisely, even data committed after your transaction started remains invisible. So Thread 2's validation saw "no overlapping bookings" and passed.

```
Thread 1: [──validate──][──save──][commit]
Thread 2:    [──validate──][────save────][commit]
                  ↑
            Thread 1 not committed yet
```

The validation logic was correct. Within a single transaction. The problem was cross-transaction visibility.

This was neither a frontend bug nor a backend bug. It was a concurrency bug at the system boundary.

## Reproducing It

Theory confirmed. Time to reproduce.

On production (before deploying the fix), I opened the booking dialog for the same room, added two time slots, and hit save. In the browser's Network tab, two requests fired almost simultaneously. Both returned success.

```
PUT  /bookings/replace  → 200 (Wed,Fri 10:00-12:00)
POST /bookings/bulk     → 201 (Fri 09:00-13:00)
```

Friday 10:00–12:00 and 09:00–13:00 clearly overlap. Both passed validation.

I tried again with completely identical bookings — Monday 10:00–11:00 entered as two separate time slots:

```
POST /bookings/bulk  → 201 (id=451, Mon 10:00-11:00)
POST /bookings/bulk  → 201 (id=452, Mon 10:00-11:00)
```

Two 100% identical bookings created. The validation bypass was not dependent on server speed — it reproduced consistently in any environment.

## The Fix

### Root Cause: Sequential Frontend Requests

```typescript
// BookingDialog.tsx — after fix
for (let i = 0; i < timeSlots.length; i++) {
  await onSave(bulkRequest, i === 0 && isEditMode);  // await added
}
```

One word: `await`. The first request commits before the second one starts. Now the backend overlap validation works as designed.

The same pattern existed elsewhere. A batch registration feature used `Promise.allSettled` for parallel execution:

```typescript
// Before — parallel execution
const results = await Promise.allSettled(
  bookings.map(b => api.createBooking(b))
);

// After — sequential execution
for (const booking of bookings) {
  await api.createBooking(booking);
}
```

### Defense in Depth: Backend Defensive Query

The frontend fix addresses the root cause, but a root cause fix alone isn't enough. You need a safety belt for production resilience.

Changed the crashing query's return type from `Optional<RoomBooking>` to `List<RoomBooking>`. If duplicates are detected, a Sentry WARNING is sent instead of crashing the service.

```java
List<RoomBooking> bookings = repository
    .findCurrentRoomBooking(roomId, dayOfWeek, time);

if (bookings.size() > 1) {
    Sentry.captureMessage("Duplicate room booking detected - roomId: " + roomId,
                          SentryLevel.WARNING);
}

return bookings.isEmpty() ? null : bookings.get(0);
```

Now even if duplicate data somehow exists, the service stays up and sends an alert for manual cleanup.

### Side Fix: Recurring Booking History

During the investigation, the missing history for id 309 slowed down root cause analysis significantly. Fixed the recurring booking creation to record history for every booking, not just the first one.

## Lessons Learned

**1. Validation only holds within a single transaction.**

Even well-implemented overlap validation is useless across concurrent transactions under REPEATABLE READ. Validation doesn't mean safety if requests are parallel.

**2. `await` in loops must be intentional.**

ESLint's `no-await-in-loop` rule recommends removing `await` from loops for performance. But when **ordering matters for correctness**, `await` is mandatory. Know the trade-off between parallelism and data integrity, and choose deliberately.

**3. Log everything, especially in bulk operations.**

Recording history for "just the first item" in a bulk operation makes the rest untraceable. This literally blocked our root cause analysis.

**4. Defensive queries are insurance.**

Receiving a `List` instead of `Optional` for queries that expect a single result prevents service crashes from unexpected data. Alert instead of crash.

---

**Correct validation logic + parallel requests ≠ safe system.**

## References

- [MySQL InnoDB Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [JavaScript async and await in loops — Zell Liew](https://zellwk.com/blog/async-await-in-loops/)
- [RepeatableRead Concurrency Issues (Korean)](https://www.blog.ecsimsw.com/entry/%EB%8F%99%EC%8B%9C%EC%84%B1-%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%99%80-%ED%95%B4%EA%B2%B0-%EB%B0%A9%EC%95%88)
- [Race Condition: The Silent Bug That Breaks Production Systems](https://www.steve-bang.com/blog/race-condition-silent-bug-breaks-production)
- [ESLint no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop)
