---
layout: post
title: "Claude Code 플러그인 13개를 감사했더니 — 42줄짜리 프롬프트의 진실"
date: 2026-04-22 21:30:00 +0900
categories: [Developer Experience, AI Tools]
tags: [claude-code, plugins, prompt-engineering, developer-workflow, productivity]
lang: ko
slug: "060"
published: false
---

## 도입

Claude Code에 플러그인이 13개 설치돼 있었다. "많을수록 좋겠지"라는 생각으로 추천 글 보이면 깔았다. 어느 날 토큰 효율이 신경 쓰이기 시작했고, 하나씩 뜯어봤다. 결과는 예상과 달랐다 — 문제는 토큰 낭비가 아니라, **발동조차 안 되고 있던 플러그인들**이었다.

이 글에서는 실제 사용 패턴 기반으로 플러그인을 감사한 과정과, 27만 설치를 기록한 인기 플러그인의 정체를 파헤친 이야기를 다룬다.

## 배경: 플러그인 13개의 무게

```
claude plugins list
```

목록을 뽑아보면 13개. 각 플러그인은 스킬을 등록하고, 이 스킬 목록이 **매 턴 system-reminder로 주입**된다. 플러그인이 많을수록 컨텍스트 윈도우에서 실제 작업에 쓸 수 있는 공간이 줄어든다.

그런데 정말로 13개를 다 쓰고 있을까?

## 감사 방법: 사용 흔적 추적

Claude Code는 플러그인 사용 이력을 로깅하지 않는다. 그래서 간접 증거를 찾았다.

**1. 커스텀 스킬에서의 참조**

```bash
# 프로젝트의 커스텀 스킬 20개에서 플러그인 이름 검색
grep -r "ralph-loop\|frontend-design\|security-guidance" .claude/skills/
```

참조 0건인 플러그인이 바로 제거 1순위다.

**2. 생성된 파일의 특징 분석**

플러그인이 발동했다면, 그 결과물에 특정 패턴이 남는다. 이게 핵심 방법이었다.

**3. 설치 시점 vs 생성 파일 시점 비교**

플러그인 설치일과 관련 파일 생성일의 타임라인을 맞춰본다.

## 발견: frontend-design 플러그인의 진실

27만+ 설치, 트위터에서 화제, "AI slop 탈출" 도구로 유명한 `frontend-design` 플러그인. 3월 20일에 설치했고, 한 달이 지났다.

한 달간 만든 HTML 파일: **12개 이상**.

```
mockup-invite-modal.html
mockup-enrollment-schedule-dialog.html
teacher-mobile-redesign.html
logo-mockups.html
link-style-final.html
...
```

이 파일들의 공통점:

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**전부 system font다.** frontend-design 스킬은 "Inter, Arial, system font 절대 금지"를 명시하고 있다. 이 스킬이 발동했다면 절대 나올 수 없는 코드다.

**한 달간 설치돼 있었지만, 단 한 번도 발동되지 않았다.**

## 원인: 트리거 충돌

왜 발동이 안 됐을까? 스킬의 트리거 조건을 보면 답이 나온다.

```
frontend-design: "Use this skill when the user asks to
  build web components, pages, or applications."
```

내가 실제로 한 요청:
- "목업 만들어줘"
- "옵션 비교해봐"
- "로고 방향 보여줘"

**"web component"나 "application을 만들어달라"고 한 적이 없다.** "목업", "비교", "방향" — 이런 키워드는 트리거에 해당하지 않는다.

더 결정적인 문제가 있었다. `superpowers:brainstorm` 스킬이 "You MUST use this before any creative work"라고 선언하고 있어서, 창작성이 있는 요청이 들어오면 **brainstorm이 먼저 가로챈다.** 실제로 생성된 HTML의 절반 이상이 `.superpowers/brainstorm/` 폴더 안에 있었다.

frontend-design은 발동 기회 자체가 없었다.

