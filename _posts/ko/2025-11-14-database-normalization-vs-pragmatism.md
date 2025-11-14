---
layout: post
title: "DB 설계 논쟁: 정규화 vs 실용주의 - 실제 의사결정 과정"
date: 2025-11-14 14:30:00 +0900
categories: [Backend, Database]
tags: [database, normalization, pragmatism, yagni, tradeoffs, architecture, mysql]
lang: ko
---

## 📋 서론

주간 고정 일정 입력 기능을 개선하면서 "어떻게 DB를 설계할 것인가"를 놓고 3시간 동안 고민했습니다. Claude Code, Gemini, 그리고 저 사이에서 벌어진 실제 논쟁 과정을 있는 그대로 기록합니다.

**핵심 질문**: "데이터 중복을 허용하는 것이 언제 합리적인가?"

---

## 🎯 출발점: 문제 상황

### 기존 시스템의 불편함

사용자가 "수학학원 - 월수금 14:00-16:00" 일정을 입력하려면:
1. 모달 열기 → 월요일 14:00-16:00 입력 → 저장
2. 모달 열기 → 수요일 14:00-16:00 입력 → 저장
3. 모달 열기 → 금요일 14:00-16:00 입력 → 저장

**불편 포인트**: 같은 내용을 3번 반복 입력!

### 개선 목표

하나의 모달에서 여러 시간대를 한 번에 입력할 수 있게 하자.

```
모달:
제목: 수학학원

[시간대 1]
시간: 14:00 - 16:00
요일: ☑월 ☐화 ☑수 ☐목 ☑금 ☐토 ☐일

[시간대 2]
시간: 18:00 - 20:00
요일: ☐월 ☑화 ☐수 ☑목 ☐금 ☐토 ☐일

[+ 시간대 추가]
[저장]
```

**실제 사용 예시**:
- "수학학원 - 월수금 오후, 화목 저녁" 같은 복잡한 패턴을 한 번에 입력
- 같은 제목이지만 시간대가 다른 경우

---

## 💬 1라운드: 직관적인 첫 아이디어

**나**: "제목은 하나인데 시간대가 여러 개니까... 테이블을 2개로 분리하고, 요일은 배열로 저장하면 되지 않을까?"

```sql
-- 테이블 1: 일정 기본 정보
weekly_schedules (
  id, user_id, title, schedule_type
)

-- 테이블 2: 시간대 (요일 배열로 저장)
weekly_schedule_times (
  id, schedule_id, start_time, end_time,
  days_of_week VARCHAR(50)  -- "1,3,5" (월수금)
)
```

**실제 데이터 예시**:
```sql
-- "수학학원 - 월수금 오후, 화목 저녁"
INSERT INTO weekly_schedules VALUES (1, 100, '수학학원', 'EXTERNAL');
INSERT INTO weekly_schedule_times VALUES
  (1, 1, '14:00', '16:00', '1,3,5'),  -- 월수금 오후
  (2, 1, '18:00', '20:00', '2,4');    -- 화목 저녁

-- "영어회화 - 화목 16:00-18:00"
INSERT INTO weekly_schedules VALUES (2, 100, '영어회화', 'EXTERNAL');
INSERT INTO weekly_schedule_times VALUES (3, 2, '16:00', '18:00', '2,4');
```

**Claude Code**: "요일을 배열로 저장하면 '수요일에 무슨 일정이 있지?'를 조회할 때 어떻게 할 건가요?"

```sql
-- ❌ 문제 1: LIKE 쿼리는 인덱스를 못 쓴다
SELECT * FROM weekly_schedule_times
WHERE days_of_week LIKE '%3%';  -- Full Table Scan!

-- ❌ 문제 2: '13일'이 '3'에 매칭되는 버그
'1,13,5' LIKE '%3%'  -- TRUE! (잘못된 결과)

-- ❌ 문제 3: 정렬이나 범위 검색 불가능
-- "월요일부터 금요일까지 일정"을 어떻게 찾을까?
WHERE days_of_week >= '1' AND days_of_week <= '5'  -- 불가능!
```

**나**: "아... 맞네. 게다가 우리 시스템은 **1분마다 '지금 진행 중인 일정'을 조회**해야 해."


```typescript
// checkus-teacher-web/src/features/students/hooks/useWeeklySchedules.ts
const { data: schedules } = useQuery({
  queryKey: ['weeklySchedules', userId],
  queryFn: () => api.getWeeklySchedules(userId),
  refetchInterval: 60000,  // ← 1분마다 리패치!
});

// 서버에서 "현재 시각에 진행 중인 일정" 필터링
const currentSchedule = schedules.filter(s => {
  const now = new Date();
  const currentDay = now.getDay();  // 0=일요일, 1=월요일, ...
  const currentTime = now.toTimeString().slice(0, 5);

  return s.dayOfWeek === currentDay &&
         s.startTime <= currentTime &&
         s.endTime > currentTime;
});
```

