---
layout: post
title: "Hibernate @SoftDelete 마이그레이션 삽질기 — 결국 @SQLDelete로 돌아오기까지"
date: 2026-04-14 21:00:00 +0900
categories: [Backend, JPA]
tags: [hibernate, soft-delete, spring-boot, jpa, migration]
lang: ko
slug: "054"
published: false
---

## 도입

프로젝트의 엔티티 6개가 각자 다른 방식으로 soft delete를 구현하고 있었다. `deletedAt` 필드, `isDeleted()` 메서드, 쿼리마다 붙는 `WHERE deletedAt IS NULL` — 패턴이 제각각이고, 새 쿼리를 작성할 때 필터를 빠뜨릴 위험이 항상 있었다.

Hibernate 6.4에 도입된 `@SoftDelete`로 이 문제를 깔끔하게 해결하려 했다. TIMESTAMP 전략이 없어서 custom converter를 만들고, 그게 런타임에 터져서 boolean으로 바꾸고, 그것마저 LAZY 로딩 버그로 실패해서 결국 `@SQLDelete` + `@SQLRestriction` 조합으로 돌아온 이야기다.

## 배경: 수동 Soft Delete의 문제

기존 코드는 이런 패턴이었다:

```java
@Entity
public class Room {
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    public boolean isDeleted() { return deletedAt != null; }
    public void markAsDeleted() { this.deletedAt = nowUtc(); }
    public void restore() { this.deletedAt = null; }
}
```

Repository에서는 모든 쿼리에 수동 필터를 붙여야 했다:

```java
@Query("SELECT r FROM Room r WHERE r.campus.id = :campusId AND r.deletedAt IS NULL")
List<Room> findAllByCampusId(@Param("campusId") Long campusId);
```

**문제점:**

| 문제 | 설명 |
|------|------|
| 패턴 불일치 | 어떤 엔티티는 `markAsDeleted()` 메서드가 있고, 어떤 건 `setDeletedAt()`을 직접 호출 |
| 필터 누락 위험 | 새 쿼리 작성 시 `deletedAt IS NULL`을 빠뜨리면 삭제된 데이터가 노출 |
| 보일러플레이트 | 60개 이상의 쿼리에 같은 조건이 반복 |
| 감사 추적 불가 | 누가 삭제했는지 기록하는 `deletedBy` 필드가 없음 |

## 시도 1: @SoftDelete + SoftDeleteType.TIMESTAMP

Hibernate 문서에는 TIMESTAMP 전략이 언급되어 있다:

```java
// 문서에서 본 코드 — 실제로는 컴파일 안 됨
@SoftDelete(strategy = SoftDeleteType.TIMESTAMP, columnName = "deleted_at")
public class Room { ... }
```

Spring Boot 3.4.5가 사용하는 Hibernate 6.6.13의 `SoftDeleteType` enum을 `javap`로 확인해보니:

```
public enum SoftDeleteType {
    ACTIVE,   // boolean: 1 = active
    DELETED   // boolean: 1 = deleted
}
```

**TIMESTAMP가 없다.** 아직 릴리스되지 않은 버전의 기능이었다.

## 시도 2: @SoftDelete + Custom AttributeConverter

`@SoftDelete`의 `converter` 속성이 `AttributeConverter<Boolean, ?>`를 받으므로, Boolean → LocalDateTime 변환 converter를 만들면 될 것 같았다:

```java
@Converter
public class DeletedAtConverter implements AttributeConverter<Boolean, LocalDateTime> {

    @Override
    public LocalDateTime convertToDatabaseColumn(Boolean deleted) {
        return Boolean.TRUE.equals(deleted)
            ? LocalDateTime.now(ZoneOffset.UTC)
            : null;
    }

    @Override
    public Boolean convertToEntityAttribute(LocalDateTime deletedAt) {
        return deletedAt != null;
    }
}
```

```java
@Entity
@SoftDelete(columnName = "deleted_at", converter = DeletedAtConverter.class)
public class Room { ... }
```

**컴파일 성공. 로컬 H2 테스트 통과.** 자신감을 갖고 6개 엔티티를 전부 마이그레이션했다.

운영 MySQL에서 서버가 시작되지 않았다.

```
java.lang.NullPointerException: Cannot invoke
  "org.hibernate.type.descriptor.jdbc.JdbcLiteralFormatter.toJdbcLiteral"
  because "this.jdbcLiteralFormatter" is null
```

Hibernate 6.6.x의 `JdbcLiteralFormatterTemporal`이 TIMESTAMP 컬럼에 대한 literal formatter를 초기화하지 못하면서 NPE가 발생한다. H2는 타입 처리가 느슨해서 이 경로를 타지 않았지만, MySQL에서는 정확한 타입 매핑이 필요해서 터진 것이다.

## 시도 3: @SoftDelete + Boolean 컬럼

TIMESTAMP converter가 실패했으니, `@SoftDelete`의 기본 동작대로 boolean 컬럼을 추가하는 방식으로 전환했다:

```java
@Entity
@SoftDelete  // 기본값: deleted boolean 컬럼
public class Room {
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;  // 수동 관리

    public void prepareForDeletion(Long deletedByUserId) {
        this.deletedAt = nowUtc();
        this.deletedBy = deletedByUserId;
    }
}
```

DB에 `deleted` boolean 컬럼을 추가하고, 기존 `deleted_at IS NOT NULL` 데이터를 동기화했다.

서버가 시작됐다. 하지만 이번에는 **LAZY 로딩이 터졌다.**

