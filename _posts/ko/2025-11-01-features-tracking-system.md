---
layout: post
title: "AI 코딩 에이전트를 위한 Features 추적 시스템 - 29개 기능을 관리하는 법"
date: 2025-11-01 14:00:00 +0900
categories: [개발생산성, AI워크플로우]
tags: [claude-code, ai, 프로젝트관리, 워크플로우, 문서화, 생산성]
lang: ko
---

## TL;DR

Claude Code 같은 AI 도구로 개발하다 보면 작업 맥락을 잃어버린다. Features 추적 시스템은 모든 기능을 문서로 추적하고, INDEX.md로 토큰을 50배 절약하며, `/blog` 명령어로 블로그 초안까지 자동 생성한다.

29개 기능 추적, 토큰 50배 절약, 블로그 작성 장벽 하락.

---

## 배경: AI와 작업하면서 겪은 문제들

Claude Code나 Cursor 같은 AI 코딩 도구를 쓰다 보면 이런 경험이 있을 것이다:

- "어제 작업하던 거 뭐였지?"
- "이 기능 절반만 구현하고 다른 거 하다가 까먹었네..."
- "나중에 블로그 쓰려고 했는데 스크린샷을 안 찍어놨어..."

AI는 똑똑하지만 **내 작업 맥락을 기억하지 못한다**. 새 대화를 시작하면 컨텍스트가 날아가고, 토큰 제한 때문에 과거 작업을 전부 설명할 수도 없다.

그래서 AI가 내 작업을 자동으로 추적하고, 블로그 초안까지 써주는 시스템을 만들었다.

### 1. 컨텍스트가 계속 날아간다

```
대화 #1: "주간 일정 기능 만들어줘"
→ 50% 구현

(컴퓨터 종료)

대화 #2: "어제 작업 이어서..."
→ AI: "뭘 하고 있었는지 모르겠는데요?"
```

매번 이전 작업을 다시 설명하느라 시간을 낭비한다.

### 2. TODO가 산재해 있다

- 코드 주석: `// TODO: 리팩토링 필요`
- 노션: 대략적인 기능 목록
- Git Issues: 버그 리포트
- 머릿속: "나중에 해야지..."

→ **어디에 뭐가 있는지 모르겠다**

### 3. 블로그 쓸 때 스크린샷이 없다

```
3주 후...

나: "이 기능 블로그에 써야지!"
(기능을 찾아보니 이미 UI가 바뀜)
나: "Before/After 스크린샷이 없네..."
```

개발 완료 시점에 바로 캡처하지 않으면 똑같은 화면을 다시 만들 수 없다.

---

## 해결 방법: Features 시스템

### 핵심 아이디어

**"모든 기능 = 하나의 문서"**

```
features/
├── INDEX.md                           # 빠른 조회용 캐시
├── F001-classroom-management/         # 기능별 폴더
│   ├── README.md                      # 작업 추적
│   ├── blog.md                        # 블로그 초안 (선택)
│   └── images/                        # 스크린샷
│       ├── 01-before.png
│       └── 02-after.png
├── F002-controller-refactoring/
└── F029-logging-policy-aop/
```

### 1. Frontmatter로 상태 관리

파일을 옮기지 않고 메타데이터만 바꾼다. **Git 히스토리가 보존된다!**

```markdown
---
id: F001
title: 교실 관리 시스템
status: DONE                 # TODO → IN_PROGRESS → DONE
priority: HIGH
created: 2025-10-18 KST
completed: 2025-10-21 KST
elapsed_hours: 16
labels: [feature, backend, frontend]
---

# 교실 관리 시스템

## ✅ 완료된 작업
- [x] 교실 CRUD API
- [x] 좌석 배치 UI
- [x] 행/열별 폭 조정

## 🔗 관련 커밋
- `8356a91` - feat: 교실 관리 기능 추가
```

**장점**:

- `git log features/F001-classroom-management/README.md` 하면 전체 과정을 추적할 수 있다
- GitHub에서 blame도 정상 작동한다
- 폴더 이동 없이 상태만 바뀐다

### 2. INDEX.md로 토큰 절약

