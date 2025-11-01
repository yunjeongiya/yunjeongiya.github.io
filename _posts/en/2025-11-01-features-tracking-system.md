---
layout: post
title: "Features Tracking System for AI Coding Agents - Managing 29 Features"
date: 2025-11-01 09:00:00 +0900
categories: [Productivity, AI-Workflow]
tags: [claude-code, ai, project-management, workflow, documentation, productivity]
lang: en
---

## TL;DR

When developing with AI tools like Claude Code, you lose work context. The Features tracking system documents every feature, saves 50x tokens with INDEX.md, and auto-generates blog drafts with the `/blog` command.

Tracking 29 features, 50x token savings, reduced blog writing barrier.

---

## Background: Limitations of daily_work_summary

Initially, I only kept daily work logs in `daily_work_summary/2025-10-15.md` format.

```markdown
# 2025-10-15
- Fixed login functionality
- Fixed search bug
- Started adding caching
```

**Problems emerged days later:**

1. **No Feature-Level Tracking**
   - "How did I fix that search bug?" → digging through multiple date files
   - "Where are caching-related commits?" → searching entire Git log

2. **Claude Conversation Thread Management Failed**
   - Working on 3 features in parallel → 3 conversation threads
   - After a few days, forgot thread titles, old threads disappeared from list
   - Starting new conversation → had to re-explain "what I was working on"

3. **AI Token Waste**
   - Explaining "what I did last week" → need to read 5 daily_log files
   - 33 features → reading all 33 READMEs = 15,000 tokens consumed

→ **Introduced Features system for feature-level tracking + token savings**

---

## Solution: Features System

### Real-World Usage Flow

**Scenario 1: When Pausing Work** (Need to shut down computer)

```
(Working on F006 search feature...)

Me: /pause
AI: "Saved F006 progress"
    → Record current state in frontmatter
    → Update INDEX.md

(Computer shutdown, weekend passes...)
```

**Scenario 2: When Resuming Work** (Monday morning)

```
Me: /resume
AI: "Paused work: F006 Search Performance Optimization (30% progress)"
    → Read INDEX.md to check paused work
    → Read F006/README.md to understand "where I left off"

→ Claude conversation thread reset? No problem ✅
→ Forgot over the weekend? No problem ✅
```

**Scenario 3: When Completing Work**

```
Me: /finish
AI: Automatically handles:
    1. Update Features documentation (status: DONE)
    2. Write work log
    3. Git commit
    4. "Is this worth blogging about?" assessment
```

**Result**: AI remembers and manages my work context.

---

### Core Idea

**"Every feature = One document"**

```
features/
├── INDEX.md                           # Cache for quick lookup
├── F001-classroom-management/         # Feature folders
│   ├── README.md                      # Work tracking
│   ├── blog.md                        # Blog draft (optional)
│   └── images/                        # Screenshots
│       ├── 01-before.png
│       └── 02-after.png
├── F002-controller-refactoring/
└── F029-logging-policy-aop/
```

### 1. State Management with Frontmatter

**Why not use other approaches?**

Many project management systems organize by status folders:

```
TODO/F001-user-auth.md
IN_PROGRESS/F001-user-auth.md
DONE/F001-user-auth.md
```

The problem: **Moving files breaks Git history**:
- `git log F001-user-auth.md` → "Huh? This file was just created?"
- Git sees it as "file deletion + new file creation"
- GitHub blame doesn't work properly

**Solution: Keep files in place, change only metadata**

```markdown
---
id: F001
title: Classroom Management System
status: DONE                 # TODO → IN_PROGRESS → DONE
priority: HIGH
created: 2025-10-18 KST
completed: 2025-10-21 KST
elapsed_hours: 16
labels: [feature, backend, frontend]
---

# Classroom Management System

## ✅ Completed Tasks
- [x] Classroom CRUD API
- [x] Seat layout UI
- [x] Row/column width adjustment

## 🔗 Related Commits
- `8356a91` - feat: add classroom management feature
```

**Benefits**:

- `git log features/F001-classroom-management/README.md` tracks the entire process
- GitHub blame works normally
- Only status changes, no file movement

### 2. Token Savings with INDEX.md

Reading 50 feature files wastes **tens of thousands of tokens**. Instead, read one summary.

