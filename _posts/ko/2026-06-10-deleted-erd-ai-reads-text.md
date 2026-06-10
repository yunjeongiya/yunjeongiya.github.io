---
layout: post
title: "ERD 문서를 삭제했다 — AI는 다이어그램을 읽지 않는다"
date: 2026-06-10 22:30:00 +0900
categories: [Development, AI]
tags: [erd, 문서화, ai-coding, claude-code, llms-txt, 1인개발]
lang: ko
slug: "099"
published: false
---

## TL;DR

96KB짜리 ERD 문서를 리포에서 지웠다. 감으로 내린 결정이 아니다. 최근 한 달치 AI 코딩 세션 로그 396개를 전수 분석해보니, ERD를 실제로 읽은 세션은 3개였고 같은 폴더의 `schema.sql`을 읽은 세션은 22개였다. 코드를 AI가 짜는 환경에서 손으로 유지하는 다이어그램은 독자가 없는 문서다. 관계 정보의 원본(DDL)만 남기고, 시각화는 필요한 순간에 생성하면 된다. CLI 도구들이 다시 흥하는 것과 정확히 같은 힘이 문서에도 작용하고 있다.

---

## 발단: 동기화하다가 포기한 문서

<!-- 📸 추천 스크린샷 #1: 삭제 전 erd.md의 ASCII 박스 다이어그램 일부 (필수)
파일명: assets/images/posts/099-deleted-erd/01-ascii-erd.png
내용: 박스 문자로 그린 도메인 연결 맵 (Identity → Auth/Campus/Task... 부분)
캡처 방법:
1. CheckUS 리포에서 git show a4a02454d^:docs/database/erd.md > /tmp/erd-restored.md
2. 에디터로 열어 "High-Level Domain Connection Map" 섹션 캡처
3. "아무도 안 읽던 다이어그램"의 실물 — 도입부 임팩트용
-->

운영 DB에서 안 쓰는 테이블 하나를 DROP했다. 프로젝트 룰상 스키마 문서를 같이 동기화해야 해서 `schema.sql`, `prod_schema.sql`, 그리고 `erd.md`를 고치기 시작했는데, SQL 덤프 두 개는 금방 끝났지만 ERD에서 막혔다.

이 ERD는 ASCII 박스 문자로 그린 다이어그램 + 번호 매긴 테이블 인벤토리(105개 테이블, 28개 도메인)로 된 1,963줄짜리 마크다운이다. 테이블 하나를 지우면 박스 다이어그램을 다시 그려야 하고, 52번 테이블을 빼면 53번부터 끝까지 전부 번호를 다시 매겨야 한다. 부분 수정이 연쇄로 번지는 구조다. 게다가 들여다보니 이미 stale했다. 몇 달 전 추가된 컬럼들이 빠져 있었다. "전면 재생성은 별도 작업으로 빼자"하고 SQL 덤프만 동기화하고 덮었다.

그날 저녁에 다시 생각했다. 전면 재생성? 그 전에 — 이 문서, 누가 읽긴 하나?

## 일단 데이터부터 깠다

나는 1인 개발자고, 코드는 거의 AI(Claude Code)가 짠다. 그 말은 "문서의 독자"도 대부분 AI 세션이라는 뜻이다. 그리고 Claude Code는 모든 세션을 JSONL로 남긴다. 즉, 문서별 실제 참조 횟수를 셀 수 있다.

보존된 세션 로그 396개(약 한 달치)를 긁어서 erd.md와 schema.sql이 실제로 Read/Grep된 횟수를 셌다.

| 문서 | 실제로 읽은 세션 수 |
|---|---|
| `schema.sql` / `prod_schema.sql` | **22개** |
| `erd.md` | **3개** |