50개 기능 파일을 다 읽으면 **수만 토큰**을 낭비한다. 대신 요약본 하나만 읽는다.

```markdown
---
last_updated: 2025-11-01 20:00 KST
auto_generated: true
---

## 📊 요약
- **TODO**: 8개
- **IN_PROGRESS**: 2개
- **DONE**: 21개

## 🚀 IN_PROGRESS

### [F006](F006-teacher-schedule-management/) 교사용 주간 일정 관리
- **시작**: 2025-10-30 05:00 KST
- **진행률**: 30%

## 📋 TODO

### [F023](F023-current-user-annotation/) @CurrentUser 어노테이션
- **예상 시간**: 2-3시간
- **주제**: Controller 인증 체크 자동화
```

**효과**:

- INDEX.md 읽기: ~300 토큰
- 전체 파일 읽기: ~15,000 토큰
- **50배 절약!**

### 3. 블로그 초안 자동화

기능 완료 → `/blog` 명령어 → 초안 + 이미지 추천까지 자동으로 생성된다.

```markdown
features/F001-classroom-management/
├── README.md
└── blog.md          # 자동 생성
```

**blog.md 예시**:

```markdown
---
title: "React에서 드래그 앤 드롭 좌석 배치 구현하기"
date: 2025-10-21
tags: [React, DnD, TypeScript]
draft: true
---

## 배경
학원 관리 시스템에서 교실 좌석을 배치하는 기능이 필요했다...

## 구현
react-dnd 대신 HTML5 Drag & Drop API를 직접 사용했다...
```

**+ 이미지 추천까지**:

```
### 📸 추천 스크린샷 목록

1. **좌석 드래그 중 화면**
   - 파일명: `01-drag-interaction.png`
   - 내용: 좌석을 드래그하는 순간 캡처
   - 캡처 방법: 교실 관리 > 좌석 배치 모드에서 드래그

📁 저장 위치: `features/F001-classroom-management/images/`

⚠️ **중요**: 지금 캡처하지 않으면 나중에 UI가 바뀌어서 못 찍어요!
```

→ **개발 끝나자마자 바로 캡처하게 만든다**

### 4. 슬래시 커맨드로 완전 자동화

#### `/finish-checkus` - 8단계 자동 프로세스

```
1. 변경사항 확인
2. 코드 정리 (디버깅 로그 제거)
3. Features 시스템 업데이트 ⭐
   → frontmatter status: DONE
   → completed: [현재시각]
   → INDEX.md 업데이트
4. 작업일지 작성
5. requirement.md 동기화
6. Git 커밋
7. Features 파일에 커밋 해시 기록 ⭐
8. 최종 보고
```

#### `/blog` - 블로그 초안 + 이미지

```
1. 최근 작업 분석
2. 글감 적합성 판단
3. 사용자 확인
4. 블로그 초안 작성
5. 이미지/스크린샷 추천 ⭐
6. 저장 위치 안내
```

#### `/pause` & `/resume` - 작업 중단/재개

```
/pause
→ 현재 IN_PROGRESS 작업들의 상태 저장
→ INDEX.md 업데이트

(다음날)

/resume
→ INDEX.md만 읽어서 중단된 작업 확인 (토큰 절약)
→ 사용자가 선택하면 해당 feature 파일 읽기
→ TodoWrite로 작업 재개
```

---

## 결과

### 정량적 효과

- **29개 기능 추적** (TODO 8개, IN_PROGRESS 2개, DONE 21개)
- **토큰 50배 절약** (INDEX.md 캐시 덕분)
- **문서 4,469줄 정리** (api/, refactoring/, analysis/ 등)
- **7개 TODO 자동 생성** (CONTROLLER_IMPROVEMENTS.md → F023-F029)

### 정성적 효과

**1. 컨텍스트 보존**

```
새 대화 시작:
"F006 작업 이어서 해줘"

AI가 INDEX.md 읽음 → F006 파일 읽음 → 바로 재개
```

**2. Git 히스토리 완벽 보존**

```bash
$ git log features/F001-classroom-management/README.md
→ 3일간 12개 커밋 전부 추적 가능
```

**3. 블로그 쓰기 장벽 하락**

