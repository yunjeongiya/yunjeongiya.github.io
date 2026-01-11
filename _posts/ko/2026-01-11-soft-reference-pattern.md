---
layout: post
title: "외래키 없이 살아남기: String으로 참조하는 소프트 레퍼런스 패턴"
date: 2026-01-10 14:00:00 +0900
categories: [Database, Architecture]
tags: [database, foreign-key, soft-reference, jpa, design-pattern]
lang: ko
slug: "022"
thumbnail: /assets/images/posts/022-soft-reference.png
---

![소프트 레퍼런스 패턴](/assets/images/posts/022-soft-reference.png){: width="600"}


## TL;DR

- 이 글의 핵심은 **외래키를 쓰지 말자는 주장**이 아니다.
- 진짜 쟁점은  
  **① Role을 코드로 볼 것인가, 운영 데이터로 볼 것인가**  
  **② 무엇을 참조하느냐(name vs code)**  
  **③ 무결성을 누가 책임지느냐(DB vs 애플리케이션)** 다.
- CheckUS에서는  
  **Role은 DB에 두되, 모든 참조는 불변 code 기반 소프트 참조로 통일**하는 선택이
  가장 현실적인 균형점이었다.

---

## 문제 제기

> CampusRole에서 ParentRole을 꼭 인자로 갖고 있어야 할까?  
> 그리고 있다면, 굳이 외래키로 강하게 묶어야 할까?

CheckUS의 권한 시스템을 설계하면서 가장 오래 붙잡고 고민한 질문이다.

시스템에는 전역 기본 역할이 있다.

- `TEACHER`
- `STUDENT`
- `ADMIN`

그리고 각 캠퍼스는 이를 기반으로 커스텀 역할을 만든다.

- `정교사`
- `보조교사`
- `체험학생`

커스텀 역할은 **기본 역할을 기반으로**,  
그 역할이 가진 권한 중 일부만 선택해서 갖는다.

즉 `정교사`는 `TEACHER` 계열이다.

---

## CampusRole은 무엇을 표현하는가

```java
@Entity
public class CampusRole {
    @Id
    private Long id;

    private String name; // "정교사"

    @Column(name = "parent_role", nullable = false)
    private String parentRole; // "TEACHER"
}
````

여기서 중요한 점은 `parentRole`이 **외래키가 아니라 String**이라는 것이다.
`Role.id`를 참조하지 않고 `"TEACHER"`라는 값을 그대로 저장한다.

처음 보면 이렇게 느껴질 수 있다.

> “이거 DB 무결성 포기한 거 아닌가?”

맞다.
하지만 이 선택에는 분명한 이유가 있었다.

---

## 오해 1: parentRole은 권한 체크용이다?

아니다.

권한 확인(Read) 시점에는 `CampusRolePermission`만 보면 된다.

```java
List<Permission> permissions =
    campusRolePermissionRepository.findByCampusRoleId(campusRoleId);
```

부모 Role의 다른 정보는 필요 없다.
이 문제는 Lazy Loading이나 Join 최적화의 문제가 아니다.

---

## parentRole이 실제로 쓰이는 지점

`parentRole`은 **권한 체크(Read)** 가 아니라
**역할 생성·할당·수정(Write)** 시점에 필요하다.

```java
// UserCampusRoleService.assignCampusRole()
Role parentRole = roleRepository.findByName(campusRole.getParentRole())
    .orElseThrow(() -> new BusinessException("부모 역할을 찾을 수 없습니다"));
```

사용자에게 `정교사`를 할당하려면 시스템은 다음을 보장해야 한다.

1. 이 커스텀 역할이 어떤 기본 역할 계열인지
2. 사용자가 해당 기본 역할(`TEACHER`)을 이미 가지고 있는지
3. 없다면 기본 역할을 먼저 할당한 뒤, 그 위에 커스텀 역할을 연결

즉 `parentRole`은
**권한 계산용 데이터가 아니라, 역할의 계보를 정의하는 메타데이터**다.

---

## 그럼 외래키를 써야 하는 거 아닌가?

정확한 질문이다.

```java
@ManyToOne
@JoinColumn(name = "parent_role_id")
private Role parentRole;
```

### 외래키의 장점

* DB가 참조 무결성을 강제로 보장
* 부모 삭제/변경 시 안전
* Role의 이름이 바뀌어도 관계 유지 (PK 기준)

### 하지만 단점도 있다

* `CampusRole`과 `Role`이 DB 레벨에서 강결합
* 성격이 다른 두 도메인이 하나의 모델로 묶임
* 운영/확장 시 유연성 감소

그래서 우리는 **소프트 참조**를 선택했다.

---

## 소프트 참조의 진짜 위험

중요한 포인트가 하나 있다.

> 문제는 **소프트 참조 자체**가 아니다.
> 문제는 **가변 값(name)을 참조한다는 것**이다.

```java
// ❌ 위험한 방식
private String parentRole; // "TEACHER"
```

`name`은 사람이 바꾼다.
요구사항 변경, 정책 변경, 리브랜딩으로 **언젠가는 바뀐다.**

이 순간 모든 CampusRole은 고아가 된다.

---

## 치명적 시나리오: Role 이름 변경

```sql
UPDATE role SET name = 'INSTRUCTOR' WHERE name = 'TEACHER';
```

DB는 아무 말도 하지 않는다.
하지만 런타임에서는 바로 터진다.

```java
roleRepository.findByName("TEACHER")
    .orElseThrow(...)
