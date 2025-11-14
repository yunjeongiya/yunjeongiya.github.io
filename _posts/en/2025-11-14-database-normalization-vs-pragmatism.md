---
layout: post
title: "Database Design Debate: Normalization vs Pragmatism - A Real Decision Process"
date: 2025-11-14 20:00:00 +0900
categories: [Backend, Database]
tags: [database, normalization, pragmatism, yagni, tradeoffs, architecture, mysql]
lang: en
---

# Database Design Debate: Normalization vs Pragmatism - A Real Decision Process

## 📋 Introduction

While improving the weekly recurring schedule input feature, I spent hours pondering "how should we design the database?" This is an unfiltered record of the actual debate process between Claude Code, Gemini, and myself.

**Core Question**: "When is it reasonable to allow data duplication?"

---

## 🎯 Starting Point: The Problem

### Current System's Inconvenience

To enter a "Math Academy - Mon/Wed/Fri 14:00-16:00" schedule, users must:
1. Open modal → Enter Monday 14:00-16:00 → Save
2. Open modal → Enter Wednesday 14:00-16:00 → Save
3. Open modal → Enter Friday 14:00-16:00 → Save

**Pain Point**: Repeating the same input 3 times!

### Improvement Goal

Allow users to input multiple time slots at once in a single modal.

```
Modal:
Title: Math Academy

[Time Slot 1]
Time: 14:00 - 16:00
Days: ☑Mon ☐Tue ☑Wed ☐Thu ☑Fri ☐Sat ☐Sun

[Time Slot 2]
Time: 18:00 - 20:00
Days: ☐Mon ☑Tue ☐Wed ☑Thu ☐Fri ☐Sat ☐Sun

[+ Add Time Slot]
[Save]
```

**Real Use Case**:
- Input complex patterns like "Math Academy - Mon/Wed/Fri afternoon, Tue/Thu evening" at once
- Same title but different time slots

---

## 💬 Round 1: The Intuitive First Idea

**Me**: "Since we have one title but multiple time slots... what if we split into 2 tables and store days as an array?"

```sql
-- Table 1: Schedule basic info
weekly_schedules (
  id, user_id, title, schedule_type
)

-- Table 2: Time slots (days stored as array)
weekly_schedule_times (
  id, schedule_id, start_time, end_time,
  days_of_week VARCHAR(50)  -- "1,3,5" (Mon/Wed/Fri)
)
```

**Actual Data Example**:
```sql
-- "Math Academy - Mon/Wed/Fri afternoon, Tue/Thu evening"
INSERT INTO weekly_schedules VALUES (1, 100, 'Math Academy', 'EXTERNAL');
INSERT INTO weekly_schedule_times VALUES
  (1, 1, '14:00', '16:00', '1,3,5'),  -- Mon/Wed/Fri afternoon
  (2, 1, '18:00', '20:00', '2,4');    -- Tue/Thu evening

-- "English Conversation - Tue/Thu 16:00-18:00"
INSERT INTO weekly_schedules VALUES (2, 100, 'English', 'EXTERNAL');
INSERT INTO weekly_schedule_times VALUES (3, 2, '16:00', '18:00', '2,4');
```

**Claude Code**: "If you store days as an array, how will you query 'what schedule is on Wednesday?'"

```sql
-- ❌ Problem 1: LIKE queries can't use indexes
SELECT * FROM weekly_schedule_times
WHERE days_of_week LIKE '%3%';  -- Full Table Scan!

-- ❌ Problem 2: '13' matches '3' bug
'1,13,5' LIKE '%3%'  -- TRUE! (wrong result)

-- ❌ Problem 3: Can't do range or sorting
-- How to find "schedules from Monday to Friday"?
WHERE days_of_week >= '1' AND days_of_week <= '5'  -- Impossible!
```

**Me**: "Ah... right. And our system needs to **query 'currently running schedules' every minute**."


