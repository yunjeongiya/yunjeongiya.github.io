---
layout: post
title: "@SQLRestriction 하나가 프로덕션을 멈추다 — Soft Delete 리팩토링에서 배운 것"
date: 2026-04-15 14:00:00 +0900
categories: [Backend, Incident]
tags: [hibernate, jpa, soft-delete, sqlrestriction, refactoring, postmortem, spring-boot]
lang: ko
slug: "055"
published: false
---

## 도입

> 이 글은 [이전 글 — "Hibernate @SoftDelete 마이그레이션 삽질기"](/posts/054)의 후속편이다. 이전 글에서 `@SoftDelete`의 한계를 겪고 `@SQLDelete` + `@SQLRestriction` 조합으로 마무리했는데, **그 @SQLRestriction이 프로덕션을 멈추는 데는 하룻밤이면 충분했다.**

어제 밤 배포한 Soft Delete 리팩토링이 오늘 아침 프로덕션을 멈췄다. `@SQLRestriction("deleted_at IS NULL")` 한 줄을 `User` 엔티티에 추가했을 뿐인데, 12시간 동안 577건의 에러가 발생했고, 하루에 5번의 핫픽스를 배포했다.

이전 글의 결론은 "결국 `@SQLRestriction`으로 돌아왔다"였다. 이 글의 결론은 **"그 `@SQLRestriction`마저 제거했다"**이다. 무엇이 잘못됐고, 어떻게 대응했고, 어떤 교훈을 얻었는지 기록한다.

## 배경: Soft Delete 마이그레이션

우리 서비스는 학생/교사/보호자를 관리하는 교육 플랫폼이다. `User` 엔티티는 시스템의 중심이고, 학생 목록, 문의, 상담, 청구서, 출결, 알림 등 **52개 테이블**이 FK로 참조한다.

기존에는 User 삭제 시 `deleted_at` 컬럼을 설정하는 방식(soft delete)이었지만, 삭제된 유저를 쿼리에서 필터링하는 건 서비스 코드에서 수동으로 하고 있었다. 이를 체계화하기 위해 Hibernate의 `@SQLRestriction`을 도입했다:

```java
@Entity
@Table(name = "users")
@SQLDelete(sql = "UPDATE users SET deleted_at = NOW() WHERE id = ?")
@SQLRestriction("deleted_at IS NULL")  // ← 이 한 줄
public class User {
    // ...
}
```

의도: 삭제된 유저를 자동으로 모든 쿼리에서 제외.

현실: 모든 쿼리에는 **FK resolve도 포함**되어 있었다.

## 장애 1: enum 불일치 (ACCEPTED vs APPROVED)

배포 직후 첫 에러는 예상 밖의 곳에서 왔다.

```
IllegalArgumentException: No enum constant
  StudentGuardian.ConnectionStatus.ACCEPTED
```

`student_guardian` 테이블에 수동 SQL로 넣은 462건의 데이터가 `ACCEPTED`라는 값을 가지고 있었다. Java enum에는 `APPROVED`만 존재. 이전에는 이 테이블을 JOIN하지 않던 쿼리 경로가 `@SQLRestriction` 도입 후 변경되면서 처음으로 이 데이터를 로드하게 된 것이다.

```sql
-- 수동 SQL 스크립트 (잘못된 값)
INSERT INTO student_guardian (..., status) VALUES (..., 'ACCEPTED');

-- Java enum (정의된 값)
public enum ConnectionStatus {
    PENDING, APPROVED, REJECTED, CANCELLED  // ACCEPTED 없음
}
```

**교훈**: MySQL은 varchar 컬럼에 아무 문자열이나 넣을 수 있다. `@Enumerated(EnumType.STRING)` 매핑은 INSERT 시점이 아니라 **SELECT 시점**에 터진다. 수동 SQL로 데이터를 넣을 때는 반드시 Java enum 값을 확인해야 한다.

## 장애 2: 52개 테이블 FK 에러

enum 문제를 DB UPDATE로 해결한 후, 더 큰 문제가 나타났다.

