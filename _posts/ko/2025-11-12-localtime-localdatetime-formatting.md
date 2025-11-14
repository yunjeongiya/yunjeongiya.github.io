---
layout: post
title: "LocalTime vs LocalDateTime: 시간 포맷팅 버그와 UTC→KST 변환"
date: 2025-11-12 09:20:00 +0900
categories: [Frontend, TypeScript]
tags: [typescript, datetime, timezone, formatting, debugging]
lang: ko
slug: "010"
---

## TL;DR
주간고정일정(LocalTime "09:00:00")과 임시배정(LocalDateTime "2025-01-12T09:00:00")을 같은 방식으로 substring 하면 망한다. 주간고정일정은 시간대 없고, 임시배정은 UTC라서 KST로 변환도 필요하다. 타입별로 처리 로직 분기하자.

---

## 좌석도 모니터링 팝오버에서 시간이 안 보이는 버그

좌석 배치도에서 학생 좌석에 마우스 호버하면 오늘 일정을 보여주는 팝오버가 있다. 주간고정일정과 임시배정을 함께 보여주는데, **주간고정일정의 시간이 표시되지 않는 버그**가 발견됐다.

### 문제 상황
```tsx
// 기존 코드 (버그)
<div className="text-gray-500 text-[10px] mt-0.5">
  {schedule.startTime.substring(11, 16)} - {schedule.endTime.substring(11, 16)}
</div>
```

이 코드는 LocalDateTime 형식(`"2025-01-12T09:00:00"`)에서만 작동한다:
- 11번 인덱스부터 16번까지 자르면 → `"09:00"`

하지만 LocalTime 형식(`"09:00:00"`)에서는:
- 11번 인덱스부터 자르면 → `""` (빈 문자열, 길이가 8자밖에 안 됨)

---

## 백엔드 DTO 구조 차이

### 주간고정일정 (WeeklyScheduleResponse)
```java
@JsonFormat(pattern = "HH:mm")
private LocalTime startTime;  // "09:00:00"

@JsonFormat(pattern = "HH:mm")
private LocalTime endTime;    // "17:00:00"
```
- **타입**: `LocalTime`
- **형식**: `"HH:mm:ss"` (시간만, 날짜 없음)
- **시간대**: 없음 (단순 시각 정보)

### 임시배정 (AssignedStudyTime)
```java
private LocalDateTime startTime;  // "2025-01-12T00:00:00"
private LocalDateTime endTime;    // "2025-01-12T09:00:00"
```
- **타입**: `LocalDateTime`
- **형식**: `"YYYY-MM-DDTHH:mm:ss"`
- **시간대**: UTC (서버가 UTC로 저장)
- **주의**: 프론트엔드에서 KST로 변환 필요 (UTC+9)

---

## 해결 방법: formatTime 헬퍼 함수

두 가지 형식을 모두 처리하고, UTC→KST 변환까지 지원하는 헬퍼 함수를 만들었다.

```typescript
/**
 * LocalTime(HH:mm:ss) 또는 LocalDateTime(YYYY-MM-DDTHH:mm:ss) 형식을 HH:mm으로 변환
 * @param timeString - LocalTime 또는 LocalDateTime 문자열
 * @param isUtc - true인 경우 UTC를 KST로 변환 (임시배정용)
 */
const formatTime = (timeString: string, isUtc: boolean = false): string => {
  if (!timeString) return '';

  // LocalDateTime 형식인 경우 (T가 포함됨)
  if (timeString.includes('T')) {
    // UTC -> KST 변환이 필요한 경우 (임시배정)
    if (isUtc) {
      const utcDate = new Date(timeString);
      // KST는 UTC+9
      const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
      const hours = String(kstDate.getUTCHours()).padStart(2, '0');
      const minutes = String(kstDate.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    // UTC 변환이 필요없는 경우
    return timeString.substring(11, 16); // "2025-01-12T09:00:00" -> "09:00"
  }

  // LocalTime 형식인 경우 (HH:mm:ss) - 주간고정일정
  return timeString.substring(0, 5); // "09:00:00" -> "09:00"
};
```

### 핵심 로직 설명

#### 1. LocalDateTime 판별
```typescript
if (timeString.includes('T'))
```
`T`가 포함되어 있으면 LocalDateTime 형식. ISO 8601 표준 형식이다.

#### 2. UTC → KST 변환
```typescript
if (isUtc) {
  const utcDate = new Date(timeString);
  const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  // ...
}
```
- UTC 시각을 JavaScript Date 객체로 파싱
- 9시간(9 × 60 × 60 × 1000ms) 더하기
- `getUTCHours()`로 시간 추출 (KST 오프셋이 이미 적용된 상태)

#### 3. LocalTime 처리
```typescript
return timeString.substring(0, 5); // "09:00:00" -> "09:00"
```
앞 5자리만 잘라내면 "HH:mm" 형식 완성.

---

## 사용 예시

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

// 렌더링
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

`source` 값에 따라 UTC 변환 여부를 자동으로 결정한다:
- `WEEKLY_SCHEDULE` → `isUtc: false` (LocalTime 그대로)
- `ASSIGNED_STUDY_TIME` → `isUtc: true` (UTC → KST 변환)

---

## 배운 점

### 1. 백엔드 DTO 타입 확인 필수
프론트엔드에서 "문자열이니까 substring 하면 되겠지" 하지 말고, 백엔드 DTO 정의를 먼저 확인하자.
```java
// 이거 보고 형식 파악
private LocalTime startTime;      // HH:mm:ss
private LocalDateTime startTime;  // YYYY-MM-DDTHH:mm:ss
```

### 2. UTC/KST 시간대 인지
서버가 UTC로 저장하면 프론트엔드에서 변환 필요.
- `LocalTime`: 시간대 없음 (단순 시각)
- `LocalDateTime`: 서버가 UTC로 저장 → KST 변환 필요

### 3. 타입별 분기 처리
여러 타입이 섞인 경우 `source` 같은 구분자를 두고 처리 로직 분기.

---

## 결론

"시간 문자열이니까 substring 하면 되겠지"는 위험한 생각이다. LocalTime과 LocalDateTime은 완전히 다른 형식이고, 시간대 변환까지 고려하면 더 복잡하다. 타입별로 명확하게 분기 처리하고, UTC→KST 변환 로직도 함께 챙기자.

**핵심 체크리스트:**
- [ ] 백엔드 DTO 타입 확인 (LocalTime vs LocalDateTime)
- [ ] 시간대 확인 (UTC인가? 로컬인가?)
- [ ] 포맷팅 로직 분기 (T 포함 여부)
- [ ] UTC 변환 필요 시 timezone offset 적용

이제 좌석도 모니터링 팝오버에서 주간고정일정 시간도 잘 보인다! 🎉
