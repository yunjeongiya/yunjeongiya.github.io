---
layout: post
title: "학생+학부모 동시 생성, 2-step에서 1-step API로"
date: 2025-12-27 10:00:00 +0900
categories: [Backend, API Design]
tags: [api-design, transaction, atomic-operation, refactoring, checkus]
lang: ko
slug: "020"
thumbnail: /assets/images/posts/020-1step-api-design-ko.png
---

![1-step vs 2-step API 디자인](/assets/images/posts/020-1step-api-design-ko.png){: width="600"}

## TL;DR
학생과 학부모를 각각 생성하던 2-step API를 하나의 트랜잭션으로 묶은 1-step API로 재설계했다. 부분 실패 없고, 코드 57% 줄고, 네트워크 요청 5회→1회로 줄었다.

---

## 처음 만든 2-step API

학원 시스템에서 신규 학생 등록은 학부모 계정도 함께 만들어야 한다. 처음엔 이렇게 구현했다:

```javascript
// Step 1: 학생 생성
const student = await createStudent({ name: "김민준", ... });

// Step 2: 학부모 계정 생성하고 연결
for (const guardian of guardians) {
  const guardianAccount = await registerGuardian({ ... });
  await connectGuardianToStudent(student.id, guardianAccount.id);
}
```

논리적으로 깔끔해 보였다. 학생 생성, 학부모 생성, 연결. 각자 역할이 명확하다.

---

## 현실에서 터진 문제들

### 1. 네트워크 에러 = 고아 계정

```
✅ 학생 생성 성공
❌ 학부모1 생성 실패 (네트워크 에러)
```

결과: 학부모 없는 학생 계정이 DB에 남는다. 수동으로 삭제해야 한다.

### 2. 부분 실패 처리 지옥

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
      // 실패한 학부모만 롤백? 전체 롤백? 🤔
    }
  }

  if (results.failed.length > 0) {
    // 부분 성공을 어떻게 처리하지?
    // 성공한 것만 유지? 전체 취소?
  }
} catch (error) {
  // 학생 생성 실패
}
```

코드가 복잡해지고, UX도 애매해진다.

### 3. 느린 속도

학부모 2명 등록 시:
- API 호출 5회 (학생 1 + 학부모 등록 2 + 연결 2)
- 각 100ms라면 최소 500ms
- 실제론 더 느림 (순차 처리)

---

## 1-step API로 재설계

모든 작업을 하나의 트랜잭션으로:

```java
@Transactional
public StudentWithGuardiansResponse createStudentWithGuardians(Request request) {
    // 1. 학생 계정 생성
    User student = createStudentUser(request.getStudent());

    // 2. 학부모 계정들 생성 & 연결
    List<Guardian> guardians = new ArrayList<>();
    for (GuardianInfo info : request.getGuardians()) {
        User guardian = createGuardianUser(info);
        connectGuardian(student, guardian);
        guardians.add(guardian);
    }

    // 3. 한 번에 응답
    return new Response(student, guardians);

    // 어디서든 에러 발생 시 → 전체 자동 롤백
}
```

---

## 개선 효과

### Before (2-step)
```javascript
// 프론트엔드 코드 110줄
const student = await studentApi.createStudent(request);
for (const guardian of data.guardians) {
  const registerResponse = await authService.registerGuardian(...);
  await studentGuardianApi.connectGuardianToStudent(...);
  // 복잡한 에러 처리...
}
```

### After (1-step)
```javascript
// 프론트엔드 코드 47줄 (57% 감소)
const response = await studentWithGuardiansApi.createStudentWithGuardians(request);
// 끝. 성공 or 실패만 존재
```

### 숫자로 보는 개선

| 항목 | Before | After | 개선 |
|------|--------|-------|------|
| API 호출 횟수 | 5회 | 1회 | 80% ⬇️ |
| 프론트 코드 | 110줄 | 47줄 | 57% ⬇️ |
| 에러 케이스 | 5개 | 1개 | 80% ⬇️ |
| 트랜잭션 보장 | ❌ | ✅ | 100% |

---

## 구현 시 고민했던 것들

### 1. API 경로 네이밍

```
❌ POST /students + body에 guardians 포함
   → RESTful하지 않음

❌ POST /registrations
   → 너무 일반적, 의미 불명확

✅ POST /students/with-guardians
   → 명확한 의도, RESTful 유지
```

### 2. 응답 구조

```json
{
  "student": {
    "id": 1234,
    "username": "student_01012345678",
    "temporaryPassword": "Temp1234!@"  // 선생님이 전달할 임시 비밀번호
  },
  "guardians": [{
    "id": 5678,
    "username": "guardian_01087654321",
    "relationship": "mother"
  }],
  "credentials": {  // 한 곳에 모아서 보안 관리
    "student": { "username": "...", "password": "..." },
    "guardians": [{ "username": "...", "password": "..." }]
  }
}
```

### 3. 중복 체크 타이밍

트랜잭션 내에서 모든 중복 체크:
1. 학생 username 중복 체크
2. 학생 phoneNumber 중복 체크
3. 각 학부모 username 중복 체크
4. 각 학부모 phoneNumber 중복 체크

하나라도 중복이면 전체 롤백.

---

## 배운 점

### 1. API는 사용자 관점에서

개발자 관점:
- "학생 생성"과 "학부모 생성"은 별개 작업
- 각각 API로 분리하는 게 깔끔

사용자 관점:
- "신규 학생 등록"은 하나의 작업
- 부분 성공은 의미 없음

**사용자 관점이 정답이다.**

### 2. 트랜잭션 경계 = API 경계

하나의 비즈니스 작업 = 하나의 트랜잭션 = 하나의 API

이 원칙을 지키면:
- 부분 실패 걱정 없음
- 복잡한 롤백 로직 불필요
- 프론트엔드 코드 단순

### 3. 네트워크 호출 최소화

5회 → 1회 줄이니:
- 응답 속도 체감 개선
- 네트워크 에러 가능성 감소
- 모바일 환경에서 특히 중요

---

## 마치며

2-step API가 항상 나쁜 건 아니다. 독립적인 작업이라면 분리가 맞다.

하지만 "학생+학부모 등록"처럼 **하나의 비즈니스 작업**이라면, 1-step API가 답이다.

복잡한 부분 실패 처리보다, 단순한 All or Nothing이 낫다.