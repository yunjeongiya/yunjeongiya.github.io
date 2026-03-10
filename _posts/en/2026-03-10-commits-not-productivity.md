---
layout: post
title: "Do More Commits Mean More Productivity? — A 6-Month Data Analysis"
date: 2026-03-10 09:00:00 +0900
categories: [Development, Productivity]
tags: [developer-productivity, commits, AI-coding, Claude-Code, process, retrospective]
lang: en
slug: "041-en"
thumbnail: /assets/images/posts/041-commits-not-productivity/chat-reaction.png
---

One night, my GitHub contribution graph showed up in the team chat.

## "How do you average 20 commits a day?"

![Team reactions](/assets/images/posts/041-commits-not-productivity/chat-reaction.png)

![Team reactions 2](/assets/images/posts/041-commits-not-productivity/chat-reaction-2.png)

"Contribution machine," "GOAT," "8x difference" — the reactions were flattering. But it made me curious: **was that actually my most productive period?**

I had a gut feeling that I was actually getting more done recently, with far fewer commits. Could be self-delusion, though. So I dug into the data.

---

## I Analyzed 6 Months of Git Logs

77 daily work logs, full commit history across 3 repositories, aggregated by week.

### Commit Trends

| Period | Avg Commits/Day | Character |
|--------|-----------------|-----------|
| Sep (early) | 52.0 | Exploratory development |
| **Oct–Nov (peak)** | **48.5** | Mass code production |
| Dec–Jan | Sporadic | End of semester / break |
| Feb (restart) | 28.8 | Infrastructure cleanup |
| **Mar (current)** | **21.6** | Feature-focused |

Oct–Nov averaged nearly 50 commits/day. March barely hits 22. **By commit count alone, it looks like productivity halved.**

### But What About Actual Output?

Starting February, I introduced a Feature tracking system that counts completed functional units precisely. March numbers:

- **7.0 Features completed per day** (peak: 11/day)
- Commits per Feature: **~3.1**

Oct–Nov didn't have Feature-level tracking, so an exact comparison isn't possible. But analyzing the work logs, single features routinely took 15–20 commits: commit → find bug → fix commit → find another bug → fix again.

Oct–Nov was a period where I *needed* many commits. March is where fewer commits produce the same or better results.

---

## A Clearer Signal: Post-Commit Hotfixes

More intuitive than raw commit counts: "how often did I immediately fix something right after committing?"

| Period | Post-Commit Hotfixes | Example |
|--------|---------------------|---------|
| Oct–Nov | **2–3/day** | Commit → bug fix 7 min later → another fix 8 min later |
| Mar | **0.3/day** | 2 total in 3 days (minor omissions) |

Actual log from October 30:
```
06:18 Feature commit
06:25 Bug fix (user.id vs user.data.id type mismatch)
06:33 Another fix (dialog duplication)
```

Three commits for the same feature in 15 minutes. That was normal back then.

In March, this pattern has almost disappeared. Mistakes still happen, but the frequency is clearly different.

---

## What Changed: 6 Factors

### 1. Process Automation

Six months ago, all project rules lived in a single file, and I had to manually explain context to the AI every time.

Now:
- **Feature Tracking System**: 208 Features managed by ID, with clear scope boundaries
- **Scoped Rules**: Opening a backend file auto-loads Spring Boot conventions; frontend files load React rules
- **Hooks**: Auto-validation on commit, requirement tracking reminders
- **16 Skills**: Repeatable workflows like `/finish`, `/inspect`, `/test` execute in one command

The time spent building these systems pays compound interest on every subsequent task.

### 2. Shorter "Commit-then-Fix" Cycles

In Oct–Nov, the cycle was: write code → commit → run → find bug → commit fix. Skipping tests was common (`./gradlew build -x test`).

Now, `/inspect` (multi-pass code review) and `/test` add a pre-commit gate. Not perfect, but issues found after commit have dropped significantly.

### 3. The Oct–Nov Struggles Were the Foundation

This is important: **March's efficiency exists because of October's struggles.**

The least efficient day in October was spent entirely cleaning up after a refactoring that broke 7 queries and caused 100+ compile errors. That experience is why I could systematically pay down tech debt in February:

- 5,156 lines of dead code deleted
- Campus auth migration across 31 endpoints
- ErrorCode standardization

With a clean foundation, new features don't break existing code.

### 4. Vertical Slice Discipline

I used to split work: "backend today, frontend tomorrow." This meant high context-switching costs and integration bugs the next day.

Now every Feature ships as **server + frontend + docs in one unit**. This wasn't intentional at first — it evolved after experiencing the pain of half-finished features causing integration bugs.

### 5. Domain Knowledge Accumulation

After 208 Features, the entire codebase lives in my head. Where to put new features, which patterns cause problems (LazyInitException, N+1, timezone issues) — the instinct is there at design time.

This is purely time and experience. No shortcut existed.

### 6. Feature Chaining

Looking at March's work, Features naturally connect within a single day:

```
Alimtalk modal (F185) → Architecture issue found → Refactoring (F186)
Waitlist system (F192) → Tab UI (F197) → Custom modal (F192 Phase 2)
Refund calculation (F200) → Difference invoice auto-generation (F202)
```

Context from the previous Feature carries directly into the next, eliminating warmup time. This is partly deliberate and partly a natural result of the project maturing — features have more interconnections now.

---

## Numbers Summary

| Metric | Oct–Nov | Mar | Change |
|--------|---------|-----|--------|
| Avg commits/day | 48.5 | 21.6 | -55% |
| Avg Features/day | (no tracking) | 7.0 | — |
| Commits/Feature | ~15–20 (est.) | ~3.1 | -80% (est.) |
| Post-commit hotfixes | 2–3/day | 0.3/day | -87% |
| Late-night work | Frequent (4 AM) | None | Gone |
| Weekly work days | 2–6 (irregular) | 5 (stable) | Stabilized |

Note: Oct–Nov lacked Feature tracking, so some figures are estimates. This isn't an apples-to-apples comparison.

---

## What I Learned

A green GitHub graph feels good. And lots of commits definitely mean you're working hard.

But many commits can also mean "many corrections." When you get it right the first time, commits go down.

The pattern from my 6-month data:

> **Oct–Nov's high commit volume was the "effort era." March's lower commits are the result of systems built on top of that effort.**

Commits dropped but output increased. No more 4 AM sessions. No more losing a full day to refactoring fallout.

Two things made the difference:
1. **Systems**: Feature tracking, automated code review, scoped rules, hooks — accumulated over months, reducing repetitive costs
2. **Experience**: Every problem hit in Oct–Nov became judgment in March

Both required time. March's efficiency wouldn't exist without October's struggles.

More important than the color of your GitHub grass: **"How much value does each commit deliver?"** If that number keeps growing over time, you're probably heading in the right direction.
