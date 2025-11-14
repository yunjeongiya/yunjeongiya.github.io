---
layout: post
title: "LocalTime vs LocalDateTime: Time Formatting Bug and UTC→KST Conversion"
date: 2025-11-12 09:20:00 +0900
categories: [Frontend, TypeScript]
tags: [typescript, datetime, timezone, formatting, debugging]
lang: en
slug: "010-en"
---

## TL;DR
Using the same substring approach for both weekly schedules (LocalTime "09:00:00") and temporary assignments (LocalDateTime "2025-01-12T09:00:00") breaks everything. Weekly schedules have no timezone, while temporary assignments are in UTC and need KST conversion. Branch your formatting logic by type.

---

## The Bug: Missing Times in Seat Monitoring Popover

We have a popover that shows today's schedule when hovering over a student's seat in the seating chart. It displays both weekly schedules and temporary study time assignments, but **weekly schedule times weren't showing up**.

### The Problem
```tsx
// Buggy code
<div className="text-gray-500 text-[10px] mt-0.5">
  {schedule.startTime.substring(11, 16)} - {schedule.endTime.substring(11, 16)}
</div>
```

This only works for LocalDateTime format (`"2025-01-12T09:00:00"`):
- substring(11, 16) → `"09:00"` ✅

But for LocalTime format (`"09:00:00"`):
- substring(11, 16) → `""` (empty string, only 8 chars total) ❌

---

## Backend DTO Structure Differences

### Weekly Schedule (WeeklyScheduleResponse)
```java
@JsonFormat(pattern = "HH:mm")
private LocalTime startTime;  // "09:00:00"

@JsonFormat(pattern = "HH:mm")
private LocalTime endTime;    // "17:00:00"
```
- **Type**: `LocalTime`
- **Format**: `"HH:mm:ss"` (time only, no date)
- **Timezone**: None (just time information)

### Temporary Assignment (AssignedStudyTime)
```java
private LocalDateTime startTime;  // "2025-01-12T00:00:00"
private LocalDateTime endTime;    // "2025-01-12T09:00:00"
```
- **Type**: `LocalDateTime`
- **Format**: `"YYYY-MM-DDTHH:mm:ss"`
- **Timezone**: UTC (server stores in UTC)
- **Note**: Frontend needs to convert to KST (UTC+9)

---

## Solution: formatTime Helper Function

Created a helper function that handles both formats and supports UTC→KST conversion.

```typescript
/**
 * Convert LocalTime(HH:mm:ss) or LocalDateTime(YYYY-MM-DDTHH:mm:ss) to HH:mm format
 * @param timeString - LocalTime or LocalDateTime string
 * @param isUtc - if true, convert UTC to KST (for temporary assignments)
 */
const formatTime = (timeString: string, isUtc: boolean = false): string => {
  if (!timeString) return '';

  // LocalDateTime format (contains T)
  if (timeString.includes('T')) {
    // UTC -> KST conversion needed (temporary assignments)
    if (isUtc) {
      const utcDate = new Date(timeString);
      // KST is UTC+9
      const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
      const hours = String(kstDate.getUTCHours()).padStart(2, '0');
      const minutes = String(kstDate.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    // No UTC conversion needed
    return timeString.substring(11, 16); // "2025-01-12T09:00:00" -> "09:00"
  }

  // LocalTime format (HH:mm:ss) - weekly schedules
  return timeString.substring(0, 5); // "09:00:00" -> "09:00"
};
```

### Key Logic Breakdown

#### 1. LocalDateTime Detection
```typescript
if (timeString.includes('T'))
```
If it contains `T`, it's LocalDateTime format (ISO 8601 standard).

#### 2. UTC → KST Conversion
```typescript
if (isUtc) {
  const utcDate = new Date(timeString);
  const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  // ...
}
```
- Parse UTC time as JavaScript Date object
- Add 9 hours (9 × 60 × 60 × 1000ms)
- Extract time using `getUTCHours()` (KST offset already applied)

#### 3. LocalTime Handling
```typescript
return timeString.substring(0, 5); // "09:00:00" -> "09:00"
```
Just take first 5 characters to get "HH:mm" format.

---

## Usage Example

```tsx
const allSchedules = [
  ...todayWeeklySchedules.map((s) => ({
    title: s.title,
    activityName: s.activityName,
    startTime: s.startTime,  // "09:00:00"
    endTime: s.endTime,      // "17:00:00"
    source: 'WEEKLY_SCHEDULE' as const,
  })),
  ...(assignedStudyTimes || []).map((s) => ({
    title: s.title,
    activityName: s.activityName,
    startTime: s.startTime,  // "2025-01-12T00:00:00" (UTC)
    endTime: s.endTime,      // "2025-01-12T09:00:00" (UTC)
    source: 'ASSIGNED_STUDY_TIME' as const,
  })),
];

// Rendering
{allSchedules.map((schedule, idx) => (
  <div key={idx}>
    <div>{schedule.title}</div>
    <div>{schedule.activityName}</div>
    <div>
      {formatTime(schedule.startTime, schedule.source === 'ASSIGNED_STUDY_TIME')}
      -
      {formatTime(schedule.endTime, schedule.source === 'ASSIGNED_STUDY_TIME')}
    </div>
  </div>
))}
```

UTC conversion is automatically determined by `source` value:
- `WEEKLY_SCHEDULE` → `isUtc: false` (LocalTime as-is)
- `ASSIGNED_STUDY_TIME` → `isUtc: true` (UTC → KST conversion)

---

## Lessons Learned

### 1. Always Check Backend DTO Types
Don't assume "it's a string, so substring will work" - check the backend DTO definition first.
```java
// Look at this to understand the format
private LocalTime startTime;      // HH:mm:ss
private LocalDateTime startTime;  // YYYY-MM-DDTHH:mm:ss
```

### 2. Be Timezone Aware
If the server stores in UTC, frontend needs to convert.
- `LocalTime`: No timezone (just time value)
- `LocalDateTime`: Server stores in UTC → KST conversion needed

### 3. Branch Logic by Type
When mixing multiple types, use a discriminator like `source` to branch processing logic.

---

## Conclusion

"It's a time string, so substring should work" is a dangerous assumption. LocalTime and LocalDateTime are completely different formats, and it gets even more complex when timezone conversion is involved. Branch clearly by type and handle UTC→KST conversion properly.

**Essential Checklist:**
- [ ] Check backend DTO type (LocalTime vs LocalDateTime)
- [ ] Verify timezone (UTC or local?)
- [ ] Branch formatting logic (check for T)
- [ ] Apply timezone offset when converting UTC

Now the weekly schedule times show up correctly in the seat monitoring popover! 🎉
