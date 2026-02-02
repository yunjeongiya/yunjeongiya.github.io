---
layout: post
title: "Notion API 없이 2만 페이지 읽기 - 로컬 캐시 + 오픈소스 기여기"
date: 2026-02-02 00:00:00 +0900
categories: [OpenSource, Productivity]
tags: [notion, mcp, sqlite, opensource, claude, windows]
lang: ko
slug: "026"
thumbnail: /assets/images/posts/026-notion-mcp/thumbnail-ko.png
---

## TL;DR

- Notion API rate limit 때문에 수천 페이지 분석이 불가능했다
- Notion 데스크톱 앱이 로컬 SQLite 캐시를 쓴다는 걸 발견했다
- **2만 페이지**를 API 없이 **3초** 만에 읽었다
- macOS 전용 오픈소스에 Windows 지원을 추가해 **첫 PR**을 보냈다

---

## 문제: Notion 데이터가 너무 많았다

학원을 운영하면서 Notion에 상담 기록을 쌓아왔는데, 몇 년치 데이터가 수천 페이지는 됐다. 이걸 Claude로 분석해보고 싶었다.

### 시도 1: 공식 Notion API

```
429 Too Many Requests
```

페이지가 많다 보니 rate limit에 금방 걸렸다.

### 시도 2: Notion Export

설정 → Export → Markdown & CSV를 시도했는데, 데이터가 너무 많아서 Export 자체가 실패했다.

### 시도 3: 공식 Notion MCP 서버

OAuth 연동해서 써봤는데, 내부적으로 API를 쓰기 때문에 같은 문제가 생겼다.

---

## 발견: 로컬 SQLite 캐시

[GPTers에 올라온 글](https://www.gpters.org/dev/post/how-read-20000-pages-jvPKBVs7YdLPgiK)에서 해결책을 찾았다.

핵심 아이디어:

> Notion 데스크톱 앱이 **로컬에 SQLite 데이터베이스**로 캐시를 저장한다.
> 이걸 직접 읽으면 API 호출 없이 데이터에 접근할 수 있다.

Notion은 오프라인 동기화를 위해 서버 데이터를 로컬 SQLite로 미러링해두고 있었고, 이 캐시는 생각보다 구조화가 잘 되어 있었다.

캐시 위치:
- **macOS**: `~/Library/Application Support/Notion/notion.db`
- **Windows**: `%APPDATA%/Notion/notion.db`

확인해보니 내 컴퓨터에 **628MB**짜리 SQLite 파일이 있었다.

---

## 근데 macOS 전용이었다

글에서 소개한 [notion-mcp-fast](https://github.com/chat-prompt/notion-mcp-fast)를 써보려고 했다.

```bash
claude mcp add notion-local -- uvx \
    --from "git+https://github.com/chat-prompt/notion-mcp-fast" \
    notion-mcp-fast
```

실행하니까:

```
FileNotFoundError: Notion database not found at
~/Library/Application Support/Notion/notion.db
```

macOS 경로가 하드코딩 되어있었다. 나는 Windows를 쓰는데...

---

## 직접 고쳐봤다

코드를 열어보니 생각보다 간단했다. `reader.py`에서 경로를 설정하는 부분:

```python
# 원본 (macOS만 지원)
NOTION_DB_PATH = os.path.expanduser(
    "~/Library/Application Support/Notion/notion.db"
)
```

OS별로 경로를 감지하도록 바꿨다:

```python
import platform

def _get_default_notion_db_path() -> str:
    # 환경변수로 오버라이드 가능
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

추가한 내용:
1. `platform.system()`으로 OS 감지
2. Windows: `%APPDATA%/Notion/notion.db`
3. Linux: `~/.config/Notion/notion.db`
4. `NOTION_DB_PATH` 환경변수로 커스텀 경로도 지원

Linux 경로는 [Arch Wiki](https://wiki.archlinux.org/title/XDG_Base_Directory)의 XDG Base Directory 표준을 따랐는데, 실제로 Notion 앱이 이 경로를 쓰는지는 확인 못했다. Linux 경로는 추정값이며, 실제 Notion AppImage / Snap 환경에서는 다를 수 있다. 테스트 환경이 없어서 PR에 피드백을 요청해뒀다.

---

## PR 보내기

고친 김에 PR을 보내봤다. 오픈소스 기여는 처음이라 좀 떨렸다.

### Fork → Branch → Commit → Push → PR

```bash
# 1. Fork (GitHub 웹에서)

# 2. Clone 후 수정
git clone https://github.com/chat-prompt/notion-mcp-fast
cd notion-mcp-fast
# ... 코드 수정 ...

# 3. Fork를 remote로 추가
git remote add fork https://github.com/yunjeongiya/notion-mcp-fast.git

# 4. 브랜치 생성 및 커밋
git checkout -b feat/cross-platform-support
git add src/notion_mcp_fast/reader.py
git commit -m "feat: add cross-platform support (Windows, Linux)"

# 5. Push 및 PR 생성
git push -u fork feat/cross-platform-support
# GitHub에서 PR 생성
```

PR 링크: https://github.com/chat-prompt/notion-mcp-fast/pull/1

이 저장소의 첫 PR이라 머지될지 모르겠다 싶었는데...

---

## 결과

Windows에서 잘 돌아갔다.

```bash
claude mcp add notion-local -- uvx \
    --from "C:/Users/YJL/Desktop/notion-mcp-fast" \
    notion-mcp-fast
```

Claude Code 재시작하니까 이런 도구들을 쓸 수 있게 됐다:

- `notion_list_pages` - 페이지 목록 조회
- `notion_search_pages` - 제목 검색
- `notion_full_text_search` - 전체 텍스트 검색
- `notion_list_databases` - 데이터베이스 목록
- `notion_get_database_records` - DB 레코드 조회

628MB 데이터베이스, 수천 페이지가 **몇 초 만에** 로드됐다. API rate limit 걱정 없이.

**테스트 범위:**
- ✅ Windows 11 - 정상 동작 확인
- ⬜ Linux - 미테스트 (환경 없음, PR에 피드백 요청)

---

## 느낀 점

### 1. 생각보다 어렵지 않더라

```diff
- 3 lines
+ 18 lines
```

21줄 수정이 전부였다. "내가 쓰고 싶은데 안 되네 → 고치자 → PR"로 끝났다.

### 2. 원작자한테 알려주면 좋다

GPTers 원글 작성자의 [Threads](https://www.threads.com/@ai.winey_ny/post/DUPG8F_kv6v)에 댓글을 달았더니 바로 머지해주셨다.

![Threads 대화](/assets/images/posts/026-notion-mcp/threads-conversation.jpg){: width="400"}

PR 리뷰가 빨라지기도 하고, 커뮤니티에서 연결되는 계기가 되기도 한다.

### 3. MIT 라이선스

수정, 배포, 판매까지 가능하다. 저작권 표시만 유지하면 된다.

---

## 참고 자료

- [원본 글 (GPTers)](https://www.gpters.org/dev/post/how-read-20000-pages-jvPKBVs7YdLPgiK)
- [원작자 Threads](https://www.threads.com/@ai.winey_ny/post/DUPG8F_kv6v)
- [notion-mcp-fast GitHub](https://github.com/chat-prompt/notion-mcp-fast)
- [내 PR](https://github.com/chat-prompt/notion-mcp-fast/pull/1)

---

*PR이 머지돼서 이제 [원본 저장소](https://github.com/chat-prompt/notion-mcp-fast)에서 바로 Windows/Linux를 지원한다.*
