---
layout: post
title: "React Query 멀티테넌트 캐싱: 왜 캠퍼스 바꿔도 데이터가 안 바뀔까?"
date: 2025-11-09 16:00:00 +0900
categories: [React, Frontend]
tags: [react-query, multi-tenancy, caching, axios, cors]
lang: ko
slug: "007"
---

## TL;DR
React Query 쿼리 키에 tenantId(campusId) 안 넣어서 캐시가 구분이 안 됐다. 넣으니까 바로 해결.

---

## 드롭다운은 바뀌는데 데이터는 안 바뀌는 문제

학원 관리 시스템 만들면서 겪은 일이다. 우측 상단에 캠퍼스 선택 드롭다운이 있고, 선택하면 그 캠퍼스 데이터만 보여야 한다.

```
사용자: 광주캠퍼스 → 서울캠퍼스 (드롭다운 클릭)
화면: 여전히 광주캠퍼스 데이터 표시 😱
사용자: F5 (새로고침)
화면: 이제야 서울캠퍼스 데이터 표시 ✅
```

React Query 쓰고 있는데 왜 이럴까? 처음엔 "서버가 잘못 보내주나?" 싶었는데, 네트워크 탭을 보니 **API 호출 자체가 안 일어나고 있었다**.

---

## 원인: React Query는 쿼리 키가 신이다

React Query는 쿼리 키가 같으면 캐시된 데이터를 쓴다. 당연한 얘기지만 놓치기 쉽다.

### 문제가 된 코드

```tsx
// ❌ 캠퍼스가 바뀌어도 쿼리 키가 그대로
export const useTrashTreeStructure = (type?: string) => {
  return useQuery({
    queryKey: ['trash', 'tree', { type }],  // campusId가 없음!
    queryFn: () => trashApi.getTrashTreeStructure(type),
  });
};
```

캠퍼스를 1번에서 2번으로 바꿔도 쿼리 키는 `['trash', 'tree', { type }]`로 똑같다. React Query 입장에서는 "같은 데이터 요청이네? 캐시에 있는 거 줄게!" 하는 거다.

### 서버는 쿠키로 구분하는데...

백엔드는 쿠키로 캠퍼스를 구분하고 있었다:

```java
Cookie[] cookies = request.getCookies();
for (Cookie cookie : cookies) {
    if ("selectedCampusId".equals(cookie.getName())) {
        campusId = cookie.getValue();
    }
}
```

쿠키는 자동으로 가니까 서버는 문제없다. 하지만 **프론트엔드 캐시가 문제**였다.

---

## 해결: 쿼리 키에 campusId 넣기

간단하다. 쿼리 키에 campusId를 넣으면 된다.

### Step 1: 쿼리 키에 campusId 추가

```tsx
// ✅ campusId가 바뀌면 쿼리 키도 바뀜
import { getCampusCookie } from '@/utils/cookies';

export const useTrashTreeStructure = (type?: string) => {
  const campusId = getCampusCookie();

  return useQuery({
    queryKey: ['trash', 'tree', { type, campusId }], // campusId 추가!
    queryFn: () => trashApi.getTrashTreeStructure(type),
  });
};
```

이제 캠퍼스를 바꾸면:
1. 쿠키 업데이트: `setCampusCookie(2)`
2. 컴포넌트 리렌더
3. 쿼리 키 변경: `{ campusId: 1 }` → `{ campusId: 2 }`
4. React Query: "새 데이터 fetch!"

### Step 2: 명시적으로 헤더 보내기 (선택사항)

쿠키만 쓰면 디버깅할 때 불편하다. 네트워크 탭에서 뭘 보냈는지 안 보인다. 그래서 헤더도 같이 보내기로 했다.

```tsx
// axios interceptor
axiosInstance.interceptors.request.use(
  async (config) => {
    const campusId = getCampusCookie();
    if (campusId !== null) {
      config.headers['X-Campus-Id'] = campusId.toString();
    }
    return config;
  }
);
```