```markdown
---
last_updated: 2025-11-01 20:00 KST
auto_generated: true
---

## 📊 Summary
- **TODO**: 8
- **IN_PROGRESS**: 2
- **DONE**: 21

## 🚀 IN_PROGRESS

### [F006](F006-teacher-schedule-management/) Teacher Weekly Schedule
- **Started**: 2025-10-30 05:00 KST
- **Progress**: 30%

## 📋 TODO

### [F023](F023-current-user-annotation/) @CurrentUser Annotation
- **Estimated**: 2-3 hours
- **Topic**: Automate controller auth checks
```

**Impact**:

- Reading INDEX.md: ~300 tokens
- Reading all files: ~15,000 tokens
- **50x savings!**

### 3. Automated Blog Drafting

Feature complete → `/blog` command → draft + image recommendations auto-generated.

```markdown
features/F001-classroom-management/
├── README.md
└── blog.md          # Auto-generated
```

**blog.md example**:

```markdown
---
title: "Implementing Drag-and-Drop Seat Layout in React"
date: 2025-10-21
tags: [React, DnD, TypeScript]
draft: true
---

## Background
We needed a seat layout feature in the academy management system...

## Implementation
Used HTML5 Drag & Drop API directly instead of react-dnd...
```

**+ Image recommendations**:

```
### 📸 Recommended Screenshots

1. **Seat dragging screen**
   - Filename: `01-drag-interaction.png`
   - Content: Capture while dragging a seat
   - How: Classroom management > Seat layout mode > Drag

📁 Save location: `features/F001-classroom-management/images/`

⚠️ **Important**: Capture now or you won't be able to later when UI changes!
```

→ **Forces immediate capture after development**

### 4. Full Automation with Slash Commands

#### `/finish` - 8-Step Automated Process

```
1. Check changes
2. Clean code (remove debug logs)
3. Update Features system ⭐
   → frontmatter status: DONE
   → completed: [current time]
   → Update INDEX.md
4. Write work log
5. Sync requirement.md
6. Git commit
7. Record commit hash in Features file ⭐
8. Final report
```

#### `/blog` - Blog Draft + Images

```
1. Analyze recent work
2. Judge blog-worthiness
3. User confirmation
4. Write blog draft
5. Recommend images/screenshots ⭐
6. Guide save location
```

#### `/pause` & `/resume` - Suspend/Resume Work

```
/pause
→ Save state of current IN_PROGRESS work
→ Update INDEX.md

(Next day)

/resume
→ Read only INDEX.md to check suspended work (save tokens)
→ When user selects, read that feature file
→ Resume with TodoWrite
```

---

## Results

### Quantitative Impact

- **29 features tracked** (8 TODO, 2 IN_PROGRESS, 21 DONE)
- **50x token savings** (thanks to INDEX.md cache)
- **4,469 lines organized** (api/, refactoring/, analysis/, etc.)
- **7 TODOs auto-generated** (CONTROLLER_IMPROVEMENTS.md → F023-F029)

### Qualitative Impact

**1. Context Preservation**

```
Start new conversation:
"Continue F006 work"

AI reads INDEX.md → reads F006 file → immediately resumes
```

**2. Perfect Git History Preservation**

```bash
$ git log features/F001-classroom-management/README.md
→ All 12 commits over 3 days trackable
```

**3. Lower Blog Writing Barrier**

```
Before: "I'll write it later..." → Never writes
After: blog.md + image recommendations → Draft complete immediately
```

**4. Industry Comparison**

| Tool | Features | Features System |
|------|----------|----------------|
| Claude Task Master | MCP-based, 36 tools | ✅ Simpler with Markdown |
| GitHub Issues | Project-level | ✅ Feature-level granularity |
| Notion | Manual management | ✅ AI automation |
| - | - | ✅ **Blog integration** (unique) |
| - | - | ✅ **Image timing** (innovative) |

---

## Lessons Learned

### 1. "Conversation Context > Git Log"

Problem: When developing multiple features simultaneously

```
git log --since="1 hour ago"
→ F001, F002, F003, F032 commits mixed
→ AI asks "What were you working on?"
```

Solution: **If in same conversation thread, AI already knows!**

```
User: (Working on F032...)
User: /finish

AI:
1. Check conversation context: "Worked on F032 in this session" ✅
2. Immediately: "Should I complete F032?"
```

