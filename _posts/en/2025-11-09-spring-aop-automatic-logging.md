---
layout: post
title: "Spring AOP: Replacing 860 Manual Logs with One Aspect"
date: 2025-11-09 15:00:00 +0900
categories: [Spring, AOP]
tags: [spring, aop, logging, security, performance]
lang: en
---

## TL;DR
Replaced 860 inconsistent manual logs across 86 files with a single Spring AOP aspect. Includes automatic sensitive data filtering and performance measurement. Implementation time: 30 minutes.

---

## The Problem: Logging Chaos

I analyzed our codebase and found a shocking mess:

```java
// AuthController - Overly verbose
log.debug("Login request received: username={}", request.getUsername());
log.debug("Login successful: username={}, userId={}", ...);
log.info("Login request Origin header: {}", ...);
log.info("All headers: {}", ...);

// UserController - Complete silence
public ResponseEntity<...> getUser(...) {
    // Nothing...
}

// StudentController - Duplicate patterns
log.info("Student list query - classId: {}, grade: {}, ...");
log.info("Student list success - count: {}", students.size());
```

**86 files. 860 log calls. 0 consistency.**

Every developer had their own logging style. Some used DEBUG, others INFO. Some logged everything, others nothing. Debugging was a nightmare - first you had to check if logging even existed for that API.

---

## The Solution: One AOP to Rule Them All

### Step 1: Define What to Log

First, I established a clear logging policy:

```markdown
✅ AOP Handles Automatically (DEBUG level)
- All controller method calls
- Request parameters (filtered for security)
- Execution time
- Success/failure status

✅ Developers Handle Manually (INFO level)
- Important business events (login, signup)
- Data creation/modification/deletion
```

### Step 2: The ControllerLoggingAspect

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

        // Extract HTTP method (GET, POST, etc.)
        String httpMethod = extractHttpMethod(method);

        // Extract safe parameters (with sensitive data filtering)
        Map<String, Object> params = extractSafeParameters(method, joinPoint.getArgs());
        String paramsStr = formatParameters(params);

        // Request log
        log.debug("[{}] {} {}() called with [{}]",
            className, httpMethod, methodName, paramsStr);

        long startTime = System.currentTimeMillis();

        try {
            Object result = joinPoint.proceed();

            // Success log with execution time
            long duration = System.currentTimeMillis() - startTime;
            log.debug("[{}] {} {}() completed successfully in {}ms",
                className, httpMethod, methodName, duration);

            return result;

        } catch (Exception e) {
            // Failure log
            long duration = System.currentTimeMillis() - startTime;
            log.debug("[{}] {} {}() failed in {}ms with exception: {}",
                className, httpMethod, methodName, duration, e.getClass().getSimpleName());

            throw e;
        }
    }
}
```

---

## Critical Feature: Automatic Sensitive Data Filtering

Logging passwords is a security incident waiting to happen. Here's how I prevent it:

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

        // Filter sensitive data
        if (isSensitiveParameter(paramName)) {
            params.put(paramName, "***FILTERED***");
            continue;
        }

        // Skip Spring framework internals
        if (isSpringFrameworkParameter(parameters[i].getType())) {
            continue;
        }

        // Add safe parameters
        Object arg = args[i];
        if (arg == null) {
            params.put(paramName, "null");
        } else if (isPrimitiveOrWrapper(arg)) {
            params.put(paramName, arg);
        } else {
            // Complex objects: show class name only (avoid toString() overhead)
            params.put(paramName, arg.getClass().getSimpleName());
        }
    }

    return params;
}

private boolean isSensitiveParameter(String paramName) {
    String lowerParamName = paramName.toLowerCase();
    return Arrays.stream(SENSITIVE_PARAM_NAMES)
            .anyMatch(lowerParamName::contains);
}
```

### Real Log Output

```
// Before: Password exposed
[AuthController] POST login() called with [username=testuser, password=secret123!]

// After: Automatically filtered
[AuthController] POST login() called with [username=testuser, password=***FILTERED***]
```

---

## Smart HTTP Method Detection

