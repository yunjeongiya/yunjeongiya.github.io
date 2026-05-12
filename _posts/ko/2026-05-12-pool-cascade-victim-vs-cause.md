---
layout: post
title: "DB 풀 고갈 cascade: leak 출처 분산에 속지 말 것"
date: 2026-05-12 10:30:00 +0900
categories: [Database, Debugging]
tags: [hikaricp, incident, debugging, postmortem]
lang: ko
slug: "078"
thumbnail: /assets/images/posts/078-pool-cascade/thumbnail-ko.jpg
image: /assets/images/posts/078-pool-cascade/thumbnail-ko.jpg
published: true
---

> 5/4 DB incident 시리즈
>
> 1. [cardinality=1 단일컬럼 인덱스가 새 compound index를 무력화한다](/posts/077/)
> 2. **DB 풀 고갈 cascade: leak 출처 분산에 속지 말 것**
> 3. [잠복 슬로우 쿼리 incident: "왜 하필 오늘?"의 답을 짚을 수 없는 이유](/posts/079/)
> 4. [anti-pattern 124곳 발견, DROP은 19개 — 나머지를 그대로 둔 이유](/posts/080/)
> 5. [JPA @Index ≠ prod DB index — Entity-DB drift 의 5가지 패턴](/posts/081/)

![원인은 하나 leak 경고는 여러 곳](/assets/images/posts/078-pool-cascade/thumbnail-ko.jpg){: width="700"}

## 도입

HikariCP `Apparent connection leak detected` 경고가 8개 서비스에 분산되어 60건 이상 발화하면 직관은 "8곳 모두 leak 이다, 각자 고쳐야" 라고 말한다. 직관이 틀리는 경우가 많다. 단일 풀이 고갈된 cascade 에서는 **1곳만 cause, 나머지는 모두 victim** 인 패턴이 흔하다.

이 글은 cause 와 victim 을 구분하는 진단 방법을 정리한다.

## 배경 / 문제

prod P0 incident 시점에 다음 8개 서비스에서 leak 경고가 분산 발화:

| 서비스 | leak 경고 수 |
|---|---|
| 사용자 진도 조회 | 20 |
| 카탈로그 트리 lazy load | 11 |
| 가상 task 집계 | 6 |
| 통합 상태 집계 | 4 |
| 사용자 목록 조회 | 3 |
| 캘린더 일정 | 2 |
| 인증 (로그인 / refresh) | 4 |
| 알림 스케줄러 | 1 |

처음에는 "이런 도메인 곳곳에 leak 이 있구나, 각자 트랜잭션 누수 검토해야겠다" 로 갔다. 가설 추적 시간 30분 낭비.

## 해결 과정

### 단일 풀의 동작 메커니즘

HikariCP `leakDetectionThreshold` (HikariCP 기본값은 0, 즉 비활성화. 우리 설정은 30초) 가 작동하는 방식:

1. 트랜잭션 시작 → 풀에서 conn borrow
2. 30초 이상 안 돌려놓으면 `Apparent connection leak detected` 경고 발화 + 그 시점의 stack trace 저장

핵심: **leak 경고는 "내가 leak 했다"가 아니라 "conn 을 30초 넘게 들고 있다"는 뜻**. 풀이 비어 있어서 자기 쿼리가 RDS CPU 점유 경쟁에 막혀 30초+ 걸린 케이스에도 발화한다.

즉:
- 같은 slow path 의 동시 실행 여러 개가 각각 오래 conn 을 점유 → 풀 모두 잠김
- 풀이 빌 때까지 다른 모든 borrow 요청이 대기
- 일부는 timeout (10초) 으로 실패, 일부는 어떻게든 conn 받아서 정상 처리
- 그런데 **RDS CPU 가 slow path 들에 점유돼 있어서**, 정상 쿼리도 30초+ 걸린다
- → 정상 쿼리들이 자기 stack trace 로 leak 경고 발화