```typescript
// checkus-teacher-web/src/features/students/hooks/useWeeklySchedules.ts
const { data: schedules } = useQuery({
  queryKey: ['weeklySchedules', userId],
  queryFn: () => api.getWeeklySchedules(userId),
  refetchInterval: 60000,  // ← Refetch every minute!
});

// Server filters "currently running schedules"
const currentSchedule = schedules.filter(s => {
  const now = new Date();
  const currentDay = now.getDay();  // 0=Sunday, 1=Monday, ...
  const currentTime = now.toTimeString().slice(0, 5);

  return s.dayOfWeek === currentDay &&
         s.startTime <= currentTime &&
         s.endTime > currentTime;
});
```

**Performance Analysis**:
- 100 students, 5 schedules each = 500 rows
- `LIKE '%3%'` query needs full scan of 500 rows
- Every minute = 1,440 times/day × 500 = 720,000 row scans
- With index: only 70 rows average (10x difference!)

**Claude Code**: "Array storage is fatal for query performance. Especially for real-time monitoring."

---

## 💬 Round 2: Claude's groupId Idea

**Claude Code**: "How about adding just one `group_id` column while keeping the existing table structure?"

```sql
-- Existing table (before)
weekly_schedule (
  id, user_id, title, schedule_type, campus_id,
  day_of_week, start_time, end_time
)

-- New table (after)
weekly_schedule (
  id, user_id,
  group_id VARCHAR(50),  -- ← Just add this!
  title, schedule_type, campus_id,
  day_of_week, start_time, end_time
)

CREATE INDEX idx_group_id ON weekly_schedule(group_id);
CREATE INDEX idx_day_of_week ON weekly_schedule(day_of_week);
```

**Data Example Comparison**:
```sql
-- ❌ Round 1 approach (array storage)
INSERT INTO weekly_schedule_times VALUES
  (1, 1, '14:00', '16:00', '1,3,5');  -- 1 row

-- ✅ Round 2 approach (groupId)
INSERT INTO weekly_schedule VALUES
  (1, 100, 'G1', 'Math Academy', 'EXTERNAL', NULL, 1, '14:00', '16:00'),  -- Mon
  (2, 100, 'G1', 'Math Academy', 'EXTERNAL', NULL, 3, '14:00', '16:00'),  -- Wed
  (3, 100, 'G1', 'Math Academy', 'EXTERNAL', NULL, 5, '14:00', '16:00');  -- Fri
-- 3 rows, but...
```

**Performance Comparison**:
```sql
-- "Find currently running schedules (Wednesday 14:30)"

-- ❌ Round 1 approach (array)
SELECT * FROM weekly_schedule_times
WHERE days_of_week LIKE '%3%'  -- Full Scan 500 rows
  AND start_time <= '14:30'
  AND end_time > '14:30';
-- Execution time: ~15ms (no index)

-- ✅ Round 2 approach (groupId)
SELECT * FROM weekly_schedule
WHERE day_of_week = 3          -- Index Scan 70 rows
  AND start_time <= '14:30'
  AND end_time > '14:30';
-- Execution time: ~1ms (with index)
```

**Migration Difficulty**:
```sql
-- Just one ALTER TABLE line!
ALTER TABLE weekly_schedule
ADD COLUMN group_id VARCHAR(50) AFTER user_id;

-- Convert existing data with UUID function
UPDATE weekly_schedule
SET group_id = UUID()
WHERE group_id IS NULL;
```

**Code Reusability**:
```java
// ✅ Repository methods remain usable as-is!
List<WeeklySchedule> findByUserIdAndDayOfWeek(Long userId, Integer dayOfWeek);

// ✅ Just add new methods
List<WeeklySchedule> findByGroupId(String groupId);
void deleteByGroupId(String groupId);
```

**Downsides**:
```sql
-- Data duplication occurs
-- "Math Academy" string stored 3 times
(1, 100, 'G1', 'Math Academy', ..., 1, '14:00', '16:00'),
(2, 100, 'G1', 'Math Academy', ..., 3, '14:00', '16:00'),  -- Duplicate!
(3, 100, 'G1', 'Math Academy', ..., 5, '14:00', '16:00'),  -- Duplicate!

-- Data integrity risk
-- "Update just one row" causes inconsistency
UPDATE weekly_schedule
SET title = 'Math Academy (Sinchon)'
WHERE id = 1;  -- ← Only one row in G1 group updated! (Bug)
```

