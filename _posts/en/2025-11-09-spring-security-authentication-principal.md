---
layout: post
title: "Spring Security: Why @AuthenticationPrincipal Beats Custom @CurrentUser"
date: 2025-11-09 14:00:00 +0900
categories: [Spring, Security]
tags: [spring, spring-security, authentication, refactoring, best-practices]
lang: en
---

## TL;DR
Was building a custom `@CurrentUser` annotation. Found out Spring already has `@AuthenticationPrincipal`. Saved 2 hours of pointless work.

---

## The Problem: Boilerplate Authentication Checks

Every secured controller method had this repetitive pattern:

```java
@PostMapping("/assign")
public ResponseEntity<...> assignStudyTime(@RequestBody Request request) {
    // These same 8 lines in every method...
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || !(authentication.getPrincipal() instanceof CustomUserPrincipal)) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ResponseBase.error("Authentication required"));
    }

    CustomUserPrincipal principal = (CustomUserPrincipal) authentication.getPrincipal();
    Long teacherId = principal.getId();
    // ... actual business logic
}
```

29 lines of duplicate code across just 3 controller methods. This would only grow with more endpoints.

---

## First Attempt: Building Custom @CurrentUser

My initial plan was to create a custom annotation with an ArgumentResolver:

```java
// 1. Custom annotation
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentUser {
}

// 2. ArgumentResolver implementation
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
            throw new UnauthorizedException("Authentication required");
        }
        return auth.getPrincipal();
    }
}

// 3. Register with WebMvcConfigurer
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CurrentUserArgumentResolver());
    }
}
```

Estimated work: 2-3 hours (implementation + tests)

---

## The Discovery: Spring Already Had It

While exploring the codebase, I found:

```bash
# Wait, we're already using something similar?
grep -r "@AuthenticationPrincipal" src/
```

```java
// CampusEventController.java
@PostMapping
public ResponseEntity<...> createEvent(
    @RequestBody EventRequest request,
    @AuthenticationPrincipal CustomUserPrincipal principal) {  // Already there!
    // ...
}
```

Spring Security provides `@AuthenticationPrincipal` out of the box, and parts of our codebase were already using it!

---

## The Solution: Apply @AuthenticationPrincipal

Instead of custom implementation, use the Spring standard:

```java
// Before: 17 lines
@GetMapping("/me")
public ResponseEntity<...> getCurrentUser() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    log.debug("Authentication: {}", authentication != null ? authentication.getClass().getSimpleName() : "null");

    if (authentication == null || !(authentication.getPrincipal() instanceof CustomUserPrincipal)) {
        log.warn("Authentication failed - authentication: {}, principal type: {}",
                authentication != null ? "present" : "null",
                authentication != null ? authentication.getPrincipal().getClass().getSimpleName() : "null");
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ResponseBase.error("User not authenticated"));
    }

    CustomUserPrincipal userPrincipal = (CustomUserPrincipal) authentication.getPrincipal();
    log.debug("User principal: ID={}, Username={}", userPrincipal.getId(), userPrincipal.getUsername());
    // ...
}

// After: 6 lines
@GetMapping("/me")
public ResponseEntity<...> getCurrentUser(
        @AuthenticationPrincipal CustomUserPrincipal userPrincipal) {

    log.debug("User principal: ID={}, Username={}", userPrincipal.getId(), userPrincipal.getUsername());
    // ...
}
```

---

## Results

### Code Reduction
- StudyTimeController: 8 lines removed (53% reduction)
- UserController.getCurrentUser(): 11 lines removed (65% reduction)
- UserController.updateProfile(): 10 lines removed (59% reduction)
- **Total: 29 lines eliminated**

### Time Saved
- Expected: 2-3 hours (custom implementation)
- Actual: 30 minutes (leveraging existing feature)
- Saved: 1.5-2.5 hours

### Additional Benefits
- Spring Security handles 401 responses automatically
- Easy to mock in tests
- No custom code to maintain

---

## Other Useful Spring Security Annotations

While researching, I discovered these gems:

```java
// Full Principal object
@GetMapping("/profile")
public String profile(@AuthenticationPrincipal CustomUserPrincipal principal) {
    return principal.getUsername();
}

// Extract specific field with SpEL
@GetMapping("/username")
public String username(@AuthenticationPrincipal(expression = "username") String username) {
    return username;
}

// Full SecurityContext
@GetMapping("/context")
public String context(@CurrentSecurityContext SecurityContext context) {
    return context.getAuthentication().getName();
}

// With optional authentication
@GetMapping("/optional")
public String optional(@AuthenticationPrincipal(errorOnInvalidType = false) CustomUserPrincipal principal) {
    return principal != null ? principal.getUsername() : "anonymous";
}
```

---

## Lessons Learned

### 1. Search Your Codebase First
Before building something new:
- Search for similar patterns in existing code
- Check what the framework already provides
- Look for what your team is already using

### 2. Standards > Custom
- Spring standards: Well-documented, community support, bug fixes
- Custom implementations: Maintenance burden, testing required, onboarding cost

### 3. The Cost of Custom Code
Every line of custom code is a liability:
- Needs documentation
- Requires tests
- Must be explained to new developers
- Can have bugs

### 4. Quick Wins Matter
This refactoring took 30 minutes but will save hours of future development and debugging time.

---

## Next Steps

Search for remaining manual authentication checks:

```bash
# Find all manual authentication checks
grep -r "SecurityContextHolder.getContext().getAuthentication()" src/

# Count the potential for improvement
grep -r "SecurityContextHolder.getContext().getAuthentication()" src/ | wc -l
```

Every occurrence is a candidate for `@AuthenticationPrincipal` refactoring.

---

## Best Practices for Authentication in Spring

Based on this experience:

1. **Use @AuthenticationPrincipal** for controller method parameters
2. **Use @PreAuthorize** for method-level security
3. **Use @RequirePermission** (custom) for business permissions
4. **Never manually check SecurityContextHolder** in controllers
5. **Let Spring Security handle 401/403 responses**

---

**The takeaway: Before reinventing the wheel, check if there's already a wheel in your garage.** 🚲

Sometimes the best code is the code you don't write.