---
layout: post
title: "레거시 시스템 멀티테넌시 전환: campus_id 컬럼 추가 실전 가이드"
date: 2025-11-20 10:00:00 +0900
categories: [Architecture, Backend]
tags: [migration, deployment, database, strategy, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: ko
slug: "016"
---

# 레거시 마이그레이션 전략 - CheckUS 아키텍처 시리즈 (5/5)

> **시리즈 안내**
> - Part 1: 멀티테넌시 개념
> - Part 2: CheckUS 4-Tier 아키텍처 구현
> - Part 3: 보안과 성능 최적화
> - Part 4: 다양한 구현 방법 비교
> - **Part 5: 레거시 마이그레이션 전략** ← 현재 글 (시리즈 완결)

---

## 이전 이야기

[Part 4](./part4-implementation-comparison.md)에서는 다양한 Row-Level Security 구현 방법들을 비교했습니다. PostgreSQL Native RLS, Hibernate Filter, API Gateway, CheckUS 4-Tier 각각의 장단점을 살펴봤습니다.

이번 글에서는 **이미 운영 중인 시스템**에 멀티테넌시를 어떻게 적용할 것인가? CheckUS가 실제로 겪은 마이그레이션 과정과 노하우를 공개합니다.

---

## 레거시 시스템 현황

### 마이그레이션 이전 아키텍처

CheckUS 초기 버전은 **단일 캠퍼스만 지원**했습니다.

```sql
-- 기존 students 테이블
CREATE TABLE students (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100),
    grade INT,
    phone VARCHAR(20),
    created_at TIMESTAMP
);
-- campus_id 컬럼이 없음!
```

```java
// 기존 Service 코드
@Service
public class StudentService {

    public List<Student> getAllStudents() {
        return studentRepository.findAll();  // 모든 학생 조회
    }
}
```

**문제점**
- ❌ 여러 캠퍼스 데이터가 섞여 있음
- ❌ 캠퍼스 구분 없이 전체 조회
- ❌ 이미 1,000명 이상의 학생 데이터 존재

### 마이그레이션 목표

1. **무중단 배포**: 서비스 중단 없이 마이그레이션
2. **데이터 무결성**: 기존 데이터 손실 없음
3. **점진적 전환**: 한 번에 모든 API를 바꾸지 않음
4. **롤백 가능**: 문제 발생 시 이전 버전으로 복구

---

## 마이그레이션 전략: 5단계 접근

### Phase 1: 스키마 변경 (데이터베이스)

**목표**: 모든 테이블에 `campus_id` 컬럼 추가

```sql
-- Step 1: 컬럼 추가 (NOT NULL 아님!)
ALTER TABLE students ADD COLUMN campus_id BIGINT;

-- Step 2: 기존 데이터에 기본 캠퍼스 ID 할당
UPDATE students SET campus_id = 1 WHERE campus_id IS NULL;

-- Step 3: 외래 키 제약 조건 추가
ALTER TABLE students ADD CONSTRAINT fk_students_campus
    FOREIGN KEY (campus_id) REFERENCES campuses(id);

-- Step 4: NOT NULL 제약 조건 추가
ALTER TABLE students ALTER COLUMN campus_id SET NOT NULL;

-- Step 5: 인덱스 추가 (성능 최적화)
CREATE INDEX idx_students_campus_id ON students(campus_id);
CREATE INDEX idx_students_campus_grade ON students(campus_id, grade);
```

**주의사항**
- ⚠️ `NOT NULL`을 처음부터 추가하면 **기존 데이터 삽입 실패**
- ⚠️ 인덱스는 트래픽 적은 시간대에 추가 (LOCK 발생)

**롤백 계획**

```sql
-- Phase 1 롤백
ALTER TABLE students DROP CONSTRAINT fk_students_campus;
ALTER TABLE students DROP COLUMN campus_id;
DROP INDEX idx_students_campus_id;
```

---

### Phase 2: Entity 변경 (백엔드 코드)

**목표**: JPA Entity에 `campusId` 필드 추가

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
    private Long campusId;  // ✅ 추가

    private String name;
    private Integer grade;
}
```

**주의사항**
- ⚠️ 기존 코드는 `campusId` 사용 안 함 (아직 필터링 미적용)
- ⚠️ 새로운 데이터 INSERT 시 `campusId` 반드시 포함

**테스트 코드 추가**

```java
@Test
void 새로운_학생_생성시_campusId_필수() {
    Student student = new Student();
    student.setName("학생A");
    student.setGrade(3);
    student.setCampusId(1L);  // 필수!

    studentRepository.save(student);

    assertThat(student.getCampusId()).isEqualTo(1L);
}
```

---

### Phase 3: ThreadLocal 및 Interceptor 도입

**목표**: HTTP Interceptor와 ThreadLocal 설정 (아직 필터링 미적용)

```java
// CampusContextHolder 생성 (이미 Part 2에서 다룸)
public class CampusContextHolder {
    private static final ThreadLocal<Set<Long>> campusIdsHolder = new ThreadLocal<>();
    // ... (코드 생략)
}