`@ManyToOne(fetch = LAZY)`로 `@SoftDelete` 엔티티를 참조하는 경우, Hibernate가 프록시를 생성하면서 soft delete 필터를 제대로 처리하지 못했다. Hibernate 6.6.x의 두 번째 버그였다.

## 최종 해결: @SQLDelete + @SQLRestriction

`@SoftDelete`를 포기하고, Hibernate의 오래된(하지만 안정적인) 방식으로 돌아갔다:

```java
@Entity
@SQLDelete(sql = "UPDATE room SET deleted_at = NOW() WHERE id = ?")
@SQLRestriction("deleted_at IS NULL")
public class Room {
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    @Column(name = "deleted_by")
    private Long deletedBy;

    public void prepareForDeletion(Long deletedByUserId) {
        this.deletedAt = nowUtc();
        this.deletedBy = deletedByUserId;
    }
}
```

| 어노테이션 | 역할 |
|-----------|------|
| `@SQLDelete` | `repository.delete()` 호출 시 DELETE 대신 지정한 UPDATE SQL 실행 |
| `@SQLRestriction` | 모든 JPQL 쿼리에 `WHERE deleted_at IS NULL` 자동 추가 |

**서비스 코드 변경 불필요.** `prepareForDeletion()` → `repository.delete()` 패턴이 그대로 동작한다. `@SQLDelete`가 실제 DELETE를 가로채서 soft delete UPDATE로 바꿔주기 때문이다.

추가한 `deleted` boolean 컬럼도 삭제했다. 더 이상 필요 없다.

## 마이그레이션에서 살아남은 것들

세 번의 시도를 거치면서도, 초기에 한 작업의 상당 부분이 최종 결과에 그대로 활용됐다:

| 작업 | 시도 1-3에서 수행 | 최종에서 재사용? |
|------|----------------|----------------|
| 60개 JPQL 수동 필터 제거 | O | **O** (@SQLRestriction이 대체) |
| cross-entity deletedAt 참조 정리 | O | **부분** (deletedAt 필드가 남아서 일부 복원) |
| isDeleted()/markAsDeleted() 제거 | O | **O** (prepareForDeletion으로 통일) |
| deletedBy 감사 필드 추가 | O | **O** |
| Native SQL 필터 보존 | O | **O** |

## 함정: Native SQL은 자동 필터링 안 됨

`@SQLRestriction`도 `@SoftDelete`와 마찬가지로 **JPQL에만 적용**된다. Native SQL 쿼리에는 적용되지 않는다:

```java
// JPQL — @SQLRestriction이 WHERE deleted_at IS NULL 자동 추가
@Query("SELECT sc FROM StudentClass sc WHERE sc.classEntity.campus.id = :campusId")

// Native SQL — 자동 필터링 X, 수동 필터 유지 필수!
@Query(value = "SELECT * FROM student_class sc JOIN class c ON sc.class_id = c.id " +
               "WHERE sc.student_id = :studentId AND c.deleted_at IS NULL",
       nativeQuery = true)
```

## 배운 점

1. **문서를 믿지 말고 실제 API를 확인하라.** Hibernate 문서에 TIMESTAMP 전략이 있었지만 실제 6.6.x에는 없었다. `javap`로 직접 확인하는 습관이 중요하다.

2. **H2 통과 ≠ MySQL 통과.** 특히 타입 매핑, literal formatting, 스키마 검증에서 차이가 크다. Soft delete처럼 스키마에 의존하는 기능은 반드시 실제 DB에서 검증해야 한다.

3. **새 API보다 검증된 API가 낫다.** `@SoftDelete`는 Hibernate 6.4에서 도입된 비교적 새로운 기능이다. `@SQLDelete` + `@SQLRestriction`은 오래됐지만, 그만큼 엣지 케이스가 잘 처리되어 있다. 새 기능의 편의성과 검증된 기능의 안정성 사이에서 판단이 필요하다.

4. **JPQL과 Native SQL의 동작 차이를 항상 인식하라.** Hibernate의 자동 기능(필터링, 캐싱 등)은 JPQL에만 적용된다. Native SQL은 ORM 밖에서 동작하므로 수동 관리가 필요하다.

5. **삽질이 낭비는 아니다.** TIMESTAMP converter → boolean 컬럼 → @SQLDelete 로 세 번 바뀌었지만, 60개 쿼리 정리, cross-entity 참조 파악, native/JPQL 구분 — 이 작업들은 최종 형태에서도 그대로 가치가 있었다.

## 에필로그

이 글의 결론은 "`@SQLDelete` + `@SQLRestriction` 조합으로 안착했다"였다. 하지만 이 결론에는 후일담이 있다 — 다음 날 이 `@SQLRestriction`이 프로덕션 전면 장애를 일으켰다. 52개 테이블의 FK resolve를 차단해서 하루에 핫픽스 5회를 배포하게 된 이야기는 후속 글에서.

> **후속 글**: [@SQLRestriction 하나가 프로덕션을 멈추다](/posts/055)

## References

- [Hibernate @SoftDelete Documentation](https://docs.jboss.org/hibernate/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#soft-delete)
- [Hibernate @SQLDelete / @SQLRestriction](https://docs.jboss.org/hibernate/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#pc-filter-sql-restriction)
- [Spring Boot 3.4.x + Hibernate 6.6.x Release Notes](https://spring.io/blog/2024/11/21/spring-boot-3-4-0-available-now)