**성능 분석**:
- 학생 100명, 평균 일정 5개 = 500 rows
- `LIKE '%3%'` 쿼리는 500개 전체 스캔 필요
- 1분마다 실행 = 하루 1,440번 × 500 = 720,000 row scans
- 인덱스 사용 시: 평균 70 rows만 확인 (10배 차이!)

**Claude Code**: "배열 저장 방식은 조회 성능이 치명적입니다. 특히 실시간 모니터링에서는요."

---

## 💬 2라운드: Claude의 groupId 아이디어

**Claude Code**: "기존 테이블 구조를 유지하면서 `group_id` 컬럼 하나만 추가하는 건 어때요?"

```sql
-- 기존 테이블 (변경 전)
weekly_schedule (
  id, user_id, title, schedule_type, campus_id,
  day_of_week, start_time, end_time
)

-- 새 테이블 (변경 후)
weekly_schedule (
  id, user_id,
  group_id VARCHAR(50),  -- ← 이거 하나만 추가!
  title, schedule_type, campus_id,
  day_of_week, start_time, end_time
)

CREATE INDEX idx_group_id ON weekly_schedule(group_id);
CREATE INDEX idx_day_of_week ON weekly_schedule(day_of_week);
```

**데이터 예시 비교**:
```sql
-- ❌ 1라운드 방식 (배열 저장)
INSERT INTO weekly_schedule_times VALUES
  (1, 1, '14:00', '16:00', '1,3,5');  -- 1 row

-- ✅ 2라운드 방식 (groupId)
INSERT INTO weekly_schedule VALUES
  (1, 100, 'G1', '수학학원', 'EXTERNAL', NULL, 1, '14:00', '16:00'),  -- 월
  (2, 100, 'G1', '수학학원', 'EXTERNAL', NULL, 3, '14:00', '16:00'),  -- 수
  (3, 100, 'G1', '수학학원', 'EXTERNAL', NULL, 5, '14:00', '16:00');  -- 금
-- 3 rows, 하지만...
```

**성능 비교**:
```sql
-- "지금(수요일 14:30) 진행 중인 일정 조회"

-- ❌ 1라운드 방식 (배열)
SELECT * FROM weekly_schedule_times
WHERE days_of_week LIKE '%3%'  -- Full Scan 500 rows
  AND start_time <= '14:30'
  AND end_time > '14:30';
-- 실행 시간: ~15ms (인덱스 미사용)

-- ✅ 2라운드 방식 (groupId)
SELECT * FROM weekly_schedule
WHERE day_of_week = 3          -- Index Scan 70 rows
  AND start_time <= '14:30'
  AND end_time > '14:30';
-- 실행 시간: ~1ms (인덱스 사용)
```

**마이그레이션 난이도**:
```sql
-- ALTER TABLE 한 줄이면 끝!
ALTER TABLE weekly_schedule
ADD COLUMN group_id VARCHAR(50) AFTER user_id;

-- UUID 생성 함수로 기존 데이터 변환
UPDATE weekly_schedule
SET group_id = UUID()
WHERE group_id IS NULL;
```

**기존 코드 재사용**:
```java
// ✅ Repository 메서드는 그대로 사용 가능!
List<WeeklySchedule> findByUserIdAndDayOfWeek(Long userId, Integer dayOfWeek);

// ✅ 새 메서드만 추가
List<WeeklySchedule> findByGroupId(String groupId);
void deleteByGroupId(String groupId);
```

**단점**:
```sql
-- 데이터 중복 발생
-- "수학학원" 문자열이 3번 반복 저장됨
(1, 100, 'G1', '수학학원', ..., 1, '14:00', '16:00'),
(2, 100, 'G1', '수학학원', ..., 3, '14:00', '16:00'),  -- 중복!
(3, 100, 'G1', '수학학원', ..., 5, '14:00', '16:00'),  -- 중복!

-- 정합성 위험
-- "한 row만 수정"하면 불일치 발생 가능
UPDATE weekly_schedule
SET title = '수학학원(신촌점)'
WHERE id = 1;  -- ← G1 그룹 중 하나만 수정됨! (버그)
```

**나**: "오, 간단하네! 근데 데이터 중복이랑 정합성 문제가 찝찝한데..."

---

## 💬 3라운드: Gemini의 반박 - "정규화가 답이다"

이 시점에서 Gemini에게 물어봤습니다.

**나**: "groupId 방식 괜찮아 보이는데, 혹시 더 나은 방법 있을까?"

**Gemini**: "데이터베이스 이론에 따르면 **3-테이블 정규화**가 정석입니다. groupId 방식은 중복 데이터로 인한 무결성 문제가 있어요."

