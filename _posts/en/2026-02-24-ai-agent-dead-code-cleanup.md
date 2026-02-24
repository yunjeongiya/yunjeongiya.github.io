---
layout: post
title: "I Used an AI Agent to Delete 5,000 Lines of Dead Code"
date: 2026-02-24 15:00:00 +0900
categories: [DevOps, Refactoring]
tags: [dead-code, static-analysis, ai-coding-agent, refactoring, spring-boot, react, clean-code, claude-code]
lang: en
slug: "035-en"
thumbnail: /assets/images/posts/035-ai-agent-dead-code/thumbnail-en.png
---

![I Used an AI Agent to Delete 5,000 Lines of Dead Code](/assets/images/posts/035-ai-agent-dead-code/thumbnail-en.png){: width="700"}

Every codebase has a graveyard. Functions nobody calls, DTOs nobody maps, exports nobody imports. You know it's there. You just never have time to clean it up.

Our project — a Spring Boot 3.4 + React/TypeScript monorepo with 35+ backend modules and 15+ frontend features — had accumulated a lot of it. Instead of setting up SonarQube or installing Knip, I pointed an AI coding agent at the whole thing and said "find the dead code." Two hours later, **5,156 lines were gone across 143 files**, and both builds still passed.

Here's exactly how it went.

---

## Why Not Just Use [Existing Tool]?

The obvious question: why not use a dedicated static analysis tool?

**SonarQube** — Needs a server, database, CI integration. We're pre-production. That's a sledgehammer for a nail.

**ESLint `no-unused-vars`** — Only catches unused *local variables*. It won't tell you that `formatPhoneNumber()` is exported from `utils/phone.ts` but never imported anywhere in the project.

**Knip** — Good for JavaScript/TypeScript, but our backend is Java. We'd need two tools with two configs, and Knip still can't understand Spring's dependency injection.

**IntelliJ "Unused" inspections** — Works per-file, not in batch mode across 1,032 Java files. You'd be clicking through dialogs for hours.

What we wanted: zero setup, works across both languages, understands git history, and lets us review before deleting anything. An AI agent with grep turned out to be exactly that.

## The Approach: Grep-Based Static Analysis + AI Orchestration

The core idea is simple. For every exported symbol in the codebase, grep the entire project for references to that symbol. Zero references = candidate for deletion.

We formalized this into a 6-phase process:

```
Phase 1: Frontend scan (542 .ts/.tsx files)
Phase 2: Backend scan (1,032 .java files)
Phase 3: Git history analysis (git log -S for each candidate)
Phase 4: Report (structured tables, before any deletion)
Phase 5: Interactive cleanup (user chooses what to remove)
Phase 6: Build verification (npm run build + gradlew compileJava)
```

For the frontend, the scan covered three categories:

- **1A: Unused files** — `.ts/.tsx` files never imported by any other file
- **1B: Unused named exports** — exported symbols with zero importers
- **1C: Stale barrel re-exports** — `index.ts` re-exports that nobody consumes

For the backend, four categories:

- **2A: Unused DTOs** — `*Request.java`, `*Response.java`, `*Dto.java` with zero references
- **2B: Unused repository methods** — custom query methods never called by any Service
- **2C: Unused utility methods** — public methods in `util/helper/common` packages
- **2D: Unused classes** — non-Spring classes with zero importers

The frontend and backend scans ran in parallel using separate task agents, cutting wall-clock time roughly in half.

## Spring's "Always Alive" Problem

Here's where Java/Spring makes dead code detection fundamentally different from JavaScript.

In a React app, if nothing imports a file, it's dead. Simple. But in Spring Boot, a class annotated with `@Service` is alive even if no `.java` file explicitly references it — because Spring's component scan picks it up at runtime and injects it wherever it's needed.

This means a naive "search for importers" approach would flag nearly every service class as dead code. Catastrophic.

Our solution was a strict exclusion list — what we called the **"Always Alive" rule**:

```
Never flag classes annotated with:
  @Component, @Service, @Repository, @Controller, @RestController
  @Configuration, @Bean
  @Entity, @MappedSuperclass, @Embeddable
  @Scheduled, @EventListener, @Async
  @Aspect, @ControllerAdvice, @RestControllerAdvice
  @Converter, @JsonComponent
  Any *Initializer class
  Anything under src/test/
```

This is deliberately conservative. We'd rather miss some dead code than accidentally delete a service that Spring wires at startup. The grep-based approach then only targets the *data objects* — DTOs, utility methods, repository query methods — where the reference chain is fully visible in source code.

## The Results

**Frontend cleanup (542 files scanned):**

| Category | Items Removed |
|----------|:---:|
| Unused files deleted | 3 |
| Unused exports removed | ~105 |
| Stale barrel re-exports cleaned | 33 |
| **Lines deleted** | **2,070** |

The 3 deleted files: `TeacherTaskForm.tsx`, `TeacherScheduleDialog.tsx`, and `lib/errorUtils.ts` — components from features that were later redesigned, leaving the old implementations behind.

**Backend cleanup (1,032 files scanned):**