// HTTP Interceptor 등록
@Component
public class CampusContextInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, ...) {
        String campusIdHeader = request.getHeader("X-Campus-Id");

        if (campusIdHeader != null) {
            Long campusId = Long.parseLong(campusIdHeader);
            CampusContextHolder.setCampusIds(Set.of(campusId));

            // ✅ 로깅만 하고 에러는 발생시키지 않음 (호환성 유지)
            log.info("Campus context set: campusId={}", campusId);
        } else {
            log.warn("X-Campus-Id header missing");  // 경고만
        }

        return true;  // 계속 진행
    }

    @Override
    public void afterCompletion(...) {
        CampusContextHolder.clear();
    }
}
```

**Phase 3의 핵심**
- ✅ ThreadLocal은 설정하되, **필수는 아님** (헤더 없어도 통과)
- ✅ 로깅으로 모니터링만 수행
- ✅ 기존 API 호출은 정상 작동 (하위 호환성 유지)

---

### Phase 4: 점진적 API 마이그레이션

**목표**: API를 하나씩 캠퍼스 필터링 적용

#### 4-1. 파일럿 API 선정

```java
// 📌 가장 먼저 마이그레이션할 API: 학생 목록 조회
@GetMapping("/students")
@CampusFiltered  // ✅ AOP 적용
public ResponseEntity<List<StudentDto>> getStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    List<Student> students = studentRepository.findByCampusId(campusId);
    return ResponseEntity.ok(students);
}
```

**파일럿 API 선정 기준**
1. ✅ **읽기 전용** (데이터 변경 없음)
2. ✅ **트래픽 낮음** (문제 발생 시 영향 최소화)
3. ✅ **롤백 쉬움** (DB 변경 없음)

#### 4-2. 프론트엔드 변경

```typescript
// Before: 헤더 없이 호출
const students = await api.get('/students');

// After: Axios Interceptor에서 자동 헤더 추가
const students = await api.get('/students');
// X-Campus-Id: 1 자동 추가됨
```

**점진적 롤아웃**

```
1주차: /students (읽기 전용)
2주차: /schedules (읽기 전용)
3주차: /tasks (읽기 전용)
4주차: POST /students (쓰기 작업)
5주차: PUT /students/{id} (업데이트)
6주차: DELETE /students/{id} (삭제)
```

#### 4-3. 모니터링

```java
@Aspect
@Component
public class ApiMigrationMonitoringAspect {

    @Around("execution(* com.checkus.controller.*.*(..))")
    public Object monitorApiCalls(ProceedingJoinPoint joinPoint) throws Throwable {
        String apiName = joinPoint.getSignature().toShortString();
        Set<Long> campusIds = CampusContextHolder.getCampusIds();

        if (campusIds == null || campusIds.isEmpty()) {
            // ⚠️ 마이그레이션 안 된 API 호출
            log.warn("Legacy API call: {} (no campus context)", apiName);
            Sentry.captureMessage("Legacy API: " + apiName);
        } else {
            // ✅ 마이그레이션 완료된 API
            log.info("Migrated API call: {}, campusIds={}", apiName, campusIds);
        }

        return joinPoint.proceed();
    }
}
```

**Grafana 대시보드**

```
[마이그레이션 진행률]
- 전체 API 수: 50개
- 마이그레이션 완료: 35개 (70%)
- 남은 API: 15개 (30%)