```sql
-- Gemini가 제안한 3NF(Third Normal Form) 구조

-- 테이블 1: 일정 기본 정보 (1 row)
weekly_schedules (
  id, user_id, title, schedule_type, campus_id
)

-- 테이블 2: 시간대 (일정당 1 row)
weekly_schedule_times (
  id, schedule_id (FK), start_time, end_time
)

-- 테이블 3: 요일별 인스턴스 (시간대당 N rows)
weekly_schedule_days (
  id, time_id (FK), day_of_week
)
```

**데이터 예시 비교**:
```sql
-- ✅ Gemini 방식 (정규화): "수학학원 - 월수금 14:00-16:00"
-- 테이블 1: weekly_schedules
INSERT INTO weekly_schedules VALUES (1, 100, '수학학원', 'EXTERNAL', NULL);

-- 테이블 2: weekly_schedule_times
INSERT INTO weekly_schedule_times VALUES (1, 1, '14:00', '16:00');

-- 테이블 3: weekly_schedule_days
INSERT INTO weekly_schedule_days VALUES
  (1, 1, 1),  -- 월요일
  (2, 1, 3),  -- 수요일
  (3, 1, 5);  -- 금요일

-- ❌ groupId 방식: 동일한 데이터
INSERT INTO weekly_schedule VALUES
  (1, 100, 'G1', '수학학원', 'EXTERNAL', NULL, 1, '14:00', '16:00'),
  (2, 100, 'G1', '수학학원', 'EXTERNAL', NULL, 3, '14:00', '16:00'),
  (3, 100, 'G1', '수학학원', 'EXTERNAL', NULL, 5, '14:00', '16:00');
-- ↑ title, schedule_type, start_time, end_time 모두 중복!
```

**Gemini의 주장**:

1. **데이터 중복 제거**:
```sql
-- groupId: "수학학원" 3번 저장 (24 bytes × 3 = 72 bytes)
-- 정규화: "수학학원" 1번 저장 (24 bytes)
-- 절약: 48 bytes per schedule
```

2. **수정 안전성**:
```sql
-- groupId: 3개 row를 동시에 수정해야 함 (실수 위험)
UPDATE weekly_schedule
SET title = '수학학원(신촌점)'
WHERE group_id = 'G1';  -- 3 rows 동시 수정

-- 정규화: 1개 row만 수정 (원자성 보장)
UPDATE weekly_schedules
SET title = '수학학원(신촌점)'
WHERE id = 1;  -- 1 row만 수정
```

3. **FK 제약조건으로 데이터 정합성 보장**:
```sql
-- 정규화: 부모 삭제 시 자식도 자동 삭제
ALTER TABLE weekly_schedule_times
ADD CONSTRAINT fk_schedule
FOREIGN KEY (schedule_id) REFERENCES weekly_schedules(id)
ON DELETE CASCADE;

-- groupId: 그룹 삭제 시 수동으로 모든 row 삭제 필요
DELETE FROM weekly_schedule WHERE group_id = 'G1';
```

**나**: "음... 이론적으로는 맞는 것 같은데?"

**Gemini**: "JOIN 연산 비용? 그렇게 크지 않아요. 현대 DB는 충분히 최적화되어 있습니다."

```sql
-- Gemini 주장: JOIN도 인덱스 사용하면 빠르다
SELECT
  s.title,
  t.start_time,
  t.end_time,
  d.day_of_week
FROM weekly_schedules s
JOIN weekly_schedule_times t ON s.id = t.schedule_id
JOIN weekly_schedule_days d ON t.id = d.time_id
WHERE d.day_of_week = 3
  AND t.start_time <= '14:30'
  AND t.end_time > '14:30';

-- FK 인덱스 + day_of_week 인덱스 사용
-- 실행 계획: Index Nested Loop Join (최적화됨)
```

**Gemini**: "1분마다 실행해도 3-5ms 정도면 충분히 감당 가능합니다. 정합성이 더 중요하지 않나요?"

**나**: "음... 확실히 정규화가 '올바른' 방법 같긴 한데... 실제로 해보면 어떨까?"

**결정**: "일단 Gemini 방식대로 3-테이블 정규화로 구현해보자!"

---

## 💬 4라운드: 구현하다 만난 현실의 벽

3-테이블 구조로 구현을 시작했습니다. 그런데...

### 문제 1: Entity 설계 복잡도

**기존 방식 (단일 테이블)**:
```java
// WeeklySchedule.java - 끝!
@Entity
public class WeeklySchedule {
    @Id @GeneratedValue
    private Long id;
    private Long userId;
    private String title;
    private String scheduleType;
    private Long campusId;
    private Integer dayOfWeek;
    private LocalTime startTime;
    private LocalTime endTime;
}
```

