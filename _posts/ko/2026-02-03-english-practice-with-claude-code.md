---
layout: post
title: "코딩하면서 영어 교정받기 — Claude Code를 영어 튜터로 쓰는 법"
date: 2026-02-03 12:00:00 +0900
categories: [Developer Tools, Productivity]
tags: [claude-code, hooks, english, productivity, developer-tools]
lang: ko
slug: "030"
thumbnail: /assets/images/posts/030-english-practice/thumbnail-ko.png
---

![코딩하면서 영어 교정받기](/assets/images/posts/030-english-practice/thumbnail-ko.png){: width="700"}

## 개요

개발자에게 영어는 필수다. 공식 문서, Stack Overflow, GitHub Issue — 전부 영어다.
그런데 따로 시간 내서 영어 공부하기는 쉽지 않다.

그래서 생각했다. **어차피 매일 쓰는 코딩 도구가 영어도 교정해주면?**

Claude Code의 hooks 시스템을 활용하면 코딩하면서 자연스럽게 영어 교정을 받을 수 있다. 별도 앱도 필요 없고, 추가 비용도 없다. 이미 쓰고 있는 도구에 설정 몇 줄만 추가하면, 영어 공부가 자동으로 끼어든다.

## 배경: 개발자의 영어 문제

한국 개발자 대부분이 영어로 커뮤니케이션할 일이 있다.
GitHub PR 리뷰, 커밋 메시지, 이슈 코멘트, 외국 동료와의 Slack 대화.

근데 문법 실수를 지적해주는 사람은 없다. 틀려도 의미는 통하니까 그냥 넘어간다. 그래서 같은 실수가 굳어진다.

나의 경우 가장 흔한 실수는 **관사(a/an/the) 누락**이었다. 한국어에는 관사가 없으니 당연하다.

```
❌ "give me solution"
✅ "give me a solution"

❌ "can you make daily review"
✅ "can you make a daily review"
```

이런 실수는 Grammarly 같은 도구로도 잡을 수 있다. 하지만 코딩 중에 별도 앱을 왔다 갔다 하면서 교정받을 사람은 거의 없다. **이미 쓰고 있는 도구 안에서 자동으로** 교정이 일어나야 한다.

영어로 쓰게 된 데는 또 다른 이유도 있다. **토큰 절약**이다. 한국어는 같은 내용을 영어보다 훨씬 많은 토큰으로 인코딩한다. AI 코딩 도구를 매일 쓰는 입장에서, 영어로 대화하면 토큰 소비가 눈에 띄게 줄어든다. 영어 연습과 비용 절감을 동시에 할 수 있는 셈이다.

그리고 예상 못한 부수 효과도 있었다. AI에게 짜증이 나서 욕을 쓰면, AI는 그 감정적인 텍스트를 처리하고 거기에 반응하느라 토큰을 소비한다. 실제 작업과 무관한 낭비다. 교정 시스템이 돌아가고 있다는 걸 의식하면 자연스럽게 말을 가려 쓰게 되고, **결과적으로 감정적 토큰 낭비도 줄어든다.**

## Claude Code Hooks — AI의 행동을 프로그래밍하는 방법

Claude Code는 Anthropic이 만든 CLI 기반 AI 코딩 도구다. 터미널에서 `claude`를 실행하면 AI와 대화하면서 코드를 작성하고, 파일을 수정하고, 커맨드를 실행할 수 있다.

여기서 중요한 건 Hooks다. Hooks는 특정 이벤트가 발생할 때 자동으로 셸 명령어를 실행하는 기능인데, Claude Code에는 12가지 hook 이벤트가 있다.

이 글에서 사용하는 건 3가지다:

| Hook | 발동 시점 | 용도 |
|------|----------|------|
| `SessionStart` | 세션이 시작될 때 | 이전 학습 기록 로드 |
| `UserPromptSubmit` | 사용자가 메시지를 보낼 때 | 매 메시지 영어 교정 |
| `SessionEnd` | 세션이 종료될 때 | (사용하려 했지만 포기 — 이유는 후술) |

핵심 메커니즘은 **hook의 stdout이 AI의 컨텍스트로 주입된다**는 점이다.

```
사용자 메시지 전송
    ↓
UserPromptSubmit hook 실행 (셸 명령어)
    ↓
stdout 출력: "영어 실수를 교정하라"
    ↓
AI가 이 지시를 읽고, 사용자 메시지 처리 시 영어 교정도 함께 수행
```

즉, hook은 **AI에게 매번 추가 지시를 주입하는 파이프라인**이다. 다시 말해, 프롬프트를 매번 손으로 쓰는 대신, 코드로 자동 주입하는 방식이다.

