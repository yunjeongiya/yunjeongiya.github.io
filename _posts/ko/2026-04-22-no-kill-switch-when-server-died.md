---
layout: post
title: "서버가 죽었는데 끌 수 있는 스위치가 없었다 — 혼자 만드는 장애 대응 체계"
date: 2026-04-22 00:00:00 +0900
categories: [Incident, Infrastructure]
tags: [nginx, circuit-breaker, resilience4j, incident-response, devops, solo-dev]
lang: ko
slug: "057"
published: false
---

혼자 풀스택 개발을 하고 있다. IT 기업에서 일해본 적이 없어서, 프로덕션 장애가 터지면 "원래 이런 상황에서 어떻게 하는 거지?"부터 찾아봐야 한다. 이 글은 일주일 동안 서버가 세 번 죽으면서, 아무 방어 체계 없이 맨땅에서 하나씩 만들어간 기록이다.

## 1일차: ALTER TABLE이 서버를 잠갔다

Spring Boot의 `ddl-auto: update`는 편리하다. 엔티티 필드를 추가하면 서버가 알아서 ALTER TABLE을 실행한다. 개발 환경에서는 문제가 없었다.

프로덕션에서 컨테이너가 재시작됐을 때 문제가 시작됐다.

```
HikariPool-1 — Connection is not available, request timed out after 30000ms
```

`ddl-auto: update`가 프로덕션에서 ALTER TABLE을 실행했고, MySQL이 메타데이터 락을 걸었다. 이 락은 해당 테이블의 모든 SELECT/INSERT를 블로킹한다. HikariCP 커넥션 풀의 모든 커넥션이 락 대기 상태에 빠졌고, 새로운 요청은 커넥션을 받지 못해 타임아웃. 서버 전체가 응답 불가 상태가 됐다.

**대응**: `ddl-auto: validate`로 변경. 스키마 불일치 시 서버가 시작 자체를 거부하도록 했다. ALTER TABLE은 배포 전에 수동으로 실행하는 프로세스를 만들었다.

| Profile | ddl-auto | 동작 |
|---------|----------|------|
| prod | `validate` | 스키마 확인만, DDL 실행 안 함 |
| dev | `update` | 자동 ALTER (dev DB만) |
| local | `create-drop` | H2, 매번 재생성 |

## 2일차: 5만 건 엔티티 로드로 OOM

다음 날 저녁 8시 43분, 서버가 또 죽었다. 이번엔 로그인 자체가 안 됐다.

```
java.lang.OutOfMemoryError: Java heap space
```

`ProgressService.getMyProgress()`가 사용자 진도를 계산하면서 50,643개의 엔티티를 통째로 JPA 영속성 컨텍스트에 올렸다. 350MB 힙에서 이 쿼리가 한 번 실행되면 메모리가 가득 찬다. 여러 사용자가 동시에 접속하면 OOM.

**대응**: 엔티티 전체 로드 → ID 프로젝션으로 변경. 힙도 350MB → 700MB로 증가.

## 깨달은 것: 끌 수 있는 스위치가 없다

두 번의 장애에서 공통된 문제가 보였다. 원인이 되는 엔드포인트를 특정해도, **그걸 끌 방법이 없다**는 것이다. 코드를 고쳐서 배포하는 것 외에는. 배포에는 빌드 + 테스트 + 도커 이미지 + 블루-그린 전환까지 최소 10분이 걸린다. 그 10분 동안 서버는 계속 죽어있다.

대기업에서는 이런 상황을 어떻게 처리하는지 찾아봤다.

## 현업에서는

### 1. 리버스 프록시 레벨 차단

가장 기본적인 방법. nginx, HAProxy, Caddy 같은 리버스 프록시에서 특정 경로를 503으로 반환한다.

```nginx
location = /api/tasks/student {
    return 503 '{"message":"일시적으로 사용할 수 없습니다"}';
}
```

장점은 코드 변경 없이 즉시 반영된다는 것이다. nginx reload는 zero-downtime이다. 단점은 수동이고, 엔드포인트 단위로만 차단할 수 있다.

### 2. API Gateway Circuit Breaker

Tyk, Kong, AWS API Gateway에 내장된 기능. 5xx 응답 비율이 설정한 threshold를 넘으면 **자동으로** 해당 엔드포인트를 차단하고, 일정 시간 후 자동 복구를 시도한다.

> "If that failure rate exceeds the configured threshold, the circuit breaker will trip and block further requests to that endpoint." — Tyk Docs

### 3. Feature Flag Kill Switch

LaunchDarkly, Unleash 같은 서비스로 코드 레벨에서 기능을 끌 수 있다. 가장 세밀한 제어가 가능하지만, 코드에 미리 플래그를 심어둬야 한다.

### 4. APM + 자동 알림

DataDog, New Relic 같은 APM이 CPU 스파이크, 에러율 증가를 감지하면 Slack/PagerDuty로 알린다. 사용자가 신고하기 전에 팀이 인지한다.

내 상황에서는 이 중 어느 것도 없었다.

## 만든 것

### Phase 1: nginx Kill Switch