[레거시 API 호출 빈도]
- /old-api-1: 120 calls/hour
- /old-api-2: 80 calls/hour
```

---

### Phase 5: 엄격 모드 전환

**목표**: 모든 API 마이그레이션 완료 후 `X-Campus-Id` 헤더 필수화

```java
// Phase 3에서 경고만 하던 Interceptor를 엄격 모드로 변경
@Override
public boolean preHandle(HttpServletRequest request, ...) {
    String campusIdHeader = request.getHeader("X-Campus-Id");

    if (campusIdHeader == null || campusIdHeader.isEmpty()) {
        // ❌ Phase 5: 에러 발생 (엄격 모드)
        throw new BusinessException("CAMPUS_ID_REQUIRED",
            "X-Campus-Id 헤더가 필요합니다.");
    }

    Long campusId = Long.parseLong(campusIdHeader);

    // JWT 권한 검증
    if (!hasAccessToCampus(campusId)) {
        throw new BusinessException("CAMPUS_ACCESS_DENIED");
    }

    CampusContextHolder.setCampusIds(Set.of(campusId));
    return true;
}
```

**Feature Flag로 점진적 전환**

```yaml
# application.yml
campus:
  filtering:
    strict-mode: false  # Phase 3-4: 경고만
                        # Phase 5: true (엄격 모드)
```

```java
@Value("${campus.filtering.strict-mode}")
private boolean strictMode;

@Override
public boolean preHandle(HttpServletRequest request, ...) {
    if (campusIdHeader == null) {
        if (strictMode) {
            throw new BusinessException("CAMPUS_ID_REQUIRED");  // 에러
        } else {
            log.warn("X-Campus-Id missing");  // 경고만
        }
    }
    return true;
}
```

---

## 데이터 마이그레이션 상세 전략

### 1. 기존 데이터 분류

```sql
-- 어느 캠퍼스 데이터인지 추론
-- 예시: 학생의 담당 선생님으로 캠퍼스 유추
UPDATE students s
SET campus_id = (
    SELECT t.campus_id
    FROM teachers t
    WHERE t.id = s.teacher_id
)
WHERE s.campus_id IS NULL;

-- 추론 불가능한 데이터는 기본 캠퍼스 할당
UPDATE students
SET campus_id = 1  -- 기본 캠퍼스 (강남 독서실)
WHERE campus_id IS NULL;
```

### 2. 데이터 검증

```sql
-- 모든 행에 campus_id가 있는지 확인
SELECT COUNT(*) FROM students WHERE campus_id IS NULL;
-- 결과: 0 (모두 할당됨)

-- 외래 키 제약 조건 위반 확인
SELECT s.id, s.campus_id
FROM students s
LEFT JOIN campuses c ON s.campus_id = c.id
WHERE c.id IS NULL;
-- 결과: 빈 결과 (모두 유효한 campus_id)
```

### 3. 백업 및 롤백 준비

```bash
# Phase 1 적용 전 전체 DB 백업
mysqldump -u root -p checkus > checkus_backup_before_migration.sql

# 특정 테이블만 백업
mysqldump -u root -p checkus students > students_backup.sql

