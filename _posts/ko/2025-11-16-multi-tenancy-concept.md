---
layout: post
title: "하나의 계정, 여러 학원, 다양한 역할: CheckUS 멀티테넌시 아키텍처"
date: 2025-11-16 10:00:00 +0900
categories: [Architecture, Backend]
tags: [multi-tenancy, database, architecture, saas, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: ko
slug: "012"
---

> **시리즈 안내**
> - **[Part 1: 하나의 계정, 여러 학원, 다양한 역할](/posts/012/)** ← 현재 글
> - [Part 2: 멀티테넌시에서 데이터 유출 막는 4-Tier 보안 아키텍처](/posts/013/)
> - [Part 3: 여러 캠퍼스-여러 역할 JWT 설계와 ThreadLocal 안전성](/posts/014/)
> - [Part 4: Row-Level Security 5가지 구현 방법 비교와 선택 가이드](/posts/015/)
> - Part 5: 레거시 시스템 멀티테넌시 전환 (준비 중)

---

![CheckUS 멀티테넌시 아키텍처](/assets/images/posts/012-multi-tenancy-architecture.jpg){: width="600"}

## 시작하며

학원 관리 서비스 CheckUS를 개발하면서 가장 중요하게 고민한 문제 중 하나는 바로 **"여러 학원의 데이터를 어떻게 안전하게 분리할 것인가?"**였습니다.

강남 독서실의 학생 정보가 분당 수학학원에 노출되면 안 되고, 각 캠퍼스의 일정과 출석 데이터는 철저히 격리되어야 합니다. 하지만 동시에, 한 학생이 여러 학원을 다니는 경우 하나의 계정으로 모든 정보를 통합해서 볼 수 있어야 합니다.

이 글에서는 이러한 요구사항을 해결하기 위한 **멀티테넌시(Multi-tenancy)** 개념과, CheckUS가 선택한 아키텍처 패턴에 대해 설명합니다.

---

## 멀티테넌시란?

**멀티테넌시(Multi-tenancy)**는 하나의 소프트웨어 인스턴스가 여러 고객(Tenant)을 동시에 서비스하는 아키텍처 패턴입니다.

### 실생활 비유

- **단일 테넌트(Single-tenant)**: 각 가족이 독립된 단독주택에 거주 🏠
- **멀티테넌트(Multi-tenant)**: 여러 가족이 한 아파트 건물을 공유하되, 각자의 호수는 독립적 🏢

CheckUS에서는 각 학원/캠퍼스가 하나의 "테넌트"이며, 모든 캠퍼스가 하나의 시스템을 공유하지만 데이터는 완전히 격리됩니다.

---

## 멀티테넌시 구현 방식 3가지

멀티테넌시를 구현하는 방법은 크게 세 가지 패턴으로 나뉩니다.

### 1. Database-per-Tenant (완전 분리형)

각 테넌트마다 독립된 데이터베이스를 사용하는 방식입니다.

```
강남 독서실 → MySQL DB (강남)
분당 수학학원 → MySQL DB (분당)
대치 영어학원 → MySQL DB (대치)
```

**장점**
- ✅ **완벽한 데이터 격리**: 물리적으로 완전히 분리되어 가장 안전
- ✅ **커스터마이징 용이**: 각 테넌트마다 다른 스키마 구조 가능
- ✅ **성능 격리**: 한 테넌트의 트래픽이 다른 테넌트에 영향 없음

**단점**
- ❌ **높은 운영 비용**: 데이터베이스 인스턴스 비용이 테넌트 수에 비례
- ❌ **유지보수 복잡도**: 스키마 변경 시 모든 DB에 마이그레이션 필요
- ❌ **통합 분석 어려움**: 전체 데이터 분석을 위해 여러 DB 조회 필요

**적합한 경우**
- 대규모 엔터프라이즈 고객 (은행, 정부기관 등)
- 데이터 주권(Data Sovereignty) 요구사항이 있는 경우
- 각 테넌트마다 완전히 다른 기능이 필요한 경우

---

### 2. Schema-per-Tenant (논리적 분리형)

하나의 데이터베이스 내에서 각 테넌트마다 독립된 스키마를 사용하는 방식입니다.

```
MySQL DB
├─ schema_gangnam    (강남 독서실)
├─ schema_bundang    (분당 수학학원)
└─ schema_daechi     (대치 영어학원)
```

**장점**
- ✅ **적절한 격리 수준**: 스키마 레벨에서 분리되어 안전
- ✅ **Database-per-Tenant보다 저렴**: 하나의 DB 인스턴스만 필요
- ✅ **백업/복원 용이**: 스키마 단위로 백업 가능

**단점**
- ❌ **스키마 수 제한**: PostgreSQL 등 일부 DB는 스키마 수에 제한
- ❌ **테넌트 추가 시 DDL 필요**: 새 스키마 생성 작업 필요
- ❌ **성능 격리 한계**: 물리적으로는 같은 DB이므로 리소스 경쟁 발생 가능

**적합한 경우**
- 중규모 B2B SaaS (테넌트 수 수십~수백 개)
- 각 테넌트의 데이터 크기가 비슷한 경우
- 스키마 레벨 격리로 충분한 보안 요구사항

---

### 3. Row-Level Security (공유 DB + 필터링)

모든 테넌트가 같은 데이터베이스와 테이블을 공유하되, 각 행(Row)에 테넌트 식별자를 저장하여 필터링하는 방식입니다.

```sql
-- students 테이블 (모든 캠퍼스 공유)
CREATE TABLE students (
    id BIGINT PRIMARY KEY,
    campus_id BIGINT NOT NULL,  -- 🔑 테넌트 식별자
    name VARCHAR(100),
    grade INT,
    ...
);

-- 쿼리 시 자동 필터링
SELECT * FROM students
WHERE campus_id = 1;  -- 강남 독서실 학생만 조회
```

**장점**
- ✅ **최소 운영 비용**: 하나의 DB, 하나의 스키마만 관리
- ✅ **테넌트 추가 간편**: 새 행 추가만으로 즉시 생성 (DDL 불필요)
- ✅ **통합 분석 용이**: 전체 테넌트 데이터를 하나의 쿼리로 분석 가능
- ✅ **스키마 마이그레이션 간단**: 한 번의 ALTER TABLE로 모든 테넌트 적용

**단점**
- ❌ **필터링 누락 위험**: 개발자 실수로 `WHERE campus_id` 누락 시 데이터 유출
- ❌ **성능**: 대규모 데이터에서 인덱스 설계가 중요
- ❌ **제한된 커스터마이징**: 모든 테넘트가 동일한 스키마 구조 사용

**적합한 경우**
- 대규모 B2C SaaS (테넌트 수 수천~수만 개)
- 모든 테넌트가 동일한 기능을 사용하는 경우
- 빠른 확장성이 중요한 스타트업

---

## CheckUS는 왜 Row-Level Security를 선택했을까?

CheckUS는 세 번째 방식인 **Row-Level Security**를 선택했습니다. 그 이유는 CheckUS의 독특한 비즈니스 모델 때문입니다.

### CheckUS의 핵심 차별점: 크로스 캠퍼스(Cross-Campus) 지원

일반적인 학원 관리 시스템은 "한 학생 = 한 학원"을 가정합니다. 하지만 CheckUS는 다릅니다.

**실제 사용 시나리오**

```
[학생 A]
  ├─ 강남 독서실 (월~금 자습)
  └─ 분당 수학학원 (화목 수업)

[선생님 B]
  ├─ 강남 독서실 (수학 강사)
  └─ 대치 영어학원 (영어 강사)
```

학생 A는 **하나의 계정**으로:
- 강남 독서실의 자습 일정 확인
- 분당 수학학원의 숙제 제출
- 두 학원의 전체 일정을 통합 대시보드에서 조회

선생님도 **하나의 계정**으로 여러 학원에서 근무하며, 학생의 다른 학원 일정을 고려해 스케줄을 조정할 수 있습니다.

### Database-per-Tenant이 불가능한 이유

만약 Database-per-Tenant 방식을 사용한다면:

```
강남 DB: { student_id: 1, name: "학생A", ... }
분당 DB: { student_id: 1, name: "학생A", ... }  // 중복 데이터!
```

- ❌ **계정 통합 불가능**: 학생 A가 두 개의 계정을 별도로 관리해야 함
- ❌ **크로스 캠퍼스 조회 불가**: 강남 독서실 선생님이 학생의 분당 수학학원 일정을 볼 수 없음
- ❌ **데이터 동기화 문제**: 학생이 이름을 변경하면 두 DB 모두 업데이트 필요

### Row-Level Security로 해결

```sql
-- 하나의 students 테이블에 모든 캠퍼스 학생 저장
students
  id | name    | campus_id
  ---+---------+----------
  1  | 학생A   | 1 (강남)
  1  | 학생A   | 2 (분당)

-- 하나의 user 계정 (user_id=100)으로 두 캠퍼스 데이터 접근
user_campus_roles
  user_id | campus_id | role
  --------+-----------+--------
  100     | 1         | STUDENT
  100     | 2         | STUDENT
```

**JWT 토큰에 여러 캠퍼스 정보 포함**
```json
{
  "userId": 100,
  "username": "student_a",
  "roles": [
    { "campusId": 1, "role": "STUDENT" },
    { "campusId": 2, "role": "STUDENT" }
  ]
}
```

**API 요청 시 헤더로 캠퍼스 선택**
```http
GET /students/me/schedules
X-Campus-Id: 1  # 강남 독서실 일정 조회

GET /students/me/schedules
X-Campus-Id: 2  # 분당 수학학원 일정 조회
```

이렇게 하면:
- ✅ **하나의 계정**으로 여러 캠퍼스 이용
- ✅ **통합 대시보드**에서 전체 일정 조회 가능
- ✅ **크로스 캠퍼스 권한 관리**: 강남 독서실 선생님이 학생의 분당 일정도 조회 (권한이 있다면)

---

## Row-Level Security의 핵심 과제

Row-Level Security를 선택하면서 가장 중요한 과제는 바로 **"필터링 누락을 어떻게 방지할 것인가?"**입니다.

```java
// ❌ 개발자 실수: campus_id 필터링 누락
@GetMapping("/students")
public List<Student> getStudents() {
    return studentRepository.findAll();  // 💥 모든 캠퍼스 학생 노출!
}

// ✅ 올바른 구현: campus_id 필터링
@GetMapping("/students")
public List<Student> getStudents() {
    Long campusId = CampusContextHolder.getCampusId();
    return studentRepository.findByCampusId(campusId);
}
```

하지만 **모든 쿼리마다 수동으로 필터링을 추가**하는 것은:
- ⚠️ 휴먼 에러 발생 가능성 높음
- ⚠️ 코드 중복 (boilerplate code)
- ⚠️ 유지보수 어려움

**그렇다면 어떻게 자동화할 수 있을까요?**

---

## 다음 편 예고

Part 1에서는 멀티테넌시의 세 가지 주요 패턴과, CheckUS가 Row-Level Security를 선택한 비즈니스적 이유를 살펴봤습니다.

**Part 2: CheckUS 4-Tier 아키텍처 구현**에서는:

- ✨ 필터링 누락을 **자동으로 방지**하는 4계층 아키텍처
- 🔒 프론트엔드부터 데이터베이스까지 **4단계 보안 체크**
- 🎯 Spring AOP와 ThreadLocal을 활용한 **우아한 구현**
- 📝 ESLint 규칙으로 **컴파일 타임에 실수 방지**

실제 CheckUS가 어떻게 구현했는지, 구체적인 코드와 함께 공개합니다.

**👉 Part 2는 내일 공개됩니다.**

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

**CheckUS 아키텍처 시리즈**
- Part 1: 멀티테넌시 개념 ← 현재 글
- Part 2: CheckUS 4-Tier 아키텍처 구현
- Part 3: 보안과 성능 최적화
- Part 4: 다양한 구현 방법 비교
- Part 5: 레거시 마이그레이션 전략