```
Before: "나중에 써야지..." → 안 씀
After: blog.md + 이미지 추천 → 바로 초안 완성
```

**4. 업계 비교**

| 도구 | 특징 | Features 시스템 |
|------|------|------------|
| Claude Task Master | MCP 기반, 36개 도구 | ✅ 마크다운으로 더 간단 |
| GitHub Issues | 프로젝트 단위 | ✅ 기능 단위 세분화 |
| Notion | 수동 관리 | ✅ AI 자동화 |
| - | - | ✅ **블로그 통합** (독창적) |
| - | - | ✅ **이미지 타이밍** (혁신적) |

---

## 배운 점

### 1. "대화 맥락 > Git Log"

문제: 동시에 여러 기능을 개발 중일 때

```
git log --since="1 hour ago"
→ F001, F002, F003, F032 커밋이 섞여 있음
→ AI가 "어떤 거 작업하셨나요?" 물어봄
```

해결: **같은 대화 스레드면 AI가 이미 알고 있다!**

```
사용자: (F032 작업 중...)
사용자: /finish

AI:
1. 대화 맥락 확인: "이 세션에서 F032 작업함" ✅
2. 즉시: "F032 완료 처리할까요?"
```

**정보 우선순위**:

1. **Features/README.md** (최우선) - 이미 구조화된 맥락
2. daily_work_summary (보완) - 디테일, 시행착오
3. Git diff (코드 예시) - 실제 변경사항

→ Git log는 **새 스레드에서만 fallback**으로 사용한다!

### 2. "AI는 도구가 아니라 팀원"

AI를 단순 코딩 보조로만 쓰지 말고, **AI가 따라갈 워크플로우**를 설계하자.

```
❌ "AI야, 이거 해줘" (매번 설명)
✅ "AI야, F023 작업 시작" (시스템이 알아서 컨텍스트 로드)
```

### 3. "파일 이동은 Git의 적"

상태를 바꿀 때 파일을 `todo/` → `in-progress/` → `done/`으로 옮기면:

- `git log --follow` 필요
- GitHub blame 깨짐
- 히스토리 추적 어려움

→ **Frontmatter 메타데이터로 해결!**

### 4. "토큰은 돈"

50개 파일을 매번 읽으면:

- 느리다
- 비싸다
- 컨텍스트가 꽉 찬다

→ **INDEX.md 캐시로 50배 절약**

### 5. "스크린샷은 타이밍"

블로그를 쓸 때가 아니라 **개발이 끝날 때 바로** 찍어야 한다.

→ `/blog` 명령어에 이미지 추천을 내장했다

### 6. "모든 프로젝트에 표준화"

Features 시스템을 CheckUS뿐만 아니라 **모든 프로젝트의 필수 표준**으로 확립했다.

```markdown
# C:/Users/YJL/.claude/CLAUDE.md (전역 설정)

## 📋 Features 추적 시스템 (모든 프로젝트 표준)

### 핵심 원칙
**모든 작업은 Feature로 추적된다.**
- ✅ 새 기능 개발 → Feature
- ✅ 버그 수정 → Feature
- ✅ 리팩토링 → Feature
- ✅ 문서 작성 → Feature
- ❌ "Features 추적 안 하는 작업"은 존재하지 않음
```

**자동 설정 유도**:

```
# 새 프로젝트에서 /finish 실행 시

AI:
1. docs/features/ 폴더 확인
2. 없으면:

┌────────────────────────────────────────┐
│ ⚠️  Features 추적 시스템이 없습니다.  │
│                                        │
│ 지금 설정할까요?                       │
│                                        │
│ 생성 파일:                             │
│ - docs/features/INDEX.md              │
│ - docs/features/F001-[현재작업]/      │
│                                        │
│ [Y/n]                                  │
└────────────────────────────────────────┘
```

### 7. "/blog 웹 서치로 자연스러운 글쓰기"

문제: AI가 쓴 글은 말투가 어색하다

```
"본 포스팅에서는..."
"구현하였습니다"
"다음과 같습니다"
```

해결: **블로그를 쓰기 전에 인기 글을 검색하고 말투를 학습한다!**

`/blog` 명령어에 1.5단계를 추가했다:

```
1.5단계: 기존 글 리서치 및 경쟁 분석

한국어 검색:
- "[주제] site:velog.io"
- "[주제] site:tech.kakao.com"
- "[주제] site:techblog.woowahan.com"

영어 검색:
- "[topic] site:dev.to"
- "[topic] site:medium.com"
- "[topic] site:hashnode.dev"

결과 분석:
1. 타겟 독자 결정 (한국 vs 글로벌)
2. 인기 글의 말투 학습 (문장 패턴, 어미, 구어체)
3. 차별화 포인트 발견
```

효과:

- 한국 독자용: "~네요", "~거 같아", 구어체
- 글로벌 독자용: 직관적 예제, 짧은 문장
- 중복 글 방지, 차별성 확보

---

## 주의할 점

### 1. INDEX.md는 "캐시"

- 개별 파일이 원본 (Source of Truth)
- INDEX.md가 꼬이면 재생성 가능
- 자동 업데이트 필수

### 2. Features 남발 방지 - 관련 Feature 검색

문제: 작은 버그 수정마다 새 Feature를 만들면?

```
F032: /blog 명령어 구현
F033: /blog 웹 서치 버그 수정
F034: /blog 인코딩 오류 수정
F035: /blog 말투 개선
```

→ Feature가 너무 많아진다!

해결: `/finish` 실행 시 **관련 Feature를 자동으로 검색**한다

```
사용자: "/blog 웹 서치 오류 수정했어. /finish"

AI:
1. 대화 맥락에서 키워드 추출: "blog", "웹 서치"
2. INDEX.md 검색 → F032 발견
3. 사용자에게 선택 제안:

┌─────────────────────────────────────────┐
│ F032와 관련된 작업으로 보입니다.        │
│                                         │
│ A) F032에 이어서 작업                   │
│    - status: DONE → IN_PROGRESS        │
│    - "🐛 추가 수정사항 (2차)" 섹션 추가│
│                                         │
│ B) 새 Feature 생성 (F033)              │
│                                         │
│ 선택: [A/B]                            │
└─────────────────────────────────────────┘
```

**A 선택 시**: Feature 재개

```markdown
---
id: F032
status: IN_PROGRESS  # DONE → IN_PROGRESS 변경
resumed: 2025-10-31 12:00 KST
completed: 2025-10-31 10:30 KST  # 첫 완료 시각 유지
---

## 🐛 추가 수정사항 (2차 - 2025-10-31)

### 배경
F032 작업 중 웹 서치 인코딩 버그 발견...

### 수정 내용
- UTF-8 인코딩 명시
- 검색 결과 파싱 로직 개선

### 관련 커밋
- `abc1234` - fix: 웹 서치 인코딩 오류 수정
```

→ **관련 작업이 한 곳에 모인다!**

---

## 향후 개선 방향

### 1. 자동 CHANGELOG 생성

```bash
Features의 DONE 항목들 → CHANGELOG.md 자동 생성
```

### 2. LinkedIn 포스트 초안

```
/blog 완료 → LinkedIn용 짧은 버전도 자동 생성
```

### 3. Features 통계 대시보드

```html
features-stats.html
- 월별 완료 기능 수
- 예상 vs 실제 시간
- 태그별 분포
```

### 4. npm package화

```bash
npx init-feature-system
→ .claude/commands/
→ checkus-docs/features/
자동 설치
```

---

## 정리

Features 추적 시스템은:

1. **컨텍스트 보존** - AI가 작업 맥락을 잃지 않게
2. **토큰 절약** - INDEX.md로 50배 효율 향상
3. **블로그 자동화** - 초안 + 이미지 추천 자동 생성
4. **Git 히스토리 보존** - Frontmatter로 상태 관리
5. **전역 표준화** - 모든 프로젝트에 적용

결과적으로 29개 기능을 체계적으로 관리하고, 블로그 작성 장벽을 낮췄다.

AI 코딩 도구를 쓴다면, AI가 따라갈 수 있는 워크플로우를 먼저 만들자.

---

**시리즈 다음 글**: [/blog 명령어 - 개발 블로그 작성 시간을 83% 줄인 방법](/2025/11/01/blog-command-ai-workflow.html)