# 롤백 시 복원
mysql -u root -p checkus < checkus_backup_before_migration.sql
```

---

## 마이그레이션 중 발견한 문제와 해결책

### 문제 1: JOIN 쿼리에서 필터링 누락

**상황**

```java
// ❌ students는 필터링했지만, 조인된 study_times는 필터링 안 함
@Query("""
    SELECT s FROM Student s
    LEFT JOIN s.studyTimes st
    WHERE s.campusId = :campusId
""")
List<Student> findStudentsWithStudyTimes(@Param("campusId") Long campusId);
```

**결과**: 다른 캠퍼스의 `study_times` 데이터가 섞여 나옴

**해결책**

```java
// ✅ 조인된 테이블도 명시적으로 필터링
@Query("""
    SELECT s FROM Student s
    LEFT JOIN s.studyTimes st
    WHERE s.campusId = :campusId
      AND (st.campusId = :campusId OR st.campusId IS NULL)
""")
```

---

### 문제 2: Soft Delete와 캠퍼스 필터링 충돌

**상황**

```sql
-- students 테이블
id | campus_id | name   | deleted_at
---+-----------+--------+------------
1  | 1         | 학생A  | NULL
2  | 1         | 학생B  | 2025-01-01  (삭제됨)
3  | 2         | 학생C  | NULL
```

```java
// ❌ 삭제된 학생 조회 시 다른 캠퍼스 데이터 노출
@Query("SELECT s FROM Student s WHERE s.deletedAt IS NOT NULL")
List<Student> findDeletedStudents();
// 결과: 캠퍼스 1, 2 모두 반환됨
```

**해결책**

```java
// ✅ Soft Delete 쿼리도 캠퍼스 필터링 적용
@CampusFiltered
public List<Student> getDeletedStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusIdAndDeletedAtIsNotNull(campusId);
}
```

---

### 문제 3: 배치 작업에서 ThreadLocal 미설정

**상황**

```java
// ❌ Scheduled Job은 HTTP 요청이 아니므로 ThreadLocal 없음
@Scheduled(cron = "0 0 2 * * *")  // 매일 새벽 2시
public void generateDailyReports() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    // 💥 NullPointerException! (ThreadLocal 미설정)
}
```

**해결책 1: 모든 캠퍼스 순회**

```java
@Scheduled(cron = "0 0 2 * * *")
public void generateDailyReports() {
    List<Campus> campuses = campusRepository.findAll();

    for (Campus campus : campuses) {
        try {
            // ThreadLocal 수동 설정
            CampusContextHolder.setCampusIds(Set.of(campus.getId()));

            // 리포트 생성
            reportService.generateReport();
        } finally {
            CampusContextHolder.clear();  // 반드시 정리
        }
    }
}
```

**해결책 2: 배치 전용 서비스 (필터링 미적용)**

```java
// @CampusFiltered 없음 (배치 작업용)
public void generateReportForAllCampuses() {
    // 전체 캠퍼스 데이터 조회
    List<Student> allStudents = studentRepository.findAll();

    // 캠퍼스별로 그룹핑
    Map<Long, List<Student>> byCampus = allStudents.stream()
        .collect(Collectors.groupingBy(Student::getCampusId));

    byCampus.forEach((campusId, students) -> {
        // 리포트 생성
    });
}
```

---

### 문제 4: 프론트엔드 캐시 무효화

**상황**

```typescript
// ❌ React Query 캐시에 캠퍼스 구분 없음
const { data } = useQuery(['students'], fetchStudents);

// 사용자가 캠퍼스 전환
setCurrentCampusId(2);  // 강남(1) → 분당(2)

// 💥 캐시에서 이전 캠퍼스(1) 데이터 반환!
```

**해결책: 캐시 키에 campusId 포함**

```typescript
const { currentCampusId } = useCampusStore();

const { data } = useQuery(
  ['students', currentCampusId],  // ✅ 캠퍼스별로 캐시 분리
  fetchStudents
);

// 캠퍼스 전환 시 자동으로 새 쿼리 실행
```

---

## 무중단 배포 계획

### Blue-Green Deployment

```
[배포 전]
Blue (구버전) ← 100% 트래픽
Green (신버전) ← 0% 트래픽

[Phase 1-3 배포]
Blue (구버전 + campusId 컬럼) ← 100%
Green (신버전 + ThreadLocal) ← 0%