erd.md의 3회도 내역을 보면 약하다. 두 번은 DB 인시던트 디버깅 중 테이블명 grep, 한 번은 위에서 말한 동기화 시도 그 자체. 다이어그램을 "보러" 온 세션은 사실상 0이었다. 문자열 "erd.md"가 등장한 세션은 19개였는데, 대부분 파일 목록에 스쳐 지나간 것이었다.

AI는 스키마가 궁금하면 `schema.sql`을 grep한다. 테이블 정의, 컬럼 타입, 그리고 FK 제약 194개 — 관계 정보까지 전부 거기 있다. 거기서 안 나오면 엔티티 코드를 읽는다. 사람인 나? 나도 ERD 안 본 지 오래됐다. 궁금한 게 있으면 AI한테 물어보니까.

## 텍스트인데 이미지처럼 행동하는 문서

여기서 재밌는 지점. erd.md는 형식상 텍스트 파일이다. 그런데 왜 AI가 안 읽고, 편집은 왜 그렇게 고통스러웠을까.

ASCII 아트 다이어그램은 **텍스트의 탈을 쓴 이미지**라서 그렇다. 정보가 문자가 아니라 2차원 배치에 들어 있다. 사람 눈에는 공간 배치가 의미를 갖지만, 토큰 스트림으로 읽는 입장에선 박스 문자와 공백의 나열일 뿐이고, 같은 정보를 DDL 한 줄(`FOREIGN KEY (student_id) REFERENCES students(id)`)이 훨씬 싸고 정확하게 전달한다. 편집도 마찬가지다. 텍스트처럼 diff는 떠지지만, 수정은 이미지처럼 "전체를 다시 그려야" 한다. 사람에게도 AI에게도 최악인 중간 형태다.

정리하면 이 문서의 문제는 두 겹이었다.

1. **파생물이다** — 원본(schema.sql)에서 생성된 2차 자료인데 손으로 유지했다. 파생물은 원본이 바뀔 때마다 빚이 쌓인다.
2. **기계가 소비할 수 없는 인코딩이다** — 주 독자가 AI가 된 환경에서, 사람 눈 전용 포맷으로 적혀 있었다.

## CLI 르네상스와 같은 힘

이게 우리 리포만의 사정이 아니라는 게 이 글을 쓰는 이유다.