```

이것이 **name 기반 소프트 참조의 가장 큰 리스크**다.

---

## 그럼 소프트 참조를 포기해야 할까?

아니다.
**참조 대상을 바꾸면 된다.**

### 핵심 원칙

> 소프트 참조는 반드시 **불변(immutable) 값**을 참조해야 한다.

```java
// ✅ 안전한 방식
private String parentRoleCode; // "ROLE_TEACHER"
```

* `code`는 내부 식별자
* rename 금지
* 변경이 필요하면 **새 code 추가 + 데이터 마이그레이션**

표시용 이름은 따로 둔다.

```java
Role {
    String code;        // ROLE_TEACHER (불변)
    String displayName; // Teacher / 강사 (가변)
    boolean active;
}
```

---

## 여기서 나오는 또 하나의 질문

## “Role이 진짜 상수라면, DB에 둘 이유가 없지 않나?”

아주 좋은 질문이다.

### 코드(enum)로만 둬도 되는 경우

아래 조건이 **모두** 충족된다면 Role 테이블 없이 가는 게 더 깔끔하다.

* Role 종류가 절대 늘지 않음
* 권한/정책이 절대 변하지 않음
* 운영 중 on/off 관리가 필요 없음
* 다국어/설명/정렬 같은 메타데이터 필요 없음
* 변경 = 배포가 문제되지 않음

이 경우 Role은 사실상 **enum 상수**다.

---

## 그런데 현실은 다르다

운영을 하다 보면 이런 요구가 생긴다.

* 특정 Role 비활성화 (`active=false`)
* 다국어 표시명
* Role별 기본 권한 프리셋 조정
* UI 노출 순서, 그룹핑
* 감사 로그 (누가 언제 바꿈)
* 멀티테넌트/캠퍼스 확장

이 순간 Role은 **상수**가 아니라
**운영 데이터**가 된다.

그래서 Role을 DB에 두는 이유가 생긴다.

---

## 가능한 선택지 정리

### 옵션 A) Role을 코드(enum)로만 관리

* Role 테이블 제거
* 모든 참조는 enum code
* 구조 단순
* 운영 유연성 ↓

### 옵션 B) Role은 DB에 두되, 참조는 불변 code로 통일 (CheckUS 선택)

* Role은 운영 데이터로 유지
* `code`는 절대 변경 금지
* `displayName`만 가변
* CampusRole은 `parentRoleCode`로 참조

👉 **이름 변경 고아 리스크 제거 + 운영 유연성 확보**

---

## “그럼 FK랑 뭐가 다른가?”

겉보기엔 비슷하다.
하지만 결정적인 차이가 있다.

| 구분         | 외래키(FK)       | 소프트 참조(code)   |
| ---------- | ------------- | -------------- |
| 무결성 책임     | DB            | 애플리케이션 + 운영 규칙 |
| rename 안전성 | 높음            | code 불변으로 보완   |
| DB 기능      | cascade, join | 없음             |
| 도메인 결합도    | 높음            | 낮음             |

즉,

> **같은 걸 참조하는 것처럼 보여도,
> “누가 책임지는가”가 완전히 다르다.**

---

## ERD에서는 어떻게 표현할까

* 물리 ERD: 관계선 없음
* 논리 ERD: 점선(dashed)

```
┌─────────────┐         ┌──────────┐
│ CampusRole  │         │   Role   │
├─────────────┤         ├──────────┤
│ id          │         │ id       │
│ name        │         │ code     │
│ parentCode  │ - - - > │ display  │
└─────────────┘
   (논리적 참조)
```

---

## 결론

이 글의 핵심 질문은 이것이었다.

> **외래키를 쓰느냐 마느냐가 아니라,
> 무엇을 불변 키로 삼고 누가 무결성을 책임질 것인가.**

CheckUS에서는

* Role은 운영 데이터를 감당해야 했고
* 이름은 바뀔 수 있었으며
* 도메인 결합도는 낮추고 싶었다

그래서 **불변 code 기반 소프트 참조**가
성능·유연성·운영 안정성의 균형점이었다.

소프트 참조는 외래키의 대체제가 아니다.
**책임의 위치를 바꾸는 선택**이다.

그 책임을 감당할 준비가 되어 있다면,
소프트 참조는 충분히 “살아남을 수 있다”.

---

## 참고 자료

- [Martin Fowler - Soft Reference Pattern](https://martinfowler.com/bliki/SoftReference.html)
- [JPA Best Practices - Lazy Loading](https://vladmihalcea.com/jpa-hibernate-lazy-loading/)
- [Database Design - When to Use Foreign Keys](https://stackoverflow.com/questions/83147/when-not-to-use-foreign-keys)