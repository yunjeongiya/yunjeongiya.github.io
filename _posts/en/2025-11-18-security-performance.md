---
layout: post
title: "Multi-Campus, Multi-Role JWT Design and ThreadLocal Safety"
date: 2025-11-18 10:00:00 +0900
categories: [Architecture, Backend]
tags: [security, performance, jwt, testing, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: en
slug: "014-en"
---

![CheckUS JWT Design and ThreadLocal Security](/assets/images/posts/014-jwt-threadlocal-security.png){: width="600"}

> **Series Navigation**
> - [Part 1: One Account, Multiple Schools, Multiple Roles](/posts/012-en/)
> - [Part 2: 4-Tier Security to Prevent Data Leaks in Multi-Tenancy](/posts/013-en/)
> - **[Part 3: Multi-Campus, Multi-Role JWT Design and ThreadLocal Safety](/posts/014-en/)** ← Current
> - [Part 4: Comparing 5 Row-Level Security Implementations and Selection Guide](/posts/015-en/)
> - Part 5: Legacy System Multi-Tenancy Migration (Coming Soon)

---

## Previously

[Part 2](/posts/013-en/) examined CheckUS's 4-Tier architecture implementation. We understood how the 4-layer security check works from frontend Axios Interceptor to backend AOP.

This article shares the **security and performance issues encountered when applying this architecture in production**, and how we solved them.

---

## JWT Token Design: Storing Multiple Campus Roles

### Requirements

CheckUS users can have **multiple roles across multiple campuses**.

```
[Teacher A]
  ├─ Gangnam Study Center: TEACHER
  ├─ Bundang Math Academy: TEACHER
  └─ Daechi English Academy: ADMIN

[Student B]
  ├─ Gangnam Study Center: STUDENT
  └─ Bundang Math Academy: STUDENT
```

How do we store this information in JWT tokens?

### Attempt 1: Simple Arrays (❌ Cannot Distinguish Roles)

```json
{
  "userId": 100,
  "username": "teacher_a",
  "campusIds": [1, 2, 3],
  "roles": ["TEACHER", "ADMIN"]
}
```

**Problems**
- ❌ Cannot tell which role for which campus
- ❌ TEACHER at campus 1, ADMIN at campus 3, but no distinction possible

### Attempt 2: Nested Object Array (✅ Adopted)

```json
{
  "userId": 100,
  "username": "teacher_a",
  "roles": [
    { "campusId": 1, "role": "TEACHER" },
    { "campusId": 2, "role": "TEACHER" },
    { "campusId": 3, "role": "ADMIN" }
  ]
}
```

**Benefits**
- ✅ Clear distinction of roles per campus
- ✅ Permission validation possible with `roles.find(r => r.campusId === 1 && r.role === 'ADMIN')`

### JWT Claims Class

```java
// Backend Implementation

@Getter
@Builder
public class JwtClaims {
    private Long userId;
    private String username;
    private List<CampusRole> roles;

    @Getter
    @AllArgsConstructor
    public static class CampusRole {
        private Long campusId;
        private String role;  // STUDENT, TEACHER, GUARDIAN, ADMIN
    }
}
```

### JWT Generation and Parsing

```java
// Backend Implementation

@Component
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secretKey;

    public String generateToken(Long userId, String username, List<CampusRole> roles) {
        // Serialize roles to JSON string
        String rolesJson = new ObjectMapper().writeValueAsString(roles);

        return Jwts.builder()
            .setSubject(username)
            .claim("userId", userId)
            .claim("roles", rolesJson)
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + 3600000)) // 1 hour
            .signWith(SignatureAlgorithm.HS512, secretKey)
            .compact();
    }

    public Set<Long> getCampusIds(String token) {
        Claims claims = parseClaims(token);
        String rolesJson = claims.get("roles", String.class);

        List<CampusRole> roles = new ObjectMapper().readValue(
            rolesJson,
            new TypeReference<List<CampusRole>>() {}
        );

        return roles.stream()
            .map(CampusRole::getCampusId)
            .collect(Collectors.toSet());
    }

    public boolean hasRole(String token, Long campusId, String role) {
        Claims claims = parseClaims(token);
        String rolesJson = claims.get("roles", String.class);

        List<CampusRole> roles = new ObjectMapper().readValue(
            rolesJson,
            new TypeReference<List<CampusRole>>() {}
        );

        return roles.stream()
            .anyMatch(r -> r.getCampusId().equals(campusId) && r.getRole().equals(role));
    }
}
```

---

## ThreadLocal Performance and Safety

### What is ThreadLocal?

ThreadLocal provides independent variable storage for each thread.

```
Request 1 (Thread 1) → ThreadLocal: campusId = 1
Request 2 (Thread 2) → ThreadLocal: campusId = 2
Request 3 (Thread 1) → ThreadLocal: campusId = 3 (after Request 1 completes)
```

### Risk 1: Memory Leaks

Spring Boot uses a **Thread Pool**. Since threads are reused:

```java
// Request 1 (Thread A)
CampusContextHolder.setCampusIds(Set.of(1L));
// ... processing ...
// What if we don't clear()?

// Request 2 (Thread A reused)
CampusContextHolder.getCampusIds();  // 💥 Returns previous request's 1L!
```

**Solution: Automatic Cleanup in Interceptor**

```java
@Override
public void afterCompletion(HttpServletRequest request,
                           HttpServletResponse response,
                           Object handler,
                           Exception ex) {
    CampusContextHolder.clear();  // ✅ Must clean up
}
```

### Risk 2: ThreadLocal Loss in Async Operations

```java
@CampusFiltered
public void sendNotifications() {
    Long campusId = CampusContextHolder.getSingleCampusId();  // ✅ 1L

    // Async task
    CompletableFuture.runAsync(() -> {
        Long asyncCampusId = CampusContextHolder.getSingleCampusId();
        // 💥 null! Different thread, cannot access ThreadLocal
    });
}
```

**Solution: ThreadLocal Propagation with TaskDecorator**

```java
// Backend Implementation

@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(20);
        executor.setTaskDecorator(new CampusContextTaskDecorator());  // ✅
        executor.initialize();
        return executor;
    }
}

// Decorator: Copies parent thread's ThreadLocal to child
public class CampusContextTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();  // Copy from parent thread

        return () -> {
            try {
                CampusContextHolder.setCampusIds(campusIds);  // Set in child thread
                runnable.run();
            } finally {
                CampusContextHolder.clear();  // Clean up after task
            }
        };
    }
}
```

### ThreadLocal Performance Measurement

```java
// Load test results with 10,000 requests

- Without ThreadLocal: Average 15ms/request
- With ThreadLocal: Average 15.2ms/request

Performance impact: About 1.3% (negligible)
```

**Conclusion**
- ✅ ThreadLocal performance overhead is almost zero
- ✅ Safe to use if memory leaks are prevented

---

## Integration Testing: Verifying Campus Isolation

### Testing Strategy

Unit tests alone are insufficient. Must verify **End-to-End** from actual **HTTP requests** to **database queries**.

### Test Scenarios

```
1. Create 5 students for Gangnam Study Center (campusId=1)
2. Create 3 students for Bundang Math Academy (campusId=2)
3. API call with X-Campus-Id: 1 → Verify only 5 students returned
4. API call with X-Campus-Id: 2 → Verify only 3 students returned
5. Unauthorized campus request (campusId=999) → Verify 403 error
```

### Integration Test Code

```java
// Backend Implementation

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class StudentControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StudentRepository studentRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @BeforeEach
    void setup() {
        // Create test data
        createStudent("Student A", 1L);  // Gangnam Study Center
        createStudent("Student B", 1L);
        createStudent("Student C", 2L);  // Bundang Math Academy
    }

    @Test
    void should_only_return_gangnam_students() throws Exception {
        // Generate JWT token (has campusId 1, 2 permissions)
        String token = jwtTokenProvider.generateToken(
            100L,
            "teacher",
            List.of(
                new CampusRole(1L, "TEACHER"),
                new CampusRole(2L, "TEACHER")
            )
        );

        // API call
        MvcResult result = mockMvc.perform(
            get("/students")
                .header("Authorization", "Bearer " + token)
                .header("X-Campus-Id", "1")  // Request Gangnam Study Center
        )
        .andExpect(status().isOk())
        .andReturn();

        // Verify response
        List<StudentDto> students = parseResponse(result);

        assertThat(students).hasSize(2);  // Only 2 Gangnam students
        assertThat(students).extracting("name")
            .containsExactlyInAnyOrder("Student A", "Student B");  // No Student C
    }

    @Test
    void should_return_403_for_unauthorized_campus() throws Exception {
        String token = jwtTokenProvider.generateToken(
            100L,
            "teacher",
            List.of(new CampusRole(1L, "TEACHER"))  // Only campusId 1 permission
        );

        mockMvc.perform(
            get("/students")
                .header("Authorization", "Bearer " + token)
                .header("X-Campus-Id", "999")  // Unauthorized campus
        )
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errorCode").value("CAMPUS_ACCESS_DENIED"));
    }

    @Test
    void should_return_400_when_x_campus_id_missing() throws Exception {
        String token = jwtTokenProvider.generateToken(100L, "teacher", List.of());

        mockMvc.perform(
            get("/students")
                .header("Authorization", "Bearer " + token)
                // X-Campus-Id header missing
        )
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("CAMPUS_ID_REQUIRED"));
    }
}
```

### Test Execution Results

```
✅ should_only_return_gangnam_students (120ms)
✅ should_return_403_for_unauthorized_campus (85ms)
✅ should_return_400_when_x_campus_id_missing (92ms)

Total: 3 tests, 3 passed, 0 failed
```

---

## Monitoring: Detecting Missing Campus Filters

### Problem Recognition

What if developers accidentally write methods without `@CampusFiltered`?

```java
// ❌ Missing @CampusFiltered
public List<Student> getDangerousMethod() {
    return studentRepository.findAll();  // Exposes all data
}
```

Covering all endpoints with integration tests is difficult. **Real-time monitoring** is needed.

### Solution 1: AOP Logging

```java
@Aspect
@Component
public class CampusFilterAspect {

    @Before("@annotation(CampusFiltered)")
    public void checkCampusContext(JoinPoint joinPoint) {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();

        // ✅ Always log
        log.info("CampusFiltered: method={}, campusIds={}",
                 joinPoint.getSignature().toShortString(),
                 campusIds);

        if (campusIds == null || campusIds.isEmpty()) {
            throw new BusinessException("CAMPUS_CONTEXT_EMPTY");
        }
    }
}
```

### Solution 2: Sentry Integration

```java
@Aspect
@Component
public class CampusFilterAspect {

    @Before("@annotation(CampusFiltered)")
    public void checkCampusContext(JoinPoint joinPoint) {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();

        if (campusIds == null || campusIds.isEmpty()) {
            // Send error to Sentry
            Sentry.captureException(new BusinessException(
                "CAMPUS_CONTEXT_EMPTY",
                String.format("Method: %s", joinPoint.getSignature())
            ));

            throw new BusinessException("CAMPUS_CONTEXT_EMPTY");
        }
    }
}
```

### Solution 3: Enforce Integration Test Coverage

```java
// Backend Implementation

test {
    finalizedBy jacocoTestReport
}

jacocoTestReport {
    dependsOn test

    afterEvaluate {
        classDirectories.setFrom(files(classDirectories.files.collect {
            fileTree(dir: it, exclude: [
                '**/dto/**',
                '**/config/**'
            ])
        }))
    }
}

jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                minimum = 0.80  // Enforce 80% coverage
            }
        }
    }
}

check.dependsOn jacocoTestCoverageVerification
```

---

## Real-World Edge Cases

### Case 1: Soft Delete and Campus Filtering

```java
// students table
id | campus_id | name      | deleted_at
---+-----------+-----------+------------
1  | 1         | Student A | NULL
2  | 1         | Student B | 2025-01-01  (deleted)
3  | 2         | Student C | NULL
```

**Question**: Should campus filtering apply to soft deleted data too?

```java
// ❌ Deleted data visible to other campuses
@Query("SELECT s FROM Student s WHERE s.deletedAt IS NOT NULL")
List<Student> findDeletedStudents();

// ✅ Deleted data also campus filtered
@CampusFiltered
public List<Student> getDeletedStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusIdAndDeletedAtIsNotNull(campusId);
}
```

**Principle**: All queries apply campus filtering regardless of deletion status

### Case 2: Statistical Queries (Aggregating Multiple Campuses)

```java
// Requirement: Aggregate student count across all campuses
public Map<Long, Long> getStudentCountPerCampus() {
    // ❌ Using @CampusFiltered queries only one campus
    // ✅ Explicitly indicate "querying all"

    return studentRepository.findAll().stream()
        .collect(Collectors.groupingBy(
            Student::getCampusId,
            Collectors.counting()
        ));
}
```

**Solution**: Don't use `@CampusFiltered` + Include `AllCampuses` in method name

```java
/**
 * ⚠️ Queries all campus data (admin only)
 * Campus filtering not applied
 */
@PreAuthorize("hasRole('SUPER_ADMIN')")
public Map<Long, Long> getStudentCountForAllCampuses() {
    return studentRepository.countGroupByCampusId();
}
```

### Case 3: Cross-Campus Data Transfer

```java
// Requirement: Transfer student from Gangnam Study Center(1) → Bundang Math Academy(2)
@Transactional
public void transferStudent(Long studentId, Long targetCampusId) {
    // 1. Query student from current campus
    Long currentCampusId = CampusContextHolder.getSingleCampusId();
    Student student = studentRepository.findByIdAndCampusId(studentId, currentCampusId)
        .orElseThrow(() -> new BusinessException("STUDENT_NOT_FOUND"));

    // 2. Validate targetCampusId permission
    if (!hasAccessToCampus(targetCampusId)) {
        throw new BusinessException("CAMPUS_ACCESS_DENIED");
    }

    // 3. Change campusId
    student.setCampusId(targetCampusId);
    studentRepository.save(student);
}
```

**Note**: ThreadLocal only holds campus set at request start, so separate permission validation needed when changing to another campus

---

## Performance Optimization

### 1. Index Design

```sql
-- ✅ Composite index: campus_id + other conditions
CREATE INDEX idx_students_campus_grade ON students(campus_id, grade);
CREATE INDEX idx_study_times_campus_student ON study_times(campus_id, student_id);

-- ❌ Performance degradation with only single index
CREATE INDEX idx_students_grade ON students(grade);  -- No campus_id!
```

**Query Performance Comparison**

```sql
-- Using composite index (✅)
SELECT * FROM students
WHERE campus_id = 1 AND grade = 3;
-- Execution time: 2ms (index scan)

-- Using single index (❌)
SELECT * FROM students
WHERE grade = 3;  -- Missing campus_id filtering
-- Execution time: 150ms (full table scan)
```

### 2. Solving N+1 Problem

```java
// ❌ N+1 queries occur
@CampusFiltered
public List<StudentWithClassDto> getStudentsWithClass() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    List<Student> students = studentRepository.findByCampusId(campusId);

    return students.stream()
        .map(s -> new StudentWithClassDto(
            s,
            classRepository.findById(s.getClassId()).orElse(null)  // 💥 N queries
        ))
        .collect(Collectors.toList());
}

// ✅ Using Fetch Join
@Query("""
    SELECT s FROM Student s
    LEFT JOIN FETCH s.classEntity
    WHERE s.campusId = :campusId
""")
List<Student> findByCampusIdWithClass(@Param("campusId") Long campusId);
```

### 3. Caching Strategy

```java
// ThreadLocal lookup is very fast (<1μs), caching unnecessary
// Instead cache DB query results

@Cacheable(value = "students", key = "#campusId")
public List<Student> getStudentsByCampus(Long campusId) {
    return studentRepository.findByCampusId(campusId);
}

// ⚠️ Note: Must separate cache keys per campus
```

---

## Security Checklist

### Required Checks During Development

- [ ] Add `@CampusFiltered` annotation to all Service methods
- [ ] Retrieve campusId from ThreadLocal and call Repository methods
- [ ] Include `WHERE campus_id = :campusId` in Native Queries
- [ ] Verify campus isolation with integration tests
- [ ] Check Frontend Request DTOs have no campusId field via ESLint
- [ ] Propagate ThreadLocal with TaskDecorator for async operations
- [ ] Clean up ThreadLocal in Interceptor afterCompletion

### Code Review Checklist

- [ ] Are there Service methods without `@CampusFiltered`?
- [ ] Are there places directly calling `findAll()` from Repository?
- [ ] Do statistical queries access all campus data? (permission check needed)
- [ ] Do Soft Delete queries apply campus filtering?

---

## Next Episode Preview

Part 3 explored security and performance optimization strategies including JWT token design, ThreadLocal safety, integration testing, monitoring, and real edge cases.

**Part 4: Comparing Implementation Methods** will cover:

- 🔍 PostgreSQL Native RLS vs CheckUS AOP
- ⚡ Can Hibernate Global Filter achieve complete automation?
- 🚀 How much faster with Redis caching?
- 🎯 Pros and cons of AspectJ Load-Time Weaving
- 📊 Comparative analysis of 4 real cases

We'll objectively compare CheckUS's approach with other industry implementation methods.

**👉 Continue to [Part 4: Comparing 5 Row-Level Security Implementations and Selection Guide](/posts/015-en/)**

---

**CheckUS Architecture Series**
- Part 1: One Account, Multiple Schools, Multiple Roles
- Part 2: 4-Tier Security to Prevent Data Leaks in Multi-Tenancy
- Part 3: Multi-Campus, Multi-Role JWT Design and ThreadLocal Safety ← Current
- Part 4: Comparing 5 Row-Level Security Implementations and Selection Guide
- Part 5: Legacy System Multi-Tenancy Migration
