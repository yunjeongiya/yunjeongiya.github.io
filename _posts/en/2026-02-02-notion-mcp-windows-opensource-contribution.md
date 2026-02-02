---
layout: post
title: "Reading 20K Notion Pages Without the API - Local Cache + My First Open Source PR"
date: 2026-02-02 00:00:00 +0900
categories: [OpenSource, Productivity]
tags: [notion, mcp, sqlite, opensource, claude, windows]
lang: en
slug: "026"
thumbnail: /assets/images/posts/026-notion-mcp/thumbnail-en.png
---

![Reading 20K Notion Pages with Local Cache](/assets/images/posts/026-notion-mcp/thumbnail-en.png){: width="700"}

## TL;DR

- Notion API rate limits made it impossible to analyze thousands of pages
- Discovered Notion desktop app stores a local SQLite cache
- Read **20K pages** in **3 seconds** without any API calls
- Added Windows support to a macOS-only tool and submitted my **first PR**

---

## The Problem: Too Much Notion Data

I run a tutoring academy and have been logging consultation records in Notion for years. Thousands of pages worth. I wanted to analyze this data with Claude.

### Attempt 1: Official Notion API

```
429 Too Many Requests
```

Hit the rate limit almost immediately with this much data.

### Attempt 2: Notion Export

Settings → Export → Markdown & CSV. Failed completely—too much data.

### Attempt 3: Official Notion MCP Server

Tried the OAuth integration, but it uses the API internally. Same problem.

---

## The Discovery: Local SQLite Cache

Found the solution in [this GPTers post](https://www.gpters.org/dev/post/how-read-20000-pages-jvPKBVs7YdLPgiK) (Korean).

The key insight:

> Notion desktop app stores data locally as a **SQLite database**.
> You can read it directly without any API calls.

Notion mirrors server data to local SQLite for offline sync, and the cache is surprisingly well-structured.

Cache locations:
- **macOS**: `~/Library/Application Support/Notion/notion.db`
- **Windows**: `%APPDATA%/Notion/notion.db`

Checked my machine—found a **628MB** SQLite file sitting there.

---

## But It Was macOS Only

Tried using [notion-mcp-fast](https://github.com/chat-prompt/notion-mcp-fast) from the article.

```bash
claude mcp add notion-local -- uvx \
    --from "git+https://github.com/chat-prompt/notion-mcp-fast" \
    notion-mcp-fast
```

Result:

```
FileNotFoundError: Notion database not found at
~/Library/Application Support/Notion/notion.db
```

The macOS path was hardcoded. I'm on Windows.

---

## Fixed It Myself

Opened the code—turned out to be pretty simple. The path setting in `reader.py`:

```python
# Original (macOS only)
NOTION_DB_PATH = os.path.expanduser(
    "~/Library/Application Support/Notion/notion.db"
)
```

Changed it to detect OS automatically:

```python
import platform

def _get_default_notion_db_path() -> str:
    # Allow env variable override
    if env_path := os.environ.get("NOTION_DB_PATH"):
        return env_path

    system = platform.system()
    if system == "Darwin":  # macOS
        return os.path.expanduser(
            "~/Library/Application Support/Notion/notion.db"
        )
    elif system == "Windows":
        return os.path.join(
            os.environ.get("APPDATA", ""),
            "Notion",
            "notion.db"
        )
    else:  # Linux
        return os.path.expanduser("~/.config/Notion/notion.db")

NOTION_DB_PATH = _get_default_notion_db_path()
```

What I added:
1. OS detection via `platform.system()`
2. Windows: `%APPDATA%/Notion/notion.db`
3. Linux: `~/.config/Notion/notion.db`
4. `NOTION_DB_PATH` env variable for custom paths

The Linux path follows [Arch Wiki](https://wiki.archlinux.org/title/XDG_Base_Directory)'s XDG Base Directory standard, but I couldn't verify if Notion actually uses this path. The Linux path is an educated guess—actual Notion AppImage/Snap environments may differ. Asked for feedback in the PR.

---

## Submitting the PR

Decided to submit a PR while I was at it. First time contributing to open source—a bit nervous.

### Fork → Branch → Commit → Push → PR

```bash
# 1. Fork (on GitHub web)

# 2. Clone and modify
git clone https://github.com/chat-prompt/notion-mcp-fast
cd notion-mcp-fast
# ... make changes ...

# 3. Add fork as remote
git remote add fork https://github.com/yunjeongiya/notion-mcp-fast.git

# 4. Create branch and commit
git checkout -b feat/cross-platform-support
git add src/notion_mcp_fast/reader.py
git commit -m "feat: add cross-platform support (Windows, Linux)"

# 5. Push and create PR
git push -u fork feat/cross-platform-support
# Create PR on GitHub
```

PR link: https://github.com/chat-prompt/notion-mcp-fast/pull/1

It was the first PR to this repo. Wasn't sure if it would get merged...

---

## Result

Works on Windows.

```bash
claude mcp add notion-local -- uvx \
    --from "C:/Users/YJL/Desktop/notion-mcp-fast" \
    notion-mcp-fast
```

After restarting Claude Code, these tools became available:

- `notion_list_pages` - List pages
- `notion_search_pages` - Search by title
- `notion_full_text_search` - Full text search
- `notion_list_databases` - List databases
- `notion_get_database_records` - Query database records

628MB database, thousands of pages loaded in **seconds**. No rate limit worries.

**Test coverage:**
- ✅ Windows 11 - Confirmed working
- ⬜ Linux - Untested (no environment, requested feedback in PR)

---

## Takeaways

### 1. Easier Than Expected

```diff
- 3 lines
+ 18 lines
```

21 lines total. "I want to use this but it doesn't work → fix it → PR." That's it.

### 2. Reach Out to the Author

Left a comment on the original author's [Threads](https://www.threads.com/@ai.winey_ny/post/DUPG8F_kv6v). Got merged immediately.

![Threads conversation](/assets/images/posts/026-notion-mcp/threads-conversation.jpg){: width="400"}

Gets your PR reviewed faster and builds community connections.

### 3. MIT License

Modify, distribute, sell—all allowed. Just keep the copyright notice.

---

## References

- [Original post (GPTers, Korean)](https://www.gpters.org/dev/post/how-read-20000-pages-jvPKBVs7YdLPgiK)
- [Author's Threads](https://www.threads.com/@ai.winey_ny/post/DUPG8F_kv6v)
- [notion-mcp-fast GitHub](https://github.com/chat-prompt/notion-mcp-fast)
- [My PR](https://github.com/chat-prompt/notion-mcp-fast/pull/1)

---

*The PR has been merged—[the original repo](https://github.com/chat-prompt/notion-mcp-fast) now supports Windows and Linux out of the box.*