가장 빠르게 구현할 수 있는 것부터 시작했다.

```
Client → nginx(8080) → [blocked-endpoints.conf] → backend(blue/green)
                         ↓ 차단 대상이면
                         503 즉시 반환 (backend 도달 안함)
```

`blocked-endpoints.conf`라는 파일을 nginx에 include했다. 평소에는 비어있어서 아무 영향이 없다. 장애 시 차단 규칙을 추가하고 `nginx -s reload`하면 즉시 적용된다.

```bash
# 차단
docker exec nginx sh -c \
  "printf 'location /problem-endpoint { return 503; }' \
   > /etc/nginx/conf.d/blocked-endpoints.conf"
docker exec nginx nginx -s reload

# 해제
docker exec nginx sh -c \
  "printf '' > /etc/nginx/conf.d/blocked-endpoints.conf"
docker exec nginx nginx -s reload
```

배포 없이 10초 안에 특정 엔드포인트를 차단하고 해제할 수 있다.

### Phase 2: 앱 레벨 Circuit Breaker

nginx 수동 차단은 **사람이 인지해야** 동작한다. 밤에 자고 있으면 의미가 없다. 그래서 Resilience4j로 앱 레벨 circuit breaker를 추가했다.

```java
@Around("controllerMethods()")
public Object applyCircuitBreaker(ProceedingJoinPoint joinPoint) {
    String endpointKey = resolveEndpointKey(joinPoint);
    CircuitBreaker cb = circuitBreakerRegistry
        .circuitBreaker(endpointKey, defaultConfig);
    return cb.executeCheckedSupplier(joinPoint::proceed);
}
```

모든 Controller 메서드에 AOP로 circuit breaker가 적용된다. 특정 엔드포인트의 실패율이 임계치를 넘으면 자동으로 차단하고, Slack으로 알린다.

```
[CIRCUIT BREAKER] CLOSED → OPEN
Endpoint: GET /task-templates/tree
실패율이 50%를 초과하여 서킷이 열렸습니다.
```

일정 시간 후 HALF_OPEN 상태에서 소수의 요청을 통과시켜 복구 여부를 판단한다. 복구됐으면 자동으로 CLOSED, 아니면 다시 OPEN.

## 아직 없는 것

두 번의 장애를 겪고 두 가지 방어 체계를 만들었지만, 여전히 부족한 것이 많다:

- **모니터링 + 알림**: CPU가 200%가 되기 전에, 80%에서 알림을 받아야 한다. 지금은 사용자가 "안 돼요"라고 연락해야 안다. DataDog이나 New Relic은 비싸지만, Spring Boot Actuator + Prometheus + Grafana Cloud(무료 플랜)면 충분하다. CPU, 힙 메모리, 응답 시간을 대시보드로 보고, 임계치 초과 시 Slack 알림을 보내는 것까지 무료로 가능하다.
- **컨테이너 자동 복구**: 지금은 서버가 OOM으로 죽으면 사람이 재시작해야 한다. Docker Compose의 `healthcheck` + `restart: unless-stopped`만 설정해도, 응답 불능 상태를 감지해서 자동으로 컨테이너를 재시작할 수 있다. 새벽에 자다 깨는 일이 줄어든다.
- **circuit breaker 세분화**: 지금은 모든 엔드포인트에 동일한 임계치를 적용하고 있다. 하지만 로그인 API가 50% 실패하는 것과 통계 조회가 50% 실패하는 것은 심각도가 다르다. 엔드포인트 중요도에 따라 임계치를 다르게 설정해야 한다.
- **부하 테스트**: 11만 건이 되기 전에 staging에서 테스트했다면 사전에 잡았을 것이다.
- **인시던트 런북**: "CPU 200%면 이렇게 해"가 정리된 문서. 지금은 매번 처음부터 추적한다.
- **slow query 모니터링**: DB 쿼리가 느려지는 걸 실시간으로 보는 도구.

하나씩 붙여나갈 계획이다. 사고가 터질 때마다 하나씩.

## 배운 점

**장애 대응 체계는 장애를 겪어야 만들게 된다.** 이론적으로 "circuit breaker가 필요하다"는 건 알고 있었다. 하지만 서버가 죽고, 사용자가 접속 못 하고, 코드 고쳐서 배포할 때까지 10분을 손 놓고 기다려야 하는 경험을 해봐야 비로소 만든다.

**혼자 개발해도 운영 체계는 필요하다.** "나밖에 없으니까 대충 해도 되지"라고 생각하기 쉽다. 하지만 혼자이기 때문에 더 필요하다. 대기업은 5명이 당직을 서지만, 나는 밤에 자면 아무도 대응할 수 없다. 자동화된 방어 체계가 사람 대신 버텨줘야 한다.

## References

- [Circuit Breaker Pattern — Microsoft Azure Architecture](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Circuit Breakers — Tyk Documentation](https://tyk.io/docs/planning-for-production/ensure-high-availability/circuit-breakers)
- [Feature Toggles — Martin Fowler](https://martinfowler.com/articles/feature-toggles.html)
- [Resilience4j — CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker)