**3-테이블 방식 (정규화)**:
```java
// 1. WeeklySchedule.java
@Entity
public class WeeklySchedule {
    @Id @GeneratedValue
    private Long id;
    private Long userId;
    private String title;
    private String scheduleType;
    private Long campusId;

    @OneToMany(mappedBy = "schedule", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<WeeklyScheduleTime> times = new ArrayList<>();

    public void addTime(WeeklyScheduleTime time) {
        times.add(time);
        time.setSchedule(this);
    }
}

// 2. WeeklyScheduleTime.java
@Entity
public class WeeklyScheduleTime {
    @Id @GeneratedValue
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "schedule_id")
    private WeeklySchedule schedule;

    private LocalTime startTime;
    private LocalTime endTime;

    @OneToMany(mappedBy = "timeSlot", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<WeeklyScheduleDay> days = new ArrayList<>();
}

// 3. WeeklyScheduleDay.java
@Entity
public class WeeklyScheduleDay {
    @Id @GeneratedValue
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "time_id")
    private WeeklyScheduleTime timeSlot;

    private Integer dayOfWeek;
}
```

**나**: "Entity 파일 3개, 양방향 연관관계, LazyLoading 이슈... 벌써 머리 아픈데?"

### 문제 2: 다른 서비스에서의 파급 효과

충격적 발견: `WeeklySchedule`을 사용하는 곳이 `WeeklyScheduleService`만이 아니었다!

#### 1. StudyTimeService (공부시간 모니터링)

```java
// BEFORE (단순)
public List<StudyTime> getCurrentStudyTimes(Long userId) {
    LocalTime now = LocalTime.now();
    int today = LocalDate.now().getDayOfWeek().getValue();

    List<WeeklySchedule> schedules = weeklyScheduleRepository
        .findByUserIdAndDayOfWeek(userId, today);

    return schedules.stream()
        .filter(s -> s.getStartTime().isBefore(now) && s.getEndTime().isAfter(now))
        .map(this::convertToStudyTime)
        .collect(Collectors.toList());
}

// AFTER (복잡)
public List<StudyTime> getCurrentStudyTimes(Long userId) {
    LocalTime now = LocalTime.now();
    int today = LocalDate.now().getDayOfWeek().getValue();

    List<WeeklySchedule> schedules = weeklyScheduleRepository
        .findByUserIdWithTimesAndDays(userId);  // ← JOIN FETCH 2번

    return schedules.stream()
        .flatMap(s -> s.getTimes().stream())  // ← 중첩 스트림
        .filter(t -> t.getDays().stream()
            .anyMatch(d -> d.getDayOfWeek() == today))  // ← 또 스트림
        .filter(t -> t.getStartTime().isBefore(now) && t.getEndTime().isAfter(now))
        .map(this::convertToStudyTime)
        .collect(Collectors.toList());
}
```

#### 2. NotificationService (일정 알림 발송)

```java
// BEFORE (단순)
@Scheduled(cron = "0 */30 * * * *")  // 30분마다
public void sendUpcomingScheduleNotifications() {
    LocalTime now = LocalTime.now();
    LocalTime soon = now.plusMinutes(30);
    int today = LocalDate.now().getDayOfWeek().getValue();

    // "30분 후 시작하는 일정" 찾기
    List<WeeklySchedule> upcomingSchedules = weeklyScheduleRepository
        .findByDayOfWeekAndStartTimeBetween(today, now, soon);

    upcomingSchedules.forEach(schedule ->
        sendNotification(schedule.getUserId(),
            schedule.getTitle() + " 30분 후 시작"));
}

// AFTER (복잡)
@Scheduled(cron = "0 */30 * * * *")
public void sendUpcomingScheduleNotifications() {
    LocalTime now = LocalTime.now();
    LocalTime soon = now.plusMinutes(30);
    int today = LocalDate.now().getDayOfWeek().getValue();

    // 모든 스케줄 조회 후 필터링 (쿼리 최적화 불가능!)
    List<WeeklySchedule> allSchedules = weeklyScheduleRepository
        .findAllWithTimesAndDays();  // ← 전체 조회!

    List<UpcomingSchedule> upcomingSchedules = allSchedules.stream()
        .flatMap(s -> s.getTimes().stream()
            .filter(t -> t.getStartTime().isAfter(now) && t.getStartTime().isBefore(soon))
            .flatMap(t -> t.getDays().stream()
                .filter(d -> d.getDayOfWeek() == today)
                .map(d -> new UpcomingSchedule(s.getUserId(), s.getTitle(), t.getStartTime()))))
        .collect(Collectors.toList());

    upcomingSchedules.forEach(schedule ->
        sendNotification(schedule.getUserId(),
            schedule.getTitle() + " 30분 후 시작"));
}
```

### 문제 3: 수정 필요한 파일 목록 (실제)

**Backend (checkus-server) - 총 27개 파일!**

