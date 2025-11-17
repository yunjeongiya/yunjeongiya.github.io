---
layout: post
title: "멀티테넌시에서 데이터 유출 막는 4-Tier 보안 아키텍처"
date: 2025-11-17 10:00:00 +0900
categories: [Architecture, Backend]
tags: [multi-tenancy, spring-boot, aop, threadlocal, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: ko
slug: "013"
---

> **시리즈 안내**
> - Part 1: 하나의 계정, 여러 학원, 다양한 역할
> - **Part 2: 멀티테넌시에서 데이터 유출 막는 4-Tier 보안 아키텍처** ← 현재 글
> - Part 3: 여러 캠퍼스-여러 역할 JWT 설계와 ThreadLocal 안전성
> - Part 4: Row-Level Security 5가지 구현 방법 비교와 선택 가이드
> - Part 5: 레거시 시스템 멀티테넌시 전환

---

![CheckUS 4-Tier 보안 아키텍처](/assets/images/posts/013-4tier-security-architecture.png){: width="600"}

## 이전 이야기

[Part 1](/posts/012/)에서는 멀티테넌시의 세 가지 패턴(Database-per-Tenant, Schema-per-Tenant, Row-Level Security)과, CheckUS가 크로스 캠퍼스 지원을 위해 Row-Level Security를 선택한 이유를 살펴봤습니다.

**Row-Level Security는 훌륭한 방식이지만, 단 한 줄의 실수로 모든 캠퍼스 데이터가 유출될 수 있습니다.**

```java
// ❌ 단순한 실수 하나
@GetMapping("/students")
public List<Student> getStudents() {
    return studentRepository.findAll();  // 💥 3개 캠퍼스 전체 노출!
}
```

이 글에서는 CheckUS가 개발자 실수로부터 테넌트 격리를 보호하는 **4단계 안전망**을 어떻게 구축했는지 설명합니다.

---

## 4-Tier 아키텍처 개요

CheckUS는 프론트엔드부터 데이터베이스까지 **4단계의 보안 체크**를 구축했습니다.

```
🌐 Layer 1: Frontend (Axios Interceptor)
    ↓ X-Campus-Id 헤더 자동 추가

🔒 Layer 2: HTTP Interceptor (Spring)
    ↓ 헤더 파싱 + 권한 검증

🎯 Layer 3: AOP (@CampusFiltered)
    ↓ ThreadLocal 존재 여부 검증

💾 Layer 4: Service Layer
    ↓ ThreadLocal에서 campusId 가져와 쿼리
```

각 계층이 독립적으로 작동하며, **4단계 모두 통과**해야만 데이터에 접근할 수 있습니다.

---

## Layer 1: Frontend Axios Interceptor — 휴먼 에러 방지

### 문제 인식

프론트엔드에서 API 호출 시마다 수동으로 `X-Campus-Id` 헤더를 추가하면:

```typescript
// ❌ 모든 API 호출마다 반복
const students = await api.get('/students', {
  headers: { 'X-Campus-Id': currentCampusId }
});

const schedules = await api.get('/schedules', {
  headers: { 'X-Campus-Id': currentCampusId }  // 중복!
});
```

- ⚠️ 개발자가 깜빡하면 헤더 누락
- ⚠️ 코드 중복 (boilerplate)
- ⚠️ 캠퍼스 전환 로직이 흩어짐

### 해결책: Axios Request Interceptor

```typescript
// Frontend - API Client 설정 (src/api/axiosInstance.ts)

import axios from 'axios';
import { getCurrentCampusId } from '@/utils/campusContext';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

// 🎯 요청 인터셉터: 모든 API 호출에 X-Campus-Id 자동 추가
apiClient.interceptors.request.use(
  (config) => {
    const campusId = getCurrentCampusId();

    if (campusId) {
      config.headers['X-Campus-Id'] = campusId;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

export default apiClient;
```

**장점**
- ✅ 개발자는 `api.get('/students')` 만 호출
- ✅ `X-Campus-Id` 헤더가 **자동으로** 모든 요청에 추가
- ✅ 캠퍼스 전환 로직이 한 곳에 집중

### 캠퍼스 컨텍스트 관리

```typescript
// Frontend - Campus Context 관리 (src/utils/campusContext.ts)

import { create } from 'zustand';

interface CampusStore {
  currentCampusId: number | null;
  setCurrentCampusId: (campusId: number) => void;
}

export const useCampusStore = create<CampusStore>((set) => ({
  currentCampusId: null,
  setCurrentCampusId: (campusId) => set({ currentCampusId: campusId }),
}));

export const getCurrentCampusId = () => {
  return useCampusStore.getState().currentCampusId;
};
```

**사용 예시**

```typescript
// 컴포넌트에서 캠퍼스 전환
function CampusSwitcher() {
  const { setCurrentCampusId } = useCampusStore();

  const handleCampusChange = (campusId: number) => {
    setCurrentCampusId(campusId);  // 상태 변경만 하면 끝!
  };

  return <Select onChange={handleCampusChange}>...</Select>;
}

// API 호출 (헤더는 자동 추가됨)
function StudentList() {
  const { data } = useQuery(['students'], () =>
    api.get('/students')  // X-Campus-Id 헤더 자동 포함
  );

  return <div>{data.map(s => s.name)}</div>;
}
```

---

## Layer 2: Backend HTTP Interceptor — 권한 검증 게이트

### 역할

프론트엔드에서 보낸 `X-Campus-Id` 헤더를:
1. 파싱하여 추출
2. JWT 토큰과 비교하여 **권한 검증**
3. ThreadLocal에 저장

### 구현

```java
// Backend - HTTP Interceptor 구현

@Component
public class CampusContextInterceptor implements HandlerInterceptor {

    private final JwtTokenProvider jwtTokenProvider;

    @Override
    public boolean preHandle(HttpServletRequest request,
                           HttpServletResponse response,
                           Object handler) throws Exception {

        // 1. X-Campus-Id 헤더 추출
        String campusIdHeader = request.getHeader("X-Campus-Id");

        if (campusIdHeader == null || campusIdHeader.isEmpty()) {
            throw new BusinessException("CAMPUS_ID_REQUIRED",
                "X-Campus-Id 헤더가 필요합니다.");
        }

        Long requestedCampusId = Long.parseLong(campusIdHeader);

        // 2. JWT 토큰에서 사용자의 캠퍼스 권한 확인
        String token = extractToken(request);
        Set<Long> userCampusIds = jwtTokenProvider.getCampusIds(token);

        // 3. 권한 검증: 요청한 캠퍼스에 접근 권한이 있는가?
        if (!userCampusIds.contains(requestedCampusId)) {
            throw new BusinessException("CAMPUS_ACCESS_DENIED",
                "해당 캠퍼스에 접근 권한이 없습니다.");
        }

        // 4. ThreadLocal에 저장 (Layer 4에서 사용)
        CampusContextHolder.setCampusIds(Set.of(requestedCampusId));

        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request,
                               HttpServletResponse response,
                               Object handler,
                               Exception ex) {
        // 요청 완료 후 ThreadLocal 정리 (메모리 누수 방지)
        CampusContextHolder.clear();
    }

    private String extractToken(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
}
```

### ThreadLocal 저장소

```java
// Backend - ThreadLocal 저장소

public class CampusContextHolder {

    private static final ThreadLocal<Set<Long>> campusIdsHolder = new ThreadLocal<>();

    public static void setCampusIds(Set<Long> campusIds) {
        campusIdsHolder.set(campusIds);
    }

    public static Set<Long> getCampusIds() {
        return campusIdsHolder.get();
    }

    public static Long getSingleCampusId() {
        Set<Long> campusIds = getCampusIds();
        if (campusIds == null || campusIds.isEmpty()) {
            throw new BusinessException("CAMPUS_CONTEXT_EMPTY",
                "캠퍼스 컨텍스트가 설정되지 않았습니다.");
        }
        if (campusIds.size() > 1) {
            throw new BusinessException("MULTIPLE_CAMPUS_NOT_ALLOWED",
                "단일 캠퍼스만 허용됩니다.");
        }
        return campusIds.iterator().next();
    }

    public static void clear() {
        campusIdsHolder.remove();
    }
}
```

### 등록

```java
// Backend 구현

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final CampusContextInterceptor campusContextInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(campusContextInterceptor)
                .addPathPatterns("/students/**", "/schedules/**", "/tasks/**")
                .excludePathPatterns("/auth/**", "/health/**");
    }
}
```

**보안 강화 포인트**
- ✅ JWT 토큰과 헤더를 **Cross-check**: 위조된 `X-Campus-Id` 차단
- ✅ 권한 없는 캠퍼스 접근 시도를 **요청 초기 단계에서 차단**
- ✅ ThreadLocal 자동 정리로 **메모리 누수 방지**

---

## Layer 3: AOP @CampusFiltered — 개발 규칙 강제

### 문제 인식

Layer 2에서 ThreadLocal에 campusId를 저장했지만, 만약 개발자가:

```java
@GetMapping("/students")
public List<Student> getStudents() {
    // ThreadLocal 사용 안 함! 💥
    return studentRepository.findAll();
}
```

이렇게 ThreadLocal을 무시하고 전체 조회하면 여전히 데이터 유출 위험이 있습니다.

### 해결책: AOP로 자동 검증

```java
// Backend 구현

@Aspect
@Component
public class CampusFilterAspect {

    @Before("@annotation(CampusFiltered)")
    public void checkCampusContext(JoinPoint joinPoint) {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();

        // ThreadLocal이 비어있으면 에러!
        if (campusIds == null || campusIds.isEmpty()) {
            String methodName = joinPoint.getSignature().toShortString();
            throw new BusinessException("CAMPUS_CONTEXT_EMPTY",
                String.format("캠퍼스 컨텍스트가 설정되지 않았습니다. [%s]", methodName));
        }

        // 로깅 (개발 환경에서 디버깅용)
        log.debug("Campus filtering applied: campusIds={}, method={}",
                  campusIds, joinPoint.getSignature().toShortString());
    }
}
```

### @CampusFiltered 어노테이션

```java
// Backend 구현

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CampusFiltered {
    /**
     * 여러 캠퍼스 동시 조회 허용 여부
     * - true: Set<Long> campusIds 사용 가능
     * - false: 단일 campusId만 허용 (기본값)
     */
    boolean allowMultiple() default false;
}
```

### Service Layer 사용 예시

```java
// Backend 구현

@Service
@Transactional(readOnly = true)
public class StudentService {

    private final StudentRepository studentRepository;

    /**
     * ✅ 안전한 구현: @CampusFiltered + ThreadLocal 사용
     */
    @CampusFiltered
    public List<Student> getStudents() {
        Long campusId = CampusContextHolder.getSingleCampusId();
        return studentRepository.findByCampusId(campusId);
    }

    /**
     * ✅ 여러 캠퍼스 동시 조회
     */
    @CampusFiltered(allowMultiple = true)
    public List<Student> getStudentsAcrossCampuses() {
        Set<Long> campusIds = CampusContextHolder.getCampusIds();
        return studentRepository.findByCampusIdIn(campusIds);
    }

    /**
     * ❌ 만약 @CampusFiltered 없이 ThreadLocal 사용 안 하면?
     * → AOP가 없어서 에러가 발생하지 않음 (위험!)
     */
    // public List<Student> getDangerousMethod() {
    //     return studentRepository.findAll();  // 💥 전체 데이터 노출
    // }
}
```

**AOP의 역할**
- ✅ 메서드 실행 전 **자동으로** ThreadLocal 존재 여부 검증
- ✅ 개발자가 ThreadLocal 사용을 깜빡해도 **런타임 에러로 즉시 감지**
- ✅ `@CampusFiltered` 어노테이션으로 **의도를 명시적으로 표현**

---

## Layer 4: Repository Layer — 최종 쿼리 격리

### JPA Repository 메서드

```java
// Backend 구현

@Repository
public interface StudentRepository extends JpaRepository<Student, Long> {

    // 단일 캠퍼스 조회
    List<Student> findByCampusId(Long campusId);

    // 여러 캠퍼스 동시 조회
    List<Student> findByCampusIdIn(Set<Long> campusIds);

    // 복잡한 조건 + 캠퍼스 필터링
    @Query("""
        SELECT s FROM Student s
        WHERE s.campusId = :campusId
          AND s.grade = :grade
          AND s.deletedAt IS NULL
    """)
    List<Student> findActiveByCampusIdAndGrade(
        @Param("campusId") Long campusId,
        @Param("grade") Integer grade
    );
}
```

### Native Query에서도 안전하게

```java
@Repository
public interface StudentRepository extends JpaRepository<Student, Long> {

    @Query(value = """
        SELECT s.*, AVG(st.duration) as avg_study_time
        FROM students s
        LEFT JOIN study_times st ON s.id = st.student_id
        WHERE s.campus_id = :campusId
        GROUP BY s.id
    """, nativeQuery = true)
    List<StudentWithAvgStudyTime> findStudentsWithAvgStudyTime(
        @Param("campusId") Long campusId
    );
}
```

**핵심 원칙**
- ✅ 모든 쿼리에 `WHERE campus_id = :campusId` 포함
- ✅ campusId는 **ThreadLocal에서만 가져옴** (파라미터로 받지 않음)
- ✅ Native Query도 예외 없이 필터링 적용

---

## 프론트엔드 보호: ESLint 규칙

백엔드가 격리되어 있어도, 프론트엔드에서 요청 Body에 `campusId`를 보내면 아키텍처가 깨질 수 있습니다.

팀 전체가 규칙을 지키도록, CheckUS는 커스텀 ESLint 규칙을 도입했습니다.

### 문제 인식

백엔드는 4-Tier로 보호했지만, 프론트엔드에서 실수로:

```typescript
// ❌ Request Body에 campusId를 포함하는 실수
export interface StudentCreateRequest {
  campusId: number;  // 💥 불필요! X-Campus-Id 헤더로 전달됨
  name: string;
  grade: number;
}
```

이런 코드가 생기면:
- ⚠️ 백엔드와 중복 (헤더 + Body 둘 다 전달)
- ⚠️ 헤더와 Body가 다를 경우 혼란
- ⚠️ CheckUS 아키텍처 규칙 위반

### 해결책: ESLint 커스텀 규칙

```javascript
// Frontend 구현

export default tseslint.config(
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Request 타입에 campusId 필드 사용 금지
          selector: "TSInterfaceDeclaration[id.name=/Request$/]:has(TSPropertySignature[key.name='campusId']):not([id.name='WeeklyScheduleRequest']):not([id.name='CreateExceptionRequest']):not([id.name='UpdateExceptionRequest'])",
          message: "❌ [F067] Request 타입에 campusId 필드를 사용하지 마세요. CheckUS는 X-Campus-Id 헤더로 자동 전달합니다."
        }
      ]
    }
  }
);
```

**동작 방식**
```typescript
// ❌ ESLint 에러 발생!
export interface StudentCreateRequest {
  campusId: number;
  // ❌ [F067] Request 타입에 campusId 필드를 사용하지 마세요.
  name: string;
}

// ✅ 올바른 구현
export interface StudentCreateRequest {
  name: string;  // campusId는 X-Campus-Id 헤더로 자동 전달됨
  grade: number;
}
```

**예외 케이스**
- `WeeklyScheduleRequest`: EXTERNAL 타입은 campusId 선택적
- `CreateExceptionRequest`: 전체 캠퍼스 적용 시 campusId = null
- `UpdateExceptionRequest`: 동일

**장점**
- ✅ **컴파일 타임에** 아키텍처 위반 감지
- ✅ VSCode에서 **즉시 빨간 줄**로 표시
- ✅ CI/CD 파이프라인에서 **자동으로 검증**

---

## 4-Tier가 함께 작동하는 전체 흐름

### 시나리오: 학생 목록 조회

```
1. 🌐 Frontend (Axios Interceptor)
   사용자: 강남 독서실 선택
   Zustand Store: currentCampusId = 1
   Axios: GET /students + header { X-Campus-Id: 1 }

   ↓

2. 🔒 HTTP Interceptor (Spring)
   헤더 파싱: campusId = 1
   JWT 검증: 사용자는 [1, 2] 캠퍼스 권한 있음 → ✅ 통과
   ThreadLocal: CampusContextHolder.set([1])

   ↓

3. 🎯 AOP (@CampusFiltered)
   @Before: ThreadLocal 존재 확인 → ✅ 있음
   로깅: "Campus filtering: campusIds=[1], method=getStudents()"

   ↓

4. 💾 Service Layer
   StudentService.getStudents():
     - campusId = CampusContextHolder.getSingleCampusId()  // 1
     - studentRepository.findByCampusId(1)
     - SQL: SELECT * FROM students WHERE campus_id = 1

   ↓

5. 📤 Response
   강남 독서실 학생들만 반환 ✅
```

### 공격 시나리오: 권한 없는 캠퍼스 조회 시도

```
1. 🌐 Frontend (악의적 요청)
   해커: X-Campus-Id: 999 (권한 없는 캠퍼스)

   ↓

2. 🔒 HTTP Interceptor
   JWT 검증: 사용자는 [1, 2] 권한만 있음
   999는 포함 안 됨 → ❌ CAMPUS_ACCESS_DENIED 예외

   요청 차단! (Layer 3, 4 실행되지 않음)
```

### 개발자 실수 시나리오: ThreadLocal 사용 누락

```
1-2. Frontend → HTTP Interceptor
   정상 처리, ThreadLocal에 campusId = 1 저장

   ↓

3. 🎯 AOP
   @Before: ThreadLocal 존재 확인 → ✅ 있음

   ↓

4. 💾 Service Layer (개발자 실수)
   @CampusFiltered
   public List<Student> getBuggyMethod() {
       // ThreadLocal 사용 안 함!
       return studentRepository.findAll();  // 💥
   }

   결과: AOP는 통과했지만, 전체 데이터 조회

   ⚠️ 이 케이스는 4-Tier로 완전히 방지 불가
   → 코드 리뷰 + 통합 테스트로 보완 필요
```

**한계와 보완책**
- ❌ AOP는 ThreadLocal **존재 여부**만 확인, **사용 여부**는 검증 불가
- ✅ 보완책 1: 코드 리뷰에서 `@CampusFiltered` 메서드는 반드시 ThreadLocal 사용 확인
- ✅ 보완책 2: 통합 테스트에서 다른 캠퍼스 데이터가 섞이지 않는지 검증

---

## 4-Tier 아키텍처의 장점

### 1. 다층 방어 (Defense in Depth)

```
Frontend (1차 방어) → HTTP (2차 방어) → AOP (3차 방어) → Service (4차 방어)
```

- ✅ 한 계층이 뚫려도 다음 계층이 막음
- ✅ 보안 사고 가능성 최소화

### 2. 명시적 의도 표현

```java
@CampusFiltered  // "이 메서드는 캠퍼스 필터링이 필요합니다"
public List<Student> getStudents() {
    ...
}
```

- ✅ 코드만 봐도 캠퍼스 필터링 여부 명확
- ✅ 신규 개발자 온보딩 시 이해 쉬움

### 3. 일관된 패턴

```java
// 모든 Service 메서드가 동일한 패턴
@CampusFiltered
public List<X> getX() {
    Long campusId = CampusContextHolder.getSingleCampusId();
    return xRepository.findByCampusId(campusId);
}
```

- ✅ 학습 곡선 낮음
- ✅ 코드 리뷰 쉬움

### 4. 프론트엔드-백엔드 통합

- ✅ Axios Interceptor + ESLint로 프론트엔드도 보호
- ✅ 팀 전체가 동일한 아키텍처 규칙 준수

---

## 요약: 왜 4개 계층이 필요한가?

| 계층 | 막는 실수 |
|------|----------|
| **Layer 1: Axios Interceptor** | 개발자가 `X-Campus-Id` 헤더 추가를 잊을 수 없음 |
| **Layer 2: HTTP Interceptor** | 백엔드가 위조되거나 권한 없는 `campusId`를 받아들일 수 없음 |
| **Layer 3: AOP** | 개발자가 캠퍼스 필터링 로직을 건너뛸 수 없음 |
| **Layer 4: Repository** | 쿼리가 실수로 다른 캠퍼스 데이터를 조회할 수 없음 |

**4개 계층이 모두 작동해야만** 완벽한 데이터 격리가 보장됩니다.

- Layer 1만 있으면? → 악의적인 클라이언트가 헤더를 위조 가능
- Layer 2까지만? → 개발자 실수로 ThreadLocal 무시 가능
- Layer 3까지만? → 네이티브 쿼리에서 필터링 누락 가능
- **Layer 4까지** → ✅ 완벽한 격리 보장

---

## 다음 편 예고

Part 2에서는 CheckUS의 4-Tier 아키텍처가 어떻게 구현되는지, 각 계층의 역할과 코드를 자세히 살펴봤습니다.

**Part 3: 여러 캠퍼스-여러 역할 JWT 설계와 ThreadLocal 안전성**에서는:

- 🔐 JWT 토큰 설계: 여러 캠퍼스 역할을 어떻게 담을까?
- ⚡ ThreadLocal 성능 이슈와 해결책
- 🧪 통합 테스트: 캠퍼스 격리를 어떻게 검증할까?
- 📊 모니터링: 캠퍼스 필터링 누락을 실시간 감지
- 🐛 실제 운영 중 발견한 엣지 케이스

실전에서 마주한 문제들과 해결 과정을 공개합니다.

**👉 [Part 3: 여러 캠퍼스-여러 역할 JWT 설계와 ThreadLocal 안전성](/posts/014/)에서 계속됩니다.**

---

**CheckUS 아키텍처 시리즈**
- Part 1: 하나의 계정, 여러 학원, 다양한 역할
- Part 2: 멀티테넌시에서 데이터 유출 막는 4-Tier 보안 아키텍처 ← 현재 글
- Part 3: 여러 캠퍼스-여러 역할 JWT 설계와 ThreadLocal 안전성
- Part 4: Row-Level Security 5가지 구현 방법 비교와 선택 가이드
- Part 5: 레거시 시스템 멀티테넌시 전환
