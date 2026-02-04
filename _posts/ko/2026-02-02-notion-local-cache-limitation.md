---
layout: post
title: "로컬 캐시의 함정 - Notion 3000개 페이지 본문 추출 삽질기"
date: 2026-02-02 12:00:00 +0900
categories: [Development, Productivity]
tags: [notion, python, asyncio, api, rate-limit]
lang: ko
slug: "027"
thumbnail: /assets/images/posts/027-notion-cache-limit/thumbnail-ko.png
published: false
---

> 이전 글: [Notion API 없이 2만 페이지 읽기 - 로컬 캐시 + 오픈소스 기여기](/posts/026-notion-mcp-windows-opensource-contribution/)

## TL;DR

- 지난번에 만든 notion-mcp-fast로 상담일지 3094개를 추출하려 했다
- **메타데이터는 있는데 본문이 비어있었다** (로컬 캐시의 한계)
- 결국 Notion API로 돌아갔고, asyncio 병렬 처리로 5시간 → 40분으로 단축
- 로컬 캐시는 "빠른 조회"용이지 "대량 백업"용이 아니었다

---

## 배경: 상담일지 3094개가 필요했다

AI 상담 시스템을 만들려면 과거 상담 데이터가 필요했다. 몇 년간 쌓인 상담일지가 Notion 데이터베이스에 3094개. [지난번에 만든 notion-mcp-fast](/posts/026-notion-mcp-windows-opensource-contribution/)를 쓰면 되겠지?

```
Claude: notion_get_database_records로 상담일지를 가져올게요.
```

3초 만에 결과가 왔다.

```json
{
  "title": "최예원 4주차 (금)",
  "properties": {
    "유형": "학습상담",
    "보고서 작성 여부": "전송 완료"
  }
}
```

좋아, 근데 **본문은?**

---

## 문제: 본문이 비어있다

```python
# 개별 페이지 조회
result = notion_get_page(page_id, include_content=True)

{
  "title": "최예원 4주차 (금)",
  "content": ""  # ???
}
```

3094개 전부 content가 비어있었다.

### 직접 SQLite를 열어봤다

```python
import sqlite3
conn = sqlite3.connect("notion.db")

# 페이지 정보는 있다
cursor.execute("SELECT * FROM block WHERE id = ?", (page_id,))
# → 있음

# 근데 자식 블록은?
cursor.execute("SELECT * FROM block WHERE parent_id = ?", (page_id,))
# → 0개
```

페이지의 `content` 필드에 자식 블록 ID 목록은 있는데, 실제 블록 데이터가 없었다.

---

## 원인: Notion의 선택적 캐싱

Notion 앱은 **전체 동기화**를 하지 않는다.

| 데이터 | 캐시 여부 |
|--------|----------|
| 페이지 메타데이터 (제목, 속성) | O |
| 페이지 본문 (블록) | **열어본 페이지만** |

Notion 팀의 공식 입장:

> "수천 개의 페이지가 있는 워크스페이스를 전부 다운로드하면 기가바이트 단위의 저장 공간이 필요합니다."

3094개 페이지를 일일이 열어서 캐시? 비현실적이다.

### 오프라인 모드 설정도 해봤다

Notion의 "Make available offline" 기능을 찾아봤는데:
- 개별 페이지 단위로만 설정 가능
- 데이터베이스는 **현재 뷰의 50개 페이지만** 오프라인 지원
- 전체 워크스페이스 오프라인 동기화 기능은 없음

---

## 결국 API로 돌아왔다

로컬 캐시는 포기하고 Notion API를 쓰기로 했다. 근데 지난번에 rate limit 때문에 포기했던 그 API...

### 첫 시도: 순차 처리

```python
for page in pages:
    blocks = get_blocks(page.id)
    time.sleep(0.35)  # rate limit 피하기
```

3094개 × 0.35초 = **약 5시간**

너무 오래 걸린다.

### 최종 해결: asyncio 병렬 처리

```python
import asyncio
import aiohttp

CONCURRENT_REQUESTS = 5  # 동시 요청 수

async def process_batch(session, pages):
    tasks = [fetch_page_blocks(session, page) for page in pages]
    return await asyncio.gather(*tasks)

async def fetch_with_retry(session, url, retries=5):
    for attempt in range(retries):
        async with session.get(url) as resp:
            if resp.status == 200:
                return await resp.json()
            elif resp.status == 429:
                # Exponential backoff
                wait = (2 ** attempt) + 1
                await asyncio.sleep(wait)
    return None
```

핵심:
1. **5개 동시 요청**: 순차 처리의 5배 속도
2. **Exponential Backoff**: rate limit 걸리면 2초, 4초, 8초... 대기
3. **중간 저장**: 50개마다 체크포인트
4. **이어하기**: 중단 후 재실행해도 처리된 것 스킵

### 결과

| 방식 | 속도 | 3094개 소요 시간 |
|------|------|-----------------|
| 순차 처리 | ~10개/분 | **5시간** |
| 병렬 처리 | ~80개/분 | **40분** |

**7.5배 빨라졌다.**

---

## 최종 데이터

```json
{
  "title": "최예원 4주차 (금)",
  "properties": {
    "유형": "학습상담",
    "보고서 작성 여부": "전송 완료"
  },
  "content": "지난 주 피드백\n국 1~2 수 5 영 3...\n오답 분석 부족: 계산 실수를 단순히 \"계산 실수\"로 처리하고...",
  "block_count": 38
}
```

드디어 본문이 보인다!

---

## 교훈

### 1. 로컬 캐시 ≠ 로컬 백업

notion-mcp-fast는 여전히 유용하다. **이미 열어본 페이지**를 빠르게 검색하거나, 메타데이터 기반 분석에는 최고다. 하지만 "전체 데이터 추출"에는 맞지 않았다.

### 2. Rate Limit은 피하는 게 아니라 다루는 것

무작정 빠르게 호출하면 차단당한다. Exponential backoff로 우아하게 재시도하면 결국 다 가져올 수 있다.

### 3. 병렬 처리의 힘

Python asyncio로 동시 요청만 늘려도 10배 이상 빨라진다.

### 4. 대량 작업에는 체크포인트

3000개 처리 중 2500개째에서 에러나면? 중간 저장 없으면 처음부터 다시.

---

## 다음 단계

추출한 3094개 상담일지로 할 일:
- RAG 시스템에 임베딩해서 과거 상담 맥락 검색
- 상담 패턴 분석 (자주 나오는 문제, 효과 있던 솔루션)
- 신입 선생님 교육용 사례집 자동 생성

데이터는 확보했다. 이제 AI가 학습할 차례다.

---

*이 글은 Claude Code와 함께 작성되었습니다.*