**Core (13개)**:
1. WeeklySchedule.java
2. WeeklyScheduleTime.java (새로 작성)
3. WeeklyScheduleDay.java (새로 작성)
4. WeeklyScheduleRepository.java
5. WeeklyScheduleTimeRepository.java (새로 작성)
6. WeeklyScheduleDayRepository.java (새로 작성)
7. WeeklyScheduleService.java
8. WeeklyScheduleController.java
9-13. DTO 5개 (Request/Response 구조 변경)

**영향받는 다른 서비스들 (14개)**:
14. StudyTimeService.java
15. DashboardService.java
16. NotificationService.java
17. AttendanceService.java
18. ReportService.java
19. StatisticsService.java
20. CalendarService.java
21. ReminderService.java
22. ScheduleConflictChecker.java
23-27. 각종 Repository, Validator, EventListener...

**Frontend (checkus-teacher-web) - 총 12개 파일**:
28. types.ts - API 타입 변경
29. api.ts - API 호출 변경
30. WeeklyScheduleDialog.tsx - 폼 구조 변경
31. useWeeklySchedules.ts - React Query 로직 변경
32-39. 각종 컴포넌트 렌더링 로직 변경

**총 39개 파일 수정 필요!**

### 문제 4: 마이그레이션 스크립트 복잡도

**groupId 방식**:
```sql
-- 1줄이면 끝!
ALTER TABLE weekly_schedule ADD COLUMN group_id VARCHAR(50);
CREATE INDEX idx_group_id ON weekly_schedule(group_id);
```

**3-테이블 방식**:
```sql
-- Step 1: 새 테이블 3개 생성
CREATE TABLE weekly_schedules (...);
CREATE TABLE weekly_schedule_times (...);
CREATE TABLE weekly_schedule_days (...);

-- Step 2: 기존 데이터 이관 (복잡!)
INSERT INTO weekly_schedules (user_id, title, schedule_type, campus_id)
SELECT DISTINCT user_id, title, schedule_type, campus_id FROM weekly_schedule;
-- ... (더 복잡한 이관 로직)

-- Step 3: 기존 테이블 삭제
DROP TABLE weekly_schedule;
```

### 문제 5: 실제 작업 시간 추정

| 작업 항목 | groupId | 3-테이블 |
|----------|---------|----------|
| Entity 수정 | 10분 | 2시간 |
| Core Repository/Service | 30분 | 2시간 |
| 다른 서비스 수정 | 0분 | 4시간 |
| Controller & DTO | 30분 | 1.5시간 |
| Frontend | 30분 | 2시간 |
| 마이그레이션 | 10분 | 2시간 |
| 테스트 (전체) | 30분 | 3시간 |
| **총 작업 시간** | **2.5시간** | **16.5시간** |

**Claude Code**: "더 심각한 건, 이미 만든 기능들을 모두 건드려야 한다는 겁니다. StudyTimeService, NotificationService... 이거 하나하나 다 테스트하고 검증해야 해요."

**나**: "그리고 혹시라도 버그가 생기면? 출석 체크가 안 되거나, 알림이 안 가거나... 사용자에게 직접 영향 가는 기능들인데..."

**Claude Code**: "리팩토링 리스크가 너무 큽니다. 이건 '설계 개선'이 아니라 '시스템 전체 재작성' 수준이에요."

**나**: "이거... 너무 크다. 뭔가 잘못된 것 같은데?"

---

## 💬 5라운드: 다시 생각해보기

**나**: "생각해보니, 한 일정의 반복 시간대가 그렇게 많지 않을 것 같은데?"

### 현실적 데이터 분석

**주간일정의 특성**:
- 일주일이 7일인데, 하나의 일정이 7개보다 많은 시간대를 가질 일은 보통 없음
- 실제 평균 = 3-4개 (월수금, 화목 같은 패턴)
- **비정상적인 경우라도 10개를 넘을 일은 잘 없음**

### 데이터 중복 계산

```
학생 100명 × 일정 5개 = 500개 일정
평균 4개 row/일정 = 2,000 rows

중복 데이터:
- title: 20 bytes × 2,000 = 40 KB
- schedule_type: 8 bytes × 2,000 = 16 KB
- campus_id: 8 bytes × 2,000 = 16 KB

총 중복: ~72 KB
```

**나**: "72 KB... 이거 무시 가능한 수준 아닌가? 오늘날 RAM이 기가바이트 단위인데."

---

## 💬 6라운드: 성능 실측

**나**: "Gemini가 JOIN 비용이 크지 않다고 했는데, 실제로 측정해보자."

### 쿼리 성능 비교 (MySQL 8.0, 2,000 rows 기준)

