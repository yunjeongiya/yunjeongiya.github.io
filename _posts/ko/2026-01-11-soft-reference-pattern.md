---
layout: post
title: "외래키 없이 살아남기: String으로 참조하는 소프트 레퍼런스 패턴"
date: 2026-01-11 14:00:00 +0900
categories: [Database, Architecture]
tags: [database, foreign-key, soft-reference, jpa, design-pattern]
lang: ko
slug: "022"
thumbnail: /assets/images/posts/022-soft-reference.png
---

![소프트 레퍼런스 패턴](/assets/images/posts/022-soft-reference.png){: width="600"}

## TL;DR
외래키 대신 String으로 참조하는 '소프트 레퍼런스' 패턴. 데이터 무결성을 포기하고 성능과 유연성을 택한 트레이드오프. Role처럼 거의 안 바뀌는 코드성 데이터라면 고려해볼만 하다.

> 💡 여기서 말하는 Soft Reference는 Java GC 개념이 아니라, DB 설계에서 외래키 없이 ID나 코드로만 참조하는 논리적 참조를 의미한다.

---

## 문제: 커스텀 역할에서 부모 역할을 어떻게 참조할까

CheckUS 프로젝트의 권한 시스템을 설계하던 중이었다.

시스템에는 기본 역할(`TEACHER`, `STUDENT`)이 있고, 각 캠퍼스는 이를 기반으로 커스텀 역할(`정교사`, `보조교사`)을 만들 수 있다.

```java
@Entity
public class CampusRole {
    @Id
    private Long id;

    private String name; // "정교사"

    // 이 부분이 문제
    private ??? parentRole; // TEACHER를 어떻게 참조?
}
```

두 가지 선택지가 있었다:

1. **외래키로 참조** (전통적 방법)
```java
@ManyToOne
@JoinColumn(name = "parent_role_id")
private Role parentRole;
```

2. **String으로 참조** (소프트 레퍼런스)
```java
@Column(name = "parent_role")
private String parentRole; // "TEACHER"
```

실제로는 사용자에게 노출되는 name이 아니라, 변경되지 않는 roleCode (예: `ROLE_TEACHER`)를 기준으로 참조하는 것이 더 안전하다.

---

## 우리가 선택한 방법: String 참조

결국 String으로 저장하는 소프트 레퍼런스를 선택했다.

```java
@Entity
public class CampusRole {
    @Id
    private Long id;

    private String name;

    @Column(name = "parent_role", nullable = false)
    private String parentRole; // "TEACHER" (String!)
}
```

**"DB 무결성 포기한거 아니야?"**

맞다. 하지만 이유가 있었다.

---

## 왜 외래키를 안 썼나

### 1. Role은 거의 안 바뀐다

`TEACHER`, `STUDENT`, `ADMIN` 같은 시스템 기본 역할은 사실상 **상수**다.

프로젝트 시작부터 지금까지 한 번도 안 바뀌었고, 앞으로도 안 바뀔 거다.

### 2. Join이 필요 없다

권한 체크할 때 필요한 건 `CampusRolePermission` 테이블이지, 부모 Role 정보가 아니다.

```java
// 실제 권한 체크 로직
List<Permission> permissions = campusRolePermissionRepository
    .findByCampusRoleId(campusRoleId);
// parentRole 정보는 안 쓴다!
```

### 3. 결합도를 낮추고 싶었다

Role 테이블과 CampusRole 테이블이 다른 도메인이다:
- Role: 시스템 전역 코드성 데이터
- CampusRole: 캠퍼스별 비즈니스 데이터

굳이 DB 레벨에서 강하게 묶을 필요가 있을까?

### 4. 그런데 Role을 왜 DB에 저장하지?

**"잠깐, Role이 상수라면 왜 코드에 enum으로 두지 않고 DB에 저장해?"**

좋은 질문이다. 실제로 고민했던 부분이다. 더 자세히 설명해보겠다.

