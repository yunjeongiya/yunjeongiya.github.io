---
layout: post
title: "Student+Guardian Creation: From 2-step to 1-step API"
date: 2025-12-27 10:00:00 +0900
categories: [Backend, API Design]
tags: [api-design, transaction, atomic-operation, refactoring, checkus]
lang: en
slug: "020-en"
thumbnail: /assets/images/posts/020-1step-api-design.png
---

![1-step vs 2-step API Design](/assets/images/posts/020-1step-api-design.png){: width="600"}

## TL;DR
Redesigned a 2-step API that created students and guardians separately into a 1-step API wrapped in a single transaction. No partial failures, 57% less code, network requests reduced from 5→1.

---

## The Original 2-step API

In our academy system, registering a new student requires creating guardian accounts too. Initially, we implemented it like this:

```javascript
// Step 1: Create student
const student = await createStudent({ name: "John Smith", ... });

// Step 2: Create and connect guardians
for (const guardian of guardians) {
  const guardianAccount = await registerGuardian({ ... });
  await connectGuardianToStudent(student.id, guardianAccount.id);
}
```

It looked logically clean. Create student, create guardian, connect them. Each has a clear role.

---

## Problems in Production

### 1. Network Error = Orphan Accounts

```
✅ Student creation successful
❌ Guardian 1 creation failed (network error)
```

Result: A student account without guardians remains in the DB. Manual cleanup required.

### 2. Partial Failure Hell

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
      // Rollback only failed guardian? Rollback everything? 🤔
    }
  }

  if (results.failed.length > 0) {
    // How to handle partial success?
    // Keep successful ones? Cancel everything?
  }
} catch (error) {
  // Student creation failed
}
```

Code becomes complex, UX becomes ambiguous.

### 3. Slow Performance

For registering 2 guardians:
- 5 API calls (1 student + 2 guardian registrations + 2 connections)
- At 100ms each, minimum 500ms
- Actually slower (sequential processing)

---

## Redesigned as 1-step API

All operations in one transaction:

```java
@Transactional
public StudentWithGuardiansResponse createStudentWithGuardians(Request request) {
    // 1. Create student account
    User student = createStudentUser(request.getStudent());

    // 2. Create & connect guardian accounts
    List<Guardian> guardians = new ArrayList<>();
    for (GuardianInfo info : request.getGuardians()) {
        User guardian = createGuardianUser(info);
        connectGuardian(student, guardian);
        guardians.add(guardian);
    }

    // 3. Return everything at once
    return new Response(student, guardians);

    // Any error anywhere → automatic full rollback
}
```

---

## Improvements

### Before (2-step)
```javascript
// Frontend code: 110 lines
const student = await studentApi.createStudent(request);
for (const guardian of data.guardians) {
  const registerResponse = await authService.registerGuardian(...);
  await studentGuardianApi.connectGuardianToStudent(...);
  // Complex error handling...
}
```

### After (1-step)
```javascript
// Frontend code: 47 lines (57% reduction)
const response = await studentWithGuardiansApi.createStudentWithGuardians(request);
// Done. Only success or failure exists
```

### Improvements in Numbers

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| API calls | 5 | 1 | 80% ⬇️ |
| Frontend code | 110 lines | 47 lines | 57% ⬇️ |
| Error cases | 5 | 1 | 80% ⬇️ |
| Transaction guarantee | ❌ | ✅ | 100% |

---

## Implementation Considerations

### 1. API Path Naming

```
❌ POST /students + guardians in body
   → Not RESTful

❌ POST /registrations
   → Too generic, unclear intent

✅ POST /students/with-guardians
   → Clear intent, maintains RESTful design
```

### 2. Response Structure

```json
{
  "student": {
    "id": 1234,
    "username": "student_01012345678",
    "temporaryPassword": "Temp1234!@"  // Temporary password for teacher to share
  },
  "guardians": [{
    "id": 5678,
    "username": "guardian_01087654321",
    "relationship": "mother"
  }],
  "credentials": {  // Grouped for security management
    "student": { "username": "...", "password": "..." },
    "guardians": [{ "username": "...", "password": "..." }]
  }
}
```

### 3. Duplicate Check Timing

All duplicate checks within the transaction:
1. Student username duplicate check
2. Student phone number duplicate check
3. Each guardian username duplicate check
4. Each guardian phone number duplicate check

Any duplicate → full rollback.

---

## Lessons Learned

### 1. APIs from User Perspective

Developer perspective:
- "Create student" and "create guardian" are separate operations
- Clean to separate into different APIs

User perspective:
- "Register new student" is one operation
- Partial success is meaningless

**User perspective is the right answer.**

### 2. Transaction Boundary = API Boundary

One business operation = One transaction = One API

Following this principle:
- No partial failure worries
- No complex rollback logic needed
- Simple frontend code

### 3. Minimize Network Calls

Reducing 5→1:
- Noticeable response time improvement
- Reduced network error probability
- Especially important for mobile environments

---

## Conclusion

2-step APIs aren't always bad. If operations are truly independent, separation makes sense.

But for operations like "student+guardian registration" that form **one business operation**, 1-step API is the answer.

Simple All or Nothing beats complex partial failure handling.