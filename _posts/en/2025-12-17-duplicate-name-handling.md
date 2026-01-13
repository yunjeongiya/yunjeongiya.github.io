---
layout: post
title: "John Smith A, B, C... Building an Automatic Duplicate Name System"
date: 2025-12-17 10:00:00 +0900
categories: [Backend, System Design]
tags: [duplicate-handling, automation, checkus, naming-system, ux]
lang: en
slug: "019-en"
thumbnail: /assets/images/posts/019-duplicate-name/thumbnail.png
---

![Automatic Duplicate Name System](/assets/images/posts/019-duplicate-name/thumbnail.png){: width="600"}

## TL;DR
Solved the tedious manual process of distinguishing students with identical names in academies using an automatic suffix generation system. When there are 3 students named John Smith, they automatically become A, B, and C.

---

## A Daily Challenge in Education Centers

"Teacher, I'm John Smith from grade 3!"
"Oh, the John Smith from class 2 or class 5?"

This happens every day in education centers. Popular names can have 5-6 students with the same name in a single academy. In Excel, they're usually managed like this:

```
John Smith (3-2)
John Smith (3-5)
John Smith (4-1)
```

The problem? **Someone has to do this manually**. Every time a new student registers:
1. Check if there's a duplicate name
2. Decide how to distinguish them
3. Manually add something after the name

It's tedious, error-prone, and inconsistent.

---

## The Power of Automation

Our system is simple. **When duplicate names are registered, it automatically adds A, B, C.**

### How It Works

1. **First John Smith registers**
   - System: "No John Smith found. Save as John Smith"
   - Result: `John Smith`

2. **Second John Smith registers**
   - System: "Oh, there's already a John Smith"
   - Existing John Smith → Automatically changed to `John Smith A`
   - New John Smith → Saved as `John Smith B`

3. **Third John Smith registers**
   - System: "There's John Smith A and B"
   - New John Smith → Saved as `John Smith C`

### Core Logic

```
Name input → Duplicate check → Generate suffix if exists → Auto save
```

Suffix generation rules:
- Start from A (alphabetical order)
- Maximum up to Z (supports up to 26 people)
- Deleted student's suffix is not reused (prevents confusion)

---

## Real Implementation Considerations

### 1. Campus-based Separation

Large academies have multiple branches. There's no need to distinguish between John Smith at the Manhattan branch and John Smith at the Brooklyn branch.

```
Manhattan: John Smith, John Smith A, John Smith B
Brooklyn: John Smith, John Smith A  (managed independently)
```

### 2. Display Name vs Actual Name

- **Original name**: `John Smith` (unchanging)
- **Display name**: `John Smith B` (varies by campus)

This separation allows:
- Original name preserved even when transferring
- Automatic suffix generation appropriate for each campus
- Use of original names for statistics and overall queries

### 3. User Experience

**Before (Manual)**
```
Staff: "There's a duplicate name. How should we distinguish?"
Parent: "Um... add the grade?"
Staff: (typing) "John Smith (Grade 3)"
```

**After (Automatic)**
```
Staff: (just registers)
System: "Automatically registered as John Smith B"
Parent: "That's convenient"
```

---

## Unexpected Benefits

### 1. Consistency

All duplicates are managed by the same rule. The result is the same regardless of which staff member registers.

### 2. Search Convenience

Searching for "John Smith" shows A, B, C all together. No need to remember the suffix.

### 3. Statistical Accuracy

Since original names are preserved, statistics like "total number of John Smith students" are accurate.

### 4. Scalability

If more complex distinctions are needed later, just modify the logic. For example:
- A1, A2, B1, B2 (more duplicates)
- 2024A, 2024B (yearly distinction)
- Automatic grade addition instead of numbers

---

## Small Automation, Big Impact

Duplicate name handling might seem like a small feature, but it's a task that happens dozens of times daily. Automating this means:

- **Staff**: Register immediately without having to think
- **Students/Parents**: Less confusion with consistent name display
- **System**: Automatic data consistency guarantee

**The key philosophy is "What doesn't need human judgment should be handled by the system."**

Of course, special cases (like wanting to distinguish twins) can still be manually configured. But 99% is handled automatically.

---

## Conclusion

You don't need complex algorithms or AI to create value. Simple automation is often enough.

What's important is finding and solving **real users' repetitive inconveniences**.