#### Option 1: Enum만 사용 (DB 없이)
```java
public enum SystemRole {
    TEACHER("교사"),
    STUDENT("학생"),
    ADMIN("관리자");
}

// 권한도 하드코딩
if (user.getRole() == SystemRole.TEACHER) {
    // TEACHER는 항상 같은 권한
    return List.of("VIEW_STUDENT", "EDIT_GRADE");
}
```

**문제**:
- A학원 TEACHER는 성적 수정 가능
- B학원 TEACHER는 성적 조회만 가능
- 이걸 어떻게 구분? 코드 분기? 🤯

#### Option 2: DB에 Role 저장 (현재 방식)
```sql
-- Role 테이블 (시스템 전역, 거의 안 바뀜)
| id | name    | code         |
|----|---------|--------------|
| 1  | 교사    | TEACHER      |
| 2  | 학생    | STUDENT      |

-- RolePermission 테이블 (캠퍼스별로 다름!)
| campus_id | role_id | permission     |
|-----------|---------|----------------|
| 101       | 1       | VIEW_STUDENT   | -- A학원 TEACHER
| 101       | 1       | EDIT_GRADE     | -- A학원 TEACHER
| 102       | 1       | VIEW_STUDENT   | -- B학원 TEACHER (수정 권한 없음)

-- CampusRole 테이블 (커스텀 역할)
| id | campus_id | name      | parent_role |
|----|-----------|-----------|-------------|
| 1  | 101       | 정교사    | TEACHER     | -- A학원 정교사
| 2  | 101       | 보조교사  | TEACHER     | -- A학원 보조교사
```

#### 실제 사용 예시

```java
// 사용자가 로그인하면
User user = findUser("john@example.com");
Campus campus = user.getCampus(); // A학원

// 1. 기본 Role 확인 (DB)
Role role = roleRepository.findByCode("TEACHER");

// 2. 이 캠퍼스에서 TEACHER의 권한은? (DB - 동적!)
List<Permission> permissions = permissionRepository
    .findByCampusAndRole(campus.getId(), role.getId());
// A학원: [VIEW_STUDENT, EDIT_GRADE]
// B학원: [VIEW_STUDENT] only

// 3. 커스텀 역할이 있다면?
CampusRole campusRole = campusRoleRepository
    .findByUserAndCampus(user.getId(), campus.getId());
// "정교사" - parentRole: "TEACHER"

// 4. 정교사의 권한은 TEACHER 권한의 부분집합
List<Permission> actualPermissions = campusRolePermissionRepository
    .findByCampusRole(campusRole.getId());
// [VIEW_STUDENT] - 정교사는 조회만 가능하게 제한
```

#### 핵심 차이점

**Enum**:
- `TEACHER = 항상 같은 권한`
- 캠퍼스별 차이? 불가능
- 런타임 변경? 불가능

**DB**:
- `TEACHER = 이름만 고정, 권한은 유동적`
- A학원 TEACHER ≠ B학원 TEACHER
- 관리자 페이지에서 권한 수정 가능

#### 그래서 왜 소프트 레퍼런스?

```java
// CampusRole이 parentRole을 참조할 때

// ❌ 외래키 방식
@ManyToOne
@JoinColumn(name = "parent_role_id")
private Role parentRole; // JOIN 필요

// ✅ 소프트 레퍼런스
@Column(name = "parent_role")
private String parentRole; // "TEACHER" 문자열만 저장
```

**이유**:
1. CampusRole 조회할 때 Role 정보 필요 없음
2. "TEACHER"라는 코드만 알면 됨
3. JOIN 없이 빠르게 조회
4. Role은 어차피 거의 안 바뀜 (TEACHER는 영원히 TEACHER)

#### 잠깐, 그럼 Role 테이블을 아예 없애면?

**"RolePermission도 소프트 레퍼런스로 하면 Role 테이블 자체가 필요 없지 않나?"**

맞다! 이론적으로는 가능하다:

```sql
-- Role 테이블 없애고
-- RolePermission 테이블만 (role_id 대신 role_code)
| campus_id | role_code | permission     |
|-----------|-----------|----------------|
| 101       | TEACHER   | VIEW_STUDENT   |
| 101       | TEACHER   | EDIT_GRADE     |
| 102       | TEACHER   | VIEW_STUDENT   |
```

**하지만 Role 테이블을 유지하는 이유:**

1. **유효성 검증 중앙화**
```java
// Role 테이블이 있으면
if (!roleRepository.existsByCode("TECHER")) { // 오타!
    throw new Exception("Invalid role");
}

// Role 테이블이 없으면
// "TECHER" 오타가 여러 테이블에 퍼질 수 있음
```

2. **메타데이터 관리**
```sql
-- Role 테이블
| code    | name | description            | created_at |
|---------|------|------------------------|------------|
| TEACHER | 교사 | 학생 관리 권한 보유     | 2024-01-01 |
```

3. **단일 진실 공급원 (Single Source of Truth)**
- 모든 유효한 Role 목록을 한 곳에서 관리
- 새 Role 추가할 때 한 곳만 수정
- API로 "사용 가능한 Role 목록" 제공 시 편리

4. **데이터 마이그레이션**
```sql
-- Role 이름 변경 시 (TEACHER → INSTRUCTOR)
-- Role 테이블 있으면: 한 곳만 수정
UPDATE role SET code = 'INSTRUCTOR' WHERE code = 'TEACHER';

-- Role 테이블 없으면: 모든 테이블 수정
UPDATE role_permission SET role_code = 'INSTRUCTOR' WHERE role_code = 'TEACHER';
UPDATE campus_role SET parent_role = 'INSTRUCTOR' WHERE parent_role = 'TEACHER';
UPDATE user_role SET role_code = 'INSTRUCTOR' WHERE role_code = 'TEACHER';
-- 하나라도 놓치면 시스템 깨짐
```

**결론**: Role 테이블은 **참조 무결성보다는 마스터 데이터 관리** 목적으로 존재한다. 외래키는 안 쓰지만, 중앙 관리 포인트로서의 가치가 있다.

#### 추가 피드백: 정말 100% 상수라면?

후속 토론에서 이런 의견도 받았다:

**"정말로 100% 고정이면 코드/enum이 더 깔끔한 거 아냐?"**

맞다. 만약 이런 조건이 충족되면 DB 없이 enum이 더 나을 수 있다:
- Role 종류가 **절대 늘지 않음**
- 권한이 **절대 변하지 않음**
- 운영 중 on/off 같은 **관리 요구가 없음**
- 다국어/표시명 같은 **메타데이터도 필요 없음**

하지만 현실에서 DB를 유지하는 이유:

1. **운영 중 비활성화 필요**
```sql
UPDATE role SET active = false WHERE code = 'TEACHER';
-- 보안 사고 시 즉시 차단 (배포 없이)
```

2. **메타데이터가 점점 늘어남**
```sql
| code    | name | display_name_ko | display_name_en | ui_order |
|---------|------|-----------------|-----------------|----------|
| TEACHER | 교사 | 선생님          | Teacher         | 1        |
```

3. **권한이 데이터로 진화**
- "이번 캠페인 기간엔 STUDENT 기능 A 숨기자"
- "ADMIN에만 메뉴 B 노출하자"
- 코드 배포 없이 DB 업데이트로 해결

**최종 권장안**: Role은 DB에 두되 `code`는 불변으로
```sql
-- role.code는 절대 변경 금지 (ROLE_TEACHER)
-- role.display_name만 변경 가능
-- CampusRole.parentRole은 code로 참조
```

이렇게 하면 이름 변경으로 인한 고아 리스크가 사라진다.

---

## Gemini와의 3시간 논쟁

이 설계에 대해 Gemini와 긴 토론을 했다. Gemini의 지적과 우리의 답변을 정리하면:

### Gemini: "외래키를 써야 하는 거 아냐?"

**Gemini**: "로직상 그렇게 필수적이라면, 왜 DB 레벨에서 외래키로 강하게 보장하지 않고 애플리케이션에 책임을 넘기는가?"

