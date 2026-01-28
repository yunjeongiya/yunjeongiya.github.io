---
layout: post
title: "The Cheapest Way to Pass Context to AI - A Features Tracking System"
date: 2026-01-28 12:00:00 +0900
categories: [AI, Productivity]
tags: [ai, claude-code, workflow, project-management, developer-productivity, features-system]
lang: en
slug: "025-en"
---

## TL;DR

AI coding tools lose context between conversations. I built a system where every feature is one markdown folder. Read one INDEX.md file (~300 tokens) instead of 130 feature files (~15,000 tokens), and the AI picks up right where it left off.

---

## The Problem

After 3+ months of building with Claude Code, the same issue kept coming up.

```
Conversation #1: "Build the weekly schedule feature"
→ 50% implemented

(Computer shutdown)

Conversation #2: "Continue from yesterday..."
→ AI: "What were we working on?"
```

Re-explaining everything from scratch, every time. TODOs scattered across code comments, Notion, Git Issues, and my head. Just telling the AI "what needs to be done right now" was work in itself.

<!-- 📸 Optional screenshot: Before/After comparison
Filename: 09-before-after-comparison.png
Content: 2-column layout - Before(code comments, Notion, Git Issues) / After(features/INDEX.md)
Capture: PowerPoint/Figma 2-column layout
-->

---

## The Fix: One Feature = One Folder

<!-- 📸 Recommended screenshot #1: Features folder structure
Filename: 01-features-folder-structure.png
Content: VS Code Explorer showing features/ folder tree
Capture: Expand checkus-docs/features/ in VS Code and screenshot
-->

The idea is simple. When a feature starts, create a folder. Put all context inside.

```
features/
├── INDEX.md                       # Summary cache
├── F001-classroom-management/
│   ├── README.md                  # Work tracking + context
│   ├── blog.md                    # Blog draft (optional)
│   └── images/                    # Screenshots
├── F002-controller-refactoring/
└── ...
```

I've managed 130 features this way over 3 months. Two key design decisions made it work.

---

### 1. State Lives in Frontmatter

<!-- 📸 Recommended screenshot: Feature frontmatter example
Filename: 03-feature-frontmatter.png
Content: Actual Feature file frontmatter (F001 recommended)
Capture: Open README.md and capture the top section
-->

I initially planned to move files between `todo/`, `in-progress/`, and `done/` folders. But that breaks `git log` and GitHub blame.

So the file stays put. Only the frontmatter changes.

```markdown
---
id: F001
title: Classroom Management System
status: DONE              # TODO → IN_PROGRESS → DONE
priority: HIGH
created: 2025-10-18 KST
completed: 2025-10-21 KST
elapsed_hours: 16
---

## ✅ Completed
- [x] Classroom CRUD API
- [x] Seat arrangement UI

## 🔗 Related Commits
- `8356a91` - feat: add classroom management
```

<!-- 📸 Recommended screenshot: Git Log history
Filename: 06-git-log-history.png
Content: feature file git log output
Capture: git log --oneline features/F001-.../README.md
-->

`git log features/F001-.../README.md` shows the full history. No `--follow` needed because the file never moved.

---

### 2. INDEX.md = Cache

Reading 130 files burns tens of thousands of tokens. One summary file fixes that.

<!-- 📸 Recommended screenshot: INDEX.md
Filename: 02-index-md-cache.png
Content: INDEX.md top section (summary + IN_PROGRESS)
Capture: Open checkus-docs/features/INDEX.md and screenshot
-->

```markdown
## 📊 Summary
- TODO: 10 | IN_PROGRESS: 8 | DONE: 89

## 🚀 IN_PROGRESS
### [F128](F128-teacher-mobile-app/) Teacher Mobile App
- Progress: 40%
```

INDEX.md: ~300 tokens. All files: ~15,000 tokens. **50x difference.**

When AI needs to know "what was I working on?", INDEX.md answers immediately. Detailed context? Read the individual file on demand.

---

## Slash Commands for Automation

Managing this manually would be tedious enough that nobody would do it. So I automated it with Claude Code slash commands.

<!-- 📸 Recommended screenshot: /finish command
Filename: 04-finish-command.png
Content: .claude/commands/finish-checkus.md file
Capture: Open and screenshot
-->

- **`/finish`**: Updates frontmatter → refreshes INDEX.md → writes work log → Git commits. All in one go.
- **`/blog`**: Analyzes Features docs + Git diff to auto-generate a blog draft. Even recommends which screenshots to take.
- **`/pause`** & **`/resume`**: Suspend/resume work. Reads only INDEX.md to figure out where things left off.

`/blog` was especially useful—run it right after finishing a feature and the draft captures that moment's context. No more struggling 3 weeks later trying to remember what happened.

---

## What Changed

130 features managed with this system:

| | Before | After |
|--|--------|-------|
| Context in new conversations | 5-10 min explaining each time | INDEX.md → individual file, instant |
| TODO management | Notion + comments + my head | One `features/` directory |
| Blog writing | "Later..." → never | `/blog` → immediate draft |

Compared to other tools:

| Tool | Difference |
|------|-----------|
| Claude Task Master | MCP-based, 36 tools. Ours uses only markdown |
| GitHub Issues | Project-level. Ours is feature-level granularity |
| Notion | Manual. Ours is automated via slash commands |

Auto-generated blog drafts and screenshot timing management are things I haven't seen in other tools.

---

## Takeaways

**AI is a teammate, not a tool.** Just like you'd leave docs for a teammate who joins mid-project, leave docs for AI. Say `"start F023"` and the AI reads the relevant file and picks up context on its own.

**File movement is Git's enemy.** Moving folders to change state breaks history. Frontmatter is the answer.

**Tokens are money.** One INDEX.md cache saves 50x. When using AI tools, always think about how many tokens an operation costs.

---

## The Industry Is Heading the Same Way

I built this system 3 months ago. Looking at the tools that have launched since, the direction is remarkably similar.

[Google Antigravity](https://antigravityai.org/) has agents that plan, implement, and verify work while generating **Artifacts** — task lists, implementation plans, screenshots. [AWS Kiro](https://kiro.dev/) calls it **spec-driven development**: a single prompt generates requirements docs, and development follows from there. Claude Code itself added [sub-agents, hooks, and skills](https://venturebeat.com/orchestration/claude-code-2-1-0-arrives-with-smoother-workflows-and-smarter-agents/) in 2.1.0 for agent orchestration.

Standardization efforts point the same way. [AGENTS.md](https://agents.md/) is building a "README for AI agents" format under the Linux Foundation. [Google Conductor](https://developers.googleblog.com/conductor-introducing-context-driven-development-for-gemini-cli/) provides markdown-based planning with pause/resume. The GitHub Blog even introduced [spec-driven development using markdown as a programming language](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-using-markdown-as-a-programming-language-when-building-with-ai/).

They're all solving the same problem: **how to pass context to AI.** The more autonomous agents become, the more valuable structured context documents get.

Being markdown-based also means no vendor lock-in. Switch from Claude Code to Antigravity tomorrow, and the features/ folder comes as-is.

---

## References

- [Claude Task Master](https://github.com/eyaltoledano/claude-task-master) - MCP-based task management
- [GitHub Copilot Agent Primitives](https://github.blog/ai-and-ml/github-copilot/how-to-build-reliable-ai-workflows-with-agentic-primitives-and-context-engineering/)
- [Agentic Workflow Patterns](https://github.com/arunpshankar/Agentic-Workflow-Patterns)

---

The bottleneck in AI coding isn't code generation speed—it's **context transfer speed**. A few markdown files solve that.