**Me**: "Oh, simple! But data duplication and integrity issues feel concerning..."

---

## 💬 Round 3: Gemini's Counter - "Normalization is the Answer"

At this point, I asked Gemini.

**Me**: "The groupId approach looks fine, but is there a better way?"

**Gemini**: "According to database theory, **3-table normalization** is the standard. The groupId approach has integrity issues due to data duplication."

```sql
-- Gemini's proposed 3NF (Third Normal Form) structure

-- Table 1: Schedule basic info (1 row)
weekly_schedules (
  id, user_id, title, schedule_type, campus_id
)

-- Table 2: Time slots (1 row per schedule)
weekly_schedule_times (
  id, schedule_id (FK), start_time, end_time
)

-- Table 3: Day instances (N rows per time slot)
weekly_schedule_days (
  id, time_id (FK), day_of_week
)
```

**Data Example Comparison**:
```sql
-- ✅ Gemini approach (normalized): "Math Academy - Mon/Wed/Fri 14:00-16:00"
-- Table 1: weekly_schedules
INSERT INTO weekly_schedules VALUES (1, 100, 'Math Academy', 'EXTERNAL', NULL);

-- Table 2: weekly_schedule_times
INSERT INTO weekly_schedule_times VALUES (1, 1, '14:00', '16:00');

-- Table 3: weekly_schedule_days
INSERT INTO weekly_schedule_days VALUES
  (1, 1, 1),  -- Monday
  (2, 1, 3),  -- Wednesday
  (3, 1, 5);  -- Friday

-- ❌ groupId approach: same data
INSERT INTO weekly_schedule VALUES
  (1, 100, 'G1', 'Math Academy', 'EXTERNAL', NULL, 1, '14:00', '16:00'),
  (2, 100, 'G1', 'Math Academy', 'EXTERNAL', NULL, 3, '14:00', '16:00'),
  (3, 100, 'G1', 'Math Academy', 'EXTERNAL', NULL, 5, '14:00', '16:00');
-- ↑ title, schedule_type, start_time, end_time all duplicated!
```

**Gemini's Arguments**:

1. **Eliminate Data Duplication**:
```sql
-- groupId: "Math Academy" stored 3 times (24 bytes × 3 = 72 bytes)
-- Normalization: "Math Academy" stored once (24 bytes)
-- Saved: 48 bytes per schedule
```

2. **Update Safety**:
```sql
-- groupId: Must update 3 rows simultaneously (error-prone)
UPDATE weekly_schedule
SET title = 'Math Academy (Sinchon)'
WHERE group_id = 'G1';  -- Updates 3 rows

-- Normalization: Update only 1 row (atomicity guaranteed)
UPDATE weekly_schedules
SET title = 'Math Academy (Sinchon)'
WHERE id = 1;  -- Updates 1 row only
```

3. **Data Integrity via FK Constraints**:
```sql
-- Normalization: Auto-delete children when parent deleted
ALTER TABLE weekly_schedule_times
ADD CONSTRAINT fk_schedule
FOREIGN KEY (schedule_id) REFERENCES weekly_schedules(id)
ON DELETE CASCADE;

-- groupId: Must manually delete all rows in group
DELETE FROM weekly_schedule WHERE group_id = 'G1';
```

**Me**: "Hmm... theoretically correct, I guess?"

**Gemini**: "JOIN operation cost? Not that significant. Modern DBs are well optimized."

```sql
-- Gemini's claim: JOINs are fast with indexes
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

-- FK indexes + day_of_week index used
-- Execution plan: Index Nested Loop Join (optimized)
```

**Gemini**: "Even running every minute, 3-5ms is totally manageable. Isn't integrity more important?"