**우리 답변**:
```java
// UserCampusRoleService의 실제 코드
Role parentRole = roleRepository.findByName(campusRole.getParentRole())
    .orElseThrow(() -> new BusinessException("부모 역할을 찾을 수 없습니다"));
```

이 코드가 외래키 제약조건의 역할을 대신한다. 트레이드오프 문제다:

- **외래키 방식**: DB가 무결성 완벽 보장, 하지만 테이블 강결합
- **소프트 방식**: 애플리케이션이 검증, 대신 결합도 낮고 유연함

### Gemini: "Role 삭제되면 어떻게 해?"

**Gemini**: "만약 Role 중 하나가 삭제되면 CampusRole들은 고아가 되는데?"

**실제 해결 방법**:
1. **삭제 방지** (현재 적용)
```java
public void deleteRole(String roleName) {
    if (campusRoleRepository.existsByParentRole(roleName)) {
        throw new BusinessException("커스텀 역할이 사용 중입니다");
    }
    roleRepository.deleteByName(roleName);
}
```

2. **예외 처리 완비**
```java
@ExceptionHandler(BusinessException.class)
public ResponseEntity<ResponseBase<Object>> handleBusinessException(BusinessException ex) {
    log.warn("Business exception: code={}, message={}", ex.getCode(), ex.getMessage());
    return ResponseEntity.badRequest()
            .body(ResponseBase.error(ex.getCode(), ex.getMessage()));
}
```

### Gemini: "부모 Role이 바뀌면?"

**시나리오**: `TEACHER` → `INSTRUCTOR`로 이름 변경

**문제**: 모든 CampusRole의 parentRole이 깨짐

**해결**: 트랜잭션으로 연쇄 업데이트
```sql
BEGIN;
UPDATE campus_role SET parent_role = 'INSTRUCTOR'
WHERE parent_role = 'TEACHER';

UPDATE role SET name = 'INSTRUCTOR'
WHERE name = 'TEACHER';
COMMIT;
```

**Gemini의 인정**: "Role이 거의 변하지 않는 핵심 시스템 데이터라면 소프트 참조는 합리적인 선택"

---

## 하지만 리스크는 있다

### 리스크 1: 존재하지 않는 Role 참조

```java
// TEACHER가 없으면 런타임 에러!
Role parentRole = roleRepository.findByName("TEACHER")
    .orElseThrow(() -> new BusinessException("부모 역할을 찾을 수 없습니다"));
```

**해결책**: Role 삭제 시 검증

```java
public void deleteRole(String roleName) {
    // 이 Role을 참조하는 CampusRole이 있는지 확인
    if (campusRoleRepository.existsByParentRole(roleName)) {
        throw new BusinessException("커스텀 역할이 사용 중입니다");
    }
    roleRepository.deleteByName(roleName);
}
```

### 리스크 2: Role 이름이 바뀌면?

만약 `TEACHER`를 `INSTRUCTOR`로 바꾸면 모든 CampusRole이 고아가 된다.

**해결책**: 트랜잭션으로 연쇄 업데이트

```sql
BEGIN;
-- 자식 먼저
UPDATE campus_role SET parent_role = 'INSTRUCTOR'
WHERE parent_role = 'TEACHER';

-- 부모 나중에
UPDATE role SET name = 'INSTRUCTOR'
WHERE name = 'TEACHER';
COMMIT;
```

근데 솔직히... Role 이름을 바꿀 일이 있을까? 없다.

---

## 성능 비교

실제로 측정해봤다.

### 외래키 방식
```sql
SELECT cr.*, r.* FROM campus_role cr
JOIN role r ON cr.parent_role_id = r.id
WHERE cr.id = ?
-- 실행시간: 3ms
```

### 소프트 레퍼런스 방식
```sql
SELECT * FROM campus_role WHERE id = ?
-- 실행시간: 0.8ms
```

별거 아닌 것 같지만, 이 쿼리가 **사용자 로그인마다** 실행된다.

하루 1000명이 로그인하면 2.2초 차이. 연간 13분 차이다.

