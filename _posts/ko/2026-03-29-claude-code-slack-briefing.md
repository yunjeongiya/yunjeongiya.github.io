---
layout: post
title: "Claude Code 스케줄 에이전트로 매일 Slack 브리핑 자동화하기 (+ 네트워크 제한 우회법)"
date: 2026-03-29 09:00:00 +0900
categories: [DevOps, Automation]
tags: [Claude Code, Remote Trigger, GitHub Actions, Slack, Automation, AI Agent]
lang: ko
slug: "046"
thumbnail: /assets/images/posts/046-claude-code-slack-briefing/thumbnail-ko.png
---

![Claude Code 에이전트 자동화로 매일 Slack 브리핑 받기](/assets/images/posts/046-claude-code-slack-briefing/thumbnail-ko.png)

퇴근했는데도 작업이 돌아간다.

다음 날 출근해서 Slack을 열면, 어제 내가 뭘 했는지 정리된 메시지가 와 있다. 이걸 Claude Code로 만들 수 있다.

커뮤니티에서 이런 글을 봤다.

> 클로드코드는 컴퓨터가 꺼져 있어도 자동 작업을 할 수 있습니다.
> 사실 이 기능이 오픈클로보다 더 유연한 기능이라고 보이는데,
> 생각보다는 많이 알려지지 않은 것 같아요.

댓글에는 "그냥 클라우드에 git clone해놓고 실행시키는 거 아닌가요?" "서버에서 자동화 실행시키면 되는 거 아닌가요?" 같은 반응이 달렸는데, 핵심은 **내 컴퓨터가 꺼져 있어도 Anthropic 클라우드에서 에이전트가 돌아간다**는 점이었다.

1인 개발자로 출결 관리 시스템을 운영하고 있는데, 평소 Claude Code 세션을 7~8개 동시에 켜놓고 작업한다. 서버, 프론트, 문서, 버그 수정 — 작업 단위별로 세션을 분리하는 게 편하니까.

문제는 퇴근했다 다음 날 출근하면 **어제 뭘 하고 있었는지 까먹는다**는 거다. 컨텍스트 스위칭 비용이 매일 아침 쌓이는 느낌이었다. `claude -r`(resume)로 세션 목록을 띄워봐도, 이름을 안 붙여놓은 세션이 UUID로 나열되어 있으면 어느 게 어느 작업이었는지 알 수가 없다. 세션에 이름 붙이는 건 또 귀찮아서 안 하게 되고, 세션이 수백 개 쌓이면 검색해도 잘 안 나온다.

매일 아침 "어제 뭐 했더라?" 하고 커밋 로그를 뒤지고, 세션 목록을 스크롤하는 시간이 아까웠다. 이걸 자동화할 수 있겠다 싶어서 바로 시도해봤다.

## 목표: 아침에 Slack으로 브리핑 받기

구상한 플로우는 이렇다:

1. **저녁 17:50** — "퇴근 전 정리해" 리마인더
2. **퇴근 전** — 로컬에서 `/wrap-up` 실행 → 오늘 세션 + 메모 정리 → git push
3. **아침 09:00** — 어제 커밋 + wrap-up 기록 분석 → Slack 브리핑

모닝 브리핑에 들어갈 내용:
- 어젯밤 메모 (wrap-up에서 내가 남긴 것)
- 어제 커밋 요약 (서브모듈별)
- 재개 가능한 세션 목록 (`claude -r {id}`로 바로 재개)
- 진행 중 Feature 목록
- 대기 중인 결정사항

## 설계: "저녁 브리핑"이 "랩업 리마인더"가 된 이유

처음에는 단순하게 생각했다. 아침/저녁 두 번 브리핑을 보내면 되지 않을까?

- **아침**: 어제 뭐 했는지
- **저녁**: 오늘 뭐 했는지

그런데 생각해보니 저녁 브리핑은 아침 브리핑의 복붙이다. 하루가 끝난 시점의 커밋 요약은 다음 날 아침에 보는 것과 같으니까. 그래서 저녁은 **리포트가 아니라 리마인더**로 바꿨다 — "퇴근 10분 전이니 정리해"라는 알림.

### 문제: Remote Agent는 내 로컬을 모른다

여기서 핵심 문제가 생겼다. 모닝 브리핑에 "어제 진행 중이던 세션 목록"을 넣고 싶었다. `claude -r {세션ID}`로 바로 재개할 수 있게.

하지만 remote agent는 Anthropic 클라우드에서 돌아가니까, 내 로컬 PC의 Claude Code 세션 기록(`~/.claude/sessions/`)에 접근할 수 없다.

### 해결: 로컬에서 정리 → Git으로 전달

결국 이런 구조가 됐다:

1. **저녁 리마인더**가 Slack으로 "wrap-up 해"라고 알려줌
2. 내가 **로컬 Claude Code에서 `/wrap-up` 실행** — 이 때 Claude가 세션 파일을 직접 읽을 수 있음
3. `/wrap-up`이 세션 요약 + 내 메모를 `checkus-docs/sessions/YYYY-MM-DD.md`에 저장하고 push
4. **다음 날 아침** remote agent가 이 파일을 읽어서 브리핑에 포함

Git repo가 로컬과 클라우드 사이의 **공유 저장소** 역할을 하는 셈이다.

### 세션 기록은 어떻게?

Claude Code는 `~/.claude/projects/{프로젝트}/` 폴더에 세션별 JSONL 파일을 저장한다. 각 파일에 `sessionId`, `timestamp`, `gitBranch`, 그리고 전체 대화 기록이 들어있다.

`/wrap-up` 스킬은 오늘 날짜 세션 파일을 스캔해서 이런 테이블을 만든다:

```markdown
| # | 세션 ID | 브랜치 | 주제 | 재개 명령어 |
|---|---------|--------|------|------------|
| 1 | a4b86b4b | dev | F274 PIN 통합 | `claude -r a4b86b4b` |
| 2 | 0ee505d3 | dev | 키오스크 API | `claude -r 0ee505d3` |
```

한 세션에서 실행하면 다른 세션의 JSONL도 읽을 수 있으니, 각 세션마다 실행할 필요가 없다.

### "내일 할 것"은 사람이 입력한다

커밋 분석은 자동화할 수 있지만, "내일 뭘 할 건지"는 자동화할 수 없다. 그래서 `/wrap-up` 실행 시 딱 하나만 물어본다:

> "내일 할 것이나 기록할 메모가 있어?"

![/wrap-up 메모 입력 화면](/assets/images/posts/046-claude-code-slack-briefing/wrap-up-memo.png)

이 답변이 다음 날 모닝 브리핑의 첫 섹션("어젯밤 메모")에 들어간다. 1분이면 끝나는 수준이지만, 아침에 "어제 내가 뭘 하려고 했더라?" 하는 시간을 줄여준다.

## 스케줄 에이전트 만들기

Claude Code CLI에서 `/schedule` 명령으로 만들 수 있고, [웹 UI](https://claude.ai/code/scheduled)에서도 가능하다.

### 기본 구조

```
Remote Trigger (Anthropic Cloud)
├── cron_expression: "0 0 * * *"  (매일 09:00 KST = 00:00 UTC)
├── git_repository: sao-math/checkus
├── model: claude-sonnet-4-6
├── allowed_tools: [Bash, Read, Write, Glob, Grep]
└── prompt: "어제 커밋 분석해서 Slack으로 보내줘"
```

에이전트는 매번 fresh하게 repo를 clone하고, 프롬프트에 적힌 대로 작업한 뒤 종료된다. 컨텍스트가 없으니 **프롬프트가 곧 전부**다 — 구체적으로 써야 한다.

### 서브모듈 프로젝트의 함정

우리 프로젝트는 서브모듈 구조(server, teacher-web, student-mobile, docs, infra)인데, remote agent가 clone할 때 서브모듈은 자동으로 init되지 않는다. 프롬프트 첫 줄에 이걸 넣어야 한다:

```bash
git submodule update --init --recursive
```

이걸 빠뜨리면 parent repo 커밋만 보여서 "어제 커밋 없음"이라는 슬픈 브리핑을 받게 된다.

## 삽질 기록: Slack 알림이 안 온다

여기서부터가 진짜 이야기다. 총 3번의 시도와 실패가 있었다.

### 시도 1: Slack MCP 커넥터 → 알림 안 옴

Claude Code는 MCP(Model Context Protocol) 커넥터로 Slack에 연결할 수 있다. 설정도 간단하고, 메시지도 잘 보내진다.

**문제**: Slack MCP는 **내 계정으로** 메시지를 보낸다. Slack은 내가 보낸 메시지에 대해 알림을 주지 않는다. DM이든 채널이든 마찬가지.

`@멘션`을 넣어봤지만, 자기가 자기를 멘션해도 알림은 안 온다.

### 시도 2: curl + Slack Incoming Webhook → 네트워크 차단

Slack 봇의 Incoming Webhook을 쓰면 봇이 보내는 거니까 알림이 올 거라고 생각했다.

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"메시지"}' \
  https://hooks.slack.com/services/T.../B.../xxx
```

**문제**: Remote agent 환경에서 외부 webhook으로의 outbound 요청이 **403으로 차단**된다. Anthropic 클라우드 환경이 외부 HTTP 요청을 제한하고 있었다.

### 시도 3: Git → GitHub Actions → Webhook ✅

결국 이 문제는 "Slack" 문제가 아니었다. **네트워크 제한 환경에서 어떻게 외부로 신호를 보내느냐**의 문제였다.

답은 예상 밖에 있었다. **Git을 메시지 큐처럼 쓰는 것**.

```
Remote Agent          GitHub Actions         Slack
    │                      │                   │
    ├─ 메시지 JSON 작성     │                   │
    ├─ git commit & push ──→                   │
    │                      ├─ push 감지         │
    │                      ├─ JSON 읽기         │
    │                      ├─ curl webhook ────→│
    │                      ├─ 파일 삭제 & push   │ ✅ 봇 알림!
    │                      │                   │