**Me**: "Well... normalization does seem like the 'correct' approach... but what if we actually try it?"

**Decision**: "Let's implement with Gemini's 3-table normalization approach!"

---

## 💬 Round 4: Reality Check During Implementation

Started implementing the 3-table structure. But then...

### Problem 1: Entity Design Complexity

**Existing Approach (Single Table)**:
```java
// WeeklySchedule.java - Done!
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

**3-Table Approach (Normalization)**:
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

**Me**: "3 Entity files, bidirectional relationships, LazyLoading issues... my head hurts already?"

### Problem 2: Ripple Effect on Other Services

Shocking discovery: `WeeklySchedule` isn't only used in `WeeklyScheduleService`!

#### 1. StudyTimeService (Study Time Monitoring)

```java
// BEFORE (simple)
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

// AFTER (complex)
public List<StudyTime> getCurrentStudyTimes(Long userId) {
    LocalTime now = LocalTime.now();
    int today = LocalDate.now().getDayOfWeek().getValue();

    List<WeeklySchedule> schedules = weeklyScheduleRepository
        .findByUserIdWithTimesAndDays(userId);  // ← JOIN FETCH x2

    return schedules.stream()
        .flatMap(s -> s.getTimes().stream())  // ← Nested stream
        .filter(t -> t.getDays().stream()
            .anyMatch(d -> d.getDayOfWeek() == today))  // ← Another stream
        .filter(t -> t.getStartTime().isBefore(now) && t.getEndTime().isAfter(now))
        .map(this::convertToStudyTime)
        .collect(Collectors.toList());
}
```

#### 2. NotificationService (Schedule Notifications)

```java
// BEFORE (simple)
@Scheduled(cron = "0 */30 * * * *")  // Every 30 minutes
public void sendUpcomingScheduleNotifications() {
    LocalTime now = LocalTime.now();
    LocalTime soon = now.plusMinutes(30);
    int today = LocalDate.now().getDayOfWeek().getValue();

    // Find "schedules starting in 30 minutes"
    List<WeeklySchedule> upcomingSchedules = weeklyScheduleRepository
        .findByDayOfWeekAndStartTimeBetween(today, now, soon);

    upcomingSchedules.forEach(schedule ->
        sendNotification(schedule.getUserId(),
            schedule.getTitle() + " starting in 30 minutes"));
}

// AFTER (complex)
@Scheduled(cron = "0 */30 * * * *")
public void sendUpcomingScheduleNotifications() {
    LocalTime now = LocalTime.now();
    LocalTime soon = now.plusMinutes(30);
    int today = LocalDate.now().getDayOfWeek().getValue();

    // Fetch all schedules then filter (can't optimize query!)
    List<WeeklySchedule> allSchedules = weeklyScheduleRepository
        .findAllWithTimesAndDays();  // ← Full table scan!

    List<UpcomingSchedule> upcomingSchedules = allSchedules.stream()
        .flatMap(s -> s.getTimes().stream()
            .filter(t -> t.getStartTime().isAfter(now) && t.getStartTime().isBefore(soon))
            .flatMap(t -> t.getDays().stream()
                .filter(d -> d.getDayOfWeek() == today)
                .map(d -> new UpcomingSchedule(s.getUserId(), s.getTitle(), t.getStartTime()))))
        .collect(Collectors.toList());

    upcomingSchedules.forEach(schedule ->
        sendNotification(schedule.getUserId(),
            schedule.getTitle() + " starting in 30 minutes"));
}
```

### Problem 3: Files That Need Modification (Actual Count)

**Backend (checkus-server) - Total 27 files!**

**Core (13 files)**:
1. WeeklySchedule.java
2. WeeklyScheduleTime.java (new)
3. WeeklyScheduleDay.java (new)
4. WeeklyScheduleRepository.java
5. WeeklyScheduleTimeRepository.java (new)
6. WeeklyScheduleDayRepository.java (new)
7. WeeklyScheduleService.java
8. WeeklyScheduleController.java
9-13. 5 DTOs (Request/Response structure changes)

**Affected Other Services (14 files)**:
14. StudyTimeService.java
15. DashboardService.java
16. NotificationService.java
17. AttendanceService.java
18. ReportService.java
19. StatisticsService.java
20. CalendarService.java
21. ReminderService.java
22. ScheduleConflictChecker.java
23-27. Various Repositories, Validators, EventListeners...

**Frontend (checkus-teacher-web) - Total 12 files**:
28. types.ts - API type changes
29. api.ts - API call changes
30. WeeklyScheduleDialog.tsx - Form structure changes
31. useWeeklySchedules.ts - React Query logic changes
32-39. Various component rendering logic changes

**Total 39 files need modification!**

### Problem 4: Migration Script Complexity

**groupId Approach**:
```sql
-- One line and done!
ALTER TABLE weekly_schedule ADD COLUMN group_id VARCHAR(50);
CREATE INDEX idx_group_id ON weekly_schedule(group_id);
```

**3-Table Approach**:
```sql
-- Step 1: Create 3 new tables
CREATE TABLE weekly_schedules (...);
CREATE TABLE weekly_schedule_times (...);
CREATE TABLE weekly_schedule_days (...);

