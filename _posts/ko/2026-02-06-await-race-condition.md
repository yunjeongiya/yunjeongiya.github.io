---
layout: post
title: "await 한 줄이 만든 프로덕션 장애 — Sentry 알림에서 레이스 컨디션까지"
date: 2026-02-06 11:00:00 +0900
categories: [Development, Debugging]
tags: [race-condition, async-await, mysql, sentry, debugging, spring-boot, react]
lang: ko
slug: "032"
thumbnail: /assets/images/posts/032-await-race-condition/diagram-ko.svg
---

![레이스 컨디션 타이밍 다이어그램](/assets/images/posts/032-await-race-condition/diagram-ko.svg){: width="700"}

오전 11시, Sentry에서 알림이 왔다.

```
NonUniqueResultException: Query did not return a unique result: 2 results were returned
```

84회. 그것도 escalating. 출결 현황 화면이 통째로 먹통이 됐다. 좌석도 조회 API(`GET /attendance/status`)에서 터진 거였다.

단일 결과를 기대하는 쿼리가 2개를 반환했다는 건, DB에 있으면 안 되는 중복 데이터가 있다는 뜻이다. 그런데 이 서비스에는 이미 겹침 검증 로직이 있었다. 모든 생성/수정 경로에서 시간이 겹치는 스케줄이 있으면 예외를 던지도록 구현되어 있었다.

그러면 검증을 통과한 중복 데이터는 어떻게 들어간 걸까?

## 1단계: 범인 찾기

먼저 DB에서 시간이 겹치는 스케줄을 직접 찾아봤다.

```sql
SELECT a.id, b.id, a.user_id, a.day_of_week,
       a.start_time, a.end_time, b.start_time, b.end_time
FROM weekly_schedule a
JOIN weekly_schedule b
  ON a.user_id = b.user_id AND a.campus_id = b.campus_id
  AND a.day_of_week = b.day_of_week AND a.id < b.id
  AND a.start_time < b.end_time AND b.start_time < a.end_time
WHERE a.schedule_type = 'CAMPUS_SEAT'
  AND b.schedule_type = 'CAMPUS_SEAT';
```

딱 1건. 한 학생의 금요일에 두 개의 등원 스케줄이 겹쳐 있었다.

| id | 시간 | 비고 |
|----|------|------|
| 651 | 09:00-22:00 | 히스토리 있음 |
| 656 | 11:00-18:00 | **히스토리 없음** |

## 2단계: 히스토리 추적

id 651은 생성 히스토리가 정상적으로 남아있었다. 문제는 id 656 — 히스토리가 아예 없었다.

변경 이력 테이블을 뒤져보니 단서가 나왔다.

```
482 | CREATE | 생성: 리플랜 [금] 09:00-22:00       | 05:40:08.684 | schedule_id=651
484 | CREATE | 생성: 리플랜 [월,수,금] 11:00-18:00  | 05:40:08.690 | schedule_id=652
```

히스토리 484를 보면 "월,수,금 11:00-18:00"인데 `schedule_id=652`(월요일)만 기록되어 있다. 벌크 생성 API로 월/수/금 3개를 한 번에 만들었지만, 히스토리는 첫 번째 것에만 남겼기 때문이다. id 656(금요일)은 같은 벌크 생성의 세 번째 스케줄이었다.

그리고 타임스탬프를 보면 — 두 히스토리의 차이가 **0.006초**다.

## 3단계: 0.006초의 비밀

사람이 0.006초 간격으로 두 번 클릭하는 건 불가능하다. 코드가 병렬로 요청을 보낸 거다.

프론트엔드 코드를 확인해보니 바로 보였다.

```typescript
// WeeklyScheduleDialog.tsx — 수정 전
for (let i = 0; i < timeSlots.length; i++) {
  onSave(bulkRequest, i === 0 && isEditMode);  // await가 없다
}
```

`async` 함수인 `onSave`를 `await` 없이 호출하고 있었다. `for` 루프 안에서 `await` 없이 비동기 함수를 호출하면, 모든 호출이 거의 동시에 실행된다. 사실상 `Promise.all`과 같은 효과.

이게 서버에서 어떤 일을 만드는지 보자.

```
스레드1 (금 09:00-22:00):
  ① 겹침 검증 → "금요일에 겹치는 거 있나?" → 없음 ✅
  ② INSERT (id=651)
  ③ 커밋

스레드2 (월수금 11:00-18:00):
  ① 겹침 검증 → "금요일에 겹치는 거 있나?" → 없음 ✅  ← 여기가 문제
  ② INSERT (id=652, 655, 656)
  ③ 커밋
```

스레드2가 겹침을 검증하는 시점에, 스레드1은 아직 커밋하지 않은 상태다. MySQL의 기본 격리 수준인 REPEATABLE READ에서는 **다른 트랜잭션의 미커밋 데이터를 볼 수 없다**. 그래서 스레드2의 검증은 "겹치는 스케줄 없음"으로 통과한다.

```
스레드1: [──검증──][──저장──][커밋]
스레드2:    [──검증──][─────저장─────][커밋]
               ↑
         이 시점에 스레드1은 아직 커밋 안 됨
```

검증 로직은 완벽했다. 단일 트랜잭션 내에서는. 문제는 동시 트랜잭션 간의 가시성이었다.

