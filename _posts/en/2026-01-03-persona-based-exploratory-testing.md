---
layout: post
title: "Persona-Based Exploratory Testing: Finding Bugs as a Rushed Teacher, Tech-Challenged Assistant, and Mischievous Student"
date: 2026-01-03 10:00:00 +0900
categories: [QA, Testing]
tags: [qa, testing, exploratory-testing, persona, bug-hunting]
lang: en
slug: "021-en"
thumbnail: /assets/images/posts/021-persona-testing/thumbnail.png
---

![Persona-Based Exploratory Testing](/assets/images/posts/021-persona-testing/thumbnail.png){: width="600"}

## TL;DR
Test cases only catch 5% of real user bugs. Become a rushed teacher, tech-challenged assistant, or mischievous student to torture your system and find the other 95%.

---

## The Limits of Test Cases

We thought we had perfect test cases:

```
TC-001: Student Registration
1. Click "Add Student"
2. Enter name, phone number
3. Click "Save"
4. Verify success message
✅ PASS
```

But in production, this happens:

- Rushed teacher clicks save 10 times → 10 duplicate students created
- Tech-challenged assistant hits browser back → All input data lost
- Mischievous student enters 1000 emojis in name → Server crashes

Test cases assume **"normal users"**. But real users aren't normal.

---

## What is Persona Testing?

It's using your system while role-playing specific user types.

**Traditional Testing**
```
"Does the student registration feature work?"
```

**Persona Testing**
```
"When a rushed teacher frantically tries to register 5 students in 30 seconds,
does the system survive?"
```

Completely different question, completely different bugs found.

---

## 4 Core Personas

### Persona 1: The Rushed Teacher

**Characteristics**
- Doesn't wait for loading
- Clicks every button multiple times
- Doesn't read error messages
- "Hurry hurry" mindset

**How to Test**

```javascript
// Normal test
await clickButton("Save");
await waitForLoading();
assert(saved);

// Rushed teacher test
for(let i=0; i<10; i++) {
  clickButton("Save");  // Loading? What loading?
}
// 10 requests hit the server simultaneously
```

**Actual Bugs Found**
- Save button spam → Duplicate data creation
- Navigation during loading → Data loss
- Concurrent requests → Server race condition
- Session timeout unhandled (returns after 5 minutes, save fails)

---

### Persona 2: Tech-Challenged Assistant

**Characteristics**
- Thinks browser back is "cancel"
- Doesn't understand error messages
- Accidentally refreshes frequently
- "Huh? What's this?" mindset

**How to Test**

```
Scenario:
1. Entering student info...
2. "Did I click wrong?" → F5 refresh
3. "Oh no, everything's gone!" → Back button
4. "The page looks weird" → F5 spam
```

**Actual Bugs Found**
- Data loss on refresh
- State inconsistency on back navigation
- Unfriendly error messages ("Error 500" → improved to "Please try again later")
- No data loss warning when clicking outside modal

---

### Persona 3: Mischievous Student

**Characteristics**
- Wants to test system limits
- Tries weird inputs
- Attempts to access other students' data
- "Does this work?" mindset

**How to Test**

```sql
-- Try these in name field
'; DROP TABLE students; --
<script>alert('hacked')</script>
😀😀😀😀😀 (1000 emojis)
```

