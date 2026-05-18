---
layout: post
title: "혼자 서버 운영하다 장애 났을 때 — AI 세션 역할 분리로 war room 흉내내기"
date: 2026-05-16 21:00:00 +0900
categories: [DevOps, Vibe Coding]
tags: [claude-code, incident-response, sre, ai, vibe-coding, multi-session]
lang: ko
slug: "084"
thumbnail: /assets/images/posts/084-ai-incident-response-role-split/thumbnail.png
image: /assets/images/posts/084-ai-incident-response-role-split/thumbnail.png
published: true
---

![체스판 위에서 한 손이 방패 말과 돋보기 말을 나누어 움직이는 장면](/assets/images/posts/084-ai-incident-response-role-split/thumbnail.png){: width="700"}

서버가 죽었다. 혼자다. 지금 당장 살려야 하는데, 왜 죽었는지도 알아야 한다.

이 두 가지를 동시에 하려고 하면 둘 다 느려진다. SRE 팀이 있는 조직은 "war room"을 연다. 복구 담당, 조사 담당, 커뮤니케이션 담당을 분리한다. 혼자 운영하면서도 비슷한 구조를 만들 수 있었다 — AI 세션 두 개로.

---

## 장애 대응의 두 가지 모드

Google SRE 책에는 incident 대응의 핵심 원칙이 있다. 요지는 **먼저 출혈을 멈추고, 서비스를 복구하고, root cause 분석을 위한 증거를 보존하라**는 것이다.

이 원칙을 혼자 운영하는 상황에 맞게 바꾸면, 서비스 복구와 원인 조사를 분리하는 쪽이 안전하다.

복구와 조사를 같은 사람이 동시에 하면:
- 조사에 시간을 쓰는 동안 서비스는 계속 죽어있다
- 복구하느라 급하면 원인 단서를 남기지 못한다
- 두 트랙이 서로를 방해한다

war room은 이 두 모드를 사람으로 분리한다. AI 세션으로도 같은 분리가 가능하다.

![AI 세션 두 개를 복구와 조사 역할로 나누는 구조도](/assets/images/posts/084-ai-incident-response-role-split/role-split-diagram.svg){: width="700"}

---

## 세션 분리: /rescue와 /incident

Claude Code를 쓴다면 두 세션을 동시에 열 수 있다. 한 컴퓨터에서 두 세션을 돌려도 로컬 CPU에는 부담이 거의 없다. 실제 연산은 Anthropic 서버에서 이루어지고, 로컬에서는 API 호출 프로세스만 돌아간다.

### 세션 1: /rescue (복구 전담)

이 세션은 **서비스를 살리는 것만** 한다.

```
"서버 죽었어. /rescue"
```

복구 세션이 하는 일:

1. **상태 확인** — 컨테이너 살아있나, 헬스체크 응답하나, 로그에 무슨 에러가 있나
2. **복구 실행** — blue-green swap, 또는 컨테이너 재시작
3. **복구 확인** — 헬스체크 반복, 응답 정상화 확인
4. **결과 요약** — "복구 완료. 방법: restart. 재시작 직전 마지막 에러: [...]"

이 세션은 **코드를 수정하지 않는다.** 원인도 파악하지 않는다. 서비스가 살아있으면 임무 완료다.

### 세션 2: /incident (조사 전담)

이 세션은 **왜 죽었는지를 찾는 것만** 한다.

```
"세션 1이 복구 중. 너는 root cause 조사만. 코드 수정하지 마."
```

조사 세션이 하는 일:

1. **직전 24h 배포 커밋 확인** — 가장 먼저
2. **에러 로그 패턴 분석** — 특정 에러가 급증했나
3. **DB 상태 확인** — 슬로우 쿼리, 락, processlist
4. **메트릭 확인** — CPU, 힙, GC pause, 커넥션 풀
5. **가설 수립 → 검증 → 수정 구현**

---

## 실제 플로우

장애 발생 시:

```
[알림 도착]
     ↓
세션 1 열기 → "/rescue 서버 살려줘"
     ↓ (동시에)
세션 2 열기 → "세션1이 복구 중. 너는 조사만. 코드 건드리지 마.
               직전 24h 배포 커밋부터 확인해줘."
     ↓
세션 1: blue-green swap 또는 restart 실행
세션 2: 로그 패턴, 배포 커밋, 메트릭 분석 병렬 진행
     ↓
세션 1 → 복구 완료 보고 (마지막 에러 로그 포함)
사용자 → 세션 2에 전달 ("세션1 복구 완료. 재시작 전 에러: [...]")
     ↓
세션 2: 가설 확정 → 수정 구현
```

![장애 알림 이후 복구와 조사가 병렬로 진행되는 타임라인](/assets/images/posts/084-ai-incident-response-role-split/incident-flow.svg){: width="700"}

두 세션이 **같은 코드를 동시에 수정하지 않도록** 명시적으로 역할을 알려주는 게 중요하다. 안 그러면 두 세션이 같은 파일을 덮어쓰는 사고가 난다.

---

## 복구 세션이 조사까지 맡으면 안 되는 이유

처음에는 "복구 세션에서 원인도 같이 파악하면 되지 않나?"라고 생각했다.

실제로 해보니 문제가 있었다. 복구 세션이 빠르게 root cause 가설을 잡고 코드 수정까지 하면:

- 서비스가 재시작되는 동안 단서(로그, 메트릭)가 사라진다
- 가설이 틀렸을 때 돌아갈 기준점이 없다
- 급하게 추측한 root cause로 잘못된 수정이 prod에 들어간다

실제 장애 대응에서 세 번 잘못된 가설을 세웠다:

1. "DB 쿼리가 느린 거다" → EXPLAIN 분석했지만 cascade victim이었음
2. "인프라 자원 한계다" → EC2 CPU가 98%였지만 이것도 결과였음
3. "직전 배포 커밋" → 이걸 첫 단계에 확인했어야 했음

복구와 조사를 분리하면 조사 세션이 **서두르지 않고** 단서를 체계적으로 수집할 수 있다.

---

## 세션이 여러 개면 더 좋을까?

처음에는 조사 세션도 여러 개 띄우면 어떨까 생각했다. 병렬로 다른 가설을 탐색하게 하면 빠를 것 같아서.

실제로는 독이 된다.

조사 세션 A: "DB 쿼리 문제"
조사 세션 B: "배포 커밋 문제"
조사 세션 C: "인프라 문제"

세 가설이 동시에 제시되면, 사용자가 중재를 해야 한다. 이미 급한 상황에서 세 세션의 의견을 종합하는 인지 부하가 추가된다. 그리고 가설이 틀렸을 때 "어느 세션 말이 맞나"를 판단하는 것도 사용자의 몫이 된다.

최적 구성: **복구 1개 + 조사 1개.**

더 필요하면 조사 세션이 "다음 단계로 넘어가면서" 동일 세션 내에서 병렬 tool call을 쓰면 된다.

---

## 스킬로 만들기

이 워크플로우를 `/rescue`와 `/incident` 스킬로 정리했다.

**`/rescue` 스킬**은 복구 전담 체크리스트다:
- 현재 active 컨테이너 확인
- blue-green swap 또는 컨테이너 재시작
- 헬스체크 반복 확인
- 복구 완료 요약 (다음 세션에 전달용 포맷 포함)
- "코드 수정하지 않는다"는 경계를 스킬 자체에 명시

**`/incident` 스킬**은 6개 실제 장애 사례에서 뽑아낸 조사 체크리스트다:
- Phase 1(≤5분): 직전 24h 배포 커밋 + 에러 로그 + 메트릭 병렬 수집
- Phase 2: root cause 가설 (함정 회피 목록 포함)
- Phase 3: 수정 + 재발 방지
- Phase 4: 문서화

스킬 덕분에 다음 장애에서는 "뭘 먼저 봐야 하지?"를 생각하는 시간 없이 바로 시작할 수 있다.

---

## AI SRE의 현실

Anthropic의 Claude Cookbook에는 [SRE incident response agent](https://platform.claude.com/cookbook/managed-agents-sre-incident-responder) 예제가 있다. PagerDuty webhook → Lambda → Claude API → 자동 분석 → Slack 보고 흐름이다. 완전 자동화다.

현실적인 제약:
- Claude Code는 채팅창에 메시지가 와야 동작한다. Slack 알림을 자동으로 받아서 반응하지 못한다.
- 자동으로 분석하고 PR을 올리는 에이전트는, 분석이 틀렸을 때 잘못된 수정이 prod에 들어갈 수 있다.

지금 구조의 현실: **알림 오면 사용자가 채팅창 열고 → `/rescue` + `/incident` 실행**. 자동화는 아니지만, 체계화되어 있다.

[incident.io의 글](https://incident.io/blog/how-it-feels-to-run-an-incident-with-ai-sre)에서도 같은 결론에 도달한다: "Most practical AI SRE deployments run as companions that read, correlate, and draft while a human engineer decides the next move." — 읽고, 연결하고, 초안을 쓰고, 사람이 결정한다.

바이브코딩으로 서비스를 운영하는 솔직한 현실이다. 완전 자동화는 아직 멀었고, 체계화된 반자동화로 대응 속도를 줄이는 게 실용적이다.

---

## 정리

| | /rescue 세션 | /incident 세션 |
|--|--|--|
| 목표 | 서비스 복구 | root cause 파악 |
| 코드 수정 | ❌ | ✅ |
| 타임라인 | ≤ 10분 | 복구 이후 |
| 결과물 | "서비스 UP" 확인 | 수정 PR + 재발 방지 |

장애가 나면 두 세션을 동시에 열고, 각자 역할만 하도록 명시적으로 알려준다. 그게 전부다.

---

## 참고

- [Google SRE Book: Managing Incidents](https://sre.google/sre-book/managing-incidents/)
- [War Room Protocols: Coordinating Critical Incident Response](https://upstat.io/blog/war-room-protocols)
- [How it feels to run an incident with AI SRE — incident.io](https://incident.io/blog/how-it-feels-to-run-an-incident-with-ai-sre)
- [AI SRE with Claude Code: 5 On-Call Reliability Workflows — Arcade](https://www.arcade.dev/blog/claude-code-ai-sre-oncall-workflows/)
- [Build an SRE incident response agent with Claude Managed Agents](https://platform.claude.com/cookbook/managed-agents-sre-incident-responder)
- [Claude Code를 활용한 예측 가능한 바이브 코딩 전략 — 컬리 기술 블로그](https://helloworld.kurly.com/blog/vibe-coding-with-claude-code/)
