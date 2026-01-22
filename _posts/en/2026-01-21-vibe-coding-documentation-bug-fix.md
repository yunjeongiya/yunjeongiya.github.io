---
layout: post
title: "How Auto-Documentation in Vibe Coding Reduced Bug Fix Time to 5 Minutes"
date: 2026-01-21 10:00:00 +0900
categories: [AI, Debugging]
tags: [vibe-coding, claude, documentation, debugging, ai, features-system]
lang: en
slug: "024-en"
---

## TL;DR
Fixed a Discord attendance system bug in 5 minutes. The secret? Auto-documentation system. When working with AI, documentation is "a gift to your future self." One Phase checkbox made the difference between 5 minutes and 5 hours.

---

## Background: Vibe Coding and Auto-Documentation

I've been vibe coding for about 3 months now. Building CheckUS, an academy management system, with Claude Code.

Initially, I just focused on cranking out code quickly. But as the project grew, a problem emerged. **AI can't remember what it built before.** When context is lost, you have to explain everything from scratch again.

So I introduced the **Features tracking system**.

```
checkus-docs/features/
├── INDEX.md                    # Full feature index
├── F052-weekly-schedule-attendance/
│   └── README.md               # Discord attendance system redesign docs
├── F072-workflow-commands/
│   └── README.md               # Workflow commands docs
└── ...
```

The key is the `/finish` command. Every time I complete a feature, Claude automatically updates the documentation:
- What changed (code changes)
- Why we decided this way (technical decisions)
- What problems it solved

Honestly, I started this out of laziness, but it proved its worth today.

---

## The Problem: "Not Connected" Despite Being on Discord?

A weird bug occurred during operations today.

> "Student Lim Ji-hwan (7th grade) is in the Discord voice channel, but the study monitoring screen shows 'Not Connected'"

At first, I thought it was a Discord bot issue. Checked the server logs.

```
WARN - Cannot find Discord user. Nickname: 중1 임지환
```

Discord nickname matching problem? But when I tested it myself, the bot worked fine. DMs came through too.

Checked the API response:

```json
{
  "assigneeId": 40,
  "assigneeName": "임지환",
  "status": "ABSENT",
  "connectedActualStudyTimes": []  // Empty!
}
```

Direct DB check:

```sql
SELECT * FROM online_study_session WHERE student_id = 40;
-- id: 1078, student_id: 40, end_time: NULL (In progress!)
```

**Session exists in DB but not in API response.** Something's off.

---

## Solution: "I Must Have Documented It, Go Find It"

This is where documentation showed its power. I told Claude:

> "This looks like the Discord attendance system migration that got stopped halfway. I must have documented it as F052. Go find it."

Claude found and opened the F052 document:

```markdown
## 📋 Overview
Complete redesign to fundamentally solve the complexity of the current Discord attendance check and notification system.

### Phase 4: Monitoring Service Migration
- [ ] StudyMonitoringService implementation
- [ ] API endpoint migration
```

**Phase 4 was incomplete.**

Reading further made it clear:
- Old: Uses `ActualStudyTime` table
- New: Uses `OnlineStudySession` table
- Discord bot already writes data to `OnlineStudySession`
- **But monitoring service still queries `ActualStudyTime`**

```java
// The problematic code (before fix)
List<ActualStudyTime> unassigned = actualStudyTimeRepository
    .findByAssigneeIdsAndDateRange(...);  // Querying old table!
```

---

## Fix: Done in 5 Minutes

Once I knew the cause, the fix was simple.

**1. Add batch query methods to Repository**

```java
// Query sessions linked to WeeklySchedule
List<OnlineStudySession> findByWeeklyScheduleIdsAndPeriod(
    List<Long> weeklyScheduleIds,
    LocalDateTime startTime,
    LocalDateTime endTime);

// Query unscheduled sessions (weeklyScheduleId is NULL)
List<OnlineStudySession> findByStudentIdsAndPeriodUnscheduled(
    List<Long> studentIds,
    LocalDateTime startTime,
    LocalDateTime endTime);
```

**2. Replace Repository in Service**

```java
// Before
private final ActualStudyTimeRepository actualStudyTimeRepository;

// After
private final OnlineStudySessionRepository onlineStudySessionRepository;
```

**3. Update query logic**

```java
// Before
List<ActualStudyTime> unassigned = actualStudyTimeRepository
    .findByAssigneeIdsAndDateRangeAndAssignedStudyTimeIdIsNull(...);

// After
List<OnlineStudySession> unassignedSessions = onlineStudySessionRepository
    .findByStudentIdsAndPeriodUnscheduled(batch, startTime, endTime);
```

Commit and deploy. **From problem discovery to resolution: 5 minutes.**

---

## Lessons Learned: Documentation is a Gift to Your Future Self

### 1. Documentation is Essential When Working with AI

AI can't remember. When context is lost, you have to explain everything from scratch. But with documentation? Just say **"I must have documented it as F052, go find it"**. Even if I don't remember exactly what I did, if I vaguely remember the document number, the AI will find and read it on its own.

### 2. Tracking Incomplete Status is Key

Phase 4 remained unchecked. Without this, I would have assumed "it must be complete" and searched in the wrong places.

```markdown
### Phase 4: Monitoring Service Migration
- [ ] StudyMonitoringService implementation  ← This one checkbox made the difference between 5 minutes and 5 hours
```

### 3. Migration Isn't "All or Nothing"

We split the ActualStudyTime → OnlineStudySession migration into 4 phases. Thanks to this:
- The system kept running even in partial completion state
- We could track how far we'd gotten

---

## Conclusion

"Fixed it right away because I documented it"

That's what I muttered to myself after fixing the bug today. Thanks to my past self 3 months ago who documented despite being lazy, my present self solved the problem in 5 minutes.

The core of vibe coding isn't AI writing code quickly. It's **leaving documentation so AI can maintain context**. That's how you can answer "Why did we build it this way?" a month or a year later.

---

## Reference: Our Project's Documentation Workflow

1. **Start new feature**: Create `features/F{number}-{name}/README.md`
2. **During work**: Manage progress with phase checkboxes
3. **Feature complete**: Auto-commit + doc update with `/finish` command
4. **On pause**: Record current state with `/pause` command

If you're curious about this pattern, check out the [/blog command post](/posts/024-en/).

---

**TL;DR**: If you automate documentation when vibe coding, you'll fix bugs super fast later. For real.