그런데 한 가지 제약이 있다. hook이 실행할 수 있는 건 셸 명령어뿐이다. `echo`, `cat`, `type` 같은 단순 명령은 되지만, "로그를 분석해서 요약을 다시 써라" 같은 **AI 수준의 처리는 hook 안에서 할 수 없다.** 이 제약이 설계에 큰 영향을 미쳤다.

## 구현: 3개 파일로 끝

전체 시스템은 딱 3개로 구성된다.

### 1. 메시지마다 교정 (`UserPromptSubmit` hook)

사용자가 메시지를 보낼 때마다 AI에게 "영어 실수를 교정하라"는 지시를 주입한다.

`~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo If the user made any English mistakes in their message, you MUST correct them with a brief grammar explanation. Format: original -> correction (reason). Keep it 1-3 lines max."
          }
        ]
      }
    ]
  }
}
```

이게 전부다. 이제 Claude Code에 영어로 뭔가를 쓸 때마다 교정이 달린다.

```
나:   "i want make new component for login"
Claude: (correction: "i want make" → "I want to make" — need 'to' before infinitive)
        Sure, let me create a login component...
```

코딩 흐름을 끊지 않는다. 교정은 1-2줄이고, 바로 작업으로 넘어간다.

### 2. 교정 기록 (`english-practice-log.md`)

교정만 하고 끝나면 의미가 없다. 어떤 실수가 반복되는지 추적해야 한다.

`~/.claude/english-practice-log.md`:

```markdown
# English Practice Log

## Pattern Tracking
| Pattern | Frequency | Examples | Tip |
|---------|-----------|----------|-----|
| Missing articles (a/an/the) | | | Korean doesn't have articles |
| Capitalization | | | Always capitalize: I, English |

## Daily Log

### 2026-02-02
- "im" → "I'm"
- "can you fix me" → "can you correct me"
- "give me solution" → "give me a solution"
- "observe my english" → "observe my English"

**Pattern observed:** Missing articles is the most common issue.
```

세션이 끝날 때 AI가 이 파일에 교정 내역을 추가한다.

### 3. 세션 시작 시 분석 (`SessionStart` hook)

다음 세션이 시작되면 hook이 로그 파일 전체를 AI에게 넘긴다. AI는 그걸 읽고 현재 약점을 분석해서 세션 시작 시 브리핑한다.

![세션 시작 시 영어 약점 분석 결과](/assets/images/posts/030-english-practice/01-session-start-analysis.png)

```json
{
  "SessionStart": [
    {
      "matcher": "startup",
      "hooks": [
        {
          "type": "command",
          "command": "echo Analyze the following English practice log and identify the user's current top weaknesses. Display a brief summary at session start. && cat ~/.claude/english-practice-log.md"
        }
      ]
    }
  ]
}
```

> Windows에서는 `cat` 대신 `type` 명령어를 사용한다.

### 왜 SessionEnd에서는 실패했는가

처음 설계는 이랬다:

```
세션 중: 교정 내역을 로그에 기록
세션 끝: 로그를 분석해서 english-practice-summary.txt에 요약 저장
다음 세션 시작: SessionStart hook이 summary.txt를 읽어서 AI에게 전달
```

깔끔해 보이지만, **"세션 끝에 요약을 업데이트한다"는 단계가 문제**였다.

`SessionEnd` hook이 있으니 자동화할 수 있지 않을까? 안 된다.

여기서 자연스러운 의문이 생긴다. "SessionStart hook에서는 AI가 로그를 분석하잖아. SessionEnd에서도 똑같이 하면 되는 거 아닌가?"

차이는 **hook 이후에 AI가 행동할 수 있느냐**다.

```
SessionStart hook 실행 → stdout이 AI 컨텍스트에 주입 → AI가 세션을 시작하며 분석 결과를 출력
SessionEnd hook 실행 → stdout이 AI 컨텍스트에 주입 → ...그리고? 세션이 끝난다.
```

SessionStart에서 AI가 분석할 수 있는 이유는, hook 출력을 받은 뒤 **세션 전체가 앞에 남아 있기 때문**이다. AI는 그 컨텍스트를 읽고 응답하고, 파일을 수정할 시간이 있다.

SessionEnd는 반대다. hook이 실행된 후 세션이 종료된다. AI가 로그를 받아도 **요약을 작성하고 파일에 저장할 다음 턴이 없다.** hook 자체는 셸 명령어만 실행할 수 있으니, `echo`로 로그를 넘겨봤자 그걸 분석해서 요약 파일을 생성할 주체가 없는 셈이다.

