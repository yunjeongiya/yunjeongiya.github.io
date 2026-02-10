---
layout: post
title: "Why Deleted Files Come Back During Git Merge"
date: 2026-02-10 14:00:00 +0900
categories: [Development, Git]
tags: [git, merge, conflict, three-way-merge, merge-base]
lang: en
slug: "033-en"
thumbnail: /assets/images/posts/033-git-merge-deleted-files/thumbnail-en.png
---

## The Problem: "I didn't touch main at all...?"

Today I tried to create a PR and ran into a strange situation.

```
No direct commits to main branch
Only worked on dev branch
```

But when I merged `main` into `dev`, **63 files had conflicts**. And the files I had **deleted were trying to come back**.

```bash
Changes to be committed:
    new file:   src/.../AssignedStudyTime.java
    new file:   src/.../AssignedStudyTimeService.java
```

I clearly deleted these files in the `dev` branch, but merging brought them back. Why?

## The Three-Way Merge Trap

Git compares **three points** when merging:

1. **Merge Base**: The common ancestor where both branches diverged
2. **Ours**: Current branch (dev)
3. **Theirs**: Branch being merged (main)

![Three-way merge diagram](/assets/images/posts/033-git-merge-deleted-files/three-way-merge.png)

The problem is that Git **doesn't look at intermediate history**.

Git only compares the **final state** of these three points:

| Point | AssignedStudyTime.java |
|-------|------------------------|
| Merge Base (A) | Exists |
| dev (current) | Deleted |
| main (merge target) | Exists |

Git's judgment: "dev deleted, main kept... Conflict!"

## Why Does "No Commits on Main" Still Cause Problems?

The key is **when main was last synced with dev**.

### Scenario

```
PR #195 merged (1 week ago)
         ↓
main:  --A--B--C (state frozen at PR #195)
              \
dev:           D--E--F--G--H (file deletion included)
                          ↑
                      Current dev
```

- **main**: "No commits" after PR #195 (correct)
- But **main's state is frozen 1 week ago**
- Files deleted in dev **still exist in main**

### Result

```bash
git merge origin/main
# → Files from main try to be "newly added"
```

Even without direct commits to main, its **stale state** causes problems during merge.

## When Git Auto-Handles Deletions vs. When It Doesn't

| Scenario | Result |
|----------|--------|
| dev deleted, main unchanged | Auto-keeps deletion |
| dev deleted, main modified | Conflict (delete/modify) |
| dev deleted, main also deleted | Auto-keeps deletion |
| Large branch divergence + complex history | Unpredictable |

My case was the last one. The divergence was too long, and there were many changes in between, so Git couldn't auto-resolve.

## Solutions

### 1. Remove Deleted Files During Merge

```bash
# Remove from staging (also deletes actual file)
git rm --cached src/.../AssignedStudyTime.java

# Complete merge commit
git commit -m "Merge main into dev - keep deletions"
```

### 2. Choose "Ours" (For All Conflicting Files)

```bash
# Keep dev branch state
git checkout --ours src/.../AssignedStudyTime.java
git add .
```

### 3. Merge Frequently (Prevention)

```bash
# Merge main into dev weekly
git fetch origin
git merge origin/main
```

Long divergence leads to merge hell. **Frequent sync** is the answer.

## Key Takeaways

1. **"No commits" ≠ "No problems"**: Even without commits, main's stale state is the issue
2. **Three-way merge ignores intermediate history**: Only compares final states
3. **Minimize branch divergence**: Longer divergence = more merge complexity
4. **Handle deleted files explicitly**: Use `git rm --cached` to ensure deletion

---

## References

- [Git Advanced Merging](https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging)
- [Resolve modify/delete merge conflicts](https://4sysops.com/archives/resolve-modifydelete-merge-conflicts-in-git/)
