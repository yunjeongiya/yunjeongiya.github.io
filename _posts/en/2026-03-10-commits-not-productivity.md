---
layout: post
title: "I Averaged 50 Commits a Day. It Was My Least Productive Period."
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

"Contribution machine," "GOAT," "8x difference." Flattering stuff. But it made me curious: **was that actually my most productive period?**

I had a gut feeling that I was getting more done recently, with far fewer commits. Could be self-delusion, though. So I dug into the data.

---

## I Analyzed 6 Months of Git Logs

77 daily work logs. Full commit history across 3 repositories. Aggregated by week.

In October–November, I was hitting nearly 50 commits a day.

In March, I barely hit 22.

**By commit count alone, it looks like productivity halved.**

But when I checked the Feature tracking system I introduced in February — counting completed functional units — the story flipped.

In March, I completed an average of **7.0 Features per day**. Peak: 11 in a single day. Commits per Feature: **about 3**.

October–November didn't have Feature-level tracking, so an exact comparison isn't possible. But analyzing the work logs, single features routinely took 15–20 commits. Commit → find bug → fix commit → find another bug → fix again.

October–November was a period where I *needed* many commits.

---

## The Clearest Signal: Post-Commit Hotfixes

More intuitive than raw commit counts or Feature counts: "how often did I immediately fix something right after committing?"

October–November: **2–3 times per day.** March: **2 total in 3 days.**

Actual log from October 30:

```
06:18 Feature commit
06:25 Bug fix (user.id vs user.data.id type mismatch)
06:33 Another fix (dialog duplication)
```

Three commits for the same feature in 15 minutes. That was normal back then.

In March, this pattern has almost disappeared. Mistakes still happen, but the frequency is clearly different.

---

## What Changed

### 1. Systems Accumulated

Six months ago, all project rules lived in a single file, and I had to manually explain context to the AI every time.

Now, 208 Features are managed by ID, backend files auto-load Spring Boot conventions, commits trigger automatic validation, and repeatable workflows like `/inspect` and `/test` run in a single command.

The time spent building these systems pays compound interest on every subsequent task. With `/inspect` catching issues before commit, the "commit → fix 7 minutes later" cycle disappeared.

### 2. Struggles Became Experience

October–November's pain is why March works.

The least efficient day in October was spent entirely cleaning up after a refactoring that broke 7 queries and caused 100+ compile errors. After 208 Features, the entire codebase lives in my head. Patterns like LazyInitException and N+1 queries — I catch them at design time now.

This isn't a system. It's purely time and experience. No shortcut existed.

### 3. The Codebase Matured

That experience made it possible to systematically pay down tech debt in February. 5,156 lines of dead code deleted. Campus auth migrated across 31 endpoints. ErrorCode standardized.

With a clean foundation, new features don't break existing code. I stopped splitting work across days ("backend today, frontend tomorrow") and started shipping server + frontend + docs as one unit. Features naturally chain within a single day, eliminating warmup time.

---

## The Numbers

October–November:
- **48.5 commits/day** average
- Post-commit hotfixes: **2–3/day**
- Late-night work frequent (4 AM)
- 2–6 working days/week, irregular

March:
- **21.6 commits/day** average
- Post-commit hotfixes: **0.3/day**
- No late-night work
- 5 days/week, stable

Commits dropped 55%, but Feature output increased.

Note: October–November lacked Feature tracking, so some comparisons are estimates. This isn't a perfectly controlled comparison.

---

## What I Learned

Many commits can also mean "many corrections."

The pattern from my 6-month data:

> **October–November's high commit volume was the "effort era." March's lower commits are the result of systems built on top of that effort.**

Two things made the difference: **systems** that reduced repetitive costs, and **experience** from every problem hit in October–November. Both required time. March's efficiency wouldn't exist without October's struggles.

Commit count measures activity.

But the metric that actually matters is **how much value each commit delivers**.

If that number keeps increasing, you're probably getting better at engineering.
