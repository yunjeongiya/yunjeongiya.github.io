---
layout: post
title: "AI한테 맥락을 넘기는 가장 싼 방법 - Features 추적 시스템"
date: 2026-01-28 12:00:00 +0900
categories: [AI, Productivity]
tags: [ai, claude-code, workflow, project-management, developer-productivity, features-system]
lang: ko
slug: "025"
---

## TL;DR

AI 코딩 도구는 대화가 끊기면 맥락을 잃는다. "모든 기능 = 하나의 마크다운 문서"로 추적하는 시스템을 만들었더니, 새 대화에서도 파일 하나만 읽으면 바로 작업을 이어갈 수 있게 됐다. INDEX.md 캐시로 토큰도 50배 절약.

---

## 문제

Claude Code로 3개월 넘게 개발하면서 계속 같은 문제를 겪었다.

```
대화 #1: "주간 일정 기능 만들어줘"
→ 50% 구현

(컴퓨터 종료)

대화 #2: "어제 작업 이어서..."
→ AI: "뭘 하고 있었는지 모르겠는데요?"
```

매번 처음부터 다시 설명해야 하는 거다. TODO도 코드 주석, 노션, Git Issues, 머릿속에 흩어져 있으니 AI한테 "지금 뭘 해야 하는지"를 전달하는 것 자체가 일이었다.

<!-- 📸 선택적 스크린샷: Before/After 비교
파일명: 09-before-after-comparison.png
내용: 2단 레이아웃 - Before(코드 주석, 노션, Git Issues) / After(features/INDEX.md)
캡처 방법: PowerPoint/Figma로 2단 레이아웃 제작
-->

---

## 해결: 기능 하나 = 문서 하나

<!-- 📸 추천 스크린샷 #1: Features 폴더 구조
파일명: 01-features-folder-structure.png
내용: VS Code Explorer에서 features/ 폴더 트리
캡처 방법: VS Code에서 checkus-docs/features/ 펼쳐서 캡처
-->

아이디어는 단순하다. 기능을 시작하면 폴더를 하나 만들고, 그 안에 모든 맥락을 넣는다.

```
features/
├── INDEX.md                       # 전체 요약 (캐시)
├── F001-classroom-management/
│   ├── README.md                  # 작업 추적 + 맥락
│   ├── blog.md                    # 블로그 초안 (선택)
│   └── images/                    # 스크린샷
├── F002-controller-refactoring/
└── ...
```

3개월간 실제로 쓰면서 130개 기능을 이걸로 관리했다. 핵심 설계 결정 두 가지를 소개한다.

---

### 1. 상태 관리는 frontmatter로

<!-- 📸 추천 스크린샷: Feature frontmatter 예시
파일명: 03-feature-frontmatter.png
내용: 실제 Feature 파일의 frontmatter (F001 권장)
캡처 방법: README.md 열어서 상단 캡처
-->

처음엔 `todo/`, `in-progress/`, `done/` 폴더로 나눠서 파일을 옮기려고 했다. 근데 이러면 `git log --follow`를 써야 하고, GitHub blame도 깨지더라.

그래서 파일은 그대로 두고 frontmatter만 바꾸는 방식으로 갔다.

```markdown
---
id: F001
title: 교실 관리 시스템
status: DONE              # TODO → IN_PROGRESS → DONE
priority: HIGH
created: 2025-10-18 KST
completed: 2025-10-21 KST
elapsed_hours: 16
---

## ✅ 완료된 작업
- [x] 교실 CRUD API
- [x] 좌석 배치 UI

## 🔗 관련 커밋
- `8356a91` - feat: 교실 관리 기능 추가
```

<!-- 📸 추천 스크린샷: Git Log 히스토리
파일명: 06-git-log-history.png
내용: feature 파일의 git log 결과
캡처 방법: git log --oneline features/F001-.../README.md
-->

`git log features/F001-.../README.md` 하면 해당 기능의 전체 히스토리가 나온다. 파일을 안 옮기니까 당연한 거다.

---

### 2. INDEX.md = 캐시

130개 파일을 매번 다 읽히면 토큰이 수만 개 날아간다. 대신 요약본 하나만 읽으면 된다.