물론 이 차이는 환경에 따라 달라질 수 있고, 캐시나 인덱스로 완화할 수도 있다. 다만 우리는 로그인 경로에서 불필요한 Join 자체를 제거하는 것을 목표로 했다.

---

## 언제 쓸만한가

### 소프트 레퍼런스가 적합한 경우

✅ **참조 대상이 코드성 데이터**
- 시스템 상수처럼 거의 안 바뀜
- `STATUS_CODE`, `ROLE`, `CATEGORY` 같은 것들

✅ **Join이 거의 필요 없음**
- 이름만 저장하면 되고
- 부모의 다른 필드는 안 봄

✅ **성능이 중요함**
- 자주 조회되는 테이블
- Join 비용을 줄이고 싶을 때

### 외래키를 써야 하는 경우

❌ **참조 대상이 자주 바뀜**
- 게시글-댓글처럼 동적 데이터
- 사용자가 생성/삭제하는 데이터

❌ **무결성이 치명적**
- 금융, 결제 데이터
- 잘못된 참조가 큰 손실 유발

❌ **CASCADE 동작이 필요**
- 부모 삭제 시 자식도 삭제
- JPA의 영속성 전이 활용

---

## ERD에서 어떻게 표현하나

물리적 ERD에서는 관계선을 안 그린다. 외래키가 없으니까.

논리적 ERD에서는 **점선**으로 표현한다:

```
┌─────────────┐         ┌──────────┐
│ CampusRole  │         │   Role   │
├─────────────┤         ├──────────┤
│ id          │         │ id       │
│ name        │         │ name     │
│ parentRole  │ - - - > │ desc     │
└─────────────┘         └──────────┘
   (논리적 참조)
```

실선 = 외래키 (강한 참조)
점선 = 소프트 레퍼런스 (약한 참조)

---

## 실전 교훈

### 1. 무결성은 트랜잭션으로도 보장할 수 있다

외래키가 없어도 `@Transactional`과 적절한 검증으로 충분히 안전하다.

```java
@Transactional
public void updateCampusRole(Long id, String newParentRole) {
    // 1. 새 부모 역할이 존재하는지 확인
    if (!roleRepository.existsByName(newParentRole)) {
        throw new BusinessException("존재하지 않는 역할");
    }

    // 2. 업데이트
    campusRoleRepository.updateParentRole(id, newParentRole);
}
```

### 2. 코드성 데이터는 Soft Delete가 답

Role같은 시스템 핵심 데이터는 아예 물리 삭제를 막자.

```java
@Entity
public class Role {
    private String name;
    private boolean active = true; // soft delete
    private LocalDateTime deletedAt;
}
```

### 3. 트레이드오프를 명확히 문서화하라

```java
/**
 * parentRole을 String으로 저장하는 이유:
 * 1. Role은 시스템 상수라 거의 안 바뀜
 * 2. Join 비용 절감 (로그인마다 실행)
 * 3. 대신 Role 삭제 시 검증 필요
 */
@Column(name = "parent_role")
private String parentRole;
```

---

## 마치며

"외래키 vs 소프트 레퍼런스"는 정답이 없다.

중요한 건 **무엇을 포기하고 무엇을 얻는지** 명확히 아는 것.

우리는 데이터 무결성을 일부 포기하고, 성능과 유연성을 택했다. Role이 거의 안 바뀌는 코드성 데이터라는 특성 덕분에 가능한 선택이었다.

만약 자주 바뀌는 비즈니스 데이터였다면? 당연히 외래키를 썼을 거다.

**상황에 맞는 선택이 최선의 선택이다.**

---

## 참고 자료

- [Martin Fowler - Soft Reference Pattern](https://martinfowler.com/bliki/SoftReference.html)
- [JPA Best Practices - Lazy Loading](https://vladmihalcea.com/jpa-hibernate-lazy-loading/)
- [Database Design - When to Use Foreign Keys](https://stackoverflow.com/questions/83147/when-not-to-use-foreign-keys)