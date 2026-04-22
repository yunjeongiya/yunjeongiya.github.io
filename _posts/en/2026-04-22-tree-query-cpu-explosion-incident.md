---
layout: post
title: "The Server Died Again, But This Time I Revived It in 30 Seconds — O(N²) CPU Explosion Incident"
date: 2026-04-22 00:30:00 +0900
categories: [Incident, Performance]
tags: [spring-boot, jpa, n-plus-1, tree-structure, incident-response, nginx]
lang: en
slug: "058-en"
published: false
---

In the [previous post](/posts/057-en), I wrote about how the server died and I had to sit helplessly waiting for a deployment because there was no kill switch. After that experience, I built an nginx kill switch and a circuit breaker. One week later, the server died again. This time, I pressed that switch for the first time in production.

## 10 PM: "Login isn't working"

A user was writing a document when suddenly — "network unstable" → "server maintenance" → logged out. Logging back in worked, but they got kicked out again after 2 minutes. Soon, other users reported the same symptoms.

At first, it looked like a specific account issue. The account had recently had its password reset, so that seemed like the culprit. Refresh tokens were missing (`AUTH_REFRESH_TOKEN_MISSING`), JWT expiration logs kept repeating. Classic auth problem pattern.

But deeper in the logs, `Broken pipe` errors were flooding in. The server was too slow to send responses before clients disconnected. This wasn't an auth problem — **the server was so overloaded that every response was timing out**.

## Diagnosis

### CPU 200%

```
app-green: CPU 199.17%, MEM 1.703GiB
```

CPU 200% on a 2-core server. Every core maxed out. Restarted the container, but CPU jumped right back to 200% after boot. Not startup warmup — the incoming requests themselves were the problem.

### Thread Dump Identified the Culprit

Sent `kill -3` to the JVM for a thread dump:

```
at ...TreeQueryService.getTree(...)
at ...TreeController.getTree(...)
at ...TreeController.getTree(...)
... (dozens repeated)
```

Dozens of `getTree` calls simultaneously stuck in RUNNABLE state. None completing, clients timing out and retrying, snowballing out of control.

### Kill Switch: 30 Seconds

I pressed the nginx kill switch I'd built the previous week:

```nginx
location /content-tree {
    return 503;
}
```

nginx reload. CPU started dropping:

```
199% → 102% (10s later) → 36% (25s later)
```

**30 seconds from identifying the cause to service recovery.** In the previous ddl-auto incident, the service stayed down until code fix + deployment. One kill switch made that much difference.

## Root Cause: Three Stacked Bombs

A DB query revealed **111,773 active nodes**. This code was written when there were a few hundred.

### 1. Loading All 111K Records

```java
if (categoryId != null) {
    templates = repository.findByCategoryIdAndActiveTrue(categoryId);
} else {
    templates = repository.findByActiveTrue();  // 111,773 records
}
```

Calling without `categoryId` loads everything into memory.

### 2. N+1 Queries

```java
// LAZY association access in mapper — 111K additional SELECTs
Subject subject = template.getCategory().getSubject();
```

### 3. O(N²) Tree Building

```java
private void buildSubTree(TreeNodeResponse parent,
                          List<ContentNode> allTemplates, ...) {
    // Each node stream-filters the entire 111K list
    List<TreeNodeResponse> children = allTemplates.stream()
            .filter(t -> parent.getId().equals(t.getParentId()))
            .collect(Collectors.toList());

    for (TreeNodeResponse child : children) {
        buildSubTree(child, allTemplates, ...);  // recurse
    }
}
```

111K DB load + 111K LAZY queries + full-list scan per node. Rough estimate: **over 10 billion comparisons**. Of course the server died.

## Hotfix

### Required categoryId

```java
if (categoryId == null) {
    throw new BusinessException(
        "categoryId is required. Full tree queries are not supported.");
}
```

### FETCH JOIN to Eliminate N+1

```java
@Query("SELECT t FROM ContentNode t JOIN FETCH t.category " +
       "WHERE t.categoryId = :categoryId AND t.active = true")
List<ContentNode> findByCategoryIdWithCategory(Long categoryId);
```

One query to fetch nodes and categories together. Having experienced the previous OOM incident (50K full entity load that blew the heap), I made sure to always combine FETCH JOIN with a `categoryId` filter. FETCH JOIN on 111K records without filtering would blow the memory again.

### O(N) HashMap Tree Building

```java
// 1. Put everything in a Map — O(N)
Map<Long, TreeNodeResponse> nodeMap = new HashMap<>(templates.size());
for (ContentNode t : templates) {
    nodeMap.put(t.getId(), converter.apply(t));
}

// 2. Link parents to children — O(N)
for (ContentNode t : templates) {
    TreeNodeResponse node = nodeMap.get(t.getId());
    if (t.getParentId() == null || !nodeMap.containsKey(t.getParentId())) {
        roots.add(node);
    } else {
        nodeMap.get(t.getParentId()).getChildren().add(node);
    }
}
```

Two passes and the tree is built. The recursive `allTemplates.stream().filter(...)` is gone.

## Timeline

| Time (KST) | Event |
|-------------|-------|
| 22:00 | First report: "can't log in" |
| 22:10 | Server status check, suspected specific account issue |
| 22:30 | More users affected — declared full outage |
| 22:32 | CPU 200% confirmed |
| 22:35 | Thread dump → identified `getTree` |
| **22:37** | **nginx kill switch → CPU down to 36% (service recovered)** |
| 22:45 | Code fix (3 files) |
| 23:14 | Hotfix deployed |
| 23:21 | nginx block removed, full service restored |

Total time from first report to full resolution: ~80 minutes. But the service itself was already recovered at 22:37 (kill switch). The remaining 44 minutes were for the permanent fix.

## How Would a Senior Engineer Have Prevented This?

After this incident, I looked into how companies prevent this kind of thing proactively.

**APM Auto-Alerting**: With DataDog or New Relic, a Slack alert would have fired the moment CPU exceeded 80%. I would have known 30 minutes before any user reported it.

**Slow Query Monitoring**: If DB query execution times were monitored, the gradual slowdown from growing data would have been caught as a trend.

**Load Testing**: Testing with production-scale data in staging would have caught this before deployment. The difference between N=100 and N=100,000 is immediately obvious under load.

**Code Review**: The "recursive full-list scan" pattern is something a senior would catch immediately. Solo development means no one else reviews the code.

I still have none of these. APM alerting is next.

## Lessons Learned

**Data grows silently.** This code worked fine — when data was small. It ran without warning until 111K records, then exploded at the tipping point.

**O(N²) is a time bomb.** When N is 100, the difference between O(N²) and O(N) is 10,000 vs 100. Imperceptible. When N is 100,000, it's 10,000,000,000 vs 100,000. The server dies. If you see code that scans the full list on every iteration in a tree/graph structure, replace it with a HashMap — even if it works fine today.

**Don't trust the symptoms.** "Can't log in" looked like an auth system problem. JWT expired, refresh token missing — the logs said so too. The actual cause was a completely unrelated tree data query. CPU overload slowed every response, which broke the auth flow as a side effect.

**Defense systems must exist before you need them.** If I hadn't built the kill switch a week earlier, the service would have stayed down until code fix + deployment — again. It's not "I'll build it someday" but "build it now and next time you revive the server in 30 seconds."