```

Remote agent는 분석 결과를 JSON 파일로 저장하고 push만 한다. GitHub Actions가 push를 감지해서 webhook으로 Slack에 전송한다. **GitHub Actions에는 네트워크 제한이 없으니** 문제없이 동작한다.

실제로 Slack에 도착한 이브닝 리마인더:

![이브닝 리마인더 Slack 메시지](/assets/images/posts/046-claude-code-slack-briefing/evening-reminder.png)

## 구현

### 1. Remote Agent 프롬프트 (핵심 부분)

```
## Steps
1. git submodule update --init --recursive
2. 각 서브모듈에서 커밋 수집
3. 메시지 텍스트 작성
4. checkus-docs/slack-messages/morning-{날짜}.json 에 저장
5. git add → commit → push
```

agent가 만드는 JSON:
```json
{"text": ":sunny: CheckUS 모닝 브리핑 — 2026-03-29\n\n:bar_chart: 어제 커밋 요약\n..."}
```

### 2. GitHub Actions Workflow

```yaml
name: Send Slack Briefing

on:
  push:
    paths:
      - 'slack-messages/*.json'

jobs:
  send-slack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Send pending messages to Slack
        env:
          SLACK_WEBHOOK_URL: {% raw %}${{ secrets.SLACK_BRIEFING_WEBHOOK_URL }}{% endraw %}
        run: |
          for file in slack-messages/*.json; do
            [ -f "$file" ] || continue
            response=$(curl -s -o /dev/null -w "%{http_code}" \
              -X POST -H 'Content-type: application/json' \
              -d @"$file" "$SLACK_WEBHOOK_URL")
            if [ "$response" = "200" ]; then
              git rm "$file"
            fi
          done

      - name: Cleanup sent messages
        run: |
          if ! git diff --cached --quiet; then
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git commit -m "chore: cleanup sent slack messages"
            git push
          fi
```

`slack-messages/` 폴더에 JSON이 push되면 자동 실행 → Slack 전송 → 파일 삭제까지 한다.

### 3. /wrap-up 스킬 (로컬)

퇴근 전 로컬 Claude Code에서 `/wrap-up`을 실행하면:
1. 오늘 활성화된 세션 JSONL 파일 분석
2. 오늘 커밋 자동 수집
3. "내일 할 것" 메모 입력
4. `checkus-docs/sessions/YYYY-MM-DD.md`에 저장 → commit & push

이 파일을 다음 날 아침 모닝 브리핑 에이전트가 읽어서 브리핑에 포함한다.

## 전체 아키텍처

```
[매일 17:50 KST]
Remote Agent → 커밋 분석 → evening JSON push → GitHub Actions → Slack 봇
                                                                  │
[사용자]                                                    "랩업 할 시간!"
  └─ Claude Code에서 /wrap-up 실행
       └─ 세션 정리 + 메모 → sessions/YYYY-MM-DD.md push

[매일 09:00 KST]
Remote Agent → 커밋 + sessions 파일 분석 → morning JSON push → GitHub Actions → Slack 봇
                                                                                   │
[사용자]                                                                    "모닝 브리핑!"
```

실제로 Slack에 도착한 모닝 브리핑:

![모닝 브리핑 — 커밋 요약](/assets/images/posts/046-claude-code-slack-briefing/morning-briefing-1.png)

![모닝 브리핑 — 세션 목록 + Feature 상태](/assets/images/posts/046-claude-code-slack-briefing/morning-briefing-2.png)

## 비용

- **Remote Trigger**: Claude Code Max 구독에 포함 (추가 비용 없음)
- **GitHub Actions**: private repo도 월 2,000분 무료 (이 워크플로우는 1회 30초 미만)
- **Slack Incoming Webhook**: 무료

## 정리

| 방법 | 전송 | 알림 | 네트워크 | 결과 |
|------|------|------|---------|------|
| Slack MCP | ✅ | ❌ (자기→자기) | ✅ | 실패 |
| curl webhook | ✅ | ✅ (봇) | ❌ (403) | 실패 |
| Git + GitHub Actions | ✅ | ✅ (봇) | ✅ | **성공** |

Claude Code Remote Trigger의 네트워크 제한은 현재 기본 설정이다. 하지만 Git push는 가능하니까, **GitHub Actions를 중간 다리로 쓰면** 사실상 어떤 외부 서비스든 연동할 수 있다. Slack뿐 아니라 Discord, Telegram, 이메일 — webhook이 있는 건 다 된다.

1인 개발이라 동료가 "어제 뭐 했어?"라고 물어볼 사람이 없는데, 이제 매일 아침 봇이 알려준다. 꽤 만족스럽다.
