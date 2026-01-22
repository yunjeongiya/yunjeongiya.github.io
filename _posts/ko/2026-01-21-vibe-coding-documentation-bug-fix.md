---
layout: post
title: "바이브코딩에서 자동 문서화가 버그 수정 시간을 5분으로 단축시킨 이야기"
date: 2026-01-21 10:00:00 +0900
categories: [AI, Debugging]
tags: [vibe-coding, claude, documentation, debugging, ai, features-system]
lang: ko
slug: "024"
---

## TL;DR
Discord 출석 시스템 버그를 5분 만에 수정. 비결은 자동 문서화 시스템. AI와 협업할 때 문서화는 "미래의 나를 위한 선물"이다. Phase별 체크박스 하나가 5분 vs 5시간을 갈랐다.

---

## 배경: 바이브코딩과 자동 문서화

바이브코딩(Vibe Coding)을 시작한 지 3개월 정도 됐다. Claude Code와 함께 CheckUS라는 학원 관리 시스템을 만들고 있다.

처음엔 그냥 코드만 빠르게 찍어내는 데 집중했다. 그런데 프로젝트가 커지면서 문제가 생겼다. **AI가 예전에 뭘 만들었는지 기억을 못 한다.** 컨텍스트가 날아가면 처음부터 다시 설명해야 했다.

그래서 도입한 게 **Features 추적 시스템**이다.

```
checkus-docs/features/
├── INDEX.md                    # 전체 기능 인덱스
├── F052-weekly-schedule-attendance/
│   └── README.md               # Discord 출석 시스템 재설계 문서
├── F072-workflow-commands/
│   └── README.md               # 워크플로우 명령어 문서
└── ...
```

핵심은 `/finish` 명령어다. 기능 하나를 완성할 때마다 Claude가 자동으로 문서를 업데이트한다:
- 뭘 바꿨는지 (코드 변경사항)
- 왜 이렇게 결정했는지 (기술적 결정사항)
- 어떤 문제를 해결했는지

솔직히 귀찮아서 시작한 건데, 오늘 진가를 발휘했다.

---

## 문제 상황: Discord에 있는데 "미접속"?

오늘 운영 중에 이상한 버그가 발생했다.

> "중1 임지환 학생이 Discord 음성채널에 들어와 있는데, 스터디 모니터링 화면에서는 '미접속'으로 표시돼요"

처음엔 Discord 봇 문제인가 싶었다. 서버 로그를 확인해봤다.

```
WARN - 디스코드 사용자를 찾을 수 없습니다. 닉네임: 중1 임지환
```

Discord 닉네임 매칭 문제? 그런데 내가 직접 테스트해보니 봇은 정상 동작했다. DM도 잘 왔다.

API 응답을 까봤다:

```json
{
  "assigneeId": 40,
  "assigneeName": "임지환",
  "status": "ABSENT",
  "connectedActualStudyTimes": []  // 비어있음!
}
```

DB를 직접 확인했더니:

```sql
SELECT * FROM online_study_session WHERE student_id = 40;
-- id: 1078, student_id: 40, end_time: NULL (진행 중!)
```

**DB에는 세션이 있는데, API 응답에는 없다.** 뭔가 이상하다.

---

## 해결: "관련 문서 있을 거야, 찾아봐"

여기서 문서화의 힘이 발휘됐다. 나는 Claude에게 이렇게 말했다:

> "이거 Discord 출석 시스템 마이그레이션하다가 중간에 멈춘 거 같은데, 관련 문서 있을 거야. 찾아봐"

Claude가 Features 문서들을 검색하더니 F052를 찾아냈다:

> "F052 - Discord 출석/알림 시스템 완전 재설계 문서를 찾았습니다. 확인해보니 Phase 4가 미완료 상태네요."

문서를 읽은 Claude가 문제를 발견했다:

```markdown
## 📋 개요
현재 Discord 출석 체크 및 알림 시스템의 복잡도를 근본적으로 해결하는 전면 재설계 작업입니다.

### Phase 4: 모니터링 서비스 전환
- [ ] StudyMonitoringService 구현
- [ ] API 엔드포인트 전환
```

**Phase 4가 미완료 상태였다.**