[Phase 4: 점진적 트래픽 전환]
Blue ← 80%
Green ← 20% (파일럿 API만)

Blue ← 50%
Green ← 50%

Blue ← 20%
Green ← 80%

[Phase 5: 완전 전환]
Blue ← 0% (종료)
Green (신버전) ← 100%
```

### 롤백 시나리오

```
1. Green 버전에서 에러 발생 감지
2. 트래픽을 즉시 Blue로 100% 전환 (10초 이내)
3. Green 버전 로그 분석
4. 문제 수정 후 재배포
```

---

## 마이그레이션 체크리스트

### Phase 1: 스키마 변경

- [ ] 모든 테이블에 `campus_id` 컬럼 추가
- [ ] 기존 데이터에 기본 campusId 할당
- [ ] 외래 키 제약 조건 추가
- [ ] NOT NULL 제약 조건 추가
- [ ] 인덱스 추가 (`campus_id`, `campus_id + 다른 컬럼`)
- [ ] 전체 DB 백업 완료

### Phase 2: Entity 변경

- [ ] JPA Entity에 `campusId` 필드 추가
- [ ] 새로운 데이터 INSERT 시 `campusId` 포함 확인
- [ ] 기존 테스트 코드 수정
- [ ] 새로운 통합 테스트 작성

### Phase 3: Interceptor 도입

- [ ] CampusContextHolder 클래스 생성
- [ ] HTTP Interceptor 등록 (경고 모드)
- [ ] 프론트엔드 Axios Interceptor 추가
- [ ] 로깅 및 모니터링 설정
- [ ] Feature Flag 설정 (`strict-mode: false`)

### Phase 4: 점진적 마이그레이션

- [ ] 파일럿 API 선정 (읽기 전용, 트래픽 낮음)
- [ ] @CampusFiltered 어노테이션 추가
- [ ] ThreadLocal 사용 코드 작성
- [ ] 프론트엔드 변경 (헤더 자동 추가)
- [ ] 1주일 모니터링 후 다음 API 전환
- [ ] 모든 API 마이그레이션 완료 확인

### Phase 5: 엄격 모드 전환

- [ ] Feature Flag `strict-mode: true` 설정
- [ ] X-Campus-Id 헤더 필수화
- [ ] 레거시 API 호출 0건 확인
- [ ] 1주일 모니터링 (에러 없음 확인)
- [ ] Phase 3 임시 코드 제거

### 배포 및 모니터링

- [ ] Blue-Green Deployment 준비
- [ ] 롤백 계획 수립
- [ ] Sentry 에러 모니터링 활성화
- [ ] Grafana 대시보드 생성 (마이그레이션 진행률)
- [ ] 배포 후 24시간 집중 모니터링

---

## 마이그레이션 소요 시간 (CheckUS 실제 경험)

```
Phase 1 (스키마 변경): 1주
- DB 테이블 20개 수정
- 데이터 마이그레이션 스크립트 작성 및 테스트

Phase 2 (Entity 변경): 3일
- Entity 클래스 수정
- 테스트 코드 업데이트

Phase 3 (Interceptor 도입): 1주
- CampusContextHolder, Interceptor 구현
- 프론트엔드 Axios Interceptor 추가
- 통합 테스트

Phase 4 (점진적 마이그레이션): 4주
- 주차별로 API 그룹 마이그레이션 (읽기 → 쓰기 → 삭제)
- 매주 모니터링 및 버그 수정

Phase 5 (엄격 모드 전환): 1주
- Feature Flag 전환
- 최종 검증

