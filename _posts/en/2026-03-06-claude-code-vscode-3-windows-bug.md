---
layout: post
title: "Fix: Claude Code Opens 3 Blank VSCode Windows on Startup"
date: 2026-03-06 11:00:00 +0900
categories: [Claude, DevTools]
tags: [claude, claude-code, bug, workaround, vscode, windows]
lang: en
slug: "038-en"
thumbnail: /assets/images/posts/038-claude-vscode-3-windows/thumbnail-ko.png
---

Here we go again. Another Claude Code bug post.

If my [last one](https://yunjeongiya.github.io/claude/devtools/2025/09/27/claude-file-modified-bug-workaround.html) was about the "File has been unexpectedly modified" error, this time it's **VSCode windows multiplying like rabbits**.

---

## The Symptom

Run `claude` from VSCode's integrated terminal → **3 blank VSCode windows** appear. Every. Single. Time.

- From a standalone PowerShell? No problem.
- From VSCode's integrated terminal only? 100% reproducible.

At first I thought it was my config. I messed with VSCode tasks, disabled extensions, wasted a day. Turns out it wasn't just me.

---

## The Cause

This is a bug introduced in **Claude Code v2.1.68** (released 2026-03-04).

VSCode's integrated terminal sets an environment variable: `TERM_PROGRAM=vscode`. Claude Code detects this and tries to connect to the IDE. The bug? **Each MCP server initialization triggers a new VSCode window**.

3 MCP servers configured = 3 windows. Simple math.

GitHub is flooded with reports:
- [#30848](https://github.com/anthropics/claude-code/issues/30848) — v2.1.68 opens 3 blank VS Code windows
- [#31016](https://github.com/anthropics/claude-code/issues/31016) — Starting Claude in VSCode terminal opens 3 new windows
- [#31136](https://github.com/anthropics/claude-code/issues/31136) — Windows: 3 blank VS Code windows spawn on every session start

Still not fixed in v2.1.69. No official patch yet.

---

## The Fix

Strip the environment variables that tell Claude Code it's running inside VSCode.

### Option 1: Permanent Fix via VSCode Settings (Recommended)

Add to your `.vscode/settings.json`:

```json
{
    "terminal.integrated.env.windows": {
        "TERM_PROGRAM": "",
        "VSCODE_INJECTION": ""
    }
}
```

If you already have `terminal.integrated.env.windows`, just add the two new keys to it.

**Reload VSCode** after applying (opening a new terminal alone may not be enough).

### Option 2: Per-Session Workaround

PowerShell:
```powershell
$env:TERM_PROGRAM=''; $env:VSCODE_INJECTION=''; claude
```

Bash:
```bash
TERM_PROGRAM= VSCODE_INJECTION= claude
```

---

## Any Side Effects?

Clearing these variables disables Claude Code's **VSCode IDE integration**:
- Opening files directly in VSCode's editor
- VSCode diff viewer integration
- The "Connected to VSCode" indicator

Honestly, if you run multiple Claude Code instances in parallel (like I do), this feature never worked properly anyway — only one instance can connect, the rest show "disconnected." Not much to lose.

Remove the workaround once Anthropic ships a proper fix.

---

## Takeaway

Another cycle of "Claude Code updates → something breaks." At least the community finds workarounds fast.

As I said in my [previous post](https://yunjeongiya.github.io/claude/devtools/2025/09/27/claude-file-modified-bug-workaround.html), the most reliable source of truth is always [GitHub Issues](https://github.com/anthropics/claude-code/issues).

---

**Related links**:
- [GitHub Issue #30848](https://github.com/anthropics/claude-code/issues/30848)
- [GitHub Issue #31136](https://github.com/anthropics/claude-code/issues/31136)
- [Previous post: The Elusive Claude "File Has Been Unexpectedly Modified" Bug](https://yunjeongiya.github.io/claude/devtools/2025/09/27/claude-file-modified-bug-workaround.html)