## 42줄 프롬프트의 정체

그래서 frontend-design 스킬의 실체를 열어봤다.

```markdown
---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces...
---

This skill guides creation of distinctive, production-grade frontend
interfaces that avoid generic "AI slop" aesthetics.

## Design Thinking
- Purpose: What problem does this interface solve?
- Tone: Pick an extreme — brutally minimal, maximalist, retro-futuristic...
- Differentiation: What makes this UNFORGETTABLE?

## Frontend Aesthetics Guidelines
- Typography: NEVER use Inter, Roboto, Arial, system fonts
- Color: Dominant colors with sharp accents
- Motion: Staggered reveals, scroll-triggered effects
- Composition: Asymmetry, overlap, grid-breaking

NEVER: purple gradients, cookie-cutter design, same aesthetic repeated
```

**이게 전부다.** 42줄짜리 프롬프트 하나. 마법이 아니라 프롬프트 엔지니어링이다.

핵심은 두 가지:
1. 코딩 전에 디자인 방향을 먼저 결정하라
2. generic한 선택지를 명시적으로 금지하라

이 두 가지만 지켜도 "AI가 만든 것 같은" 느낌이 사라진다.

## 해결: rules 파일로 이식

플러그인은 `/frontend-design`을 명시적으로 호출해야 발동한다. 하지만 `.claude/rules/` 파일은 **경로 매칭으로 자동 적용**된다.

```yaml
# .claude/rules/design-aesthetics.md
---
paths:
  - "**/*.html"
  - ".superpowers/brainstorm/**"
  - "checkus-docs/mockups/**"
  - "checkus-docs/features/**/mockup*"
---

# Frontend Design Aesthetics
(42줄 프롬프트 내용 전체 이식)
```

이제 mockup이든 brainstorm이든, HTML을 생성하는 **모든 상황에서 자동으로** 디자인 가이드가 적용된다. 트리거 충돌 문제가 근본적으로 해결됐다.

## 핵심 교훈

### 토큰 낭비보다 중요한 것

frontend-design 플러그인의 토큰 비용은 매 턴 ~30토큰(스킬 목록 1줄)에 불과했다. 발동 시에도 ~400토큰. 13개 플러그인 전체를 합쳐도 컨텍스트 윈도우 대비 미미한 수준이다.

**진짜 문제는 토큰이 아니라 "발동 안 되는 플러그인"이었다.** 설치만 돼있고 효과가 없는 도구는, 비용이 얼마건 낭비다.

### 플러그인 vs rules 파일

| | 플러그인 | rules 파일 |
|---|---|---|
| 발동 조건 | 명시적 호출 또는 스킬 판단 | **경로 매칭 자동 적용** |
| 다른 스킬과 충돌 | 가능 (우선순위 문제) | 없음 (컨텍스트로 주입) |
| 설치/관리 | 별도 커맨드 | 프로젝트 git에 포함 |
| 팀 공유 | 개인 설치 | **커밋하면 전원 적용** |

42줄짜리 프롬프트라면, 플러그인으로 감싸는 것보다 rules 파일로 직접 넣는 게 더 확실하다.

### 감사의 기준

"이 플러그인이 좋은가?"가 아니라 **"내 워크플로우에서 실제로 발동하는가?"**를 봐야 한다. frontend-design은 좋은 플러그인이다. 27만 명이 설치했고, 원리도 건전하다. 하지만 내 사용 패턴에서는 한 달간 한 번도 발동하지 않았다.

좋은 도구도 쓰이지 않으면 죽은 코드와 같다.

## References

- [Claude Code frontend-design plugin (GitHub)](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design)
- [Breaking the AI Slop Aesthetic (paddo.dev)](https://paddo.dev/blog/claude-code-plugins-frontend-design/)
- [Best Claude Code Plugins — 10 Tested, 4 Worth Keeping](https://buildtolaunch.substack.com/p/best-claude-code-plugins-tested-review)
