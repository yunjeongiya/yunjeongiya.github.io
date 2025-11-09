---
layout: post
title: "React Query Multi-Tenant Caching: Why Query Keys Need Tenant IDs"
date: 2025-11-09 16:00:00 +0900
categories: [React, Frontend]
tags: [react-query, multi-tenancy, caching, axios, cors]
lang: en
---

## TL;DR
Campus dropdown changes, data doesn't. Why? React Query cache doesn't know about tenant IDs. Add `tenantId` to query keys. Problem solved.

---

## The Problem: Switching Tenants, Seeing Old Data

Building a multi-campus school management system. User switches from Campus A to Campus B using a dropdown. Expected: Campus B data. Reality: Still showing Campus A data.

```
User: Switches dropdown from "Seoul" to "Busan"
Screen: Still shows Seoul data 😱
User: Hits F5
Screen: Finally shows Busan data ✅
```

Using React Query, everything should be reactive, right? Checked the network tab - **no API call was being made**. That's when it hit me.

---

## Root Cause: React Query Caches by Query Key

React Query uses query keys to identify cached data. Same key = same cache. Different key = different cache. Simple, but easy to miss in multi-tenant apps.

### The Problematic Code

```tsx
// ❌ Query key doesn't change when campus changes
export const useTrashTreeStructure = (type?: string) => {
  return useQuery({
    queryKey: ['trash', 'tree', { type }],  // No campusId!
    queryFn: () => trashApi.getTrashTreeStructure(type),
  });
};
```

When campus changes from 1 to 2, the query key stays `['trash', 'tree', { type }]`. React Query thinks: "Same query, here's your cached data!"

### Meanwhile, the Backend...

The backend identifies campus from cookies:

```java
Cookie[] cookies = request.getCookies();
for (Cookie cookie : cookies) {
    if ("selectedCampusId".equals(cookie.getName())) {
        campusId = cookie.getValue();
    }
}
```

Cookies update, backend filters correctly, but **frontend cache doesn't know anything changed**.

---

## The Fix: Include Tenant ID in Query Keys

### Step 1: Add campusId to Query Key

```tsx
// ✅ Query key changes when campus changes
import { getCampusCookie } from '@/utils/cookies';

export const useTrashTreeStructure = (type?: string) => {
  const campusId = getCampusCookie();

  return useQuery({
    queryKey: ['trash', 'tree', { type, campusId }], // Added campusId!
    queryFn: () => trashApi.getTrashTreeStructure(type),
  });
};
```

Now when campus changes:
1. Cookie updates: `setCampusCookie(2)`
2. Component re-renders
3. Query key changes: `{ campusId: 1 }` → `{ campusId: 2 }`
4. React Query: "New key! Fetching fresh data!"

### Step 2: Make It Explicit with Headers

Cookies are sent automatically, but they're invisible in dev tools. Added custom headers for clarity:

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

Backend updated to check headers first:

```java
// Priority 1: Header
String campusIdParam = request.getHeader("X-Campus-Id");

// Priority 2: Cookie (backward compatibility)
if (campusIdParam == null) {
    // Read from cookie
}
```

Now I can see `X-Campus-Id: 2` in the network tab. Debugging became 10x easier.

---

## Apply Everywhere

This isn't just about one API. Every campus-filtered endpoint needs this:

```tsx
// Student details
export const useStudentDetail = (studentId: number) => {
  const campusId = getCampusCookie();
  return useQuery({
    queryKey: ['students', studentId, { campusId }],  // Here too
    queryFn: () => studentApi.getStudentDetail(studentId),
  });
};

// Task templates
export const useTaskTemplates = () => {
  const campusId = getCampusCookie();
  return useQuery({
    queryKey: ['task-templates', { campusId }],  // And here
    queryFn: () => taskApi.getTaskTemplates(),
  });
};
```

The pattern: **Every query key needs the tenant ID**.

---

## The Complete Flow

```
[User changes campus dropdown]
    ↓
setCampusCookie(2)  // Update cookie
    ↓
Component re-renders
    ↓
getCampusCookie() → 2  // Read new value
    ↓
Query key: { campusId: 1 } → { campusId: 2 }
    ↓
React Query: "New query! Fetching..."
    ↓
axios: Adds X-Campus-Id: 2 header
    ↓
Server: Returns campus 2 data only
    ↓
UI updates instantly ✨
```

---

## Results

### Before
- Change campus → Need F5
- User: "Is this a bug?"
- Dev: "Just refresh..."

### After
- Change campus → Instant update
- Separate cache per campus (better performance)
- Visible headers in network tab

---

## Lessons Learned

### 1. Query Keys Must Include All Dependencies

```tsx
// ❌ Bad - Ambiguous
queryKey: ['students']  // Which campus? What filters?

// ✅ Good - Explicit
queryKey: ['students', { campusId, grade, status }]
```

### 2. Design for Multi-Tenancy from Day One

Retrofitting is painful. Every hook needs updating. Start with:
- Tenant ID in query keys
- Axios interceptors for headers
- Backend auto-filtering

### 3. Cookies vs Headers

| Cookies | Headers |
|---------|---------|
| Sent automatically | Explicit |
| Hard to debug | Visible in network tab |
| CORS complexity | Need CORS config |

Use both. Headers for clarity, cookies for backup.

---

## CORS Configuration

Custom headers need CORS allowlist:

```java
configuration.setAllowedHeaders(Arrays.asList(
    "Authorization",
    "Content-Type",
    "X-Campus-Id"  // Don't forget this!
));
```

Without this, preflight requests will fail.

---

## Performance Bonus

With campus-specific query keys, each campus gets its own cache:

```
Campus 1: ['students', { campusId: 1 }] → 500 students cached
Campus 2: ['students', { campusId: 2 }] → 300 students cached
```

Switching between campuses is now instant if data is already cached. No unnecessary refetches.

---

## Future Improvements

Currently reading cookies in every hook. Context would be cleaner:

```tsx
// Future approach
const { currentCampusId } = useCampus();  // From Context
queryKey: ['students', currentCampusId]
```

One source of truth, easier to maintain.

---

## Common Pitfalls

### 1. Forgetting Some Hooks
One missed hook = one confused user. Search your codebase:

```bash
grep -r "useQuery" src/ | grep -v "campusId"
```

### 2. Not Invalidating on Logout
When user switches accounts, invalidate all queries:

```tsx
queryClient.invalidateQueries();  // Clear everything
```

### 3. Forgetting Background Refetches
React Query refetches on window focus. Make sure query keys are correct or users see wrong tenant data after alt-tabbing.

---

**Key Takeaway**: In multi-tenant React Query apps, tenant ID belongs in every query key. Miss it once, spend hours debugging why data doesn't update. Learn from my mistake. 🤦‍♂️