서버도 헤더를 우선적으로 읽도록 수정:

```java
// 1순위: 헤더
String campusIdParam = request.getHeader("X-Campus-Id");

// 2순위: 헤더 없으면 쿠키 (하위 호환성)
if (campusIdParam == null) {
    // 쿠키에서 읽기
}
```

이제 네트워크 탭에서 `X-Campus-Id: 2` 헤더가 보인다. 디버깅이 훨씬 쉬워졌다.

---

## 모든 훅에 적용

휴지통만 고치면 안 된다. 캠퍼스별로 데이터가 다른 모든 API에 적용해야 한다.

```tsx
// 학생 상세
export const useStudentDetail = (studentId: number) => {
  const campusId = getCampusCookie();
  return useQuery({
    queryKey: ['students', studentId, { campusId }],  // 여기도
    queryFn: () => studentApi.getStudentDetail(studentId),
  });
};

// 과제 템플릿 목록
export const useTaskTemplates = () => {
  const campusId = getCampusCookie();
  return useQuery({
    queryKey: ['task-templates', { campusId }],  // 여기도
    queryFn: () => taskApi.getTaskTemplates(),
  });
};
```

패턴이 보이나? **모든 쿼리 키에 campusId를 넣는다**.

---

## 전체 흐름 정리

```
[캠퍼스 드롭다운 변경]
    ↓
setCampusCookie(2)  // 쿠키 업데이트
    ↓
컴포넌트 리렌더
    ↓
getCampusCookie() → 2  // 새 값
    ↓
쿼리 키: { campusId: 1 } → { campusId: 2 }
    ↓
React Query: "새 쿼리네? fetch!"
    ↓
axios: X-Campus-Id: 2 헤더 추가
    ↓
서버: 캠퍼스 2 데이터만 반환
    ↓
화면 즉시 업데이트 ✨
```

---

## 결과

### Before
- 캠퍼스 변경 → F5 필요
- 사용자: "버그인가요?"
- 개발자: "새로고침하세요..."

### After
- 캠퍼스 변경 → 즉시 반영
- 캠퍼스별 캐시 분리 (성능도 좋아짐)
- 네트워크 탭에서 헤더로 확인 가능

---

## 배운 점

### 1. React Query 쿼리 키는 데이터의 모든 의존성을 담아야 한다

```tsx
// ❌ Bad
queryKey: ['students']  // 어느 캠퍼스? 어떤 필터?

// ✅ Good
queryKey: ['students', { campusId, grade, status }]  // 명확
```

### 2. 멀티테넌트는 처음부터 설계하자

나중에 추가하려면 모든 훅을 다 고쳐야 한다. 처음부터:
- 쿼리 키에 tenantId 포함
- axios interceptor로 헤더 자동 추가
- 서버에서 자동 필터링

### 3. 쿠키 vs 헤더

| 쿠키 | 헤더 |
|------|------|
| 자동 전송 | 명시적 |
| 디버깅 어려움 | 네트워크 탭에서 보임 |
| CORS 복잡 | CORS 설정 필요 |

둘 다 쓰면 좋다. 헤더 우선, 쿠키 백업.

---

## CORS 주의사항

커스텀 헤더 쓸 거면 CORS 설정 필수:

```java
configuration.setAllowedHeaders(Arrays.asList(
    "Authorization",
    "Content-Type",
    "X-Campus-Id"  // 이거 빼먹으면 preflight에서 막힘
));
```

---

## 다음 개선 아이디어

지금은 매번 쿠키를 읽는데, Context로 관리하면 더 깔끔할 듯:

```tsx
// 미래
const { currentCampusId } = useCampus();  // Context
queryKey: ['students', currentCampusId]
```

---

**핵심**: React Query로 멀티테넌트 앱 만들 때는 쿼리 키에 tenantId를 꼭 넣자. 안 그러면 나처럼 "왜 안 바뀌지?" 하면서 한참 헤맨다. 🤦‍♂️