```sql
-- groupId 방식: "수요일에 뭐 있지?"
EXPLAIN SELECT * FROM weekly_schedule WHERE day_of_week = 3;
-- type: ref (인덱스 사용)
-- rows: 285
-- 실행 시간: 1ms

-- 3-테이블 방식: 동일한 쿼리
EXPLAIN SELECT s.* FROM weekly_schedules s
JOIN weekly_schedule_times t ON s.id = t.schedule_id
JOIN weekly_schedule_days d ON t.id = d.time_id
WHERE d.day_of_week = 3;
-- type: ref → ref → ref (인덱스 사용하지만 JOIN 3번)
-- rows: 285 → 570 → 285 (중간 테이블 스캔)
-- 실행 시간: 3-5ms
```

**나**: "3-5배 차이네... **1분마다** 실행되는 쿼리인데, 이게 유의미한 차이 아닌가?"

**Claude Code**: "맞습니다. 1분에 1번 × 24시간 × 365일 = 연간 525,600번 실행됩니다. 누적 차이는 약 35분 vs 2시간입니다."

---

## 💬 7라운드: 트랜잭션으로 무결성 보장 가능한가?

**Gemini**: "groupId 방식의 가장 큰 문제는 데이터 불일치입니다. 예를 들어 제목을 '수학학원' → '심화수학'으로 변경할 때 일부만 업데이트되면?"

**나**: "`@Transactional`로 묶으면 되지 않아?"

```java
@Transactional
public void updateScheduleGroup(String groupId, WeeklyScheduleUpdateRequest req) {
    // 그룹 전체를 원자적으로 수정
    List<WeeklySchedule> schedules = repository.findByGroupId(groupId);

    // 검증: 그룹 내 모든 row가 동일한 title/type을 가지는지
    validateGroupIntegrity(schedules);

    // 전체 수정 (한 번에)
    schedules.forEach(s -> {
        s.setTitle(req.getTitle());
        s.setScheduleType(req.getScheduleType());
    });

    repository.saveAll(schedules);
}
```

```java
@Transactional
public void updateGroupTitle(String groupId, String newTitle) {
    // Repository에서 JPA Query 사용
    scheduleRepository.updateTitleByGroupId(groupId, newTitle);
    // 전부 성공 or 전부 실패 (원자성 보장)
}
```

**Gemini**: "설계 자체로 무결성을 보장하는 게 낫지 않을까요? 트랜잭션을 '항상 기억해야 한다'는 것 자체가 위험 요소입니다."

**나**: "그렇긴 한데... 우리 시스템에서 데이터 중복이 실제로 얼마나 될까? 앞서 말했 듯 한 일정에 대해 보통은 2~3개, 많아야 7개야."

**Gemini**: "한 건의 불일치도 치명적입니다."

**나**: "데이터 중복이 '개수'는 적지만, 불일치 '가능성'이 문제라는 거네?"

### 불일치 시나리오 vs 트랜잭션 해결

**Gemini가 우려한 시나리오**:
```
1. "수학학원" (월수금) 저장 → groupId=100, 3 rows
2. 제목 변경: "심화수학"
3. 네트워크 오류 → 월/수만 변경, 금 누락
4. DB 불일치: "심화수학" 2개 + "수학학원" 1개
```

**나의 반박**:
```java
@Transactional  // ← 이걸로 해결되는데?
public void updateGroupTitle(String groupId, String newTitle) {
    scheduleRepository.updateTitleByGroupId(groupId, newTitle);
    // 전부 성공 or 전부 실패
}
```

**Gemini**: "트랜잭션으로 막을 수 없는 실수도 있습니다."

```java
// 개발자 실수: 같은 groupId에 다른 title 입력
repository.save(new WeeklySchedule()
    .setGroupId("100")
    .setTitle("수학특강"));  // ← 기존 "심화수학"과 다름!
// 트랜잭션과 무관하게 데이터 깨짐
```

**Claude Code**: "그건 Service 검증 로직 5줄이면 막을 수 있어요."

```java
public void createSchedule(WeeklyScheduleRequest req) {
    if (req.getGroupId() != null) {
        List<WeeklySchedule> existing = repo.findByGroupId(req.getGroupId());
        if (!existing.isEmpty() && !existing.get(0).getTitle().equals(req.getTitle())) {
            throw new BusinessException("같은 그룹은 같은 제목이어야 합니다");
        }
    }
    repository.save(req.toEntity());
}
```

### 본질적 차이

**Gemini의 주장**:
> "정규화 = 설계로 무결성 보장. groupId = 개발자 주의력에 의존."

**나의 반론**:
> "하지만 우리는 이미 Service Layer에서 수많은 비즈니스 룰을 검증하고 있다.
> 'groupId 그룹 일관성'도 그 중 하나일 뿐 아닐까?"

**예시**:
```java
// 이미 하고 있는 검증들
validateStartTimeBeforeEndTime();
validateCampusExists();
validateNoOverlappingSchedules();
validateGroupConsistency();  // ← 이것만 추가
```

---

## 💬 8라운드: 시간대별 메타데이터가 필요한가?

