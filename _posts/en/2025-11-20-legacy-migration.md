---
layout: post
title: "Legacy System Multi-Tenancy Migration: Adding campus_id Column Guide"
date: 2025-11-20 10:00:00 +0900
categories: [Architecture, Backend]
tags: [migration, deployment, database, strategy, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: en
slug: "016-en"
---

# Legacy Migration Strategy - CheckUS Architecture Series (5/5)

> **Series Navigation**
> - [Part 1: One Account, Multiple Schools, Multiple Roles](/posts/012-en/)
> - [Part 2: 4-Tier Security to Prevent Data Leaks in Multi-Tenancy](/posts/013-en/)
> - [Part 3: Multi-Campus, Multi-Role JWT Design and ThreadLocal Safety](/posts/014-en/)
> - [Part 4: Comparing 5 Row-Level Security Implementations and Selection Guide](/posts/015-en/)
> - **[Part 5: Legacy System Multi-Tenancy Migration](/posts/016-en/)** ← Current (Series Finale)

---

## Previously

[Part 4](./part4-implementation-comparison.md) compared various Row-Level Security implementation methods. We examined the pros and cons of PostgreSQL Native RLS, Hibernate Filter, API Gateway, and CheckUS 4-Tier.

This article reveals how to apply multi-tenancy to **already running systems**. We share CheckUS's actual migration experience and know-how.

---

## Legacy System Status

### Pre-Migration Architecture

CheckUS's initial version **supported only single campus**.

```sql
-- Original students table
CREATE TABLE students (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100),
    grade INT,
    phone VARCHAR(20),
    created_at TIMESTAMP
);
-- No campus_id column!
```

```java
// Original Service code
@Service
public class StudentService {

    public List<Student> getAllStudents() {
        return studentRepository.findAll();  // Query all students
    }
}
```

**Problems**
- ❌ Multiple campus data mixed together
- ❌ Query all without campus distinction
- ❌ Already have 1,000+ student data records

### Migration Goals

1. **Zero-downtime deployment**: Migrate without service interruption
2. **Data integrity**: No loss of existing data
3. **Gradual transition**: Don't change all APIs at once
4. **Rollback capable**: Recover to previous version if problems occur

---

## Migration Strategy: 5-Phase Approach

### Phase 1: Schema Changes (Database)

**Goal**: Add `campus_id` column to all tables

```sql
-- Step 1: Add column (NOT NULL yet!)
ALTER TABLE students ADD COLUMN campus_id BIGINT;

-- Step 2: Assign default campus ID to existing data
UPDATE students SET campus_id = 1 WHERE campus_id IS NULL;

-- Step 3: Add foreign key constraint
ALTER TABLE students ADD CONSTRAINT fk_students_campus
    FOREIGN KEY (campus_id) REFERENCES campuses(id);

-- Step 4: Add NOT NULL constraint
ALTER TABLE students ALTER COLUMN campus_id SET NOT NULL;

-- Step 5: Add indexes (performance optimization)
CREATE INDEX idx_students_campus_id ON students(campus_id);
CREATE INDEX idx_students_campus_grade ON students(campus_id, grade);
```

**Precautions**
- ⚠️ Adding `NOT NULL` from the start causes **existing data insert failures**
- ⚠️ Add indexes during low-traffic hours (LOCK occurs)

**Rollback Plan**

```sql
-- Phase 1 rollback
ALTER TABLE students DROP CONSTRAINT fk_students_campus;
ALTER TABLE students DROP COLUMN campus_id;
DROP INDEX idx_students_campus_id;
```

---

### Phase 2: Entity Changes (Backend Code)

**Goal**: Add `campusId` field to JPA Entity

```java
// Before
@Entity
@Table(name = "students")
public class Student {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private Integer grade;
}

// After
@Entity
@Table(name = "students")
public class Student {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "campus_id", nullable = false)
    private Long campusId;  // ✅ Added

    private String name;
    private Integer grade;
}
```

**Precautions**
- ⚠️ Existing code doesn't use `campusId` yet (filtering not applied yet)
- ⚠️ Must include `campusId` when inserting new data

**Add Test Code**

```java
@Test
void creating_new_student_requires_campusId() {
    Student student = new Student();
    student.setName("Student A");
    student.setGrade(3);
    student.setCampusId(1L);  // Required!

    studentRepository.save(student);

    assertThat(student.getCampusId()).isEqualTo(1L);
}
```

---

### Phase 3: Introduce ThreadLocal and Interceptor

**Goal**: Set up HTTP Interceptor and ThreadLocal (filtering not applied yet)

```java
// Create CampusContextHolder (already covered in Part 2)
public class CampusContextHolder {
    private static final ThreadLocal<Set<Long>> campusIdsHolder = new ThreadLocal<>();
    // ... (code omitted)
}

// Register HTTP Interceptor
@Component
public class CampusContextInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, ...) {
        String campusIdHeader = request.getHeader("X-Campus-Id");

        if (campusIdHeader != null) {
            Long campusId = Long.parseLong(campusIdHeader);
            CampusContextHolder.setCampusIds(Set.of(campusId));

            // ✅ Only log, don't throw errors (maintain compatibility)
            log.info("Campus context set: campusId={}", campusId);
        } else {
            log.warn("X-Campus-Id header missing");  // Just warning
        }

        return true;  // Continue
    }

    @Override
    public void afterCompletion(...) {
        CampusContextHolder.clear();
    }
}
```

**Phase 3 Core**
- ✅ Set ThreadLocal, but **not required** (pass even without header)
- ✅ Only monitor with logging
- ✅ Existing API calls work normally (maintain backward compatibility)

---

### Phase 4: Gradual API Migration

**Goal**: Apply campus filtering to APIs one by one

#### 4-1. Select Pilot API

```java
// 📌 First API to migrate: Query student list
@GetMapping("/students")
@CampusFiltered  // ✅ Apply AOP
public ResponseEntity<List<StudentDto>> getStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    List<Student> students = studentRepository.findByCampusId(campusId);
    return ResponseEntity.ok(students);
}
```

**Pilot API Selection Criteria**
1. ✅ **Read-only** (no data changes)
2. ✅ **Low traffic** (minimize impact if problems occur)
3. ✅ **Easy rollback** (no DB changes)

#### 4-2. Frontend Changes

```typescript
// Before: Call without header
const students = await api.get('/students');

// After: Axios Interceptor automatically adds header
const students = await api.get('/students');
// X-Campus-Id: 1 automatically added
```

**Gradual Rollout**

```
Week 1: /students (read-only)
Week 2: /schedules (read-only)
Week 3: /tasks (read-only)
Week 4: POST /students (write operations)
Week 5: PUT /students/{id} (updates)
Week 6: DELETE /students/{id} (deletions)
```

#### 4-3. Monitoring

```java
@Aspect
@Component
public class ApiMigrationMonitoringAspect {

    @Around("execution(* com.checkus.controller.*.*(..))")
    public Object monitorApiCalls(ProceedingJoinPoint joinPoint) throws Throwable {
        String apiName = joinPoint.getSignature().toShortString();
        Set<Long> campusIds = CampusContextHolder.getCampusIds();

        if (campusIds == null || campusIds.isEmpty()) {
            // ⚠️ Unmigrated API call
            log.warn("Legacy API call: {} (no campus context)", apiName);
            Sentry.captureMessage("Legacy API: " + apiName);
        } else {
            // ✅ Migrated API
            log.info("Migrated API call: {}, campusIds={}", apiName, campusIds);
        }

        return joinPoint.proceed();
    }
}
```

**Grafana Dashboard**

```
[Migration Progress]
- Total APIs: 50
- Migrated: 35 (70%)
- Remaining: 15 (30%)

[Legacy API Call Frequency]
- /old-api-1: 120 calls/hour
- /old-api-2: 80 calls/hour
```

---

### Phase 5: Switch to Strict Mode

**Goal**: Make `X-Campus-Id` header required after all API migration completes

```java
// Change Interceptor from Phase 3 warning-only to strict mode
@Override
public boolean preHandle(HttpServletRequest request, ...) {
    String campusIdHeader = request.getHeader("X-Campus-Id");

    if (campusIdHeader == null || campusIdHeader.isEmpty()) {
        // ❌ Phase 5: Throw error (strict mode)
        throw new BusinessException("CAMPUS_ID_REQUIRED",
            "X-Campus-Id header is required.");
    }

    Long campusId = Long.parseLong(campusIdHeader);

    // JWT permission validation
    if (!hasAccessToCampus(campusId)) {
        throw new BusinessException("CAMPUS_ACCESS_DENIED");
    }

    CampusContextHolder.setCampusIds(Set.of(campusId));
    return true;
}
```

**Gradual Transition with Feature Flag**

```yaml
# application.yml
campus:
  filtering:
    strict-mode: false  # Phase 3-4: warning only
                        # Phase 5: true (strict mode)
```

```java
@Value("${campus.filtering.strict-mode}")
private boolean strictMode;

@Override
public boolean preHandle(HttpServletRequest request, ...) {
    if (campusIdHeader == null) {
        if (strictMode) {
            throw new BusinessException("CAMPUS_ID_REQUIRED");  // Error
        } else {
            log.warn("X-Campus-Id missing");  // Warning only
        }
    }
    return true;
}
```

---

## Detailed Data Migration Strategy

### 1. Classify Existing Data

```sql
-- Infer which campus data belongs to
-- Example: Infer campus from student's teacher
UPDATE students s
SET campus_id = (
    SELECT t.campus_id
    FROM teachers t
    WHERE t.id = s.teacher_id
)
WHERE s.campus_id IS NULL;

-- Assign default campus for uninferrable data
UPDATE students
SET campus_id = 1  -- Default campus (Gangnam Study Center)
WHERE campus_id IS NULL;
```

### 2. Data Validation

```sql
-- Verify all rows have campus_id
SELECT COUNT(*) FROM students WHERE campus_id IS NULL;
-- Result: 0 (all assigned)

-- Check for foreign key constraint violations
SELECT s.id, s.campus_id
FROM students s
LEFT JOIN campuses c ON s.campus_id = c.id
WHERE c.id IS NULL;
-- Result: Empty (all valid campus_id)
```

### 3. Backup and Rollback Preparation

```bash
# Full DB backup before Phase 1
mysqldump -u root -p checkus > checkus_backup_before_migration.sql

# Backup specific tables only
mysqldump -u root -p checkus students > students_backup.sql

# Restore for rollback
mysql -u root -p checkus < checkus_backup_before_migration.sql
```

---

## Problems and Solutions Discovered During Migration

### Problem 1: Missing Filtering in JOIN Queries

**Situation**

```java
// ❌ students filtered but joined study_times not filtered
@Query("""
    SELECT s FROM Student s
    LEFT JOIN s.studyTimes st
    WHERE s.campusId = :campusId
""")
List<Student> findStudentsWithStudyTimes(@Param("campusId") Long campusId);
```

**Result**: `study_times` data from other campuses mixed in

**Solution**

```java
// ✅ Explicitly filter joined tables too
@Query("""
    SELECT s FROM Student s
    LEFT JOIN s.studyTimes st
    WHERE s.campusId = :campusId
      AND (st.campusId = :campusId OR st.campusId IS NULL)
""")
```

---

### Problem 2: Soft Delete and Campus Filtering Conflict

**Situation**

```sql
-- students table
id | campus_id | name      | deleted_at
---+-----------+-----------+------------
1  | 1         | Student A | NULL
2  | 1         | Student B | 2025-01-01  (deleted)
3  | 2         | Student C | NULL
```

```java
// ❌ Other campus data exposed when querying deleted students
@Query("SELECT s FROM Student s WHERE s.deletedAt IS NOT NULL")
List<Student> findDeletedStudents();
// Result: Both campus 1, 2 returned
```

**Solution**

```java
// ✅ Apply campus filtering to Soft Delete queries too
@CampusFiltered
public List<Student> getDeletedStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusIdAndDeletedAtIsNotNull(campusId);
}
```

---

### Problem 3: ThreadLocal Not Set in Batch Jobs

**Situation**

```java
// ❌ Scheduled Job isn't HTTP request, so no ThreadLocal
@Scheduled(cron = "0 0 2 * * *")  // Daily at 2 AM
public void generateDailyReports() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    // 💥 NullPointerException! (ThreadLocal not set)
}
```

**Solution 1: Iterate All Campuses**

```java
@Scheduled(cron = "0 0 2 * * *")
public void generateDailyReports() {
    List<Campus> campuses = campusRepository.findAll();

    for (Campus campus : campuses) {
        try {
            // Manually set ThreadLocal
            CampusContextHolder.setCampusIds(Set.of(campus.getId()));

            // Generate report
            reportService.generateReport();
        } finally {
            CampusContextHolder.clear();  // Must clean up
        }
    }
}
```

**Solution 2: Batch-Specific Service (No Filtering)**

```java
// No @CampusFiltered (for batch jobs)
public void generateReportForAllCampuses() {
    // Query all campus data
    List<Student> allStudents = studentRepository.findAll();

    // Group by campus
    Map<Long, List<Student>> byCampus = allStudents.stream()
        .collect(Collectors.groupingBy(Student::getCampusId));

    byCampus.forEach((campusId, students) -> {
        // Generate report
    });
}
```

---

### Problem 4: Frontend Cache Invalidation

**Situation**

```typescript
// ❌ React Query cache has no campus distinction
const { data } = useQuery(['students'], fetchStudents);

// User switches campus
setCurrentCampusId(2);  // Gangnam(1) → Bundang(2)

// 💥 Returns previous campus(1) data from cache!
```

**Solution: Include campusId in Cache Key**

```typescript
const { currentCampusId } = useCampusStore();

const { data } = useQuery(
  ['students', currentCampusId],  // ✅ Separate cache per campus
  fetchStudents
);

// Automatically executes new query on campus switch
```

---

## Zero-Downtime Deployment Plan

### Blue-Green Deployment

```
[Before Deployment]
Blue (old version) ← 100% traffic
Green (new version) ← 0% traffic

[Phase 1-3 Deployment]
Blue (old version + campusId column) ← 100%
Green (new version + ThreadLocal) ← 0%

[Phase 4: Gradual Traffic Shift]
Blue ← 80%
Green ← 20% (pilot API only)

Blue ← 50%
Green ← 50%

Blue ← 20%
Green ← 80%

[Phase 5: Complete Transition]
Blue ← 0% (terminated)
Green (new version) ← 100%
```

### Rollback Scenario

```
1. Detect error in Green version
2. Immediately shift 100% traffic to Blue (within 10 seconds)
3. Analyze Green version logs
4. Redeploy after fixing issues
```

---

## Migration Checklist

### Phase 1: Schema Changes

- [ ] Add `campus_id` column to all tables
- [ ] Assign default campusId to existing data
- [ ] Add foreign key constraints
- [ ] Add NOT NULL constraint
- [ ] Add indexes (`campus_id`, `campus_id + other columns`)
- [ ] Complete full DB backup

### Phase 2: Entity Changes

- [ ] Add `campusId` field to JPA Entity
- [ ] Verify `campusId` included when inserting new data
- [ ] Modify existing test code
- [ ] Write new integration tests

### Phase 3: Introduce Interceptor

- [ ] Create CampusContextHolder class
- [ ] Register HTTP Interceptor (warning mode)
- [ ] Add frontend Axios Interceptor
- [ ] Set up logging and monitoring
- [ ] Configure Feature Flag (`strict-mode: false`)

### Phase 4: Gradual Migration

- [ ] Select pilot API (read-only, low traffic)
- [ ] Add @CampusFiltered annotation
- [ ] Write ThreadLocal usage code
- [ ] Frontend changes (auto-add header)
- [ ] Monitor for 1 week before switching to next API
- [ ] Verify all API migration complete

### Phase 5: Switch to Strict Mode

- [ ] Set Feature Flag `strict-mode: true`
- [ ] Make X-Campus-Id header required
- [ ] Verify 0 legacy API calls
- [ ] Monitor for 1 week (verify no errors)
- [ ] Remove Phase 3 temporary code

### Deployment and Monitoring

- [ ] Prepare Blue-Green Deployment
- [ ] Establish rollback plan
- [ ] Activate Sentry error monitoring
- [ ] Create Grafana dashboard (migration progress)
- [ ] Intensive monitoring for 24 hours post-deployment

---

## Migration Timeline (CheckUS Actual Experience)

```
Phase 1 (Schema Changes): 1 week
- Modified 20 DB tables
- Wrote and tested data migration scripts

Phase 2 (Entity Changes): 3 days
- Modified Entity classes
- Updated test code

Phase 3 (Introduce Interceptor): 1 week
- Implemented CampusContextHolder, Interceptor
- Added frontend Axios Interceptor
- Integration testing

Phase 4 (Gradual Migration): 4 weeks
- Weekly API group migration (read → write → delete)
- Weekly monitoring and bug fixes

Phase 5 (Switch to Strict Mode): 1 week
- Feature Flag switch
- Final verification

Total Timeline: About 8 weeks (2 months)
```

---

## Series Conclusion

We've deeply explored CheckUS's multi-tenancy architecture through this 5-part series.

### Summary of Key Content

**Part 1: Multi-Tenancy Concept**
- 3 main patterns (Database-per-Tenant, Schema-per-Tenant, Row-Level Security)
- CheckUS's cross-campus requirements and reasons for choosing Row-Level Security

**Part 2: CheckUS 4-Tier Architecture**
- Frontend Axios Interceptor
- Backend HTTP Interceptor + AOP
- Campus context management using ThreadLocal
- Frontend protection with ESLint rules

**Part 3: Security and Performance Optimization**
- JWT token design (storing multiple campus roles)
- ThreadLocal safety (memory leaks, async operations)
- Integration testing strategies
- Real edge cases (Soft Delete, statistical queries, etc.)

**Part 4: Comparing Implementation Methods**
- PostgreSQL Native RLS
- Hibernate Global Filter
- API Gateway
- 4 real AOP implementation cases
- Pros, cons, and suitable situations for each method

**Part 5: Legacy Migration**
- 5-phase migration strategy
- Zero-downtime deployment plan
- Real problems and solutions encountered
- Detailed checklist

### Key Lessons

1. **No "perfect method"**: Optimal choice differs based on team situation, requirements, and tech stack
2. **Explicit control vs automation**: CheckUS chose explicitness, but complete automation may be better for some teams
3. **Gradual migration**: Don't try to change everything at once, proceed step-by-step with validation
4. **Monitoring is crucial**: Early problem detection with real-time monitoring during migration

### Next Steps

CheckUS is currently operating in **Phase 5 strict mode**, planning these improvements:

- 🚀 **Add Redis caching**: Improve performance while maintaining ThreadLocal
- 📊 **Optimize statistical queries**: Add composite indexes and query tuning
- 🔍 **Strengthen automation**: Consider introducing Hibernate Filter (if Native Query usage decreases)
- 🌐 **Introduce API Gateway**: Prepare for microservices transition

---

## Closing

Multi-tenancy architecture is not simply "technical implementation", but **a process of balancing business requirements with technical trade-offs**.

CheckUS's 4-Tier architecture isn't the answer for all teams. But I hope this series serves as **concrete reference material** when your team considers multi-tenancy.

Questions and feedback are always welcome. Thank you!

---

## Complete Series Links

- **[Part 1: Multi-Tenancy Concept](./part1-multi-tenancy-concept.md)**
- **[Part 2: CheckUS 4-Tier Architecture Implementation](./part2-4tier-architecture.md)**
- **[Part 3: Security and Performance Optimization](./part3-security-performance.md)**
- **[Part 4: Comparing Implementation Methods](./part4-implementation-comparison.md)**
- **[Part 5: Legacy Migration Strategy](./part5-legacy-migration.md)** ← Current

---

## References

### Industry Standard Documentation
- Microsoft Azure - Multi-tenant SaaS Database Patterns
- Google Cloud - Implement Multi-Tenancy in Spanner
- AWS - SaaS Tenant Isolation Strategies

### Technical Blogs
- Bytebase - Multi-Tenant Database Architecture Patterns
- Vlad Mihalcea - The Ultimate Guide to Database Multitenancy

> Note: These resources can be found by searching "Multi-tenant database patterns"

---

**CheckUS Architecture Series (Complete)**

Thank you for reading the entire series! 🎉
