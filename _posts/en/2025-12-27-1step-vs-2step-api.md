---
layout: post
title: "Student+Guardian Registration: Why We Built a New 1-step API Instead of Combining Existing APIs in Frontend"
date: 2025-12-27 10:00:00 +0900
categories: [Backend, API Design]
tags: [api-design, transaction, atomic-operation, refactoring, checkus]
lang: en
slug: "020-en"
thumbnail: /assets/images/posts/020-api-design/thumbnail-en.png
---

![1-step vs 2-step API Design](/assets/images/posts/020-api-design/thumbnail-en.png){: width="600"}

## TL;DR
Instead of combining existing APIs in the frontend to create students and guardians separately, we built a new 1-step API that represents a single business operation. The decision criteria wasn't about "number of steps" but about business boundaries and transaction responsibility.

---

## Background: We Had APIs, But There Were Problems

CheckUS already had these APIs:
- Student creation API
- Guardian account creation API
- Student-guardian connection API

We could implement "student+guardian registration" by calling these APIs sequentially from the frontend:

```javascript
const student = await createStudent(...)
for (const guardian of guardians) {
  const account = await registerGuardian(...)
  await connectGuardianToStudent(student.id, account.id)
}
```

Initially, it seemed reasonable. Each API had a clear role and was reusable.

But problems emerged in production.

---

## Problem 1: Frontend Has No Transactions

Combining multiple APIs in the frontend looks like one operation, but it's actually multiple independent network requests.

```
✅ Student creation successful
❌ Guardian 1 creation failed (network error)
```

In this case:
- Student is created
- Some guardians are missing
- Connection state is incomplete

There's no way to automatically rollback this state.

The result:
- Orphaned data
- Manual cleanup required
- Complex branching logic in frontend

---

## Problem 2: Failure Responsibility Moves to Frontend

When combining APIs in the frontend, the frontend needs to know:
- How far it succeeded
- Which step failed
- What to retry first

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
      // Partial failure handling logic goes into frontend
    }
  }
  // Complex state management...
} catch (error) {
  // Total failure handling...
}
```

Business state management responsibility leaks to the frontend. This isn't a UI logic problem—it's domain logic placed in the wrong location.

---

## Problem 3: "Partial Success" Was Meaningless

This was the key point.

In CheckUS, "new student registration":
- Is meaningless with just a student created
- Requires guardian accounts to start operations

This operation should have been All or Nothing from the beginning. The design allowing partial success didn't match domain requirements.

---

## Our Solution: Build a New 1-step API

We kept existing APIs and added one more API that represents the business unit:

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

The key points:
- Multiple operations internally
- Appears as one atomic operation externally
- Everything rolls back on failure

---

## "Were the Existing APIs Wrong?"

No.

Existing APIs:
- Are still valid as independent operations
- Can be used in other screens or flows

The problem was combining existing APIs in the frontend to use them like a single business operation.

---

## 2-step vs "Completely Separate Flows" Are Different

The 2-step we're discussing doesn't mean business-separated workflows.

For example:
```
Student registration
    ↓ (days later)
Guardian invitation
```

This is:
- Different timing
- Different user actions
- Each step independently meaningful

API separation is natural in this case.

But if it's executed with the same button on the same screen, it's one business operation.

---

## Decision Criteria

When deciding whether to split or combine APIs, this one question clarifies it:

**When this operation fails, do you want to keep the partially successful results for the user?**

- Yes → Separate APIs / Frontend combination possible
- No → Server should handle with 1-step API

---

## Improvements in Numbers

| Metric | Before (Frontend Combination) | After (1-step API) |
|--------|-------------------------------|-------------------|
| API calls | 5 | 1 |
| Frontend code | 110 lines | 47 lines |
| Error cases | 5 | 1 |
| Transaction guarantee | ❌ | ✅ |
| Partial failure handling | Frontend responsibility | None (All or Nothing) |

---

## Conclusion

The problem wasn't "2-step vs 1-step." The problem was where to draw business boundaries.

- One user action
- One business meaning
- One success/failure

If these conditions are met, it's better to create a new API representing that operation rather than combining existing APIs.

If an API represents a single business operation, even if its internal implementation is divided into multiple domain operations, it's preferable to expose it as one atomic endpoint externally.

Frontend should be closer to consuming results rather than orchestration.