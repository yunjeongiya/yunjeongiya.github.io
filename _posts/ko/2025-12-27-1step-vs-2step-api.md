---
layout: post
title: "학생+학부모 등록: 왜 기존 API를 프론트에서 조합하지 않고 1-step API를 새로 만들었는가"
date: 2025-12-27 10:00:00 +0900
categories: [Backend, API Design]
tags: [api-design, transaction, atomic-operation, refactoring, checkus]
lang: ko
slug: "020"
thumbnail: /assets/images/posts/020-api-design/thumbnail-ko.png
---

![1-step vs 2-step API 디자인](/assets/images/posts/020-api-design/thumbnail-ko.png){: width="600"}

## TL;DR
학생과 학부모를 각각 생성하던 기존 API를 프론트에서 조합하는 대신, 하나의 비즈니스 작업을 표현하는 1-step API를 새로 만들었다. 이 선택의 기준은 "step 수"가 아니라 비즈니스 경계와 트랜잭션 책임이었다.

---

## 배경: 이미 API는 있었지만, 문제가 있었다

CheckUS에는 이미 다음과 같은 API들이 존재했다:
- 학생 생성 API
- 학부모 계정 생성 API
- 학생-학부모 연결 API

이 API들을 프론트엔드에서 순차적으로 호출하면 "학생+학부모 등록" 기능을 구현할 수 있었다:

```javascript
const student = await createStudent(...)
for (const guardian of guardians) {
  const account = await registerGuardian(...)
  await connectGuardianToStudent(student.id, account.id)
}
```

처음에는 합리적으로 보였다. 각 API는 역할이 명확했고, 재사용도 가능했다.

하지만 실제 운영에서는 문제가 발생했다.

---

## 문제 1: 프론트엔드에는 트랜잭션이 없다

프론트에서 여러 API를 조합하는 방식은 겉보기엔 하나의 작업처럼 보이지만, 실제로는 여러 개의 독립된 네트워크 요청이다.

```
✅ 학생 생성 성공
❌ 학부모1 생성 실패 (네트워크 오류)
```

이 경우:
- 학생은 생성됨
- 일부 학부모는 없음
- 연결 상태는 불완전

이 상태를 자동으로 되돌릴 방법은 없다.

결국:
- 고아 데이터가 생기거나
- 수동 정리가 필요하거나
- 프론트에서 복잡한 분기 처리가 필요해진다

---

## 문제 2: 실패 책임이 프론트로 이동한다

프론트에서 API를 조합하면, 프론트가 다음을 알아야 한다:
- 어디까지 성공했는지
- 어떤 단계에서 실패했는지
- 재시도 시 무엇부터 해야 하는지

```javascript
try {
  const student = await createStudent(data);
  const results = { success: [], failed: [] };

  for (const guardian of guardians) {
    try {
      const account = await registerGuardian(guardian);
      await connectGuardianToStudent(student.id, account.id);
      results.success.push(guardian);
    } catch (error) {
      results.failed.push({ guardian, error });
      // 부분 실패 처리 로직이 프론트엔드에 들어간다
    }
  }
  // 복잡한 상태 관리...
} catch (error) {
  // 전체 실패 처리...
}
```

즉, 비즈니스 상태 관리 책임이 프론트로 새어나간다. 이건 UI 로직의 문제가 아니라 도메인 로직이 잘못된 위치에 놓인 결과다.

---

## 문제 3: "부분 성공"이 의미 없는 작업이었다

중요한 점은 이거였다.

CheckUS에서 "신규 학생 등록"은:
- 학생만 생성된 상태로는 의미가 없고
- 학부모 계정까지 함께 있어야 업무가 시작된다

즉, 이 작업은 처음부터 All or Nothing이어야 했다. 부분 성공을 허용하는 설계 자체가 도메인 요구사항과 맞지 않았다.

---

## 그래서 선택한 방법: 1-step API를 새로 만든다

기존 API를 그대로 두고, 그 위에 비즈니스 단위를 표현하는 API를 하나 더 추가했다:

```java
@Transactional
public StudentWithGuardiansResponse createStudentWithGuardians(Request request) {
    User student = createStudentUser(request.getStudent());

    List<User> guardians = new ArrayList<>();
    for (GuardianInfo info : request.getGuardians()) {
        User guardian = createGuardianUser(info);
        connectGuardian(student, guardian);
        guardians.add(guardian);
    }

    return new Response(student, guardians);
}
```

핵심은 이거다:
- 내부적으로는 여러 작업이지만
- 외부에는 하나의 원자적 작업으로 보인다
- 실패 시 전부 롤백된다

---

## "그럼 기존 API는 잘못 만든 건가?"

아니다.

기존 API들은:
- 독립적인 작업으로는 여전히 유효하고
- 다른 화면이나 다른 플로우에서는 그대로 쓸 수 있다

문제는 기존 API를 프론트에서 조합해 하나의 비즈니스 작업처럼 사용한 것이었다.

---

## 2-step과 "아예 분리된 흐름"은 다르다

여기서 말하는 2-step은 비즈니스가 분리된 워크플로우를 의미하지 않는다.

예를 들어:
```
학생 등록
    ↓ (며칠 후)
학부모 초대
```

이건:
- 다른 시점
- 다른 사용자 액션
- 각 단계가 독립적으로 의미 있음

이 경우엔 API 분리가 자연스럽다.

반면, 같은 화면에서 같은 버튼으로 실행되는 작업이라면 그건 하나의 비즈니스 작업이다.

---

## 판단 기준 정리

API를 나눌지, 합칠지 고민될 때 이 질문 하나로 정리할 수 있다:

**이 작업이 실패했을 때, 이미 성공한 일부 결과를 사용자에게 남기고 싶은가?**

- Yes → 분리된 API / 프론트 조합 가능
- No → 서버에서 1-step API로 책임져야 함

---

## 숫자로 보는 개선

| 항목 | Before (프론트 조합) | After (1-step API) |
|------|---------------------|-------------------|
| API 호출 횟수 | 5회 | 1회 |
| 프론트 코드 | 110줄 | 47줄 |
| 에러 케이스 | 5개 | 1개 |
| 트랜잭션 보장 | ❌ | ✅ |
| 부분 실패 처리 | 프론트 책임 | 없음 (All or Nothing) |

---

## 결론

문제는 "2-step이냐 1-step이냐"가 아니었다. 문제는 비즈니스 경계를 어디에 두느냐였다.

- 하나의 사용자 액션
- 하나의 비즈니스 의미
- 하나의 성공/실패

이 조건을 만족한다면, 기존 API를 조합하기보다 그 작업을 대표하는 API를 새로 만드는 편이 낫다.

하나의 비즈니스 작업을 표현하는 API가 존재한다면, 그 내부 구현이 여러 도메인 작업으로 나뉘더라도 외부에는 하나의 원자적 엔드포인트로 노출하는 것이 바람직하다.

프론트엔드는 오케스트레이션이 아니라 결과를 소비하는 쪽에 가까워야 한다.