**Gemini**: "정규화의 또 다른 장점은 확장성입니다. 예를 들어 시간대별로 '담당 선생님'을 다르게 지정하려면?"

**나**: "잠깐, 우리 시스템에서 그런 요구사항이 있나?"

### 실제 요구사항 분석

**현재 필요한 정보**:
- ✅ 제목 (일정 전체 공통)
- ✅ 일정 유형 (일정 전체 공통)
- ✅ 캠퍼스 (일정 전체 공통)
- ✅ 요일 (각기 다름 - 당연함)
- ✅ 시작/종료 시간 (시간대별로 다름)

**시간대별로 달라야 하는 정보**:
- ❌ 담당 선생님? (없음)
- ❌ 특별 메모? (없음)
- ❌ 캠퍼스? (같음)

**나**: "시간대별 메타데이터가 **현재** 없고, **미래에도** 필요 없을 것 같은데?"

**Claude Code**: "YAGNI 원칙입니다. 'You Aren't Gonna Need It' - 필요하지 않은 복잡도를 미리 추가하지 마세요."

---

## 💬 9라운드: 최종 의사결정

**나**: "정리해보자."

### 비교표

| 항목 | 3-테이블 정규화 | groupId 방식 |
|------|----------------|-------------|
| **개발 시간** | 6-8시간 | 1-2시간 |
| **데이터 중복** | 0 KB | 72 KB |
| **조회 성능** | 3-5ms (JOIN 2번) | 1ms (단일 테이블) |
| **코드 복잡도** | Entity 3개 + 복잡한 관계 | Entity 1개 + 간단 |
| **마이그레이션** | 복잡 (테이블 3개 분산) | 간단 (컬럼 1개 추가) |
| **무결성 보장** | FK 제약조건 | @Transactional + validation |
| **시간대별 메타데이터** | 확장 용이 | 현재 불필요 |

### 트레이드오프 분석

**3-테이블을 선택하면**:
- ✅ 이론적으로 완벽한 설계
- ✅ 시간대별 메타데이터 추가 용이 (미래 대비)
- ❌ 6시간 개발 비용
- ❌ 3-5배 느린 조회
- ❌ 복잡한 코드 유지보수

**groupId를 선택하면**:
- ✅ 1-2시간 개발 비용 (70% 절감)
- ✅ 3-5배 빠른 조회
- ✅ 간단한 코드
- ❌ 72 KB 데이터 중복
- ❌ 시간대별 메타데이터 추가 시 리팩토링 필요

**나**: "72 KB 중복 vs 6시간 개발 비용... 이건 답이 명확한데?"

---

## 💬 10라운드: Claude vs Gemini 최종 토론

**Gemini**: "하지만 나중에 확장이 필요하면 어떻게 하려고?"

**Claude Code**: "그때 가서 리팩토링하면 됩니다. 데이터 규모도 작고, 마이그레이션도 충분히 가능합니다."

```sql
-- 미래에 필요하다면 이렇게 마이그레이션
CREATE TABLE weekly_schedule_times (
  id, group_id, start_time, end_time,
  teacher_id  -- 새로운 메타데이터
);

-- 기존 데이터 이관
INSERT INTO weekly_schedule_times (group_id, start_time, end_time, ...)
SELECT DISTINCT group_id, start_time, end_time, ...
FROM weekly_schedule
GROUP BY group_id, start_time, end_time;

-- weekly_schedule에 FK 추가
ALTER TABLE weekly_schedule ADD COLUMN time_id BIGINT;
```

---

## ✅ 최종 결정: groupId 방식 선택

### 결정 이유

#### 1. 문제 규모와 해결책의 균형

**3-테이블이 필요한 조건** (우리 프로젝트):
- ✅ 시간대별 메타데이터 필요? → ❌ 없음
- ✅ 일정당 평균 20개 이상 시간대? → ❌ 3-5개 (최대 7개)
- ✅ 수백만 rows 대규모? → ❌ 수천 rows
- ✅ 시간대가 독립적 라이프사이클? → ❌ 항상 함께 조회

**결론**: 조건 0개 충족 → 과잉 설계

#### 2. 성능이 중요한 쿼리

```
1분마다 실행: "지금 무슨 일정이 있지?"
→ 연간 525,600번 실행
→ 1ms vs 3-5ms 차이 = 연간 35분 vs 2시간
```

#### 3. 개발 효율성

```
6시간 개발 비용 vs 72 KB 중복
→ 개발자 시급 $50 가정
→ $300 vs 무시 가능한 저장공간
```

#### 4. YAGNI 원칙

> "미래를 위한 과도한 설계보다, 현재 문제를 간단히 해결하라"

- 시간대별 메타데이터가 **실제로 필요해질 때** 리팩토링해도 늦지 않음
- 그때는 데이터 규모, 사용 패턴이 더 명확해짐