**Information Priority**:

1. **Features/README.md** (highest) - Already structured context
2. daily_work_summary (supplement) - Details, trial & error
3. Git diff (code examples) - Actual changes

→ Git log used as **fallback only in new threads**!

### 2. "AI is a Teammate, Not a Tool"

Don't just use AI as a coding assistant, **design a workflow AI can follow**.

```
❌ "AI, do this" (explain every time)
✅ "AI, start F023 work" (system auto-loads context)
```

### 3. "File Movement is Git's Enemy"

Moving files `todo/` → `in-progress/` → `done/` when changing state:

- Needs `git log --follow`
- Breaks GitHub blame
- Hard to track history

→ **Solved with Frontmatter metadata!**

### 4. "Tokens are Money"

Reading 50 files every time:

- Slow
- Expensive
- Context fills up

→ **50x savings with INDEX.md cache**

### 5. "Screenshots are About Timing"

Capture **immediately after development**, not when writing blog.

→ **Built image recommendations into `/blog` command**

### 6. "Standardize Across All Projects"

Established Features system as **required standard for all projects**, not just CheckUS.

```markdown
# C:/Users/YJL/.claude/CLAUDE.md (Global settings)

## 📋 Features Tracking System (Standard for All Projects)

### Core Principle
**Every task is tracked as a Feature.**
- ✅ New feature development → Feature
- ✅ Bug fix → Feature
- ✅ Refactoring → Feature
- ✅ Documentation → Feature
- ❌ "Work not tracked in Features" doesn't exist
```

**Auto-setup prompt**:

```
# When running /finish in a new project

AI:
1. Check for docs/features/ folder
2. If not found:

┌────────────────────────────────────────┐
│ ⚠️  No Features tracking system.       │
│                                        │
│ Set it up now?                         │
│                                        │
│ Will create:                           │
│ - docs/features/INDEX.md               │
│ - docs/features/F001-[current work]/   │
│                                        │
│ [Y/n]                                  │
└────────────────────────────────────────┘
```

## Considerations

### 1. INDEX.md is a "Cache"

- Individual files are source of truth
- INDEX.md can be regenerated if corrupted
- Auto-update is essential

### 2. Prevent Feature Bloat - Search Related Features

Problem: Creating new Feature for every small bug fix?

```
F032: Implement /blog command
F033: Fix /blog web search bug
F034: Fix /blog encoding error
F035: Improve /blog tone
```

→ Too many Features!

Solution: **Auto-search related Features** when running `/finish`

```
User: "Fixed /blog web search error. /finish"

AI:
1. Extract keywords from conversation context: "blog", "web search"
2. Search INDEX.md → Find F032
3. Offer user choice:

┌─────────────────────────────────────────┐
│ Looks related to F032.                  │
│                                         │
│ A) Continue F032                        │
│    - status: DONE → IN_PROGRESS         │
│    - Add "🐛 Additional Changes (2nd)"  │
│                                         │
│ B) Create new Feature (F033)            │
│                                         │
│ Choice: [A/B]                           │
└─────────────────────────────────────────┘
```

**If A selected**: Resume Feature

```markdown
---
id: F032
status: IN_PROGRESS  # DONE → IN_PROGRESS
resumed: 2025-10-31 12:00 KST
completed: 2025-10-31 10:30 KST  # Keep first completion time
---

## 🐛 Additional Changes (2nd - 2025-10-31)

### Background
Found web search encoding bug while working on F032...

### Changes
- Specify UTF-8 encoding
- Improve search result parsing logic

### Related Commits
- `abc1234` - fix: web search encoding error
```

→ **Related work consolidated in one place!**

---

## Conclusion

The Features tracking system:

1. **Context Preservation** - AI doesn't lose work context
2. **Token Savings** - 50x efficiency with INDEX.md
3. **Blog Automation** - Auto-generate draft + image recommendations
4. **Git History Preservation** - State management with Frontmatter
5. **Global Standardization** - Applied to all projects

Ultimately managed 29 features systematically and lowered blog writing barrier.

If you use AI coding tools, build a workflow AI can follow first.

---

**Next in series**: [/blog Command - How I Reduced Blog Writing Time by 83%](https://yunjeongiya.github.io/en/productivity/ai-workflow/2025/11/01/blog-command-ai-workflow/)