Knowing the HTTP method makes debugging much easier:

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
    } else if (method.isAnnotationPresent(RequestMapping.class)) {
        RequestMapping mapping = method.getAnnotation(RequestMapping.class);
        if (mapping.method().length > 0) {
            return mapping.method()[0].name();
        }
    }
    return "HTTP";
}
```

Now logs clearly show: `[StudentController] GET getStudents()` instead of just `[StudentController] getStudents()`.

---

## Performance Optimizations

### 1. Avoid toString() Overhead

```java
// ❌ Bad: Calls expensive toString()
log.debug("Request: {}", request); // Slow for large objects

// ✅ Good: Just show class name
params.put(paramName, arg.getClass().getSimpleName()); // "StudentRequest"
```

### 2. Disable DEBUG in Production

```yaml
# application-prod.yml
logging:
  level:
    com.example: INFO  # DEBUG logs disabled
    com.example.aspect: INFO  # AOP logs also disabled
```

When log level is INFO, `log.debug()` isn't even executed. Zero performance impact.

### 3. Skip Framework Internals

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

No point logging `HttpServletRequest` or `Authentication`. They just clutter the logs.

---

## Real-World Results

### Actual Log Output

```
[StudentController] GET getStudents() called with [classId=1, grade=5, status=ENROLLED]
[StudentController] GET getStudents() completed successfully in 42ms

[AuthController] POST login() called with [username=testuser, password=***FILTERED***]
[AuthController] POST login() completed successfully in 156ms

[TaskController] POST createTask() called with [request=TaskInstanceRequest]
[TaskController] POST createTask() failed in 23ms with exception: BusinessException
```

Clean. Clear. Consistent. Every log shows:
- Which controller and method
- HTTP method
- Parameters (safely filtered)
- Execution time
- Success or failure

### What Developers Focus On Now

```java
@PostMapping
public ResponseEntity<...> createStudent(@RequestBody StudentRequest request) {
    StudentDetailResponse response = studentService.createStudent(request);

    // Only log important business events
    log.info("Student created: studentId={}, username={}",
        response.getId(), response.getUsername());

    return ResponseEntity.status(HttpStatus.CREATED).body(...);
}
```

The AOP handles the boilerplate. Developers focus on business-critical events.

---

## The Numbers

### Before
- 86 files with manual logging
- 860 log statements
- Inconsistent formats
- Security risks (passwords in logs)
- Debugging requires checking if logs exist

### After
- **1 AOP Aspect** covers all controllers
- **100% consistent** format
- **Automatic security** filtering
- **Automatic performance** measurement
- **30 minutes** to implement (estimated 4-6 hours)

---

## Lessons Learned

### 1. Policy Before Code
Don't write logging code until you've defined what to log. Separate concerns:
- DEBUG: Framework handles (method calls, params, timing)
- INFO: Developers handle (business events)

### 2. Automate Security
Humans make mistakes. Automatic filtering prevents security incidents.

### 3. Environment-Specific Configuration
- Development: DEBUG for easy debugging
- Production: INFO+ for performance

### 4. Know AOP Limitations
Internal method calls bypass the proxy:

```java
public void outerMethod() {
    innerMethod(); // No AOP interception
}

private void innerMethod() {
    // No logs here
}
```

This is a Spring AOP limitation. Use AspectJ for compile-time weaving if you need internal call interception.

---

## Production Checklist

Before deploying:
- [ ] Set log level to INFO in production
- [ ] Verify sensitive data filtering works
- [ ] Update `SENSITIVE_PARAM_NAMES` for new sensitive fields
- [ ] Monitor performance impact (should be negligible with INFO level)

---

## Advanced Patterns

### Custom Audit Logging

For critical operations, combine AOP with custom annotations:

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface AuditLog {
    String event();
}

// Usage
@PostMapping
@AuditLog(event = "STUDENT_DELETION")
public ResponseEntity<...> deleteStudent(@PathVariable Long id) {
    // AOP will log this as a critical audit event
}
```

### Correlation IDs

Add request correlation for distributed tracing:

```java
String correlationId = MDC.get("correlationId");
log.debug("[{}] [{}] {} {}() called",
    correlationId, className, httpMethod, methodName);
```

---

**Bottom line: 860 manual logs replaced by 1 AOP aspect. Consistency, security, and performance all improved.** 🎯

Sometimes the best code is the code that writes itself.