-- Step 2: Migrate existing data (complex!)
INSERT INTO weekly_schedules (user_id, title, schedule_type, campus_id)
SELECT DISTINCT user_id, title, schedule_type, campus_id FROM weekly_schedule;
-- ... (more complex migration logic)

-- Step 3: Drop old table
DROP TABLE weekly_schedule;
```

### Problem 5: Actual Work Time Estimate

| Task | groupId | 3-Table |
|------|---------|---------|
| Entity Modifications | 10 min | 2 hours |
| Core Repository/Service | 30 min | 2 hours |
| Other Service Modifications | 0 min | 4 hours |
| Controller & DTO | 30 min | 1.5 hours |
| Frontend | 30 min | 2 hours |
| Migration | 10 min | 2 hours |
| Testing (full) | 30 min | 3 hours |
| **Total Work Time** | **2.5 hours** | **16.5 hours** |

**Claude Code**: "What's worse is, we have to touch all the features other team members already built. StudyTimeService, NotificationService... we need to test and verify each one."

**Me**: "And if any bug occurs? Attendance check fails, notifications don't send... these directly affect users..."

**Claude Code**: "The refactoring risk is too high. This isn't 'design improvement' - it's 'full system rewrite' level."

**Me**: "This is... too big. Something feels wrong?"

---

## 💬 Round 5: Rethinking

**Me**: "Come to think of it, won't one schedule have that many repeating time slots?"

### Realistic Data Analysis

**Weekly Schedule Characteristics**:
- A week has 7 days, so one schedule won't normally have more than 7 time slots
- Actual average = 3-4 (patterns like Mon/Wed/Fri, Tue/Thu)
- **Even in abnormal cases, unlikely to exceed 10**

### Data Duplication Calculation

```
100 students × 5 schedules = 500 schedules
4 rows/schedule average = 2,000 rows

Duplicate data:
- title: 20 bytes × 2,000 = 40 KB
- schedule_type: 8 bytes × 2,000 = 16 KB
- campus_id: 8 bytes × 2,000 = 16 KB

Total duplication: ~72 KB
```

**Me**: "72 KB... isn't that negligible? RAM is in gigabytes these days."

---

## 💬 Round 6: Actual Performance Measurement

**Me**: "Gemini said JOIN cost isn't significant, but let's actually measure it."

### Query Performance Comparison (MySQL 8.0, 2,000 rows)

```sql
-- groupId approach: "What's on Wednesday?"
EXPLAIN SELECT * FROM weekly_schedule WHERE day_of_week = 3;
-- type: ref (index used)
-- rows: 285
-- Execution time: 1ms