총 소요 시간: 약 8주 (2개월)
```

---

## 시리즈 결론

지금까지 5부작 시리즈를 통해 CheckUS의 멀티테넌시 아키텍처를 깊이 있게 살펴봤습니다.

### 주요 내용 요약

**Part 1: 멀티테넌시 개념**
- 3가지 주요 패턴 (Database-per-Tenant, Schema-per-Tenant, Row-Level Security)
- CheckUS의 크로스 캠퍼스 요구사항과 Row-Level Security 선택 이유

**Part 2: CheckUS 4-Tier 아키텍처**
- Frontend Axios Interceptor
- Backend HTTP Interceptor + AOP
- ThreadLocal을 이용한 캠퍼스 컨텍스트 관리
- ESLint 규칙으로 프론트엔드 보호

**Part 3: 보안과 성능 최적화**
- JWT 토큰 설계 (여러 캠퍼스 역할 담기)
- ThreadLocal 안전성 (메모리 누수, 비동기 작업)
- 통합 테스트 전략
- 실전 엣지 케이스 (Soft Delete, 통계 쿼리 등)

**Part 4: 다양한 구현 방법 비교**
- PostgreSQL Native RLS
- Hibernate Global Filter
- API Gateway
- 실제 AOP 구현 사례 4가지
- 각 방법의 장단점과 적합한 상황

**Part 5: 레거시 마이그레이션**
- 5단계 마이그레이션 전략
- 무중단 배포 계획
- 실전에서 마주한 문제와 해결책
- 상세한 체크리스트

### 핵심 교훈

1. **"완벽한 방법"은 없다**: 팀의 상황, 요구사항, 기술 스택에 따라 최적의 선택이 다름
2. **명시적 제어 vs 자동화**: CheckUS는 명시성을 선택했지만, 완전 자동화가 더 나은 팀도 있음
3. **점진적 마이그레이션**: 한 번에 모든 걸 바꾸려 하지 말고, 단계별로 검증하며 진행
4. **모니터링이 핵심**: 마이그레이션 중 실시간 모니터링으로 문제 조기 발견

### 다음 단계

CheckUS는 현재 **Phase 5 엄격 모드**로 운영 중이며, 다음 개선 사항을 계획하고 있습니다:

- 🚀 **Redis 캐싱 추가**: ThreadLocal 유지하면서 성능 향상
- 📊 **통계 쿼리 최적화**: 복합 인덱스 추가 및 쿼리 튜닝
- 🔍 **자동화 강화**: Hibernate Filter 도입 검토 (Native Query 비중 낮아지면)
- 🌐 **API Gateway 도입**: 마이크로서비스 전환 준비

---

## 마무리하며

멀티테넌시 아키텍처는 단순히 "기술적 구현"이 아니라, **비즈니스 요구사항과 기술적 트레이드오프를 균형 있게 선택하는 과정**입니다.

CheckUS의 4-Tier 아키텍처가 모든 팀에게 정답은 아닙니다. 하지만 이 시리즈가 여러분의 팀에서 멀티테넌시를 고민할 때 **구체적인 참고 자료**가 되길 바랍니다.

질문이나 피드백은 언제든 환영합니다. 감사합니다!

---

## 전체 시리즈 링크

- **[Part 1: 멀티테넌시 개념](./part1-multi-tenancy-concept.md)**
- **[Part 2: CheckUS 4-Tier 아키텍처 구현](./part2-4tier-architecture.md)**
- **[Part 3: 보안과 성능 최적화](./part3-security-performance.md)**
- **[Part 4: 다양한 구현 방법 비교](./part4-implementation-comparison.md)**
- **[Part 5: 레거시 마이그레이션 전략](./part5-legacy-migration.md)** ← 현재 글

---

## 참고 자료

### 업계 표준 문서
- [Microsoft Azure - Multi-tenant SaaS Database Patterns](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns)
- [Google Cloud - Implement Multi-Tenancy in Spanner](https://cloud.google.com/spanner/docs/multi-tenancy-overview)
- [AWS - SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html)

### 기술 블로그
- [Bytebase - Multi-Tenant Database Architecture Patterns](https://www.bytebase.com/blog/multi-tenant-database/)
- [Vlad Mihalcea - The Ultimate Guide to Database Multitenancy](https://vladmihalcea.com/database-multitenancy/)

---

**CheckUS 아키텍처 시리즈 (완결)**

시리즈를 끝까지 읽어주셔서 감사합니다! 🎉