## 재현

이론은 확인했으니, 실제로 재현해봤다.

프로덕션에서 (수정 배포 전) 같은 학생의 스케줄 수정 다이얼로그를 열고 시간대 2개를 설정한 뒤 저장을 눌렀다. 브라우저 Network 탭에는 두 요청이 거의 동시에 나갔고, 둘 다 201 Created로 성공했다.

```
PUT  /weekly-schedule/replace  → 200 (수,금 11:00-18:00)
POST /weekly-schedule/bulk     → 201 (금 09:00-23:00)
```

금요일에 11:00-18:00과 09:00-23:00이 겹치지만, 둘 다 통과했다.

같은 방법으로 완전히 동일한 스케줄도 시도했다. 토요일 09:00-10:00을 2개의 시간대로 입력하고 저장하면:

```
POST /weekly-schedule/bulk  → 201 (id=1249, 토 09:00-10:00)
POST /weekly-schedule/bulk  → 201 (id=1250, 토 09:00-10:00)
```

100% 동일한 스케줄이 2개 생성됐다. 검증이 무력화되는 건 서버 속도와 무관했다 — EC2 t3.small에서도 동일하게 재현됐다.

## 수정

### 근본 원인: 프론트엔드 순차 실행

```typescript
// WeeklyScheduleDialog.tsx — 수정 후
for (let i = 0; i < timeSlots.length; i++) {
  await onSave(bulkRequest, i === 0 && isEditMode);  // await 추가
}
```

`await` 한 줄. 첫 번째 요청이 커밋된 후 두 번째 요청이 실행되니까, 백엔드 겹침 검증이 정상 작동한다.

같은 패턴이 다른 곳에도 있었다. 붙여넣기로 여러 스케줄을 생성하는 코드에서 `Promise.allSettled`를 쓰고 있었다.

```typescript
// 수정 전 — 병렬 실행
const results = await Promise.allSettled(
  schedules.map(s => api.createWeeklySchedule(s))
);

// 수정 후 — 순차 실행
for (const schedule of schedules) {
  await api.createWeeklySchedule(schedule);
}
```

### 2차 방어: 백엔드 방어적 쿼리

프론트엔드 수정으로 근본 원인은 해결되지만, 혹시 모를 상황에 대비해 백엔드도 수정했다.

크래시가 발생한 쿼리의 반환 타입을 `Optional<WeeklySchedule>`에서 `List<WeeklySchedule>`로 변경하고, 중복이 감지되면 Sentry WARNING을 보내도록 했다.

```java
List<WeeklySchedule> schedules = repository
    .findCurrentCampusSeatSchedule(userId, campusId, dayOfWeek, time);

if (schedules.size() > 1) {
    Sentry.captureMessage("CAMPUS_SEAT 스케줄 중복 감지 - userId: " + userId,
                          SentryLevel.WARNING);
}

return schedules.isEmpty() ? null : schedules.get(0);
```

이제 중복 데이터가 있어도 서비스가 크래시되지 않고, 알림을 받아 사후 정리할 수 있다.

### 부수 수정: 벌크 히스토리

원인 추적 과정에서 id 656의 히스토리가 없어서 한참 헤맸다. 벌크 생성 시 첫 번째 스케줄에만 히스토리를 기록하던 코드를 모든 스케줄에 개별 기록하도록 수정했다.

## 교훈

**1. 검증은 단일 트랜잭션 안에서만 유효하다**

겹침 검증 로직이 잘 짜여 있어도, 병렬 트랜잭션에서는 서로의 미커밋 데이터를 볼 수 없다. 검증이 있다고 안심하면 안 된다.

**2. `for` 루프의 `await`는 의도적이어야 한다**

ESLint의 `no-await-in-loop` 규칙은 성능을 위해 `await`를 루프에서 빼라고 권장한다. 하지만 이번 경우처럼 **순서가 보장되어야 하는 작업**에서는 `await`가 필수다. 성능 최적화와 정합성 보장 사이의 트레이드오프를 의식적으로 결정해야 한다.

**3. 히스토리는 빠짐없이 남겨야 한다**

벌크 작업에서 "대표 1건만 기록"하면 나머지는 추적 불가능하다. 이번에 실제로 원인 분석의 장애물이 됐다.

**4. 방어적 쿼리는 보험이다**

단일 결과를 기대하는 쿼리도 `List`로 받아서 방어하면, 예상치 못한 데이터가 들어왔을 때 서비스 중단 대신 알림을 받을 수 있다.

## 참고 자료

- [MySQL InnoDB Transaction Isolation Levels](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [JavaScript async and await in loops — Zell Liew](https://zellwk.com/blog/async-await-in-loops/)
- [RepeatableRead에서 발생할 수 있는 동시성 문제와 락](https://www.blog.ecsimsw.com/entry/%EB%8F%99%EC%8B%9C%EC%84%B1-%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%99%80-%ED%95%B4%EA%B2%B0-%EB%B0%A9%EC%95%88)
- [Race Condition: The Silent Bug That Breaks Production Systems](https://www.steve-bang.com/blog/race-condition-silent-bug-breaks-production)
- [ESLint no-await-in-loop](https://eslint.org/docs/latest/rules/no-await-in-loop)
