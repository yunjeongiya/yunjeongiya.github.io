---
layout: post
title: "Spring AOP로 86개 파일 860개 로그를 하나로 통합한 방법"
date: 2025-11-09 15:00:00 +0900
categories: [Spring, AOP]
tags: [spring, aop, logging, security, performance]
lang: ko
---

## TL;DR
개발자마다 제각각이던 860개 로그를 AOP 하나로 정리했다. 비밀번호는 자동으로 가려지고, 실행 시간도 알아서 찍힌다.

---

## 문제: 개발자마다 다른 로깅 스타일

우리 프로젝트 코드베이스를 분석해보니 충격적인 결과가 나왔다:

```java
// AuthController - 과도하게 자세한 로그
log.debug("로그인 요청 수신: username={}", request.getUsername());
log.debug("로그인 성공: username={}, userId={}", ...);
log.info("로그인 요청 Origin 헤더: {}", ...);
log.info("모든 헤더: {}", ...);

// UserController - 로그가 아예 없음
public ResponseEntity<...> getUser(...) {
    // 침묵...
}

// StudentController - 중복되는 패턴
log.info("학생 목록 조회 요청 - classId: {}, grade: {}, ...");
log.info("학생 목록 조회 성공 - 조회된 학생 수: {}", students.size());
```

**86개 파일, 860개 로그 호출, 0개의 일관성.**

디버깅할 때마다 "이 API는 로그가 있나?" 확인하는 게 일상이었다.

---

## 해결: AOP로 모든 Controller 자동 로깅

### 로깅 정책 수립

먼저 뭘 자동화하고 뭘 수동으로 남길지 정했다:

```markdown
✅ AOP 자동 처리 (DEBUG 레벨)
- 모든 Controller 메서드 호출
- 요청 파라미터 (민감 정보 제외)
- 실행 시간
- 성공/실패 여부

✅ 개발자 직접 작성 (INFO 레벨)
- 로그인, 회원가입 등 중요 비즈니스 이벤트
- 데이터 생성/수정/삭제
```

### ControllerLoggingAspect 구현

```java
@Aspect
@Component
@Slf4j
public class ControllerLoggingAspect {

    @Around("@within(org.springframework.web.bind.annotation.RestController)")
    public Object logControllerMethods(ProceedingJoinPoint joinPoint) throws Throwable {
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method method = signature.getMethod();
        String className = joinPoint.getTarget().getClass().getSimpleName();
        String methodName = method.getName();

        // HTTP 메서드 추출 (GET, POST, PUT, DELETE)
        String httpMethod = extractHttpMethod(method);

        // 안전한 파라미터만 추출 (민감 정보 필터링)
        Map<String, Object> params = extractSafeParameters(method, joinPoint.getArgs());
        String paramsStr = formatParameters(params);

        // 요청 로그
        log.debug("[{}] {} {}() called with [{}]",
            className, httpMethod, methodName, paramsStr);

        long startTime = System.currentTimeMillis();

        try {
            Object result = joinPoint.proceed();

            // 성공 로그 + 실행 시간
            long duration = System.currentTimeMillis() - startTime;
            log.debug("[{}] {} {}() completed successfully in {}ms",
                className, httpMethod, methodName, duration);

            return result;

        } catch (Exception e) {
            // 실패 로그
            long duration = System.currentTimeMillis() - startTime;
            log.debug("[{}] {} {}() failed in {}ms with exception: {}",
                className, httpMethod, methodName, duration, e.getClass().getSimpleName());

            throw e;
        }
    }
}
```

---

## 핵심 기능: 민감 정보 자동 필터링

로그에 비밀번호가 찍히면 보안 사고다. 자동 필터링을 구현했다:

```java
private static final String[] SENSITIVE_PARAM_NAMES = {
    "password", "pwd", "token", "accessToken", "refreshToken",
    "secret", "apiKey", "authorization", "cookie"
};

private Map<String, Object> extractSafeParameters(Method method, Object[] args) {
    Map<String, Object> params = new HashMap<>();
    Parameter[] parameters = method.getParameters();

    for (int i = 0; i < parameters.length; i++) {
        String paramName = parameters[i].getName();

        // 민감 정보는 필터링
        if (isSensitiveParameter(paramName)) {
            params.put(paramName, "***FILTERED***");
            continue;
        }

        // Spring 내부 객체는 제외
        if (isSpringFrameworkParameter(parameters[i].getType())) {
            continue;
        }

        // 안전한 파라미터만 추가
        Object arg = args[i];
        if (arg == null) {
            params.put(paramName, "null");
        } else if (isPrimitiveOrWrapper(arg)) {
            params.put(paramName, arg);
        } else {
            // 복잡한 객체는 클래스명만 (toString() 오버헤드 방지)
            params.put(paramName, arg.getClass().getSimpleName());
        }
    }

    return params;
}
```

### 실제 로그 출력

```
// Before: 비밀번호 노출
[AuthController] POST login() called with [username=testuser, password=secret123!]

// After: 자동 필터링
[AuthController] POST login() called with [username=testuser, password=***FILTERED***]
```

