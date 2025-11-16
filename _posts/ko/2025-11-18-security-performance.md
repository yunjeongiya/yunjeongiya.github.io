---
layout: post
title: "보안과 성능 최적화 - CheckUS 아키텍처 시리즈 (3/5)"
date: 2025-11-18 10:00:00 +0900
categories: [Architecture, Backend]
tags: [security, performance, jwt, testing, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: ko
slug: "014"
---

# 보안과 성능 최적화 - CheckUS 아키텍처 시리즈 (3/5)

> **시리즈 안내**
> - Part 1: 멀티테넌시 개념
> - Part 2: CheckUS 4-Tier 아키텍처 구현
> - **Part 3: 보안과 성능 최적화** ← 현재 글
> - Part 4: 다양한 구현 방법 비교
> - Part 5: 레거시 마이그레이션 전략

---

## 이전 이야기

[Part 2](./part2-4tier-architecture.md)에서는 CheckUS의 4-Tier 아키텍처 구현을 살펴봤습니다. 프론트엔드 Axios Interceptor부터 백엔드 AOP까지, 4단계 보안 체크가 어떻게 작동하는지 이해했습니다.

이번 글에서는 이 아키텍처를 **실전 환경에 적용하면서 마주한 보안과 성능 이슈**, 그리고 그 해결 과정을 공유합니다.

---

## JWT 토큰 설계: 여러 캠퍼스 역할 담기

### 요구사항

CheckUS 사용자는 **여러 캠퍼스에서 여러 역할**을 가질 수 있습니다.

```
[선생님 A]
  ├─ 강남 독서실: TEACHER
  ├─ 분당 수학학원: TEACHER
  └─ 대치 영어학원: ADMIN

[학생 B]
  ├─ 강남 독서실: STUDENT
  └─ 분당 수학학원: STUDENT
```

이 정보를 JWT 토큰에 어떻게 담을까요?

### 시도 1: 단순 배열 (❌ 역할 구분 불가)

```json
{
  "userId": 100,
  "username": "teacher_a",
  "campusIds": [1, 2, 3],
  "roles": ["TEACHER", "ADMIN"]
}
```

**문제점**
- ❌ 어느 캠퍼스에서 어떤 역할인지 알 수 없음
- ❌ 캠퍼스 1에서는 TEACHER, 캠퍼스 3에서는 ADMIN인데 구분 불가

### 시도 2: 중첩 객체 배열 (✅ 채택)

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

**장점**
- ✅ 캠퍼스별 역할 명확히 구분
- ✅ 권한 검증 시 `roles.find(r => r.campusId === 1 && r.role === 'ADMIN')` 가능

### JWT Claims 클래스

```java
// Backend 구현

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

### JWT 생성 및 파싱

```java
// Backend 구현

@Component
public class JwtTokenProvider {

    @Value("${jwt.secret}")
    private String secretKey;

    public String generateToken(Long userId, String username, List<CampusRole> roles) {
        // roles를 JSON 문자열로 직렬화
        String rolesJson = new ObjectMapper().writeValueAsString(roles);

        return Jwts.builder()
            .setSubject(username)
            .claim("userId", userId)
            .claim("roles", rolesJson)
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + 3600000)) // 1시간
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

## ThreadLocal 성능과 안전성

### ThreadLocal이란?

ThreadLocal은 각 스레드마다 독립적인 변수 저장소를 제공합니다.

```
Request 1 (Thread 1) → ThreadLocal: campusId = 1
Request 2 (Thread 2) → ThreadLocal: campusId = 2
Request 3 (Thread 1) → ThreadLocal: campusId = 3 (Request 1 완료 후)
```

### 위험 1: 메모리 누수

Spring Boot는 **Thread Pool**을 사용합니다. 스레드가 재사용되므로:

```java
// Request 1 (Thread A)
CampusContextHolder.setCampusIds(Set.of(1L));
// ... 처리 ...
// clear() 안 하면?

// Request 2 (Thread A 재사용)
CampusContextHolder.getCampusIds();  // 💥 이전 요청의 1L 반환!
```

**해결책: Interceptor에서 자동 정리**

```java
@Override
public void afterCompletion(HttpServletRequest request,
                           HttpServletResponse response,
                           Object handler,
                           Exception ex) {
    CampusContextHolder.clear();  // ✅ 반드시 정리
}
```

### 위험 2: 비동기 작업에서 ThreadLocal 손실

```java
@CampusFiltered
public void sendNotifications() {
    Long campusId = CampusContextHolder.getSingleCampusId();  // ✅ 1L

    // 비동기 작업
    CompletableFuture.runAsync(() -> {
        Long asyncCampusId = CampusContextHolder.getSingleCampusId();
        // 💥 null! 다른 스레드에서 실행되므로 ThreadLocal 접근 불가
    });
}
```

**해결책: TaskDecorator로 ThreadLocal 전파**

```java
// Backend 구현

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

// 데코레이터: 부모 스레드의 ThreadLocal을 자식에게 복사
public class CampusContextTaskDecorator implements TaskDecorator {

    @Override
    public Runnable decorate(Runnable runnable) {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();  // 부모 스레드에서 복사

        return () -> {
            try {
                CampusContextHolder.setCampusIds(campusIds);  // 자식 스레드에 설정
                runnable.run();
            } finally {
                CampusContextHolder.clear();  // 작업 후 정리
            }
        };
    }
}
```

### ThreadLocal 성능 측정

```java
// 10,000 requests 부하 테스트 결과

- Without ThreadLocal: 평균 15ms/request
- With ThreadLocal: 평균 15.2ms/request

성능 영향: 약 1.3% (무시 가능한 수준)
```

**결론**
- ✅ ThreadLocal 성능 오버헤드는 거의 없음
- ✅ 메모리 누수만 방지하면 안전하게 사용 가능

---

## 통합 테스트: 캠퍼스 격리 검증

### 테스트 전략

단위 테스트만으로는 부족합니다. **실제 HTTP 요청**부터 **데이터베이스 쿼리**까지 End-to-End로 검증해야 합니다.

### 테스트 시나리오

```
1. 강남 독서실(campusId=1) 학생 5명 생성
2. 분당 수학학원(campusId=2) 학생 3명 생성
3. X-Campus-Id: 1로 API 호출 → 5명만 조회되는지 확인
4. X-Campus-Id: 2로 API 호출 → 3명만 조회되는지 확인
5. 권한 없는 캠퍼스(campusId=999) 요청 → 403 에러 확인
```

### 통합 테스트 코드

```java
// Backend 구현

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
        // 테스트 데이터 생성
        createStudent("학생A", 1L);  // 강남 독서실
        createStudent("학생B", 1L);
        createStudent("학생C", 2L);  // 분당 수학학원
    }

    @Test
    void 강남_독서실_학생만_조회() throws Exception {
        // JWT 토큰 생성 (campusId 1, 2 권한 있음)
        String token = jwtTokenProvider.generateToken(
            100L,
            "teacher",
            List.of(
                new CampusRole(1L, "TEACHER"),
                new CampusRole(2L, "TEACHER")
            )
        );

        // API 호출
        MvcResult result = mockMvc.perform(
            get("/students")
                .header("Authorization", "Bearer " + token)
                .header("X-Campus-Id", "1")  // 강남 독서실 요청
        )
        .andExpect(status().isOk())
        .andReturn();

        // 응답 검증
        List<StudentDto> students = parseResponse(result);

        assertThat(students).hasSize(2);  // 강남 독서실 학생 2명만
        assertThat(students).extracting("name")
            .containsExactlyInAnyOrder("학생A", "학생B");  // 학생C 포함 안 됨
    }

    @Test
    void 권한_없는_캠퍼스_요청_시_403() throws Exception {
        String token = jwtTokenProvider.generateToken(
            100L,
            "teacher",
            List.of(new CampusRole(1L, "TEACHER"))  // campusId 1만 권한
        );

        mockMvc.perform(
            get("/students")
                .header("Authorization", "Bearer " + token)
                .header("X-Campus-Id", "999")  // 권한 없는 캠퍼스
        )
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errorCode").value("CAMPUS_ACCESS_DENIED"));
    }

    @Test
    void X_Campus_Id_헤더_없으면_400() throws Exception {
        String token = jwtTokenProvider.generateToken(100L, "teacher", List.of());

        mockMvc.perform(
            get("/students")
                .header("Authorization", "Bearer " + token)
                // X-Campus-Id 헤더 없음
        )
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errorCode").value("CAMPUS_ID_REQUIRED"));
    }
}
```

### 테스트 실행 결과

```
✅ 강남_독서실_학생만_조회 (120ms)
✅ 권한_없는_캠퍼스_요청_시_403 (85ms)
✅ X_Campus_Id_헤더_없으면_400 (92ms)

Total: 3 tests, 3 passed, 0 failed
```

---

## 모니터링: 캠퍼스 필터링 누락 감지

### 문제 인식

개발자가 실수로 `@CampusFiltered` 없이 메서드를 작성하면?

```java
// ❌ @CampusFiltered 누락
public List<Student> getDangerousMethod() {
    return studentRepository.findAll();  // 전체 데이터 노출
}
```

통합 테스트로 모든 엔드포인트를 커버하기는 어렵습니다. **실시간 모니터링**이 필요합니다.

### 해결책 1: AOP 로깅

```java
@Aspect
@Component
public class CampusFilterAspect {

    @Before("@annotation(CampusFiltered)")
    public void checkCampusContext(JoinPoint joinPoint) {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();

        // ✅ 항상 로깅
        log.info("CampusFiltered: method={}, campusIds={}",
                 joinPoint.getSignature().toShortString(),
                 campusIds);

        if (campusIds == null || campusIds.isEmpty()) {
            throw new BusinessException("CAMPUS_CONTEXT_EMPTY");
        }
    }
}
```

### 해결책 2: Sentry 통합

```java
@Aspect
@Component
public class CampusFilterAspect {

    @Before("@annotation(CampusFiltered)")
    public void checkCampusContext(JoinPoint joinPoint) {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();

        if (campusIds == null || campusIds.isEmpty()) {
            // Sentry에 에러 전송
            Sentry.captureException(new BusinessException(
                "CAMPUS_CONTEXT_EMPTY",
                String.format("Method: %s", joinPoint.getSignature())
            ));

            throw new BusinessException("CAMPUS_CONTEXT_EMPTY");
        }
    }
}
```

### 해결책 3: 통합 테스트 커버리지 강제

```java
// Backend 구현

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
                minimum = 0.80  // 80% 커버리지 강제
            }
        }
    }
}

check.dependsOn jacocoTestCoverageVerification
```

---

## 실전 엣지 케이스

### Case 1: Soft Delete와 캠퍼스 필터링

```java
// students 테이블
id | campus_id | name   | deleted_at
---+-----------+--------+------------
1  | 1         | 학생A  | NULL
2  | 1         | 학생B  | 2025-01-01  (삭제됨)
3  | 2         | 학생C  | NULL
```

**문제**: Soft Delete된 데이터도 캠퍼스 필터링을 적용해야 할까?

```java
// ❌ 삭제된 데이터도 다른 캠퍼스에서 보임
@Query("SELECT s FROM Student s WHERE s.deletedAt IS NOT NULL")
List<Student> findDeletedStudents();

// ✅ 삭제된 데이터도 캠퍼스 필터링
@CampusFiltered
public List<Student> getDeletedStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusIdAndDeletedAtIsNotNull(campusId);
}
```

**원칙**: 모든 쿼리는 삭제 여부와 무관하게 캠퍼스 필터링 적용

### Case 2: 통계 쿼리 (여러 캠퍼스 집계)

```java
// 요구사항: 전체 캠퍼스의 학생 수 집계
public Map<Long, Long> getStudentCountPerCampus() {
    // ❌ @CampusFiltered 사용하면 한 캠퍼스만 조회됨
    // ✅ 명시적으로 "전체 조회"임을 표시

    return studentRepository.findAll().stream()
        .collect(Collectors.groupingBy(
            Student::getCampusId,
            Collectors.counting()
        ));
}
```

**해결책**: `@CampusFiltered` 사용 안 함 + 메서드명에 `AllCampuses` 명시

```java
/**
 * ⚠️ 전체 캠퍼스 데이터 조회 (관리자 전용)
 * 캠퍼스 필터링 미적용
 */
@PreAuthorize("hasRole('SUPER_ADMIN')")
public Map<Long, Long> getStudentCountForAllCampuses() {
    return studentRepository.countGroupByCampusId();
}
```

### Case 3: 캠퍼스 간 데이터 이동

```java
// 요구사항: 학생을 강남 독서실(1) → 분당 수학학원(2)로 이동
@Transactional
public void transferStudent(Long studentId, Long targetCampusId) {
    // 1. 현재 캠퍼스에서 학생 조회
    Long currentCampusId = CampusContextHolder.getSingleCampusId();
    Student student = studentRepository.findByIdAndCampusId(studentId, currentCampusId)
        .orElseThrow(() -> new BusinessException("STUDENT_NOT_FOUND"));

    // 2. targetCampusId 권한 검증
    if (!hasAccessToCampus(targetCampusId)) {
        throw new BusinessException("CAMPUS_ACCESS_DENIED");
    }

    // 3. campusId 변경
    student.setCampusId(targetCampusId);
    studentRepository.save(student);
}
```

**주의점**: ThreadLocal은 요청 시작 시 설정된 캠퍼스만 가지므로, 다른 캠퍼스로 변경 시 별도 권한 검증 필요

---

## 성능 최적화

### 1. 인덱스 설계

```sql
-- ✅ 복합 인덱스: campus_id + 다른 조건
CREATE INDEX idx_students_campus_grade ON students(campus_id, grade);
CREATE INDEX idx_study_times_campus_student ON study_times(campus_id, student_id);

-- ❌ 단일 인덱스만 있으면 성능 저하
CREATE INDEX idx_students_grade ON students(grade);  -- campus_id 없음!
```

**쿼리 성능 비교**

```sql
-- 복합 인덱스 사용 (✅)
SELECT * FROM students
WHERE campus_id = 1 AND grade = 3;
-- Execution time: 2ms (인덱스 스캔)

-- 단일 인덱스 사용 (❌)
SELECT * FROM students
WHERE grade = 3;  -- campus_id 필터링 누락
-- Execution time: 150ms (풀 테이블 스캔)
```

### 2. N+1 문제 해결

```java
// ❌ N+1 쿼리 발생
@CampusFiltered
public List<StudentWithClassDto> getStudentsWithClass() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    List<Student> students = studentRepository.findByCampusId(campusId);

    return students.stream()
        .map(s -> new StudentWithClassDto(
            s,
            classRepository.findById(s.getClassId()).orElse(null)  // 💥 N번 쿼리
        ))
        .collect(Collectors.toList());
}

// ✅ Fetch Join 사용
@Query("""
    SELECT s FROM Student s
    LEFT JOIN FETCH s.classEntity
    WHERE s.campusId = :campusId
""")
List<Student> findByCampusIdWithClass(@Param("campusId") Long campusId);
```

### 3. 캐싱 전략

```java
// ThreadLocal 조회는 매우 빠르므로 (1μs 이하), 캐싱 불필요
// 대신 DB 쿼리 결과를 캐싱

@Cacheable(value = "students", key = "#campusId")
public List<Student> getStudentsByCampus(Long campusId) {
    return studentRepository.findByCampusId(campusId);
}

// ⚠️ 주의: 캠퍼스별로 캐시 키를 분리해야 함
```

---

## 보안 체크리스트

### 개발 시 필수 확인 사항

- [ ] 모든 Service 메서드에 `@CampusFiltered` 어노테이션 추가
- [ ] ThreadLocal에서 campusId 가져와서 Repository 메서드 호출
- [ ] Native Query에도 `WHERE campus_id = :campusId` 포함
- [ ] 통합 테스트로 캠퍼스 격리 검증
- [ ] Frontend Request DTO에 campusId 필드 없는지 ESLint 확인
- [ ] 비동기 작업 시 TaskDecorator로 ThreadLocal 전파
- [ ] Interceptor afterCompletion에서 ThreadLocal 정리

### 코드 리뷰 체크리스트

- [ ] `@CampusFiltered` 없는 Service 메서드가 있는가?
- [ ] Repository에서 `findAll()` 직접 호출하는 곳이 있는가?
- [ ] 통계 쿼리가 전체 캠퍼스 데이터를 조회하는가? (권한 확인 필요)
- [ ] Soft Delete 쿼리도 캠퍼스 필터링이 적용되었는가?

---

## 다음 편 예고

Part 3에서는 JWT 토큰 설계, ThreadLocal 안전성, 통합 테스트, 모니터링, 실전 엣지 케이스까지 보안과 성능 최적화 전략을 살펴봤습니다.

**Part 4: 다양한 구현 방법 비교**에서는:

- 🔍 PostgreSQL Native RLS vs CheckUS AOP
- ⚡ Hibernate Global Filter로 완전 자동화는 가능한가?
- 🚀 Redis 캐싱을 추가하면 얼마나 빨라질까?
- 🎯 AspectJ Load-Time Weaving의 장단점
- 📊 실제 사례 4가지 비교 분석

CheckUS의 방식과 다른 업계 구현 방법들을 객관적으로 비교합니다.

**👉 [Part 4: 다양한 구현 방법 비교](./part4-implementation-comparison.md)에서 계속됩니다.**

---

**CheckUS 아키텍처 시리즈**
- Part 1: 멀티테넌시 개념
- Part 2: CheckUS 4-Tier 아키텍처 구현
- Part 3: 보안과 성능 최적화 ← 현재 글
- Part 4: 다양한 구현 방법 비교
- Part 5: 레거시 마이그레이션 전략
