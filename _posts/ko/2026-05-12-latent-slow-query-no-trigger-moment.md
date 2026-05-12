---
layout: post
title: "잠복 슬로우 쿼리 incident: '왜 하필 오늘?'의 답을 짚을 수 없는 이유"
date: 2026-05-12 11:00:00 +0900
categories: [Postmortem, Debugging]
tags: [incident, postmortem, debugging, methodology]
lang: ko
slug: "079"
thumbnail: /assets/images/posts/079-latent-slow-query/thumbnail-ko.jpg
image: /assets/images/posts/079-latent-slow-query/thumbnail-ko.jpg
published: true
---

> 5/4 DB incident 시리즈
>
> 1. [cardinality=1 단일컬럼 인덱스가 새 compound index를 무력화한다](/posts/077/)
> 2. [DB 풀 고갈 cascade: leak 출처 분산에 속지 말 것](/posts/078/)
> 3. **잠복 슬로우 쿼리 incident: "왜 하필 오늘?"의 답을 짚을 수 없는 이유**
> 4. [anti-pattern 124곳 발견, DROP은 19개 — 나머지를 그대로 둔 이유](/posts/080/)
> 5. [JPA @Index ≠ prod DB index — Entity-DB drift 의 5가지 패턴](/posts/081/)

![천천히 찬 압력 노이즈 속에서 임계선을 넘다](/assets/images/posts/079-latent-slow-query/thumbnail-ko.jpg){: width="700"}

## 도입

P0 incident 사후 분석에서 매번 나오는 질문이 있다. **"왜 어제는 안 터졌고 오늘 터졌나?"**

가설 추적의 함정이 여기 있다. 잠복하던 슬로우 쿼리가 데이터 누적으로 임계점을 통과하는 incident 에서는 **"오늘의 차이"를 짚을 수 없는 경우가 많다.** 환경 노이즈에 가려져 있기 때문이다. 그런데도 가설을 깊이 쫓다 보면 시간을 버린다.

이 글은 그 함정에 빠졌다가 빠져나온 기록이다.

## 배경 / 문제

prod P0 incident — 슬로우 쿼리가 풀을 점유해서 12 endpoint cascade. 근본 원인 (저카디널리티 단일 인덱스로 인한 잘못된 실행 계획) 은 빠르게 찾아서 20분 만에 fix.

마무리 단계에서 운영자가 던진 질문: **"왜 하필 오늘 터졌어?"**

당시 fact 들:
- 슬로우 쿼리 자체는 X개월 전 (기능 출시 시점) 부터 존재
- 테이블 row 수는 지난 한 달간 ~50× 증가 (외부 데이터 일괄 import 누적)
- 사고 발생 시각: 평일 저녁 피크 (운영시간)
- 어제 / 그제: 같은 시간대에 정상 동작

## 해결 과정 (가설 추적의 함정)

### 가설 1: "오늘 배포된 새 코드가 트리거"

오늘 배포된 commit 21개 검토. 슬로우 쿼리가 있는 service 와 직접 관련된 변경 0건. **무관 확인.** 시간 사용: ~15분.

### 가설 2: "오늘 새로 시작된 트래픽 패턴이 트리거"

nginx access log 에서 슬로우 쿼리 트리거 endpoint 호출량 확인:
- 어제까지 0건 (?)
- 오늘 1,500건+

"오늘 갑자기 그 endpoint 가 사용되기 시작했다" 결론. 무엇이 이걸 트리거했는지 추가 추적:
- 새 UI 배포? 새 push 알림 캠페인? 운영자 안내?

20분 더 추적 후 알게 됨: **nginx docker log retention 한계 — 어제 데이터가 아예 없음.** 어제까지 0건이 아니라 어제까지 로그가 없는 것. **잘못된 전제로 결론.** 시간 사용: ~25분.

### 가설 3: "오늘 활동을 시작한 18명 사용자가 트리거"

서버 로그 분석으로 incident 시점 access user 식별 시도. 컨테이너 재시작으로 logs 휘발돼서 일부만 식별. 활성 사용자 평소 패턴과 대조:
- 후보 18명의 활동 이력 14일 점검
- **이들은 모두 평소부터 매일 활발하게 활동하던 일상 사용자였음**

"18명이 오늘 신규로 추가됐다"는 가설 무너짐. 시간 사용: ~15분.

