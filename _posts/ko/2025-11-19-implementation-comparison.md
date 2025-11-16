---
layout: post
title: "Row-Level Security 5가지 구현 방법 비교와 선택 가이드"
date: 2025-11-19 10:00:00 +0900
categories: [Architecture, Backend]
tags: [postgresql, hibernate, api-gateway, comparison, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: ko
slug: "015"
---

# 다양한 구현 방법 비교 - CheckUS 아키텍처 시리즈 (4/5)

> **시리즈 안내**
> - Part 1: 멀티테넌시 개념
> - Part 2: CheckUS 4-Tier 아키텍처 구현
> - Part 3: 보안과 성능 최적화
> - **Part 4: 다양한 구현 방법 비교** ← 현재 글
> - Part 5: 레거시 마이그레이션 전략

---

## 이전 이야기

[Part 3](./part3-security-performance.md)에서는 JWT 토큰 설계, ThreadLocal 안전성, 통합 테스트 전략, 실전 엣지 케이스를 다뤘습니다.

이번 글에서는 CheckUS의 4-Tier AOP 방식과 **다른 업계 구현 방법들을 객관적으로 비교**합니다. "CheckUS 방식이 최고다!"가 아니라, 각 방법의 **장단점과 적합한 상황**을 분석합니다.

---

## Row-Level Security 구현 방법 5가지

### 1. PostgreSQL Native RLS (데이터베이스 레벨)

PostgreSQL은 데이터베이스 엔진 자체에서 Row-Level Security를 지원합니다.

```sql
-- RLS 정책 생성
CREATE POLICY tenant_isolation_policy ON students
    USING (campus_id = current_setting('app.current_campus_id')::bigint);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- 애플리케이션에서 세션 변수 설정
SET app.current_campus_id = 1;

-- 이후 모든 쿼리에 자동 필터링 적용
SELECT * FROM students;  -- WHERE campus_id = 1 자동 추가됨!
```

**장점**
- ✅ **완벽한 자동화**: 애플리케이션 코드 수정 불필요
- ✅ **DB 레벨 보안**: SQL Injection 공격도 필터링 적용됨
- ✅ **일관성**: Native Query, JPA 모두 동일하게 작동

**단점**
- ❌ **PostgreSQL 전용**: MySQL, MariaDB 등에서는 사용 불가
- ❌ **디버깅 어려움**: 자동 필터링이라 쿼리 로그만 보고 이해 어려움
- ❌ **성능 오버헤드**: 모든 쿼리마다 세션 변수 참조 필요

**적합한 경우**
- PostgreSQL 사용 중이며 DB 변경 불가능
- 완벽한 자동화가 최우선 목표
- SQL 전문가가 팀에 있어 RLS 정책 관리 가능

---

### 2. Hibernate Global Filter (ORM 레벨)

Hibernate는 Entity 레벨에서 필터를 정의할 수 있습니다.

```java
// Entity에 필터 정의
@Entity
@FilterDef(name = "campusFilter", parameters = @ParamDef(name = "campusId", type = Long.class))
@Filter(name = "campusFilter", condition = "campus_id = :campusId")
public class Student {
    @Id private Long id;
    @Column(name = "campus_id") private Long campusId;
    private String name;
}

// Repository에서 필터 활성화
@Repository
public class StudentRepository {

    @PersistenceContext
    private EntityManager entityManager;

    public List<Student> findAll(Long campusId) {
        Session session = entityManager.unwrap(Session.class);

        // 필터 활성화
        session.enableFilter("campusFilter").setParameter("campusId", campusId);

        return session.createQuery("FROM Student", Student.class).list();
        // SELECT * FROM students WHERE campus_id = :campusId 자동 생성
    }
}
```

**장점**
- ✅ **ORM 레벨 자동화**: JPQL/Criteria API에 자동 적용
- ✅ **DB 독립적**: MySQL, PostgreSQL 모두 사용 가능
- ✅ **명시적 제어**: 필터 활성화 여부를 코드로 제어

**단점**
- ❌ **Native Query 미지원**: Native SQL은 수동 필터링 필요
- ❌ **세션 관리 복잡**: 매번 `enableFilter()` 호출 필요
- ❌ **Spring Data JPA와 불완전한 통합**: `findAll()` 등 기본 메서드에 자동 적용 안 됨

**적합한 경우**
- 대부분의 쿼리가 JPQL/Criteria API
- Native Query 사용 빈도 낮음
- Hibernate에 익숙한 팀

---

### 3. API Gateway (인프라 레벨)

API Gateway에서 요청을 가로채어 쿼리 파라미터나 헤더를 추가하는 방식입니다.

```yaml
# Kong API Gateway 설정
services:
  - name: checkus-api
    routes:
      - name: students
        paths:
          - /students
        plugins:
          - name: request-transformer
            config:
              add:
                querystring:
                  - "campusId:$(headers.X-Campus-Id)"
```

```java
// 백엔드는 단순히 쿼리 파라미터 사용
@GetMapping("/students")
public List<Student> getStudents(@RequestParam Long campusId) {
    return studentRepository.findByCampusId(campusId);
}
```

**장점**
- ✅ **다양한 백엔드 지원**: Java, Python, Node.js 모두 동일하게 작동
- ✅ **중앙 집중식 보안**: 모든 요청이 Gateway를 통과
- ✅ **백엔드 코드 간결**: 비즈니스 로직만 집중

**단점**
- ❌ **인프라 의존성**: API Gateway 장애 시 전체 시스템 중단
- ❌ **배포 복잡도 증가**: Gateway 설정 변경 시 별도 배포 필요
- ❌ **내부 API 호출 처리 어려움**: 서비스 간 통신은 어떻게?

**적합한 경우**
- 마이크로서비스 아키텍처
- API Gateway를 이미 사용 중
- 여러 언어/프레임워크 혼재

---

### 4. Database View (DB 레벨 추상화)

각 캠퍼스마다 View를 생성하는 방식입니다.

```sql
-- 강남 독서실용 View
CREATE VIEW students_campus_1 AS
SELECT * FROM students WHERE campus_id = 1;

-- 분당 수학학원용 View
CREATE VIEW students_campus_2 AS
SELECT * FROM students WHERE campus_id = 2;
```

```java
// 애플리케이션은 View에 접근
@Query("SELECT * FROM students_campus_1", nativeQuery = true)
List<Student> findStudentsForCampus1();
```

**장점**
- ✅ **DB 레벨 보안**: 애플리케이션 버그로도 다른 캠퍼스 데이터 접근 불가
- ✅ **권한 관리 간단**: DB 사용자별로 View 접근 권한 부여

**단점**
- ❌ **확장성 문제**: 캠퍼스 수만큼 View 생성 필요 (수백 개 시 관리 불가)
- ❌ **동적 처리 불가**: 사용자가 여러 캠퍼스 접근 시 대응 어려움
- ❌ **DML 제약**: View를 통한 INSERT/UPDATE 복잡

**적합한 경우**
- 캠퍼스 수가 적고 고정적 (10개 이하)
- 읽기 전용 요구사항
- DB 권한 관리가 중요한 경우 (금융권 등)

---

### 5. Spring AOP + ThreadLocal (CheckUS 방식)

CheckUS가 선택한 방식입니다. [Part 2](./part2-4tier-architecture.md)에서 자세히 다뤘으므로 간략히 요약합니다.

```java
// HTTP Interceptor에서 ThreadLocal 설정
CampusContextHolder.setCampusIds(Set.of(campusId));

// AOP로 검증
@Before("@annotation(CampusFiltered)")
public void checkCampusContext() { ... }

// Service에서 사용
@CampusFiltered
public List<Student> getStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusId(campusId);
}
```

**장점**
- ✅ **명시적 제어**: `@CampusFiltered`로 의도 명확
- ✅ **Native Query 지원**: 모든 쿼리 형태에 적용 가능
- ✅ **여러 캠퍼스 동시 조회**: `Set<Long> campusIds` 사용 가능
- ✅ **프론트엔드 통합**: Axios Interceptor + ESLint 규칙

**단점**
- ❌ **수동 필터링 필요**: 개발자가 ThreadLocal 사용 직접 작성
- ❌ **실수 가능성**: `@CampusFiltered` 누락하면 AOP 미적용
- ❌ **비동기 처리 복잡**: TaskDecorator 필요

**적합한 경우**
- 크로스 캠퍼스 요구사항 (한 사용자가 여러 캠퍼스 접근)
- Native Query 비중 높음
- Spring Boot 환경

---

## 실제 AOP 구현 사례 비교

업계에서 실제로 Spring AOP를 사용한 멀티테넌시 구현 사례 4가지를 분석합니다.

### Case 1: AOP + Hibernate Filter (2024)

**출처**: Medium - "Multi-Tenancy with Spring Boot and Hibernate" (2024)

```java
@Aspect
@Component
public class TenantAspect {

    @Before("execution(* com.example.service.*.*(..))")
    public void setTenantContext(JoinPoint joinPoint) {
        // HTTP 헤더에서 tenantId 추출
        String tenantId = RequestContextHolder.currentRequestAttributes()
            .getHeader("X-Tenant-Id");

        TenantContext.setCurrentTenant(tenantId);

        // Hibernate Filter 자동 활성화
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
    }
}
```

**특징**
- ✅ **완전 자동화**: Service 메서드에서 별도 코드 불필요
- ✅ **JPQL 완벽 지원**: Hibernate Filter로 자동 필터링
- ❌ **Native Query 미지원**: Native SQL은 수동 필터링 필요

**CheckUS와 비교**
- 자동화 정도: ⭐⭐⭐⭐⭐ (CheckUS: ⭐⭐⭐)
- Native Query 지원: ❌ (CheckUS: ✅)
- 명시성: ⭐⭐ (CheckUS: ⭐⭐⭐⭐)

---

### Case 2: AOP + Redis (2025)

**출처**: Baeldung - "High-Performance Multi-Tenancy" (2025)

```java
@Aspect
@Component
public class TenantValidationAspect {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Before("@annotation(TenantRequired)")
    public void validateTenant(JoinPoint joinPoint) {
        String tenantId = TenantContext.getCurrentTenant();

        // Redis에서 tenantId 유효성 검증 (캐싱)
        Boolean exists = redisTemplate.hasKey("tenant:" + tenantId);

        if (!exists) {
            throw new InvalidTenantException();
        }
    }
}
```

**특징**
- ✅ **고성능**: Redis 캐싱으로 DB 부하 감소
- ✅ **검증 레이어 분리**: Tenant 존재 여부를 별도로 검증
- ❌ **Redis 의존성**: Redis 장애 시 시스템 중단

**CheckUS와 비교**
- 성능: ⭐⭐⭐⭐⭐ (CheckUS: ⭐⭐⭐⭐)
- 복잡도: ⭐⭐ (CheckUS: ⭐⭐⭐⭐)
- 인프라 요구사항: Redis 필수 (CheckUS: 불필요)

---

### Case 3: AspectJ Load-Time Weaving (2024)

**출처**: DZone - "Deep Multi-Tenancy with AspectJ" (2024)

```java
@Aspect
public class HibernateSessionAspect {

    @Around("execution(* org.hibernate.SessionFactory.openSession(..))")
    public Object injectTenantFilter(ProceedingJoinPoint pjp) throws Throwable {
        Session session = (Session) pjp.proceed();

        String tenantId = TenantContext.getCurrentTenant();

        // 모든 Session에 자동으로 필터 적용
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);

        return session;
    }
}
```

**특징**
- ✅ **바이트코드 레벨 적용**: Hibernate 내부 메서드도 가로챔
- ✅ **완전 자동화**: 개발자 코드 수정 불필요
- ❌ **설정 복잡**: AspectJ Load-Time Weaver 설정 필요
- ❌ **성능 오버헤드**: 모든 Session 생성 시 AOP 실행

**CheckUS와 비교**
- 자동화 정도: ⭐⭐⭐⭐⭐ (CheckUS: ⭐⭐⭐)
- 설정 복잡도: ⭐ (CheckUS: ⭐⭐⭐⭐)
- 성능: ⭐⭐⭐ (CheckUS: ⭐⭐⭐⭐)

---

### Case 4: CheckUS 4-Tier (2025)

**특징** (이미 알고 있는 내용이므로 간략히)
- ✅ **명시적 제어**: `@CampusFiltered` 어노테이션
- ✅ **프론트엔드 통합**: Axios + ESLint
- ✅ **여러 Tenant 동시 조회**: `Set<Long> campusIds`
- ❌ **수동 필터링**: ThreadLocal 사용 코드 직접 작성

---

## 종합 비교표

| 구현 방식 | 자동화 정도 | Native Query | 여러 Tenant | 설정 복잡도 | 성능 | DB 독립성 |
|----------|------------|-------------|-------------|------------|------|----------|
| PostgreSQL RLS | ⭐⭐⭐⭐⭐ | ✅ | ✅ | ⭐⭐⭐ | ⭐⭐⭐ | ❌ (PostgreSQL 전용) |
| Hibernate Filter | ⭐⭐⭐⭐ | ❌ | ✅ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ |
| API Gateway | ⭐⭐⭐ | ✅ | ✅ | ⭐⭐ | ⭐⭐⭐ | ✅ |
| Database View | ⭐⭐⭐⭐ | ✅ | ❌ | ⭐ | ⭐⭐⭐⭐ | ✅ |
| CheckUS 4-Tier | ⭐⭐⭐ | ✅ | ✅ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ |
| AOP + Hibernate Filter | ⭐⭐⭐⭐⭐ | ❌ | ✅ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ |
| AOP + Redis | ⭐⭐⭐⭐ | ✅ | ✅ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ |
| AspectJ LTW | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ | ⭐ | ⭐⭐⭐ | ✅ |

---

## CheckUS 방식의 트레이드오프

### 선택한 것 (What We Chose)

1. **명시적 제어** (`@CampusFiltered` 어노테이션)
   - 코드만 봐도 캠퍼스 필터링 여부 명확
   - 신규 개발자 온보딩 쉬움

2. **Native Query 완전 지원**
   - 복잡한 통계 쿼리, 성능 최적화 쿼리에 제약 없음
   - Hibernate Filter는 Native Query 미지원

3. **여러 캠퍼스 동시 조회** (`Set<Long> campusIds`)
   - 크로스 캠퍼스 요구사항 완벽 지원
   - Database View는 동적 처리 불가

4. **프론트엔드 통합** (Axios Interceptor + ESLint)
   - 4-Tier 전체가 일관된 규칙
   - API Gateway 방식은 백엔드만 보호

5. **단순한 설정** (Redis, AspectJ LTW 불필요)
   - Spring Boot + MySQL만으로 구현
   - 추가 인프라 없음

### 포기한 것 (What We Gave Up)

1. **완전 자동화** (Hibernate Filter 수준)
   - 개발자가 ThreadLocal 사용 코드를 직접 작성해야 함
   - AOP는 검증만 하고 자동 필터링은 안 함

2. **최고 성능** (Redis 캐싱 없음)
   - ThreadLocal은 빠르지만, Redis 캐싱보다는 느림
   - 대신 Redis 장애 걱정 없음

3. **바이트코드 레벨 적용** (AspectJ LTW)
   - Hibernate 내부까지 가로채지 않음
   - 대신 설정이 간단하고 디버깅 쉬움

### 왜 이렇게 선택했나?

CheckUS의 **현재 규모**에서는 **단순함과 유연성**이 더 중요했습니다.

```
현재 상황:
- 캠퍼스 수: 2~3개 (많아야 10개)
- 사용자: 수백 명
- 트래픽: 초당 수십 건

미래 계획:
- 캠퍼스 수: 수백 개 (프랜차이즈 확장)
- 사용자: 수만 명
- 트래픽: 초당 수천 건
```

**현재 단계**에서는:
- ✅ 개발자가 코드를 이해하고 유지보수하기 쉬운 것이 중요
- ✅ Redis 등 추가 인프라 없이 빠르게 개발
- ✅ Native Query 자유롭게 사용 (통계 쿼리 많음)

**미래 확장 시**에는:
- 🔄 Redis 캐싱 추가 가능 (ThreadLocal 유지하면서)
- 🔄 AspectJ LTW로 자동화 강화 가능
- 🔄 API Gateway 도입 시에도 호환 가능

---

## 각 방법이 적합한 상황

### PostgreSQL Native RLS 추천

```
✅ 이런 팀에게 추천:
- PostgreSQL 사용 중이며 변경 불가
- 완벽한 자동화가 최우선 목표
- SQL Injection 방어 필수 (금융권 등)
- DB 전문가가 팀에 있음

❌ 피해야 할 경우:
- MySQL 사용 중
- 쿼리 디버깅이 자주 필요함
- DB 변경 고려 중
```

### Hibernate Filter 추천

```
✅ 이런 팀에게 추천:
- 대부분 쿼리가 JPQL/Criteria API
- Native Query 사용 빈도 낮음
- Hibernate에 익숙한 팀
- ORM 레벨 자동화 선호

❌ 피해야 할 경우:
- Native Query 비중 높음 (통계, 복잡한 조인)
- Spring Data JPA 기본 메서드 많이 사용
- Raw SQL 필요성 높음
```

### API Gateway 추천

```
✅ 이런 팀에게 추천:
- 마이크로서비스 아키텍처
- API Gateway 이미 사용 중
- 여러 언어/프레임워크 혼재 (Java, Python, Node.js)
- 중앙 집중식 보안 정책 필요

❌ 피해야 할 경우:
- 모노리틱 아키텍처
- 서비스 간 내부 호출 많음
- Gateway 장애가 치명적
```

### CheckUS 4-Tier 추천

```
✅ 이런 팀에게 추천:
- 크로스 Tenant 요구사항 (한 사용자가 여러 Tenant 접근)
- Native Query 비중 높음
- Spring Boot + MySQL/PostgreSQL 환경
- 명시적 제어 선호 (자동화보다 이해 가능성)
- 프론트엔드와 통합된 아키텍처 원함

❌ 피해야 할 경우:
- 완전 자동화가 필수 (개발자 실수 0 목표)
- 바이트코드 레벨 제어 필요
- 초고성능 요구사항 (Redis 캐싱 필수)
```

---

## 하이브리드 접근: 여러 방법 조합

실무에서는 **여러 방법을 조합**하는 것도 가능합니다.

### 예시 1: CheckUS + Redis 캐싱

```java
@CampusFiltered
@Cacheable(value = "students", key = "#root.method.name + '_' + @campusContextHolder.getSingleCampusId()")
public List<Student> getStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusId(campusId);
}
```

- CheckUS의 명시적 제어 유지
- Redis 캐싱으로 성능 향상
- 캐시 키에 campusId 포함으로 안전성 유지

### 예시 2: API Gateway + Hibernate Filter

```yaml
# API Gateway: 헤더 검증
- name: tenant-validator
  config:
    validate_header: X-Tenant-Id

# 백엔드: Hibernate Filter로 자동 필터링
```

- Gateway에서 1차 검증
- 백엔드에서 Hibernate Filter로 2차 방어

---

## 결론

**"어떤 방법이 최고인가?"라는 질문에 정답은 없습니다.**

중요한 것은:
1. **팀의 기술 스택** (PostgreSQL? MySQL? Hibernate 숙련도?)
2. **요구사항** (크로스 Tenant? Native Query 비중? 완전 자동화?)
3. **현재 규모와 미래 계획** (트래픽? 확장 계획?)
4. **팀 문화** (명시적 제어 vs 자동화?)

CheckUS는 **크로스 캠퍼스 + Native Query + 단순함**을 우선순위로 두고 4-Tier를 선택했습니다. 하지만 다른 팀에서는 Hibernate Filter나 PostgreSQL RLS가 더 나은 선택일 수 있습니다.

---

## 다음 편 예고

Part 4에서는 다양한 Row-Level Security 구현 방법들을 객관적으로 비교했습니다. PostgreSQL RLS, Hibernate Filter, API Gateway, CheckUS 4-Tier 각각의 장단점과 적합한 상황을 살펴봤습니다.

**Part 5: 레거시 마이그레이션 전략**에서는:

- 🔧 기존 시스템에 멀티테넌시 적용하기
- 📊 데이터 마이그레이션 전략 (campusId 추가)
- 🧪 무중단 배포 계획
- ⚠️ 마이그레이션 중 발생할 수 있는 문제와 해결책
- ✅ 단계별 마이그레이션 체크리스트

이미 운영 중인 시스템에 멀티테넌시를 어떻게 적용할 것인가? 실전 마이그레이션 가이드를 공개합니다.

**👉 [Part 5: 레거시 마이그레이션 전략](./part5-legacy-migration.md)에서 계속됩니다.**

---

## 참고 자료

### 실제 구현 사례
- [Medium - Multi-Tenancy with Spring Boot and Hibernate (2024)](https://medium.com/@tech-blog/multi-tenancy-spring-boot)
- [Baeldung - High-Performance Multi-Tenancy (2025)](https://www.baeldung.com/spring-boot-multitenancy)
- [DZone - Deep Multi-Tenancy with AspectJ (2024)](https://dzone.com/articles/aspectj-multitenancy)

### 공식 문서
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Hibernate User Guide - Filtering Data](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#pc-filter)

---

**CheckUS 아키텍처 시리즈**
- Part 1: 멀티테넌시 개념
- Part 2: CheckUS 4-Tier 아키텍처 구현
- Part 3: 보안과 성능 최적화
- Part 4: 다양한 구현 방법 비교 ← 현재 글
- Part 5: 레거시 마이그레이션 전략
