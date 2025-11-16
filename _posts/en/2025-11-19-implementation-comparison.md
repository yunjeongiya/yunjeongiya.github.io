---
layout: post
title: "Comparing 5 Row-Level Security Implementations and Selection Guide"
date: 2025-11-19 10:00:00 +0900
categories: [Architecture, Backend]
tags: [postgresql, hibernate, api-gateway, comparison, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: en
slug: "015-en"
---

# Comparing Implementation Methods - CheckUS Architecture Series (4/5)

> **Series Navigation**
> - Part 1: Multi-Tenancy Concept
> - Part 2: CheckUS 4-Tier Architecture Implementation
> - Part 3: Security and Performance Optimization
> - **Part 4: Comparing Implementation Methods** ← Current
> - Part 5: Legacy Migration Strategy

---

## Previously

[Part 3](./part3-security-performance.md) covered JWT token design, ThreadLocal safety, integration testing strategies, and real edge cases.

This article **objectively compares** CheckUS's 4-Tier AOP approach with other industry implementation methods. Not claiming "CheckUS's way is the best!", but analyzing the **pros, cons, and suitable situations** for each approach.

---

## 5 Row-Level Security Implementation Methods

### 1. PostgreSQL Native RLS (Database Level)

PostgreSQL supports Row-Level Security natively in the database engine.

```sql
-- Create RLS policy
CREATE POLICY tenant_isolation_policy ON students
    USING (campus_id = current_setting('app.current_campus_id')::bigint);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- Set session variable from application
SET app.current_campus_id = 1;

-- All subsequent queries automatically filtered
SELECT * FROM students;  -- WHERE campus_id = 1 automatically added!
```

**Pros**
- ✅ **Perfect automation**: No application code changes needed
- ✅ **DB-level security**: SQL Injection attacks also filtered
- ✅ **Consistency**: Works identically for Native Query and JPA

**Cons**
- ❌ **PostgreSQL only**: Cannot use with MySQL, MariaDB, etc.
- ❌ **Difficult debugging**: Automatic filtering makes understanding query logs hard
- ❌ **Performance overhead**: Every query requires session variable reference

**Suitable When**
- Using PostgreSQL and cannot change DB
- Complete automation is top priority
- SQL Injection defense is critical (financial sector, etc.)
- Team has SQL experts who can manage RLS policies

---

### 2. Hibernate Global Filter (ORM Level)

Hibernate allows defining filters at the Entity level.

```java
// Define filter on Entity
@Entity
@FilterDef(name = "campusFilter", parameters = @ParamDef(name = "campusId", type = Long.class))
@Filter(name = "campusFilter", condition = "campus_id = :campusId")
public class Student {
    @Id private Long id;
    @Column(name = "campus_id") private Long campusId;
    private String name;
}

// Enable filter in Repository
@Repository
public class StudentRepository {

    @PersistenceContext
    private EntityManager entityManager;

    public List<Student> findAll(Long campusId) {
        Session session = entityManager.unwrap(Session.class);

        // Enable filter
        session.enableFilter("campusFilter").setParameter("campusId", campusId);

        return session.createQuery("FROM Student", Student.class).list();
        // SELECT * FROM students WHERE campus_id = :campusId automatically generated
    }
}
```

**Pros**
- ✅ **ORM-level automation**: Automatically applies to JPQL/Criteria API
- ✅ **DB independent**: Works with both MySQL and PostgreSQL
- ✅ **Explicit control**: Control filter activation in code

**Cons**
- ❌ **No Native Query support**: Native SQL requires manual filtering
- ❌ **Complex session management**: Must call `enableFilter()` every time
- ❌ **Incomplete Spring Data JPA integration**: Doesn't auto-apply to `findAll()` and other default methods

**Suitable When**
- Most queries use JPQL/Criteria API
- Low Native Query usage
- Team familiar with Hibernate

---

### 3. API Gateway (Infrastructure Level)

Approach where API Gateway intercepts requests to add query parameters or headers.

```yaml
# Kong API Gateway configuration
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
// Backend simply uses query parameter
@GetMapping("/students")
public List<Student> getStudents(@RequestParam Long campusId) {
    return studentRepository.findByCampusId(campusId);
}
```

**Pros**
- ✅ **Supports various backends**: Works identically for Java, Python, Node.js
- ✅ **Centralized security**: All requests go through Gateway
- ✅ **Clean backend code**: Focus only on business logic

**Cons**
- ❌ **Infrastructure dependency**: Entire system stops if Gateway fails
- ❌ **Increased deployment complexity**: Separate deployment needed for Gateway config changes
- ❌ **Difficult internal API handling**: What about inter-service communication?

**Suitable When**
- Microservices architecture
- Already using API Gateway
- Mixed languages/frameworks

---

### 4. Database View (DB-Level Abstraction)

Approach creating Views for each campus.

```sql
-- View for Gangnam Study Center
CREATE VIEW students_campus_1 AS
SELECT * FROM students WHERE campus_id = 1;

-- View for Bundang Math Academy
CREATE VIEW students_campus_2 AS
SELECT * FROM students WHERE campus_id = 2;
```

```java
// Application accesses Views
@Query("SELECT * FROM students_campus_1", nativeQuery = true)
List<Student> findStudentsForCampus1();
```

**Pros**
- ✅ **DB-level security**: Cannot access other campus data even with application bugs
- ✅ **Simple permission management**: Grant View access per DB user

**Cons**
- ❌ **Scalability issues**: Need to create Views for each campus (unmanageable with hundreds)
- ❌ **Cannot handle dynamically**: Difficult to handle users accessing multiple campuses
- ❌ **DML constraints**: Complex INSERT/UPDATE through Views

**Suitable When**
- Small, fixed number of campuses (≤10)
- Read-only requirements
- DB permission management is critical (financial sector, etc.)

---

### 5. Spring AOP + ThreadLocal (CheckUS Approach)

CheckUS's chosen method. Briefly summarized as covered in detail in [Part 2](./part2-4tier-architecture.md).

```java
// HTTP Interceptor sets ThreadLocal
CampusContextHolder.setCampusIds(Set.of(campusId));

// AOP validates
@Before("@annotation(CampusFiltered)")
public void checkCampusContext() { ... }

// Use in Service
@CampusFiltered
public List<Student> getStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusId(campusId);
}
```

**Pros**
- ✅ **Explicit control**: Intent clear with `@CampusFiltered`
- ✅ **Native Query support**: Applicable to all query types
- ✅ **Multiple campus concurrent query**: Can use `Set<Long> campusIds`
- ✅ **Frontend integration**: Axios Interceptor + ESLint rules

**Cons**
- ❌ **Manual filtering required**: Developers must write ThreadLocal usage code directly
- ❌ **Mistake possibility**: AOP not applied if `@CampusFiltered` omitted
- ❌ **Complex async handling**: TaskDecorator needed

**Suitable When**
- Cross-campus requirements (one user accesses multiple campuses)
- High Native Query usage
- Spring Boot environment

---

## Comparing Real AOP Implementation Cases

Analyzing 4 actual industry cases using Spring AOP for multi-tenancy implementation.

### Case 1: AOP + Hibernate Filter (2024)

**Source**: Medium - "Multi-Tenancy with Spring Boot and Hibernate" (2024)

```java
@Aspect
@Component
public class TenantAspect {

    @Before("execution(* com.example.service.*.*(..))")
    public void setTenantContext(JoinPoint joinPoint) {
        // Extract tenantId from HTTP header
        String tenantId = RequestContextHolder.currentRequestAttributes()
            .getHeader("X-Tenant-Id");

        TenantContext.setCurrentTenant(tenantId);

        // Automatically enable Hibernate Filter
        Session session = entityManager.unwrap(Session.class);
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);
    }
}
```

**Characteristics**
- ✅ **Complete automation**: No separate code needed in Service methods
- ✅ **Perfect JPQL support**: Automatic filtering with Hibernate Filter
- ❌ **No Native Query support**: Native SQL requires manual filtering

**Comparison with CheckUS**
- Automation level: ⭐⭐⭐⭐⭐ (CheckUS: ⭐⭐⭐)
- Native Query support: ❌ (CheckUS: ✅)
- Explicitness: ⭐⭐ (CheckUS: ⭐⭐⭐⭐)

---

### Case 2: AOP + Redis (2025)

**Source**: Baeldung - "High-Performance Multi-Tenancy" (2025)

```java
@Aspect
@Component
public class TenantValidationAspect {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    @Before("@annotation(TenantRequired)")
    public void validateTenant(JoinPoint joinPoint) {
        String tenantId = TenantContext.getCurrentTenant();

        // Validate tenantId from Redis (caching)
        Boolean exists = redisTemplate.hasKey("tenant:" + tenantId);

        if (!exists) {
            throw new InvalidTenantException();
        }
    }
}
```

**Characteristics**
- ✅ **High performance**: Reduced DB load with Redis caching
- ✅ **Separated validation layer**: Separately validates Tenant existence
- ❌ **Redis dependency**: System stops on Redis failure

**Comparison with CheckUS**
- Performance: ⭐⭐⭐⭐⭐ (CheckUS: ⭐⭐⭐⭐)
- Complexity: ⭐⭐ (CheckUS: ⭐⭐⭐⭐)
- Infrastructure requirements: Redis required (CheckUS: none)

---

### Case 3: AspectJ Load-Time Weaving (2024)

**Source**: DZone - "Deep Multi-Tenancy with AspectJ" (2024)

```java
@Aspect
public class HibernateSessionAspect {

    @Around("execution(* org.hibernate.SessionFactory.openSession(..))")
    public Object injectTenantFilter(ProceedingJoinPoint pjp) throws Throwable {
        Session session = (Session) pjp.proceed();

        String tenantId = TenantContext.getCurrentTenant();

        // Automatically apply filter to all Sessions
        session.enableFilter("tenantFilter").setParameter("tenantId", tenantId);

        return session;
    }
}
```

**Characteristics**
- ✅ **Bytecode-level application**: Intercepts even Hibernate internal methods
- ✅ **Complete automation**: No developer code changes needed
- ❌ **Complex configuration**: AspectJ Load-Time Weaver setup required
- ❌ **Performance overhead**: AOP executes on every Session creation

**Comparison with CheckUS**
- Automation level: ⭐⭐⭐⭐⭐ (CheckUS: ⭐⭐⭐)
- Configuration complexity: ⭐ (CheckUS: ⭐⭐⭐⭐)
- Performance: ⭐⭐⭐ (CheckUS: ⭐⭐⭐⭐)

---

### Case 4: CheckUS 4-Tier (2025)

**Characteristics** (already known, briefly)
- ✅ **Explicit control**: `@CampusFiltered` annotation
- ✅ **Frontend integration**: Axios + ESLint
- ✅ **Multiple Tenant concurrent query**: `Set<Long> campusIds`
- ❌ **Manual filtering**: Write ThreadLocal usage code directly

---

## Comprehensive Comparison Table

| Implementation | Automation | Native Query | Multiple Tenants | Config Complexity | Performance | DB Independence |
|---------------|-----------|--------------|------------------|-------------------|-------------|-----------------|
| PostgreSQL RLS | ⭐⭐⭐⭐⭐ | ✅ | ✅ | ⭐⭐⭐ | ⭐⭐⭐ | ❌ (PostgreSQL only) |
| Hibernate Filter | ⭐⭐⭐⭐ | ❌ | ✅ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ |
| API Gateway | ⭐⭐⭐ | ✅ | ✅ | ⭐⭐ | ⭐⭐⭐ | ✅ |
| Database View | ⭐⭐⭐⭐ | ✅ | ❌ | ⭐ | ⭐⭐⭐⭐ | ✅ |
| CheckUS 4-Tier | ⭐⭐⭐ | ✅ | ✅ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ |
| AOP + Hibernate Filter | ⭐⭐⭐⭐⭐ | ❌ | ✅ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ |
| AOP + Redis | ⭐⭐⭐⭐ | ✅ | ✅ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ |
| AspectJ LTW | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ | ⭐ | ⭐⭐⭐ | ✅ |

---

## CheckUS Approach Trade-offs

### What We Chose

1. **Explicit control** (`@CampusFiltered` annotation)
   - Code clearly shows campus filtering requirement
   - Easy onboarding for new developers

2. **Full Native Query support**
   - No constraints on complex statistical queries, performance optimization queries
   - Hibernate Filter doesn't support Native Query

3. **Multiple campus concurrent query** (`Set<Long> campusIds`)
   - Perfect support for cross-campus requirements
   - Database View cannot handle dynamically

4. **Frontend integration** (Axios Interceptor + ESLint)
   - Entire 4-Tier follows consistent rules
   - API Gateway approach only protects backend

5. **Simple configuration** (no Redis, AspectJ LTW needed)
   - Implements with only Spring Boot + MySQL
   - No additional infrastructure

### What We Gave Up

1. **Complete automation** (Hibernate Filter level)
   - Developers must write ThreadLocal usage code directly
   - AOP only validates, doesn't auto-filter

2. **Maximum performance** (no Redis caching)
   - ThreadLocal is fast, but slower than Redis caching
   - But no worries about Redis failures

3. **Bytecode-level application** (AspectJ LTW)
   - Doesn't intercept Hibernate internals
   - But simple configuration and easy debugging

### Why These Choices?

At CheckUS's **current scale**, **simplicity and flexibility** were more important.

```
Current situation:
- Campus count: 2-3 (at most 10)
- Users: hundreds
- Traffic: tens of requests per second

Future plans:
- Campus count: hundreds (franchise expansion)
- Users: tens of thousands
- Traffic: thousands of requests per second
```

**At current stage**:
- ✅ Developer understanding and easy maintenance most important
- ✅ Rapid development without additional infrastructure like Redis
- ✅ Free Native Query usage (many statistical queries)

**For future expansion**:
- 🔄 Can add Redis caching (while maintaining ThreadLocal)
- 🔄 Can strengthen automation with AspectJ LTW
- 🔄 Compatible even when introducing API Gateway

---

## Suitable Situations for Each Method

### Recommend PostgreSQL Native RLS

```
✅ Recommended for:
- Using PostgreSQL and cannot change
- Complete automation is top priority
- SQL Injection defense critical (financial sector, etc.)
- Team has DB experts

❌ Avoid when:
- Using MySQL
- Frequent query debugging needed
- Considering DB change
```

### Recommend Hibernate Filter

```
✅ Recommended for:
- Most queries use JPQL/Criteria API
- Low Native Query usage
- Team familiar with Hibernate
- Prefer ORM-level automation

❌ Avoid when:
- High Native Query usage (statistics, complex joins)
- Heavy use of Spring Data JPA default methods
- High Raw SQL necessity
```

### Recommend API Gateway

```
✅ Recommended for:
- Microservices architecture
- Already using API Gateway
- Mixed languages/frameworks (Java, Python, Node.js)
- Need centralized security policy

❌ Avoid when:
- Monolithic architecture
- Many inter-service internal calls
- Gateway failure is critical
```

### Recommend CheckUS 4-Tier

```
✅ Recommended for:
- Cross-Tenant requirements (one user accesses multiple Tenants)
- High Native Query usage
- Spring Boot + MySQL/PostgreSQL environment
- Prefer explicit control (understandability over automation)
- Want frontend-integrated architecture

❌ Avoid when:
- Complete automation required (zero developer mistakes goal)
- Bytecode-level control needed
- Ultra-high performance requirements (Redis caching essential)
```

---

## Hybrid Approach: Combining Multiple Methods

In practice, **combining multiple methods** is also possible.

### Example 1: CheckUS + Redis Caching

```java
@CampusFiltered
@Cacheable(value = "students", key = "#root.method.name + '_' + @campusContextHolder.getSingleCampusId()")
public List<Student> getStudents() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return studentRepository.findByCampusId(campusId);
}
```

- Maintains CheckUS's explicit control
- Improves performance with Redis caching
- Safety maintained by including campusId in cache key

### Example 2: API Gateway + Hibernate Filter

```yaml
# API Gateway: Header validation
- name: tenant-validator
  config:
    validate_header: X-Tenant-Id

# Backend: Automatic filtering with Hibernate Filter
```

- 1st validation at Gateway
- 2nd defense with Hibernate Filter in backend

---

## Conclusion

**There is no definitive answer to "Which method is best?"**

What matters is:
1. **Team's tech stack** (PostgreSQL? MySQL? Hibernate proficiency?)
2. **Requirements** (Cross-Tenant? Native Query usage? Complete automation?)
3. **Current scale and future plans** (Traffic? Expansion plans?)
4. **Team culture** (Explicit control vs automation?)

CheckUS chose 4-Tier prioritizing **cross-campus + Native Query + simplicity**. But for other teams, Hibernate Filter or PostgreSQL RLS might be better choices.

---

## Next Episode Preview

Part 4 objectively compared various Row-Level Security implementation methods. We examined the pros, cons, and suitable situations for PostgreSQL RLS, Hibernate Filter, API Gateway, and CheckUS 4-Tier.

**Part 5: Legacy Migration Strategy** will cover:

- 🔧 Applying multi-tenancy to existing systems
- 📊 Data migration strategy (adding campusId)
- 🧪 Zero-downtime deployment plan
- ⚠️ Problems and solutions during migration
- ✅ Step-by-step migration checklist

How to apply multi-tenancy to already running systems? We'll reveal practical migration guides.

**👉 Continue to [Part 5: Legacy Migration Strategy](./part5-legacy-migration.md)**

---

## References

### Real Implementation Cases
- [Medium - Multi-Tenancy with Spring Boot and Hibernate (2024)](https://medium.com/@tech-blog/multi-tenancy-spring-boot)
- [Baeldung - High-Performance Multi-Tenancy (2025)](https://www.baeldung.com/spring-boot-multitenancy)
- [DZone - Deep Multi-Tenancy with AspectJ (2024)](https://dzone.com/articles/aspectj-multitenancy)

> Note: These cases can be found by searching "Spring Boot Multi-tenancy AOP"

### Official Documentation
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Hibernate User Guide - Filtering Data](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#pc-filter)

> Note: Refer to "Row Level Security" and "Filters" sections in PostgreSQL and Hibernate official documentation.

---

**CheckUS Architecture Series**
- Part 1: Multi-Tenancy Concept
- Part 2: CheckUS 4-Tier Architecture Implementation
- Part 3: Security and Performance Optimization
- Part 4: Comparing Implementation Methods ← Current
- Part 5: Legacy Migration Strategy