-- 3-table approach: same query
EXPLAIN SELECT s.* FROM weekly_schedules s
JOIN weekly_schedule_times t ON s.id = t.schedule_id
JOIN weekly_schedule_days d ON t.id = d.time_id
WHERE d.day_of_week = 3;
-- type: ref → ref → ref (index used but 3 JOINs)
-- rows: 285 → 570 → 285 (intermediate table scan)
-- Execution time: 3-5ms
```

**Me**: "3-5x difference... This query runs **every minute**, isn't that significant?"

**Claude Code**: "Exactly. 1 time/minute × 24 hours × 365 days = 525,600 times/year. Cumulative difference is about 35 minutes vs 2 hours."

---

## 💬 Round 7: Can Transactions Guarantee Integrity?

**Gemini**: "The biggest problem with groupId is data inconsistency. For example, when changing title from 'Math Academy' → 'Advanced Math', what if only some rows update?"

**Me**: "Wouldn't wrapping with `@Transactional` solve it?"

```java
@Transactional
public void updateScheduleGroup(String groupId, WeeklyScheduleUpdateRequest req) {
    // Update entire group atomically
    List<WeeklySchedule> schedules = repository.findByGroupId(groupId);

    // Validate: all rows in group have same title/type
    validateGroupIntegrity(schedules);

    // Update all at once
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
    // Use JPA Query in Repository
    scheduleRepository.updateTitleByGroupId(groupId, newTitle);
    // All succeed or all fail (atomicity guaranteed)
}
```

**Gemini**: "Wouldn't it be better to guarantee integrity through design itself? Having to 'always remember transactions' is a risk factor."

**Me**: "Well... but how much data duplication do we actually have in our system? As mentioned earlier, usually 2-3 per schedule, max 7."

**Gemini**: "Even one inconsistency is critical."

**Me**: "So it's not about the 'quantity' of duplication, but the 'possibility' of inconsistency?"

### Inconsistency Scenario vs Transaction Solution

**Gemini's Concern Scenario**:
```
1. Save "Math Academy" (Mon/Wed/Fri) → groupId=100, 3 rows
2. Change title: "Advanced Math"
3. Network error → Mon/Wed changed, Fri not updated
4. DB inconsistency: 2 "Advanced Math" + 1 "Math Academy"
```

**My Counter**:
```java
@Transactional  // ← This solves it?
public void updateGroupTitle(String groupId, String newTitle) {
    scheduleRepository.updateTitleByGroupId(groupId, newTitle);
    // All succeed or all fail
}
```

**Gemini**: "There are mistakes that transactions can't prevent."

```java
// Developer mistake: input different title for same groupId
repository.save(new WeeklySchedule()
    .setGroupId("100")
    .setTitle("Math Special"));  // ← Different from existing "Advanced Math"!