| Category | Items Removed |
|----------|:---:|
| Unused DTOs deleted | 13 |
| Unused utility classes deleted | 3 |
| Unused repository methods removed | ~185 |
| Unused utility methods removed | 11 |
| **Lines deleted** | **3,086** |

The 3 deleted utility classes: `DomainUtils`, `StringValidationUtils`, `CampusTimeUtils`. Each had been superseded by better implementations months ago but never cleaned up.

**Combined totals:**

| Metric | Value |
|--------|------:|
| Files scanned | 1,574 |
| Dead code items found | ~356 |
| Files changed | 143 |
| Lines deleted | 5,156 |
| False positives caught by build | 2 |
| Total elapsed time | ~2 hours |

## The False Positives (And Why Build Verification Is Non-Negotiable)

Two items made it through the scan as "dead" but weren't. Both were caught by the build step, not by the scan itself.

**False positive #1: The aliased field name**

`OrderService` had two methods — `generateFirstOrder()` and `generateBetweenOrder()`. The grep scan searched for `OrderService.generateFirstOrder` and found nothing. Dead code, right?

Wrong. `TaskTemplateOrderService` injects `OrderService` into a field named `orderService` (lowercase), then calls `orderService.generateFirstOrder()`. The grep pattern was searching for the class name, not the field name. The methods were very much alive.

Caught by `./gradlew compileJava` -> compilation error -> auto-restored via `git checkout`.

**False positive #2: The missed call syntax**

`SeatWaitingEntryRepository` had 3 methods flagged as unused. They were actually called by `SeatWaitingService`, but the scan agent's grep pattern didn't match the specific call syntax used.

Same story: caught by build, auto-restored.

**Bonus: the corrupted import**

During the batch removal of repository methods, one of the agent's edits accidentally broke an import statement — inserting a line break in the middle of a package name. Not a false positive per se, but another thing caught exclusively by the build step.

The takeaway is blunt: **without build verification, we would have shipped broken code.** The scan is a heuristic. The build is the source of truth.

## The Reusable Command

We didn't want this to be a one-off. The entire process is now a reusable `/dead-code` slash command in our Claude Code configuration.

The 6-phase flow:

```
/dead-code
  |
  +-- Phase 1: Frontend scan
  |   +-- 1A: Unused files
  |   +-- 1B: Unused named exports
  |   +-- 1C: Stale barrel re-exports
  |
  +-- Phase 2: Backend scan (parallel with Phase 1)
  |   +-- 2A: Unused DTOs
  |   +-- 2B: Unused repository methods
  |   +-- 2C: Unused utility methods
  |   +-- 2D: Unused classes
  |
  +-- Phase 3: Git history (classify STALE / RECENT / ORPHANED)
  |
  +-- Phase 4: Report (tables, no deletions yet)
  |
  +-- Phase 5: Interactive cleanup
  |   +-- Clean ALL
  |   +-- Clean by category
  |   +-- Review one-by-one
  |   +-- Export report only
  |
  +-- Phase 6: Build verification
      +-- On failure: auto-restore false positive, retry
      +-- On success: suggest commit
```

Four key design decisions:

**Conservative scanning** — The command prefers false negatives over false positives. If a symbol name appears in a string literal (reflection, dynamic imports), it's not flagged.

**Git pickaxe classification** — `git log -S "<symbol>"` tells you *when* the last reference was removed. A symbol whose import was explicitly deleted 8 months ago (ORPHANED) is a much stronger deletion candidate than one that was simply never imported from (might be WIP).

**Report before acting** — Phase 4 is mandatory. The user sees every candidate, with file paths, last-modified dates, and classification signals, before a single line is deleted.

**Auto-restore on build failure** — If the build fails after cleanup, the command identifies the broken file, runs `git checkout -- <path>`, re-runs the build, and notes it as a false positive. No manual intervention needed.

## Key Takeaways

**1. Conservative scanning beats aggressive scanning.** Our 2 false positives (out of ~356 candidates) is a 0.56% rate, and both were caught automatically. Start strict; you can always loosen later.

**2. Build verification is the only reliable safety net.** Grep-based analysis is a heuristic. It can't trace field-name aliases, reflection, or dynamic dispatch. The build catches what the scan misses. Always run it after cleanup.

**3. Git context separates "probably dead" from "definitely dead."** A function with zero callers that was last touched yesterday is probably work-in-progress. A function whose import was explicitly removed 8 months ago is almost certainly dead. `git log -S` gives you that signal for free.

**4. You don't need a dedicated tool for this.** SonarQube, Knip, and IDE inspections all have their place. But for a project where you want a quick, cross-language sweep with interactive review, an AI agent with grep, git, and a build command covers the gap surprisingly well. The whole run — 1,574 files, 356 candidates, 5,156 lines deleted — took about 2 hours with zero setup.

---

Dead code is technical debt that accumulates silently. It makes grep results noisier, onboarding harder, and refactoring riskier. The longer you wait, the more it costs to clean up. Two hours and an AI agent got us back to a clean baseline.
