---
layout: post
title: "The Server Died and There Was No Kill Switch — Building Incident Response from Scratch as a Solo Dev"
date: 2026-04-22 00:00:00 +0900
categories: [Incident, Infrastructure]
tags: [nginx, circuit-breaker, resilience4j, incident-response, devops, solo-dev]
lang: en
slug: "057-en"
published: false
---

I'm a solo full-stack developer. I've never worked at a tech company, so when production goes down, the first thing I have to figure out is "how do people normally handle this?" This is a record of building incident response from nothing, after the server died three times in one week.

## Day 1: ALTER TABLE Locked the Server

Spring Boot's `ddl-auto: update` is convenient. Add a field to an entity and the server runs ALTER TABLE automatically. No issues in development.

The problem started when a production container restarted.

```
HikariPool-1 — Connection is not available, request timed out after 30000ms
```

`ddl-auto: update` ran ALTER TABLE in production, and MySQL acquired a metadata lock. This lock blocks all SELECT/INSERT on the table. Every connection in HikariCP's pool was stuck waiting for the lock. New requests couldn't get a connection and timed out. The entire server became unresponsive.

**Response**: Switched to `ddl-auto: validate`. The server now refuses to start if the schema doesn't match. ALTER TABLE is run manually before deployment.

| Profile | ddl-auto | Behavior |
|---------|----------|----------|
| prod | `validate` | Schema check only, no DDL |
| dev | `update` | Auto ALTER (dev DB only) |
| local | `create-drop` | H2, recreated every time |

## Day 2: OOM from Loading 50K Entities

The next evening at 8:43 PM, the server died again. This time, login itself was broken.

```
java.lang.OutOfMemoryError: Java heap space
```

`ProgressService.getMyProgress()` was loading 50,643 entities entirely into the JPA persistence context to calculate user progress. A single execution of this query filled the 350MB heap. Multiple concurrent users meant OOM.

**Response**: Changed from full entity loading to ID projection. Also increased heap from 350MB to 700MB.

## The Realization: There Was No Kill Switch

Both incidents shared a common problem. Even after identifying the problematic endpoint, **there was no way to turn it off**. The only option was to fix the code and deploy. A deployment takes at least 10 minutes — build, test, Docker image, blue-green switch. The server stays dead for those 10 minutes.

I looked into how larger companies handle this.

## What the Industry Does

### 1. Reverse Proxy Level Blocking

The most basic approach. Block specific paths at the reverse proxy (nginx, HAProxy, Caddy) and return 503.

```nginx
location = /api/tasks/student {
    return 503 '{"message":"Temporarily unavailable"}';
}
```

The advantage is instant application without code changes. nginx reload is zero-downtime. The downside is it's manual and can only block at the endpoint level.

### 2. API Gateway Circuit Breaker

Built into Tyk, Kong, AWS API Gateway. When the 5xx response rate exceeds a configured threshold, it **automatically** blocks that endpoint and attempts recovery after a cooldown period.

> "If that failure rate exceeds the configured threshold, the circuit breaker will trip and block further requests to that endpoint." — Tyk Docs

### 3. Feature Flag Kill Switch

Services like LaunchDarkly and Unleash let you toggle features off at the code level. The most granular control, but you need to pre-embed flags in the code.

### 4. APM + Auto-Alerting

APM tools like DataDog and New Relic detect CPU spikes and error rate increases, then alert via Slack/PagerDuty. The team knows before users report anything.

I had none of these.

## What I Built

### Phase 1: nginx Kill Switch

Started with the fastest thing to implement.

```
Client → nginx(8080) → [blocked-endpoints.conf] → backend(blue/green)
                         ↓ if blocked
                         503 instant response (never reaches backend)
```

I added a `blocked-endpoints.conf` include to nginx. It's normally empty — zero impact. During an incident, add blocking rules and `nginx -s reload` for instant effect.

```bash
# Block
docker exec nginx sh -c \
  "printf 'location /problem-endpoint { return 503; }' \
   > /etc/nginx/conf.d/blocked-endpoints.conf"
docker exec nginx nginx -s reload

# Unblock
docker exec nginx sh -c \
  "printf '' > /etc/nginx/conf.d/blocked-endpoints.conf"
docker exec nginx nginx -s reload
```

Block and unblock any endpoint within 10 seconds, no deployment needed.

### Phase 2: Application-Level Circuit Breaker

The nginx manual switch only works **if a human notices**. Useless if I'm asleep. So I added Resilience4j as an application-level circuit breaker.

```java
@Around("controllerMethods()")
public Object applyCircuitBreaker(ProceedingJoinPoint joinPoint) {
    String endpointKey = resolveEndpointKey(joinPoint);
    CircuitBreaker cb = circuitBreakerRegistry
        .circuitBreaker(endpointKey, defaultConfig);
    return cb.executeCheckedSupplier(joinPoint::proceed);
}
```

Every Controller method gets a circuit breaker via AOP. When an endpoint's failure rate exceeds the threshold, it's automatically blocked and a Slack notification fires.

```
[CIRCUIT BREAKER] CLOSED → OPEN
Endpoint: GET /content-tree
Failure rate exceeded 50%, circuit opened.
```

After a cooldown, it enters HALF_OPEN state and lets a few requests through to test recovery. If recovered, it closes automatically. If not, back to OPEN.

## What's Still Missing

Two incidents and two defense mechanisms later, there's still a lot missing:

- **Monitoring + Alerting**: I need alerts at CPU 80%, not 200%. Right now I only find out when a user says "it's not working." DataDog and New Relic are expensive, but Spring Boot Actuator + Prometheus + Grafana Cloud (free tier) is enough. CPU, heap memory, response times on a dashboard, with Slack alerts on threshold breaches — all free.
- **Auto-Restart on Failure**: Currently, if the server OOMs, a human has to restart it. Just Docker Compose `healthcheck` + `restart: unless-stopped` would detect unresponsive containers and restart them automatically. Fewer 3 AM wake-ups.
- **Circuit Breaker Granularity**: Currently every endpoint has the same threshold. But a login API failing 50% is far more critical than a stats endpoint failing 50%. Thresholds need to vary by endpoint importance.
- **Load Testing**: If I'd tested with production-scale data in staging, this would have been caught before deployment.
- **Incident Runbooks**: A documented procedure for "CPU at 200% — do this." Right now I investigate from scratch every time.
- **Slow Query Monitoring**: A tool to see DB queries getting slower in real-time.

I'll keep adding these. One per incident.

## Lessons Learned

**You don't build incident response until you've had incidents.** I theoretically knew "circuit breakers are important." But you don't actually build one until your server dies, users can't log in, and you sit helpless for 10 minutes waiting for a deployment.

**Solo doesn't mean you can skip ops.** It's easy to think "I'm the only one, so I can cut corners." But being solo makes it more important. Big companies have 5 people on-call. When I'm asleep, nobody can respond. Automated defenses have to hold the line instead of people.

## References

- [Circuit Breaker Pattern — Microsoft Azure Architecture](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Circuit Breakers — Tyk Documentation](https://tyk.io/docs/planning-for-production/ensure-high-availability/circuit-breakers)
- [Feature Toggles — Martin Fowler](https://martinfowler.com/articles/feature-toggles.html)
- [Resilience4j — CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker)