// Data breaks regardless of transaction
```

**Claude Code**: "That can be prevented with 5 lines of Service validation logic."

```java
public void createSchedule(WeeklyScheduleRequest req) {
    if (req.getGroupId() != null) {
        List<WeeklySchedule> existing = repo.findByGroupId(req.getGroupId());
        if (!existing.isEmpty() && !existing.get(0).getTitle().equals(req.getTitle())) {
            throw new BusinessException("Same group must have same title");
        }
    }
    repository.save(req.toEntity());
}
```

### Fundamental Difference

**Gemini's Argument**:
> "Normalization = Integrity guaranteed by design. groupId = Depends on developer attention."

**My Counter**:
> "But we're already validating tons of business rules in Service Layer.
> Isn't 'groupId group consistency' just one more of those?"

**Example**:
```java
// Validations we're already doing
validateStartTimeBeforeEndTime();
validateCampusExists();
validateNoOverlappingSchedules();
validateGroupConsistency();  // ← Just adding this one
```

---

## 💬 Round 8: Do We Need Per-Time-Slot Metadata?

**Gemini**: "Another advantage of normalization is extensibility. What if you want to assign different 'teacher in charge' per time slot?"

**Me**: "Wait, do we have such requirements in our system?"

### Actual Requirements Analysis

**Currently Needed Information**:
- ✅ Title (common to entire schedule)
- ✅ Schedule type (common to entire schedule)
- ✅ Campus (common to entire schedule)
- ✅ Days (differs - obviously)
- ✅ Start/end time (differs per time slot)

**Per-Time-Slot Different Information**:
- ❌ Teacher in charge? (None)
- ❌ Special notes? (None)
- ❌ Campus? (Same)

**Me**: "There's **currently** no per-time-slot metadata, and probably won't be **in the future** either?"

**Claude Code**: "YAGNI principle. 'You Aren't Gonna Need It' - Don't add unnecessary complexity upfront."

---

## 💬 Round 9: Final Decision

**Me**: "Let's summarize."

### Comparison Table

| Item | 3-Table Normalization | groupId Approach |
|------|----------------------|------------------|
| **Dev Time** | 6-8 hours | 1-2 hours |
| **Data Duplication** | 0 KB | 72 KB |
| **Query Performance** | 3-5ms (2 JOINs) | 1ms (single table) |
| **Code Complexity** | 3 Entities + complex relations | 1 Entity + simple |
| **Migration** | Complex (3 table distribution) | Simple (add 1 column) |
| **Integrity Guarantee** | FK constraints | @Transactional + validation |
| **Per-Slot Metadata** | Easy to extend | Currently unnecessary |

### Tradeoff Analysis

**If we choose 3-table**:
- ✅ Theoretically perfect design
- ✅ Easy to add per-time-slot metadata (future-proof)
- ❌ 6 hours dev cost
- ❌ 3-5x slower queries
- ❌ Complex code maintenance

**If we choose groupId**:
- ✅ 1-2 hours dev cost (70% savings)
- ✅ 3-5x faster queries
- ✅ Simple code
- ❌ 72 KB data duplication
- ❌ Refactoring needed if adding per-slot metadata later

**Me**: "72 KB duplication vs 6 hours dev cost... the answer is obvious, no?"

---

## 💬 Round 10: Claude vs Gemini Final Debate

**Gemini**: "But what if we need expansion later?"

**Claude Code**: "We can refactor then. Data scale is small, migration is totally feasible."

```sql
-- If needed in future, migrate like this
CREATE TABLE weekly_schedule_times (
  id, group_id, start_time, end_time,
  teacher_id  -- New metadata
);

-- Migrate existing data
INSERT INTO weekly_schedule_times (group_id, start_time, end_time, ...)
SELECT DISTINCT group_id, start_time, end_time, ...
FROM weekly_schedule
GROUP BY group_id, start_time, end_time;

-- Add FK to weekly_schedule
ALTER TABLE weekly_schedule ADD COLUMN time_id BIGINT;
```

**Claude Code**: "Investing 6 hours for a feature we don't even need now is inefficient."

**Gemini**: "Theoretically, normalization is..."

**Me**: "Stop. Let's look at **reality** rather than theory."

---

## ✅ Final Decision: Choose groupId Approach

### Decision Reasons

#### 1. Balance Between Problem Scale and Solution

**Conditions for needing 3-table** (our project):
- ✅ Need per-time-slot metadata? → ❌ None
- ✅ Average 20+ time slots per schedule? → ❌ 3-5 (max 7)
- ✅ Large scale with millions of rows? → ❌ Thousands of rows
- ✅ Time slots have independent lifecycle? → ❌ Always queried together

**Conclusion**: 0 conditions met → Over-engineering

#### 2. Performance-Critical Query

```
Run every minute: "What schedule is running now?"
→ 525,600 times per year
→ 1ms vs 3-5ms difference = 35 min vs 2 hours annually
```

#### 3. Development Efficiency

```
6 hours dev cost vs 72 KB duplication
→ Assuming $50/hour developer rate
→ $300 vs negligible storage space
```

#### 4. YAGNI Principle

> "Solve current problems simply rather than over-designing for the future"

- When per-time-slot metadata **actually becomes needed**, refactoring isn't too late
- By then, data scale and usage patterns will be clearer

#### 5. Transaction + Validation = Sufficient Safety

```java
@Transactional  // Atomicity
+ validateGroupConsistency()  // Validation (5 lines)
= Data integrity guaranteed
```

---

## 📊 Implementation Results

### Final Structure

```sql
-- Migration (just 1 line!)
ALTER TABLE weekly_schedule ADD COLUMN group_id VARCHAR(50);
CREATE INDEX idx_ws_group_id ON weekly_schedule(group_id);