그러면 세션 끝에 내가 수동으로 해야 하나? `/finish` 같은 커맨드에 넣어두면 되겠지. 하지만 현실은 — `/finish` 쓰는 걸 까먹는다.

결국 발상을 뒤집었다. **요약 파일을 없애고, 로그 원본을 통째로 AI에게 넘기자.**

```
❌ v1: 로그 → (AI가 요약 생성) → summary.txt → hook이 읽음
   문제: 요약 생성 시점을 자동화할 수 없음

✅ v2: 로그 → hook이 통째로 읽음 → AI가 매번 직접 분석
   해결: 분석이 항상 최신, 업데이트 단계 자체가 없음
```

AI에게 원본 데이터를 넘기면 매번 최신 상태를 분석한다. 중간 파일을 관리할 필요도, 업데이트를 까먹을 일도 없다.

## 실제 효과

실제로 코딩 대화 중에 영어 교정이 자연스럽게 삽입되는 모습:

![실제 교정 사례 — 관사, 주어-동사 일치](/assets/images/posts/030-english-practice/02-correction-example-1.png)

![실제 교정 사례 — 명사 수식어, 어순](/assets/images/posts/030-english-practice/03-correction-example-2.png)

2일간 사용한 결과:

| 패턴 | 빈도 | 예시 |
|------|------|------|
| 관사 누락 | 2회 | "make daily review" → "make **a** daily review" |
| 대문자 누락 | 2회 | "english" → "**E**nglish" |
| 단어 선택 | 1회 | "fix me" → "correct me" |
| 동사 패턴 | 1회 | "help to save" → "help save" |

아직 샘플이 적지만, **관사 누락이 반복된다**는 패턴이 바로 보인다. 이런 걸 스스로 인식하는 것만으로도 실수가 줄어든다.

## 전체 설정 파일

복사해서 바로 쓸 수 있는 전체 설정이다. `~/.claude/settings.json`에 추가하면 된다.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "echo Analyze the following English practice log and identify the user's current top weaknesses. Display a brief summary at session start. Then correct English mistakes inline during this session. && echo --- LOG START --- && cat ~/.claude/english-practice-log.md && echo --- LOG END ---"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo If the user made any English mistakes in their message, you MUST correct them with a brief grammar explanation. Format: original -> correction (reason). Keep it 1-3 lines max."
          }
        ]
      }
    ]
  }
}
```

> Windows에서는 `cat` 대신 `type`으로 바꾸고, 경로에 `\\`를 사용한다.

로그 파일은 `~/.claude/english-practice-log.md`에 직접 만들면 된다. 형식은 자유지만, Pattern Tracking 테이블과 Daily Log 구조를 권장한다.

## 확장 가능성

이 구조는 영어에만 한정되지 않는다.

- **일본어 교정**: 일본어로 대화하면서 문법 교정
- **코드 리뷰 스타일 학습**: PR 코멘트 문체를 교정
- **기술 용어 통일**: 프로젝트 내 용어 사용 일관성 체크

hooks의 본질은 **"매 인터랙션에 컨텍스트를 주입하는 것"**이다. 어떤 종류의 피드백이든 이 구조에 얹을 수 있다.

## 배운 점

1. **이미 쓰는 도구에 기능을 얹는 게 가장 효과적이다.** 별도 앱은 결국 안 쓰게 된다.
2. **hook은 셸 명령어만 실행할 수 있다는 제약을 이해해야 한다.** AI 수준의 처리가 필요한 작업은 hook 안에서 하려 하지 말고, 원본 데이터를 넘겨서 AI에게 맡기는 게 맞다.
3. **"나중에 업데이트하겠다"는 계획은 실패한다.** 자동화할 수 없으면 아예 그 단계를 없애는 게 낫다.
4. **교정은 짧아야 한다.** 1-2줄 넘어가면 작업 흐름을 방해한다. hook 지시문에 "Keep it 1-3 lines max"를 명시한 이유다.

## 참고 자료

- [Claude Code Hooks 공식 문서](https://code.claude.com/docs/en/hooks)
- [Claude Code Hooks 완벽 가이드 (Velog)](https://velog.io/@csk917work/Claude-Code-Hooks-%EC%99%84%EB%B2%BD-%EA%B0%80%EC%9D%B4%EB%93%9C-%EA%B0%9C%EB%B0%9C%EC%9E%90%EC%9D%98-%EC%83%88%EB%A1%9C%EC%9A%B4-%EC%8A%88%ED%8D%BC%ED%8C%8C%EC%9B%8C)
- [개발자 영어 실력 향상 (InfoGrab)](https://insight.infograb.net/blog/2024/07/10/developer-english/)