2025년부터 터미널 도구들이 갑자기 다시 흥하고 있다. Claude Code가 터미널 도구로 나와서 1년이 안 돼 [공개 GitHub 커밋의 4%를 작성](https://jrpospos.blog/posts/2025/12/the-terminal-renaissance-in-the-age-of-ai-coding-agents/)하는 지경이 됐고, Google(Gemini CLI), Microsoft(Copilot CLI), AWS까지 전부 독립 CLI 에이전트를 제품으로 내놨다. 수십 년 된 GUI 시대에 왜 거꾸로 가나 싶지만, 이유는 단순하다. **에이전트가 일꾼이 되자, 일꾼이 쓰기 좋은 인터페이스가 이겼다.** GUI는 사람의 눈과 손에 최적화된 인터페이스고, CLI는 조합 가능한 텍스트 스트림이다. AI는 텍스트를 먹고 텍스트를 뱉는다. [MCP 기반 에이전트와 CLI 기반 에이전트로 같은 작업을 75회 비교한 테스트](https://galtea.ai/blog/why-ai-coding-agents-are-bringing-the-cli-back)에서 CLI 쪽이 토큰 비용 10~32배 우위, 안정성 ~100% vs 72%로 전 지표를 이겼다는 보고도 있다.

문서 쪽에서도 같은 선택압이 이미 보인다.

- [llms.txt](https://llmstxt.org/) — HTML 사이트 대신 LLM이 읽을 마크다운 인덱스를 제공하자는 표준. Anthropic, Stripe, Cloudflare 등 600개 넘는 사이트가 채택했다 ([한국어 소개](https://daleseo.com/llms-txt/)).
- [AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md) — 리포 루트에 에이전트용 컨텍스트를 마크다운으로 두는 관례. Vercel이 [스킬 시스템 vs 압축된 AGENTS.md 한 장을 비교](https://the-decoder.com/a-simple-text-file-beats-complex-skill-systems-for-ai-coding-agents/)했더니 단순 텍스트 파일 쪽이 100% vs 79%로 이겼다.
- AI ERD 생성기들 — ChartDB 같은 도구가 DDL에서 다이어그램을 즉석 생성한다. 다이어그램이 "유지하는 자산"에서 "필요할 때 뽑는 출력물"로 옮겨가고 있다는 신호다.

도구 시장에서 일어난 일이 문서에도 그대로 일어나고 있는 거다. 독자의 다수가 AI가 되면, 형식은 기계 친화적 텍스트로 수렴한다. 내 ERD 삭제는 그 흐름의 아주 작은 로컬 버전이고.

## 그럼 다이어그램은 끝인가

아니다. 핵심은 "시각 자료를 버려라"가 아니라 **"파생물을 손으로 유지하지 마라"**다.

다이어그램이 필요한 순간은 여전히 있다. 신규 도메인 설계 논의, 외부인에게 구조 설명할 때. 그런데 그 순간이 오면 AI한테 "schema.sql에서 결제 도메인만 Mermaid로 그려줘"라고 하면 끝난다. Mermaid도 결국 텍스트 DSL이라 AI가 잘 만들고, 그 시점의 원본에서 뽑으니까 **항상 최신**이다. 유지보수된 stale 다이어그램보다 생성된 다이어그램이 언제나 정확하다.

오히려 stale한 ERD는 무해하지 않다. 위에서 erd.md를 읽은 3개 세션 중 2개가 DB 인시던트 디버깅 중이었다는 걸 떠올려보자. 장애 대응 중인 에이전트가 낡은 관계도를 자신 있게 참조하는 상황 — 없는 게 낫다.

## 실행

결정하고 나니 작업 자체는 시시했다.

- `docs/database/erd.md` 삭제 (1,963줄)
- `docs/database/README.md`에 두 줄: "schema.sql이 source of truth다. FK가 관계를 담는다. 다이어그램이 필요하면 schema.sql에서 생성하라."
- 과거 작업 문서들이 erd.md를 링크한 ~20곳은 그대로 뒀다. 시점 기록이니까.

git 히스토리에 erd.md는 남아 있다. 혹시 그리워지면 `git show`로 꺼내 보면 된다. 아직 그럴 일은 없었다.

## 남는 생각

"문서화 잘 해야지"라는 말은 이제 반쪽짜리다. 질문이 하나 더 붙어야 한다 — **누가 읽는데?** 독자가 사람이면 사람의 포맷으로, AI면 AI의 포맷으로. 그리고 요즘 내 리포의 독자는 396 대 3으로 AI다.

원본은 텍스트로 한 벌만. 파생물은 유지하지 말고 생성할 것. 도구는 이미 그렇게 갔고, 문서가 따라가는 중이다.

---

## 참고 자료

- [The Terminal Renaissance in the Age of AI Coding Agents](https://jrpospos.blog/posts/2025/12/the-terminal-renaissance-in-the-age-of-ai-coding-agents/)
- [Why AI coding agents are bringing the CLI back — Galtea](https://galtea.ai/blog/why-ai-coding-agents-are-bringing-the-cli-back)
- [A simple text file beats complex skill systems for AI coding agents — The Decoder](https://the-decoder.com/a-simple-text-file-beats-complex-skill-systems-for-ai-coding-agents/)
- [The /llms.txt file](https://llmstxt.org/) · [llms.txt: LLM을 위한 웹사이트 안내서 — Dale Seo](https://daleseo.com/llms-txt/)
- [A Complete Guide To AGENTS.md](https://www.aihero.dev/a-complete-guide-to-agents-md)
- [AI 시대, 왜 마크다운을 알아야 하는가 — brunch](https://brunch.co.kr/@230kimi/49)