```
FetchNotFoundException: Entity `User` with identifier value `3270` does not exist
```

문의 페이지, 학생 목록, 교사 캘린더, 청구서 — 거의 모든 페이지가 터졌다.

원인: `@SQLRestriction`은 **Hibernate의 FK resolve에도 적용**된다. 다른 엔티티가 `@ManyToOne`으로 soft-deleted User를 참조하면, Hibernate가 User를 로드하려 할 때 `WHERE deleted_at IS NULL` 조건에 의해 찾을 수 없고, `FetchNotFoundException`을 던진다.

```
User (soft-deleted, deleted_at = '2026-04-01')
  ↑ FK 참조
StudentGuardian (student_id = 3270)  → 터짐
Inquiry (created_by = 3015)          → 터짐
Consultation (student_id = 3270)     → 터짐
... 52개 테이블 전부 잠재적 폭탄
```

**이 동작은 문서에 명시되어 있지 않다.** `@SQLRestriction`의 공식 설명은 "엔티티에 대한 쿼리에 WHERE 절을 추가한다"지만, **다른 엔티티에서 이 엔티티를 FK로 참조할 때의 동작**은 직관적이지 않다. 직접 쿼리하지 않더라도, FK를 통해 간접적으로 로드되는 순간 restriction이 적용된다.

### 수정: @SQLRestriction 제거 + 쿼리 레벨 필터링

```java
@Entity
@Table(name = "users")
@SQLDelete(sql = "UPDATE users SET deleted_at = NOW() WHERE id = ?")
// @SQLRestriction 제거 — FK resolve에 영향을 주지 않도록
public class User {
    // ...
}
```

대신 UserRepository의 **리스팅 쿼리에만** 명시적 필터를 추가:

```java
@Query("SELECT u FROM User u WHERE u.username = :username AND u.deletedAt IS NULL")
Optional<User> findByUsername(@Param("username") String username);

@Query("SELECT DISTINCT u FROM User u " +
       "JOIN StudentProfile sp ON u.id = sp.user.id " +
       "WHERE scp.campusId IN :campusIds " +
       "AND u.deletedAt IS NULL")  // 명시적 필터
List<User> findStudentsByCampuses(@Param("campusIds") Set<Long> campusIds);
```

핵심 원칙: **FK resolve는 항상 작동해야 한다. 필터링은 쿼리 레벨에서.**

## 장애 3: 삭제된 유저가 목록에 부활

`@SQLRestriction`을 제거한 직후, 또 다른 피드백이 들어왔다: "삭제했던 학생이 다시 보여요."

`@SQLRestriction`이 없어지면서 학생/교사 목록 쿼리에서 soft-deleted User가 다시 노출된 것이다. 앞서 추가한 명시적 필터가 **UserRepository에만** 적용됐고, 다른 Repository에서 User를 JOIN하는 쿼리에는 빠져 있었다.

결국 UserRepository의 **모든** 리스팅 쿼리 8개에 `AND u.deletedAt IS NULL`을 추가하는 추가 핫픽스를 배포했다.

## 하루 타임라인

| 시각 (KST) | 사건 | 핫픽스 |
|---|---|---|
| 어젯밤 | F397 @SoftDelete migration 배포 | - |
| 09:00 | 학생 목록 500 에러 발견 (ACCEPTED enum) | DB UPDATE 462건 |
| 09:30 | 배포 파이프라인 S3 ACL 실패 | `--acl public-read` 제거 |
| 10:00 | 문의/학생/캘린더 전면 장애 (User FK) | `@SQLRestriction` 제거 |
| 13:30 | 삭제된 학생 목록 부활 | 쿼리 8개에 필터 추가 |
| 14:00 | 다중 캠퍼스 에러 + 트랜잭션 롤백 | getCampusIds() + REQUIRES_NEW |

## 근본 원인: 행동 변경을 구조 변경으로 착각

Kent Beck의 말:

> "There are two kinds of changes — behavior changes and structure changes. You should always be making one kind or the other, but **never both at the same time**."