### 결국: 트리거를 짚을 수 없다는 결론

가설 세 개 모두 폐기. 남은 그림:

- 슬로우 쿼리는 X개월 전부터 존재 (잠복)
- 데이터는 한 달 전부터 매일 누적 (테이블 50× 성장)
- 매일 피크 시간에 풀이 거의 차다가 빠지는 패턴이 점차 빡빡해지는 중
- 어느 날 결국 임계점 통과
- 그날과 어제의 차이는 **동시 호출 1~2명 더, RDS CPU 1~2% 더** 수준의 환경 노이즈
- **이건 짚어낼 수 없다.** 시계열 메트릭이 있어도 노이즈 안에 가려져 있음

![Latent threshold diagram](/assets/images/posts/079-latent-slow-query/latent-threshold-diagram.svg){: width="700"}

## 결과

- 근본 원인 fix (인덱스 정리와 compound index 적용) 로 incident 마무리
- "왜 오늘" 질문에 대한 답: **"특별한 이유 없음, 누적 임계점 통과"**
- 가설 추적에 1시간 사용 — 사실 빠르게 폐기했어야

## 배운 점

### latent incident 와 trigger-driven incident 의 구분

incident 는 크게 두 종류:

1. **Trigger-driven**: 특정 배포 / 설정 변경 / 외부 이벤트가 직접 원인. 트리거를 짚으면 답 나옴
2. **Latent**: 잠복 결함이 누적 효과로 어느 날 임계점 통과. 트리거를 짚을 수 없는 경우가 많음

처음 incident 마주하면 어느 쪽인지 모른다. 하지만 **데이터 누적이 있고 / 코드 변경이 무관 확인되면 latent 가능성이 높아진다.** 이 시점부터는 트리거 가설 추적을 멈추고 근본 원인 fix 로 전환한다.

![Hypothesis discard timeline](/assets/images/posts/079-latent-slow-query/hypothesis-discard-timeline.svg){: width="700"}

### 가설은 "맞으면 좋고 안 맞으면 빠르게 폐기"

세 가지 가설 모두 추적했다. 1번은 15분, 2번은 25분, 3번은 15분. 합 55분. 폐기 자체는 옳지만 **각각 더 빨리 폐기할 수 있었다.**

체크리스트:
- 가설 진위를 판단할 **결정적 데이터** 가 무엇인지 먼저 명시
- 그 데이터가 신뢰 가능한지 (예: log retention 한계) 즉시 검증
- 30 분 안에 결정적 데이터를 못 얻으면 가설 폐기

### 근본 원인 fix 가 답, 트리거 짚기가 답이 아니다

latent incident 에서는 트리거 모름을 인정하는 게 정직하다. **다음 incident 방지는 근본 원인 fix 로** (인덱스 추가, 정기 데이터 정리) 하는 것이지, 트리거를 짚는 게 아니다.

운영자 / stakeholder 에게 "왜 오늘?" 질문 받았을 때 가설 둘러대지 않고 **"누적 임계점 통과 — 특정 트리거 짚을 수 없음. 근본 원인 fix 로 해결, 재발 0건 검증"** 으로 답하는 게 옳다.

### 환경 노이즈의 존재 인정

prod 시스템은 매일 미세하게 다르다 — RDS CPU 변동, 동시 사용자 변동, 외부 호출 응답 시간 변동, etc. 임계점을 넘는 incident 에서는 그 노이즈가 **결정적 변수**가 된다. **노이즈 안에서 결정 인자를 추출할 수는 없다.** 인정하고 넘어간다.

## 다음 글

incident 를 닫은 뒤에는 "같은 종류의 잠복 결함이 더 있는가"를 봐야 한다. [다음 글](/posts/080/)은 audit 에서 발견한 124개 후보를 왜 19개 DROP 으로만 좁혔는지, cleanup decision tree 를 정리한다.

## References

- Postmortem 작성 가이드 (Google SRE Book): [Postmortem Culture: Learning from Failure](https://sre.google/sre-book/postmortem-culture/)
- 잠복 결함의 누적 효과: 데이터 성장 그래프 + 쿼리 latency 시계열을 같이 보기
- 메트릭 모니터링 (Prometheus / Grafana 류) 으로 임계점 *접근* 자체를 미리 잡기 — incident 발생 전에 알림