이게 cascade 다. 60+ 경고가 8 서비스에 분산되어 있어도, 진짜 원인은 그 슬로우 쿼리 1개일 수 있다.

![Connection pool cascade diagram](/assets/images/posts/078-pool-cascade/pool-cascade-diagram.svg){: width="700"}

### Cause / Victim 구분법

각 leak 출처에 대해 한 번에 하나씩 검증:

```sql
EXPLAIN [본인 쿼리];
-- 그리고 prod-like 데이터로 단독 실행 시간 측정
```

- 본인 쿼리가 **단독으로 빠르면** (< 100ms): cascade victim. 풀이 비어 있었기 때문에 늦은 것
- 본인 쿼리가 **단독으로 느리면** (수초 이상): 별개의 cause. 자체 fix 필요

8개 출처를 모두 검증한 결과:

| 출처 | 단독 실행 시간 | 결론 |
|---|---|---|
| 사용자 진도 조회 | 391초 → 50ms (인덱스 fix 후) | cause |
| 카탈로그 트리 | <100ms | victim |
| 가상 task 집계 | <100ms (이전 incident 때 인덱스 추가됨) | victim |
| 통합 상태 집계 | 항상 <50ms | victim |
| 그 외 | 항상 빠름 | victim |

→ **1곳 fix 로 8개 cascade 전부 해결.** 7개 의심 도메인 follow-up 작업은 불필요했다.

![Cause victim check loop](/assets/images/posts/078-pool-cascade/cause-victim-check-loop.svg){: width="700"}

## 결과

- cause 1건 fix → 다음 날 같은 endpoint 트래픽 +6% 였지만 incident 0건
- victim 검증 시간: 30분. fix 자체보다 더 걸렸지만, 7개 도메인 wild-goose chase 를 막은 가치 있는 시간

## 배운 점

### 단일 풀의 cascade 는 신호 분산을 만든다

같은 incident 가 매번 8개 stack trace 로 나타나면, 8 곳 작업 항목으로 분해되는 게 자연스러운 사고 흐름이다. 그게 함정이다. **분산된 신호 = 분산된 원인** 이 항상 성립하지 않는다.

### 첫 단계는 단독 검증

큰 incident 마무리 단계에서 "다른 leak 들은 어떻게 처리할까" 가 나오면, **각각의 본인 쿼리를 EXPLAIN/timing 으로 단독 검증** 하는 것을 첫 단계로 둔다. 코드 변경 작업으로 들어가기 전.

### leak 경고는 "borrow 시간 임계 초과" 신호

이름 때문에 직관이 흐려진다. "leak" 이라는 단어 그대로 받아들이면 "코드가 conn 을 안 닫고 있다" 로 해석되지만, 실제로는 **`@Transactional` 메서드가 threshold 보다 오래 걸렸다** 의 신호다. 코드 결함이 아닐 수 있다.

### 진단 시간 vs 작업 시간

incident 사후 7개 도메인을 의심해서 각각 코드 검토 들어가면 며칠 작업이다. 30분 단독 검증으로 6 곳을 후보에서 빼면 그 며칠을 살린다. **진단 시간을 충분히 쓰는 게 작업 시간을 줄인다.**

## 다음 글

root cause 와 cascade 구조를 정리한 뒤에도 운영자는 보통 "왜 하필 오늘?"을 묻는다. [다음 글](/posts/079/)은 이 질문을 끝까지 쫓아도 답이 안 나오는 latent incident 의 경우를 다룬다.

## References

- HikariCP 공식 문서: [leakDetectionThreshold](https://github.com/brettwooldridge/HikariCP#frequently-used)
- 풀 고갈 incident 사후 분석 시 함께 보면 좋은 메트릭: `pool_active`, `pool_pending`, `pool_idle` 시계열
- Resilience4j circuit breaker — pool 고갈 시 cascade 차단의 1차 방어선