#### 5. 트랜잭션 + Validation = 충분한 안전성

```java
@Transactional  // 원자성
+ validateGroupConsistency()  // 검증 (5줄)
= 데이터 무결성 보장
```

---

## 📊 구현 결과

### 최종 구조

```sql
-- 마이그레이션 (1줄!)
ALTER TABLE weekly_schedule ADD COLUMN group_id VARCHAR(50);
CREATE INDEX idx_ws_group_id ON weekly_schedule(group_id);

-- 데이터 예시
INSERT INTO weekly_schedule (user_id, group_id, title, day_of_week, start_time, end_time, ...)
VALUES
  (100, 'uuid-1', '수학학원', 1, '14:00', '16:00', ...),  -- 월
  (100, 'uuid-1', '수학학원', 3, '14:00', '16:00', ...),  -- 수
  (100, 'uuid-1', '수학학원', 5, '14:00', '16:00', ...);  -- 금
```

### 작업 시간

- **예상**: 1-2시간
- **실제**:
  - Entity 수정: 10분
  - Repository 메서드 추가: 20분
  - Service 로직: 30분
  - Controller + DTO: 30분
  - **총 1시간 30분**

### 성능 측정 (실제)

```sql
-- "수요일에 뭐 있지?" (1분마다 실행)
SELECT * FROM weekly_schedule WHERE day_of_week = 3;
-- 실행 시간: 0.8ms

-- 그룹 조회
SELECT * FROM weekly_schedule WHERE group_id = 'uuid-1';
-- 실행 시간: 0.6ms
```

---

## 🎓 교훈: 언제 정규화하고, 언제 실용주의를 택할 것인가

### 정규화를 선택해야 하는 경우

1. **대규모 데이터**
   - 수백만 rows 이상
   - 데이터 중복이 기가바이트 단위

2. **복잡한 관계**
   - 자식 엔티티에 독립적인 메타데이터 **실제로 있음**
   - 자식 엔티티 간 다른 라이프사이클

3. **빈번한 부모 정보 업데이트**
   - 부모 정보가 자주 변경됨
   - UPDATE 비용 절감이 중요함

### 실용주의를 선택해야 하는 경우

1. **작은 규모**
   - 수천~수만 rows
   - 데이터 중복이 메가바이트 이하

2. **간단한 관계**
   - 자식 데이터가 부모와 항상 함께 조회됨
   - 독립적인 메타데이터 **현재 없음**

3. **성능 민감**
   - 빈번한 조회 (1분마다 등)
   - JOIN 비용을 피해야 함

4. **개발 속도**
   - 작은 팀, 짧은 일정
   - 빠른 프로토타이핑 필요

### 핵심 원칙

> **"문제의 규모에 맞는 해결책을 선택하라"**

- 교과서적 정답 ≠ 현실적 정답
- 72 KB 중복을 위해 6시간 투자는 **비효율적**
- YAGNI: 필요하지 않은 복잡도를 미리 추가하지 말라

---

## 📝 결론

### 우리가 배운 것

1. **이론과 현실의 균형**
   - Gemini: "정규화가 이론적으로 완벽합니다"
   - Claude: "현재 문제 규모에는 과잉입니다"
   - **최종**: 현실적 제약을 고려한 실용주의 선택

2. **측정의 중요성**
   - "JOIN 비용은 무시 가능" → 실측: 3-5배 차이
   - "데이터 중복이 문제" → 실측: 72 KB (무시 가능)
   - **교훈**: 추측하지 말고 측정하라

3. **트레이드오프 사고**
   - 완벽한 설계는 없다
   - 모든 선택은 트레이드오프
   - **중요한 것**: 무엇을 얻고 무엇을 포기하는지 명확히 알기

### 마지막 한 마디

> **"완벽한 설계보다 적절한 설계가 낫다"**

논쟁 끝에, 우리는 다음을 배웠습니다:
- 정규화는 강력한 도구이지만, **만능은 아니다**
- 프로젝트 규모, 팀 역량, 일정을 고려한 **실용적 선택**이 진짜 엔지니어링이다
- AI도 틀릴 수 있다. **측정하고 검증하라**

---

## 🔗 관련 자료

- Feature 문서: [F066-weekly-schedule-multi-timeslot-refactoring](../features/F066-weekly-schedule-multi-timeslot-refactoring/README.md)
- 마이그레이션 파일: `V20251114200000__add_group_id_to_weekly_schedule.sql`
- YAGNI 원칙: https://martinfowler.com/bliki/Yagni.html
- Database Normalization: https://en.wikipedia.org/wiki/Database_normalization

---

**작성일**: 2025-11-14
**카테고리**: Database Design, Architecture, Decision Making
**태그**: #database #normalization #pragmatism #yagni #tradeoffs #claude-vs-gemini