<!-- 📸 추천 스크린샷: INDEX.md
파일명: 02-index-md-cache.png
내용: INDEX.md 파일 상단 (요약 + IN_PROGRESS 섹션)
캡처 방법: checkus-docs/features/INDEX.md 열어서 캡처
-->

```markdown
## 📊 요약
- TODO: 10개 | IN_PROGRESS: 8개 | DONE: 89개

## 🚀 IN_PROGRESS
### [F128](F128-teacher-mobile-app/) 교사용 모바일 앱
- 진행률: 40%
```

INDEX.md 하나 읽는 데 ~300 토큰. 전체 파일 읽으면 ~15,000 토큰. **50배 차이**다.

AI한테 "지금 뭐 하고 있었지?"라고 물으면, INDEX.md만 보고 바로 대답할 수 있다. 상세 내용이 필요하면 그때 개별 파일을 읽으면 되고.

---

## 슬래시 커맨드로 자동화

이 시스템을 수동으로 관리하면 귀찮아서 안 쓰게 된다. 그래서 Claude Code 슬래시 커맨드로 자동화했다.

<!-- 📸 추천 스크린샷: /finish 명령어
파일명: 04-finish-command.png
내용: .claude/commands/finish-checkus.md 파일
캡처 방법: 파일 열어서 캡처
-->

- **`/finish`**: 작업 완료 시 frontmatter 업데이트 → INDEX.md 갱신 → 작업일지 작성 → Git 커밋까지 한 번에
- **`/blog`**: Features 문서 + Git diff를 분석해서 블로그 초안 자동 생성. 스크린샷 추천까지 해줌
- **`/pause`** & **`/resume`**: 작업 중단/재개. INDEX.md만 읽어서 어디서 멈췄는지 바로 파악

특히 `/blog`가 좋았던 게, 개발 끝나자마자 실행하면 그때의 맥락으로 초안이 나온다. 3주 뒤에 "뭐했더라..." 하면서 끙끙대는 일이 없어졌다.

---

## 실제로 써보니

130개 기능을 이 시스템으로 관리한 결과:

| | Before | After |
|--|--------|-------|
| 새 대화에서 맥락 전달 | 매번 5-10분 설명 | INDEX.md → 개별 파일, 즉시 |
| TODO 관리 | 노션+주석+머릿속 | features/ 한 곳 |
| 블로그 작성 | "나중에..." → 안 씀 | `/blog`로 바로 초안 |

다른 도구와 비교하면:

| 도구 | Features 시스템과의 차이 |
|------|------------------------|
| Claude Task Master | MCP 기반 36개 도구. 우리 건 마크다운만 씀 |
| GitHub Issues | 프로젝트 단위. 우리 건 기능 단위로 더 세분화 |
| Notion | 수동 관리. 우리 건 슬래시 커맨드로 자동화 |

블로그 초안 자동 생성이랑 스크린샷 타이밍 관리는 다른 도구에서 못 본 기능이다.

---

## 얻은 교훈

**AI는 도구가 아니라 팀원이다.** 팀원한테 매번 처음부터 설명하면 비효율적이듯, AI한테도 "읽어볼 문서"를 남겨두는 게 핵심이다. `"F023 작업 시작"`이라고만 하면 AI가 알아서 해당 문서를 읽고 맥락을 파악한다.

**파일 이동은 Git의 적이다.** 상태를 바꿀 때 폴더를 옮기면 히스토리가 꼬인다. Frontmatter가 답이다.

**토큰은 돈이다.** INDEX.md 캐시 하나로 50배를 아낄 수 있다. AI 도구를 쓸 때 "이 작업에 토큰이 얼마나 드는가"를 항상 생각해야 한다.

---

## 참고 자료

- [Claude Task Master](https://github.com/eyaltoledano/claude-task-master) - MCP 기반 작업 관리
- [GitHub Copilot Agent Primitives](https://github.blog/ai-and-ml/github-copilot/how-to-build-reliable-ai-workflows-with-agentic-primitives-and-context-engineering/)
- [Agentic Workflow Patterns](https://github.com/arunpshankar/Agentic-Workflow-Patterns)

---

AI 코딩의 병목은 코드 생성 속도가 아니라 **맥락 전달 속도**다. 마크다운 파일 몇 개가 그 병목을 풀어준다.