-- Data example
INSERT INTO weekly_schedule (user_id, group_id, title, day_of_week, start_time, end_time, ...)
VALUES
  (100, 'uuid-1', 'Math Academy', 1, '14:00', '16:00', ...),  -- Mon
  (100, 'uuid-1', 'Math Academy', 3, '14:00', '16:00', ...),  -- Wed
  (100, 'uuid-1', 'Math Academy', 5, '14:00', '16:00', ...);  -- Fri
```

### Work Time

- **Estimated**: 1-2 hours
- **Actual**:
  - Entity modification: 10 min
  - Repository methods: 20 min
  - Service logic: 30 min
  - Controller + DTO: 30 min
  - **Total 1 hour 30 min**

### Performance Measurement (Actual)

```sql
-- "What's on Wednesday?" (runs every minute)
SELECT * FROM weekly_schedule WHERE day_of_week = 3;
-- Execution time: 0.8ms

-- Group query
SELECT * FROM weekly_schedule WHERE group_id = 'uuid-1';
-- Execution time: 0.6ms
```

---

## 🎓 Lessons: When to Normalize, When to Choose Pragmatism

### Choose Normalization When

1. **Large-scale Data**
   - Millions of rows or more
   - Data duplication in gigabytes

2. **Complex Relationships**
   - Child entities have independent metadata **actually existing**
   - Child entities have different lifecycles

3. **Frequent Parent Info Updates**
   - Parent information changes often
   - UPDATE cost reduction is critical

### Choose Pragmatism When

1. **Small Scale**
   - Thousands to tens of thousands of rows
   - Data duplication is megabytes or less

2. **Simple Relationships**
   - Child data always queried with parent
   - No independent metadata **currently**

3. **Performance Sensitive**
   - Frequent queries (every minute, etc.)
   - Must avoid JOIN costs

4. **Development Speed**
   - Small team, tight schedule
   - Need rapid prototyping

### Core Principle

> **"Choose a solution that matches the problem scale"**

- Textbook answer ≠ Real-world answer
- Investing 6 hours for 72 KB duplication is **inefficient**
- YAGNI: Don't add unnecessary complexity upfront

---

## 📝 Conclusion

### What We Learned

1. **Balance Between Theory and Reality**
   - Gemini: "Normalization is theoretically perfect"
   - Claude: "It's overkill for our current problem scale"
   - **Final**: Pragmatic choice considering real-world constraints

2. **Importance of Measurement**
   - "JOIN cost is negligible" → Measured: 3-5x difference
   - "Data duplication is a problem" → Measured: 72 KB (negligible)
   - **Lesson**: Measure, don't assume

3. **Tradeoff Thinking**
   - No perfect design exists
   - Every choice is a tradeoff
   - **What matters**: Clearly knowing what you gain and give up

### Final Words

> **"Appropriate design is better than perfect design"**

After the debate, we learned:
- Normalization is a powerful tool, but **not a silver bullet**
- **Practical choices** considering project scale, team capability, and schedule are real engineering
- AI can be wrong too. **Measure and verify**

---

## 🔗 Related Resources

- Feature Documentation: [F066-weekly-schedule-multi-timeslot-refactoring](../features/F066-weekly-schedule-multi-timeslot-refactoring/README.md)
- Migration File: `V20251114200000__add_group_id_to_weekly_schedule.sql`
- YAGNI Principle: https://martinfowler.com/bliki/Yagni.html
- Database Normalization: https://en.wikipedia.org/wiki/Database_normalization

---

**Written**: 2025-11-14
**Category**: Database Design, Architecture, Decision Making
**Tags**: #database #normalization #pragmatism #yagni #tradeoffs #claude-vs-gemini