Claude가 문서를 더 읽고 분석했다:
- 기존: `ActualStudyTime` 테이블 사용
- 신규: `OnlineStudySession` 테이블 사용
- Discord 봇은 이미 `OnlineStudySession`에 데이터를 쓰고 있음
- **그런데 모니터링 서비스는 여전히 `ActualStudyTime`을 조회 중**

```java
// 문제의 코드 (수정 전)
List<ActualStudyTime> unassigned = actualStudyTimeRepository
    .findByAssigneeIdsAndDateRange(...);  // 구 테이블 조회!
```

---

## 수정: 5분만에 완료

원인을 알았으니 수정은 간단했다.

**1. Repository에 배치 조회 메서드 추가**

```java
// WeeklySchedule과 연결된 세션 조회
List<OnlineStudySession> findByWeeklyScheduleIdsAndPeriod(
    List<Long> weeklyScheduleIds,
    LocalDateTime startTime,
    LocalDateTime endTime);

// 일정 외 세션 조회 (weeklyScheduleId가 NULL)
List<OnlineStudySession> findByStudentIdsAndPeriodUnscheduled(
    List<Long> studentIds,
    LocalDateTime startTime,
    LocalDateTime endTime);
```

**2. Service에서 Repository 교체**

```java
// Before
private final ActualStudyTimeRepository actualStudyTimeRepository;

// After
private final OnlineStudySessionRepository onlineStudySessionRepository;
```

**3. 조회 로직 수정**

```java
// Before
List<ActualStudyTime> unassigned = actualStudyTimeRepository
    .findByAssigneeIdsAndDateRangeAndAssignedStudyTimeIdIsNull(...);

// After
List<OnlineStudySession> unassignedSessions = onlineStudySessionRepository
    .findByStudentIdsAndPeriodUnscheduled(batch, startTime, endTime);
```

커밋하고 배포. **문제 발견부터 해결까지 5분.**

---

## 배운 점: 문서화는 미래의 나를 위한 선물

### 1. AI와 일할 때 문서화는 필수다

AI는 기억을 못 한다. 컨텍스트가 날아가면 처음부터 다시 설명해야 한다. 그런데 문서가 있으면? **"관련 문서 있을 거니까 찾아봐"** 한 마디면 된다. 내가 뭘 했는지, 어떤 번호인지 기억 안 나도 AI가 알아서 찾아서 문제까지 파악한다.

### 2. 미완료 상태 추적이 핵심이다

Phase 4가 체크 안 된 상태로 남아있었다. 이게 없었으면 "다 완료됐겠지" 하고 엉뚱한 곳을 뒤졌을 거다.

```markdown
### Phase 4: 모니터링 서비스 전환
- [ ] StudyMonitoringService 구현  ← 이 체크박스 하나가 5분 vs 5시간을 갈랐다
```

### 3. 마이그레이션은 "전부 아니면 전무"가 아니다

ActualStudyTime → OnlineStudySession 전환을 4단계로 나눠서 진행했다. 그 덕에:
- 부분 완료 상태에서도 시스템이 돌아갔고
- 어디까지 했는지 추적이 가능했다

---

## 결론

"문서화 해뒀어서 바로 고쳤네"

오늘 버그 수정 후 혼잣말로 한 말이다. 3개월 전의 내가 귀찮아하면서도 문서를 남겨둔 덕에, 오늘의 내가 5분 만에 문제를 해결했다.

바이브코딩의 핵심은 AI가 코드를 빠르게 짜는 게 아니다. **AI가 맥락을 유지할 수 있게 문서로 남겨두는 것**이다. 그래야 한 달 뒤, 일 년 뒤에도 "이거 왜 이렇게 만들었지?"라는 질문에 답할 수 있다.

---

## 참고: 우리 프로젝트의 문서화 워크플로우

1. **새 기능 시작**: `features/F{번호}-{이름}/README.md` 생성
2. **작업 중**: Phase별 체크박스로 진행률 관리
3. **기능 완료**: `/finish` 명령어로 자동 커밋 + 문서 업데이트
4. **중단 시**: `/pause` 명령어로 현재 상태 기록

이 패턴이 궁금하다면 [/blog 명령어 포스트](/posts/024/)를 참고.

---

**TL;DR**: 바이브코딩 할 때 문서화 자동화 해두면 나중에 버그 잡을 때 엄청 빠르다. 진짜로.