`@SQLRestriction` 추가는 **구조 변경이 아니라 행동 변경**이었다. 모든 쿼리의 결과가 바뀌고, FK resolve 동작이 바뀌고, 삭제된 데이터의 가시성이 바뀐다. 그런데 "soft delete 구조 정리"라는 이름 아래 구조 변경(`@SQLDelete` 추가)과 함께 묶여서 배포됐다.

Martin Fowler:

> "Each transformation is too small to be worth doing, but the cumulative effect is significant. **By doing them in small steps you reduce the risk of introducing errors.**"

한 번에 `@SQLRestriction` + `@SQLDelete` + enum 변경을 묶어서 배포한 게 문제다. 단계별로 했으면 각 단계에서 검증할 수 있었다.

## 배운 것: 리팩토링 체크리스트

이 사건 이후 프로젝트에 추가한 체크리스트:

1. **행동 변경인가 구조 변경인가?** 둘 다면 반드시 분리 배포
2. **FK 영향 범위 확인** — 변경 대상 엔티티를 참조하는 테이블 수 조회
   ```sql
   SELECT TABLE_NAME, COLUMN_NAME
   FROM information_schema.KEY_COLUMN_USAGE
   WHERE REFERENCED_TABLE_NAME = 'users';
   -- 결과: 52개
   ```
3. **기존 데이터 호환성 검증** — enum, status, nullable 변경 시 prod 데이터와 충돌 확인
4. **dev 서버 수동 검증** — CI 통과 ≠ 정상 동작. 주요 페이지 직접 확인 후 배포
5. **롤백 계획** — "문제 시 어떻게 되돌리는가"를 배포 전에 결정

## FK가 많은 핵심 엔티티의 Soft Delete 전략

`@SQLRestriction`을 쓸 수 없다면, FK 참조가 많은 엔티티의 soft delete는 어떻게 해야 하는가?

| 전략 | 장점 | 단점 |
|---|---|---|
| **쿼리 레벨 필터링** (우리가 선택) | FK resolve 안전, 유연 | 모든 리스팅 쿼리에 수동 추가 필요 |
| `@Where` / `@SQLRestriction` | 자동 필터링 | FK resolve 깨짐 (오늘의 사고) |
| Hibernate `@SoftDelete` | FK resolve 자동 처리 | timestamp 기반이면 커스텀 converter 필요 |
| **아예 soft delete 안 하기** | 복잡도 제거 | 데이터 복구 불가 |

[brandur.org의 "Soft Deletion Probably Isn't Worth It"](https://brandur.org/soft-deletion)에서는 soft delete의 근본적 문제를 지적한다: 모든 쿼리에 필터가 필요하고, FK 정합성이 깨지고, cascade가 없다. 우리도 이 문제를 정확히 겪었다.

## 마무리

"돌아가는 코드를 건드리지 마라"는 격언은 반은 맞고 반은 틀리다. 리팩토링은 필요하다. 하지만 **리팩토링의 전제 조건은 "동작을 바꾸지 않는 것"**이다. 동작이 바뀌는 순간, 그건 리팩토링이 아니라 기능 변경이고, 기능 변경에 맞는 검증과 배포 프로세스를 따라야 한다.

오늘의 핫픽스 5회는 비싼 수업료였지만, 앞으로 같은 실수를 반복하지 않을 체크리스트를 얻었다.

## References

- [Martin Fowler - Refactoring](https://martinfowler.com/books/refactoring.html) — "Small behavior-preserving transformations"
- [Kent Beck - BS Changes](https://medium.com/@kentbeck_7670/bs-changes-e574bc396aaa) — "Behavior changes vs structure changes"
- [Soft Deletion Probably Isn't Worth It](https://brandur.org/soft-deletion) — Soft delete의 근본적 문제점
- [Linear Incident Post-Mortem (Jan 2024)](https://linear.app/now/linear-incident-on-jan-24th-2024) — CASCADE 한 줄로 프로덕션 데이터 삭제
- [Hibernate @SQLRestriction Javadoc](https://docs.jboss.org/hibernate/orm/6.6/javadocs/org/hibernate/annotations/SQLRestriction.html)
