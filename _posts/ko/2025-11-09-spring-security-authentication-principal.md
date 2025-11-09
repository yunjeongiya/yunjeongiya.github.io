---
layout: post
title: "Spring Security: @AuthenticationPrincipal이 커스텀 @CurrentUser보다 나은 이유"
date: 2025-11-09 14:00:00 +0900
categories: [Spring, Security]
tags: [spring, spring-security, authentication, refactoring, best-practices]
lang: ko
---

## TL;DR
Controller에서 인증 정보를 가져오려고 커스텀 `@CurrentUser` 어노테이션을 만들려다가, Spring Security가 이미 제공하는 `@AuthenticationPrincipal`을 발견. 바퀴를 재발명하지 말자.

---

## 문제: 보일러플레이트 코드의 반복

모든 Controller 메서드에서 이런 코드를 반복하고 있었다:

```java
@PostMapping("/assign")
public ResponseEntity<...> assignStudyTime(@RequestBody Request request) {
    // 매번 이 8줄을 반복...
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || !(authentication.getPrincipal() instanceof CustomUserPrincipal)) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ResponseBase.error("인증이 필요합니다."));
    }

    CustomUserPrincipal principal = (CustomUserPrincipal) authentication.getPrincipal();
    Long teacherId = principal.getId();
    // ... 실제 비즈니스 로직
}
```

3개 Controller 메서드에서 총 29줄의 중복 코드. 더 많은 엔드포인트가 추가될수록 이 보일러플레이트는 계속 늘어난다.

---

## 첫 번째 시도: 커스텀 @CurrentUser 만들기

처음엔 커스텀 어노테이션과 ArgumentResolver를 만들 계획이었다:

```java
// 1. 커스텀 어노테이션
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentUser {
}

// 2. ArgumentResolver 구현
@Component
public class CurrentUserArgumentResolver implements HandlerMethodArgumentResolver {
    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentUser.class);
    }

    @Override
    public Object resolveArgument(...) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof CustomUserPrincipal)) {
            throw new UnauthorizedException("인증이 필요합니다.");
        }
        return auth.getPrincipal();
    }
}

// 3. WebMvcConfigurer에 등록
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CurrentUserArgumentResolver());
    }
}
```

예상 작업 시간: 2-3시간 (구현 + 테스트)

---

## 발견: Spring Security가 이미 제공하고 있었다

코드베이스를 조사하던 중 발견한 사실:

```bash
# 기존 코드에서 이미 사용 중이었다!
grep -r "@AuthenticationPrincipal" src/
```

```java
// CampusEventController.java
@PostMapping
public ResponseEntity<...> createEvent(
    @RequestBody EventRequest request,
    @AuthenticationPrincipal CustomUserPrincipal principal) {  // 이미 있네?
    // ...
}
```

Spring Security가 이미 `@AuthenticationPrincipal`을 제공하고 있었고, 프로젝트 일부에서는 이미 사용 중이었다.

---

## 해결: @AuthenticationPrincipal 적용

커스텀 구현 대신 Spring 표준을 사용:

```java
// Before: 17줄
@GetMapping("/me")
public ResponseEntity<...> getCurrentUser() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    log.debug("Authentication: {}", authentication != null ? authentication.getClass().getSimpleName() : "null");

    if (authentication == null || !(authentication.getPrincipal() instanceof CustomUserPrincipal)) {
        log.warn("Authentication failed - authentication: {}, principal type: {}",
                authentication != null ? "present" : "null",
                authentication != null ? authentication.getPrincipal().getClass().getSimpleName() : "null");
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ResponseBase.error("인증되지 않은 사용자입니다."));
    }

    CustomUserPrincipal userPrincipal = (CustomUserPrincipal) authentication.getPrincipal();
    log.debug("User principal: ID={}, Username={}", userPrincipal.getId(), userPrincipal.getUsername());
    // ...
}

// After: 6줄
@GetMapping("/me")
public ResponseEntity<...> getCurrentUser(
        @AuthenticationPrincipal CustomUserPrincipal userPrincipal) {

    log.debug("User principal: ID={}, Username={}", userPrincipal.getId(), userPrincipal.getUsername());
    // ...
}
```

---

## 결과

### 코드 감소
- StudyTimeController: 8줄 감소 (53%)
- UserController.getCurrentUser(): 11줄 감소 (65%)
- UserController.updateProfile(): 10줄 감소 (59%)
- **총 29줄 제거**

### 실제 작업 시간
- 예상: 2-3시간 (커스텀 구현)
- 실제: 30분 (기존 기능 활용)
- 절약: 1.5-2.5시간

### 추가 이점
- Spring Security가 자동으로 401 처리
- 테스트 시 Mock 주입 용이
- 유지보수할 커스텀 코드 없음

---

## Spring Security의 다른 유용한 어노테이션들

이번에 알게 된 것들:

```java
// Principal 객체 전체
@GetMapping("/profile")
public String profile(@AuthenticationPrincipal CustomUserPrincipal principal) {
    return principal.getUsername();
}

// SpEL로 특정 필드만
@GetMapping("/username")
public String username(@AuthenticationPrincipal(expression = "username") String username) {
    return username;
}

// SecurityContext 전체
@GetMapping("/context")
public String context(@CurrentSecurityContext SecurityContext context) {
    return context.getAuthentication().getName();
}
```

---

## 배운 점

### 1. 코드베이스 먼저 검색하기
새 기능을 만들기 전에 항상:
- 기존 코드에서 비슷한 패턴 검색
- Spring/프레임워크가 제공하는 기능 확인
- 팀이 이미 사용 중인 방법 확인

### 2. 표준 > 커스텀
- Spring 표준: 문서화 잘 되어있음, 커뮤니티 지원, 버그 수정
- 커스텀 구현: 유지보수 부담, 테스트 필요, 온보딩 비용

### 3. Quick Win 찾기
복잡한 해결책보다 간단한 표준 기능이 더 나을 때가 많다.

---

## 다음 단계

프로젝트 전체에 적용:

```bash
# 아직 수동 인증 체크가 남아있는 곳 찾기
grep -r "SecurityContextHolder.getContext().getAuthentication()" src/
```

발견되는 모든 곳을 `@AuthenticationPrincipal`로 교체 예정.

---

**교훈: 바퀴를 재발명하기 전에, 이미 있는 바퀴를 찾아보자.** 🚲