**Actual Bugs Found**
- SQL injection vulnerability
- XSS attack possible
- No input length limit → Server memory explosion
- Missing permission checks (URL manipulation accesses other students' data)

---

### Persona 4: Multitasking Parent

**Characteristics**
- Managing multiple children simultaneously
- Mobile/PC simultaneous access
- Multiple browser tabs open
- "Multiple things at once" mindset

**How to Test**

```
Tab 1: Checking first child's homework
Tab 2: Registering second child's consultation
Mobile: Marking third child's attendance
→ Click save on all simultaneously
```

**Actual Bugs Found**
- Session conflicts with simultaneous login
- Data mixing when switching tabs (first child's data on second child's screen)
- No real-time sync
- Last save overwrites everything on concurrent edits

---

## Exploratory Testing Techniques

### 1. The Terrible Twos Method (Opposite Action)

Do the opposite of test cases:

**Normal**: Input → Confirm → Save
**Terrible Twos**: Save → Input → Save → Cancel → Save → Delete → Save

Actually found: "Save then immediately delete" causes DB transaction corruption.

### 2. 15-Minute Random QA

Set timer and go wild for 15 minutes:

```
0-3 min: Click all buttons
3-6 min: Weird values in all inputs
6-9 min: Resize browser, back button
9-12 min: Toggle network on/off
12-15 min: Manipulate HTML with dev tools
```

**Actual Result**: Average 3 bugs found in 15 minutes

### 3. Trolling Testing

Intentionally torture the system:

- 100 concurrent requests to every API
- Upload 10GB video to file upload
- Edit all fields simultaneously
- Same operation in 10 browser tabs

**Critical bug found**: No file upload size limit → Server disk full

---

## Effectiveness of Exploratory Testing: Research Findings

### Bug Detection Rate Improvements

Multiple studies have demonstrated the effectiveness of exploratory testing:

- **11% more issues found**: Research shows exploratory testing finds an average of 11% more software errors compared to scripted testing
- **33% more complex bugs**: Finds 33% more complex bugs requiring multiple user interactions
- **Up to 50% improvement**: Some studies report finding defects up to 50% more effectively than conventional methods

### Persona-Based Testing Impact

Real-world case studies:

- **Travel App**: After implementing personas like "Globetrotter Gina" and "Family Planner Frank", achieved **45% reduction in post-launch bugs**
- **Healthcare App**: "Caregiver Claire" persona helped identify medication tracking confusion early, **saving $250K**
- **Capgemini Research**: Risk-based exploratory testing showed **35% improvement in defect detection efficiency**

### Bug Complexity Analysis

From IEEE journal research by Juha Itkonen et al.:

| Bug Complexity | Scripted Testing Strength | Exploratory Testing Strength |
|---------------|-------------------------|---------------------------|
| Mode 0 (Immediately visible) | ✅ Excellent | - |
| Mode 1 (1 interaction) | ✅ Excellent | - |
| Mode 2 (2 interactions) | - | ✅ Excellent |
| Mode 3+ (3+ interactions) | - | ✅ Excellent |

**Key Insight**: The more complex the scenario, the more effective persona-based exploratory testing becomes

---

## Getting Started with Persona Testing

### Step 1: Observe Real Users

Who uses our system?
- Age range?
- IT proficiency?
- Usage patterns?
- Often in a rush?

### Step 2: Define Personas

```yaml
Persona: Rushed Academy Director
Characteristics:
  - Age: 50s
  - IT Proficiency: Low
  - Situation: 5 minutes before parent meeting
  - Goal: Quickly check info and leave
Behavior Patterns:
  - Doesn't wait for loading
  - Clicks buttons multiple times
  - Doesn't read error messages
```

### Step 3: Write Scenarios

```
Rushed director 5 minutes before parent meeting:
1. Login (wrong password 3 times)
2. Student search (wrong name, search again)
3. Accidentally edit while checking attendance
4. Browser back to cancel
5. Re-enter and check
→ All within 3 minutes
```

### Step 4: Execute and Record

Important: **Record everything that feels "weird"**:
- Buttons respond slowly
- Error messages confusing
- Data disappears
- Page breaks

---

## Conclusion

There's no perfect test case. Users use systems in ways we never imagine.

The core of persona testing is **abandoning the "normal usage" assumption**.

Become the rushed teacher, the tech-challenged assistant, the mischievous student. Through their eyes, hidden bugs emerge.

Next QA, instead of test cases, ask this:

**"Can our system survive a rushed teacher's 10-click save button spam?"**

---

## References

- [Exploratory Testing vs. Scripted Testing](https://www.qualitylogic.com/knowledge-center/exploratory-testing-vs-scripted-testing/) - QualityLogic
- [Effectiveness of Exploratory Testing](https://www.researchgate.net/publication/262685821_Effectiveness_of_Exploratory_Testing_An_empirical_scrutiny_of_the_challenges_and_factors_affecting_the_defect_detection_efficiency) - ResearchGate
- [The Role of Personas in User-Centric Testing](https://www.applause.com/blog/the-role-of-personas-in-user-centric-testing/) - Applause
- [Persona-based testing to double your test case quality](https://qamind.com/blog/persona-based-testing-test-case-quality/) - QAMIND
- [Improve your exploratory testing with personas](https://www.getxray.app/blog/exploratory-testing-personas) - Xray Blog
- Juha Itkonen et al., "Defect Detection Efficiency: Test Case Based vs. Exploratory Testing", IEEE, 2007