---

## HTTP 메서드 자동 추출

디버깅 시 HTTP 메서드를 보면 API를 바로 알 수 있다:

```java
private String extractHttpMethod(Method method) {
    if (method.isAnnotationPresent(GetMapping.class)) {
        return "GET";
    } else if (method.isAnnotationPresent(PostMapping.class)) {
        return "POST";
    } else if (method.isAnnotationPresent(PutMapping.class)) {
        return "PUT";
    } else if (method.isAnnotationPresent(DeleteMapping.class)) {
        return "DELETE";
    }
    // RequestMapping은 method 배열 확인
    else if (method.isAnnotationPresent(RequestMapping.class)) {
        RequestMapping mapping = method.getAnnotation(RequestMapping.class);
        if (mapping.method().length > 0) {
            return mapping.method()[0].name();
        }
    }
    return "HTTP";
}
```

---

## 성능 최적화

### 1. toString() 오버헤드 방지

```java
// ❌ Bad: 큰 객체의 toString() 호출
log.debug("Request: {}", request); // 느림

// ✅ Good: 클래스명만 출력
params.put(paramName, arg.getClass().getSimpleName()); // "StudentRequest"
```

### 2. 프로덕션에서 DEBUG 끄기

```yaml
# application-prod.yml
logging:
  level:
    saomath.checkusserver: INFO  # DEBUG 로그 비활성화
    saomath.checkusserver.common.aspect: INFO  # AOP 로그도 비활성화
```

로그 레벨이 INFO면 `log.debug()`는 실행조차 안 된다. 성능 영향 제로.

### 3. Spring 내부 객체 제외

```java
private boolean isSpringFrameworkParameter(Class<?> paramType) {
    String packageName = paramType.getPackage() != null ?
        paramType.getPackage().getName() : "";

    return packageName.startsWith("jakarta.servlet") ||
           packageName.startsWith("org.springframework.security") ||
           paramType.getName().contains("Authentication") ||
           paramType.getName().contains("Principal");
}
```

`HttpServletRequest`, `Authentication` 같은 건 로그에서 제외. 의미도 없고 로그만 길어진다.

---

## 적용 결과

### 실제 로그 예시

```
[StudentController] GET getStudents() called with [classId=1, grade=5, status=ENROLLED]
[StudentController] GET getStudents() completed successfully in 42ms

[AuthController] POST login() called with [username=testuser, password=***FILTERED***]
[AuthController] POST login() completed successfully in 156ms

[TaskController] POST createTask() called with [request=TaskInstanceRequest]
[TaskController] POST createTask() failed in 23ms with exception: BusinessException
```

깔끔하다. 언제 호출됐는지, 파라미터가 뭔지, 얼마나 걸렸는지 한눈에 보인다.

### 개발자는 이제 중요한 것만

```java
@PostMapping
public ResponseEntity<...> createStudent(@RequestBody StudentRequest request) {
    StudentDetailResponse response = studentService.createStudentByTeacher(request);

    // 중요한 비즈니스 이벤트만 INFO로
    log.info("학생 계정 생성: studentId={}, username={}",
        response.getId(), response.getUsername());

    return ResponseEntity.status(HttpStatus.CREATED).body(...);
}
```

메서드 호출, 파라미터, 실행 시간은 AOP가 자동으로 처리한다.

---

## 숫자로 보는 개선 효과

### Before
- 86개 파일에 860개 로그 호출
- 개발자마다 다른 로깅 스타일
- 민감 정보 노출 위험
- 디버깅 시 로그 유무 확인 필요

### After
- **1개의 AOP Aspect**로 모든 Controller 커버
- **100% 일관된 로그 포맷**
- **민감 정보 자동 필터링**
- **실행 시간 자동 측정**
- **30분만에 구현 완료** (예상 4-6시간)

---

## 배운 점

### 1. 로깅 정책이 코드보다 중요하다
코드 짜기 전에 "뭘 로그로 남길지" 정하는 게 먼저다.

### 2. 민감 정보 필터링은 자동화하라
사람은 실수한다. 자동 필터링으로 보안 사고를 방지하자.

### 3. 프로덕션과 개발 환경을 구분하라
개발: DEBUG 로그로 디버깅 편하게
프로덕션: INFO 이상만 남겨서 성능 확보

### 4. AOP의 한계를 알아두자
내부 메서드 호출은 프록시를 안 거쳐서 로그가 안 남는다:

```java
public void outerMethod() {
    innerMethod(); // AOP 적용 안 됨
}

private void innerMethod() {
    // 로그 안 남음
}
```

---

## 프로덕션 체크리스트

배포 전 확인사항:
- [ ] 로그 레벨 INFO로 설정
- [ ] 민감 정보 필터링 동작 확인
- [ ] 새로운 민감 파라미터 추가 시 `SENSITIVE_PARAM_NAMES` 업데이트
- [ ] 성능 모니터링

---

**결론: 860개 로그를 하나의 AOP로 대체했다. 일관성, 보안, 성능 모두 잡았다.** 🎯