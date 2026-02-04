---
layout: post
title: "삽질 스크립트를 오픈소스로 - notion-bulk-export 발행기"
date: 2026-02-04 12:00:00 +0900
categories: [OpenSource, Development]
tags: [notion, asyncio, python, opensource, cli, pip]
lang: ko
slug: "029"
thumbnail: /assets/images/posts/029-notion-bulk-export/thumbnail-ko.png
published: false
---

> 이전 글: [로컬 캐시의 함정 - Notion 3000개 페이지 본문 추출 삽질기](/posts/027-notion-local-cache-limit/)

## TL;DR

- Notion 데이터베이스를 통째로 JSON/CSV로 내보내는 CLI 도구를 만들어 오픈소스로 발행했다
- asyncio 병렬 처리 + 체크포인트 & 이어하기 + 모든 속성 타입 지원
- `pip install notion-bulk-export` 한 줄로 설치 가능
- GitHub: [yunjeongiya/notion-bulk-export](https://github.com/yunjeongiya/notion-bulk-export)

---

## 문제: Notion 대량 추출이 어렵다

Notion에 수천 개 페이지가 쌓인 데이터베이스가 있다고 하자. 이걸 통째로 내보내고 싶으면?

- **공식 Export**: 데이터가 많으면 실패한다
- **공식 API**: Rate limit (429 Too Many Requests)에 금방 걸린다
- **기존 도구들**: 대부분 Markdown 출력만 지원. 데이터 분석이나 AI 파이프라인에 쓰려면 구조화된 JSON이 필요하다

[지난번에 이 문제를 겪고](/posts/027-notion-local-cache-limit/) asyncio 병렬 처리로 3094개 페이지를 40분 만에 추출하는 스크립트를 만들었는데, 이걸 누구나 쓸 수 있는 도구로 발행했다.

---

## 사용법

```bash
# 설치
pip install notion-bulk-export

# 기본 사용 (JSON 출력 + 본문 포함)
notion-bulk-export --database-id abc123 --token ntn_xxx

# JSON + CSV 동시 출력
notion-bulk-export --database-id abc123 --format json csv

# 속성만 (본문 제외, 더 빠름)
notion-bulk-export --database-id abc123 --no-content

# 동시 요청 수 조절
notion-bulk-export --database-id abc123 --concurrency 3
```

환경변수도 지원한다:
```bash
export NOTION_TOKEN=ntn_xxx
notion-bulk-export --database-id abc123
```

---

## 핵심 기능

### 1. asyncio 병렬 처리

순차 처리 대비 **7.5배** 빠르다.

| 방식 | 속도 | 3,094개 소요 시간 |
|------|------|-----------------|
| 순차 API 호출 | ~10개/분 | ~5시간 |
| **notion-bulk-export** (concurrency=5) | ~80개/분 | **~40분** |

### 2. 체크포인트 & 이어하기

50개마다 진행 상황을 저장한다. 중간에 끊겨도 다시 실행하면 이어서 진행한다.

```
$ notion-bulk-export --database-id abc123
[OK] Total 3094 pages found
  [1-5/3094] Processing...
  ...
  [SAVED] 1250 pages
  ^C  (중단)

$ notion-bulk-export --database-id abc123
[INFO] Resuming from 1250 already processed
[INFO] 1844 pages remaining
```

### 3. Rate Limit 자동 대응

Notion API가 429를 반환하면 exponential backoff로 자동 재시도한다. `Retry-After` 헤더가 있으면 그대로 따르고, 없으면 2초, 4초, 8초...로 늘린다.

### 4. 모든 속성 타입 지원

title, rich_text, number, checkbox, select, multi_select, status, date, people, files, formula, relation, rollup 등 **20개 이상**의 Notion 속성 타입을 파싱한다.

CSV 출력 시 컬럼도 자동 감지된다. 어떤 데이터베이스든 속성 구조에 맞게 동적으로 컬럼이 생성된다.

---

## 기존 도구와 뭐가 다른가?

발행 전에 비슷한 도구가 이미 있는지 찾아봤다.

| 도구 | 출력 형식 | 비동기 | 체크포인트 | 전체 속성 |
|------|----------|-------|-----------|----------|
| [notion-exporter](https://pypi.org/project/notion-exporter/) (PyPI) | Markdown | O | X | X |
| [python-notion-exporter](https://github.com/Strvm/python-notion-exporter) | MD/HTML/PDF | X | X | X |
| [notion4ever](https://github.com/MerkulovDaniil/notion4ever) | MD + HTML | X | X | X |
| [notion-exporter](https://github.com/yannbolliger/notion-exporter) (TS) | MD + CSV | X | X | X |
| **notion-bulk-export** | **JSON + CSV** | **O** | **O** | **O** |

기존 도구들은 대부분 **페이지를 Markdown으로 렌더링**하는 데 집중한다. 개인 블로그나 위키 백업에는 적합하지만, 데이터를 **분석**하거나 **AI 파이프라인**에 넣으려면 구조화된 JSON이 필요하다.

가장 가까운 건 PyPI의 `notion-exporter`인데, 이것도 Markdown 출력만 지원하고 체크포인트가 없다. 3000개 페이지를 추출하다가 2500개째에서 끊기면 처음부터 다시 해야 한다.

**notion-bulk-export가 차별화되는 3가지:**

1. **구조화된 데이터 출력** (JSON/CSV) — Markdown이 아닌 데이터 분석용 포맷
2. **체크포인트 & 이어하기** — 대량 작업의 필수 기능인데 아무도 안 만들었다
3. **데이터베이스 특화** — 페이지 트리가 아닌 DB 레코드 + 모든 속성 타입

---

## 만든 과정

원래는 오픈소스를 목표로 만든 게 아니었다. 상담일지 추출이 급해서 후다닥 만든 스크립트(`export_fast.py`)였다.

그런데 돌이켜보니 핵심 로직은 범용적이었고, 하드코딩만 제거하면 누구나 쓸 수 있었다.

| | export_fast.py (원본) | notion-bulk-export |
|---|---|---|
| 대상 | 상담일지 DB 하나 | **어떤 DB든** |
| 설정 | 코드에 하드코딩 | CLI 인자 / 환경변수 |
| 속성 | 3개 타입 | **20+ 타입** |
| 블록 | 기본 타입만 | **20+ 타입** (마크다운) |
| CSV | 고정 컬럼 | **자동 감지** |
| 설치 | 파일 복사 | `pip install` |
| 테스트 | 없음 | **56개** |

일반화 작업은 생각보다 간단했다. 하드코딩을 파라미터로 바꾸고, 속성 파서를 Notion API 문서 보면서 `match-case`로 확장하면 됐다. 어려운 건 코드가 아니라 "이걸 다른 사람이 쓸 수 있겠다"는 생각을 하는 것이었다.

---

## 프로젝트 구조

```
notion-bulk-export/
├── src/notion_bulk_export/
│   ├── cli.py              # argparse CLI
│   ├── exporter.py         # asyncio 병렬 + 체크포인트
│   ├── notion_api.py       # API 래퍼 (retry + rate limit)
│   ├── block_parser.py     # 20+ 블록 타입 → 마크다운
│   └── property_parser.py  # 모든 속성 타입 파싱
├── tests/                   # 56개 테스트
├── pyproject.toml
└── README.md
```

---

## 느낀 점

### "나만 쓸 스크립트"의 가치

[첫 번째 오픈소스 기여는 notion-mcp-fast에 Windows 지원을 추가한 21줄짜리 PR](/posts/026-notion-mcp-windows-opensource-contribution/)이었다. 이번에는 처음부터 내 프로젝트를 만들어서 발행했다. 21줄 수정 PR → 독립 도구 발행으로 성장한 셈이다.

급하게 만든 스크립트도 핵심 로직이 범용적이면 오픈소스가 될 수 있다. "나만 쓸 코드"에서 시작해도, 같은 문제를 겪는 사람이 있다면 공유할 가치가 있다.

---

## 링크

- **GitHub**: [yunjeongiya/notion-bulk-export](https://github.com/yunjeongiya/notion-bulk-export)
- **PyPI**: `pip install notion-bulk-export`

---

*이 글은 Claude Code와 함께 작성되었습니다.*
