---
layout: post
title: "서버가 또 죽었는데, 이번엔 30초 만에 살렸다 — O(N²) CPU 폭주 실전 대응"
date: 2026-04-22 00:30:00 +0900
categories: [Incident, Performance]
tags: [spring-boot, jpa, n-plus-1, tree-structure, incident-response, nginx]
lang: ko
slug: "058"
published: false
---

[지난 글](/posts/057)에서 서버가 죽었을 ��� 끌 수 있는 스위치가 없어서, 손 놓고 배포를 기다려야 했던 이야기�� 썼다. 그 경험 끝에 nginx kill switch와 circuit breaker를 만들��다. 일주일 뒤, 서버가 또 죽었다. 그리고 나는 그 스위치를 처음으�� 실전에서 눌렀다.

## 밤 10시, "로그인이 안 된다"

사용자가 문서를 작성하던 중 갑자기 "네트워크 불안정" → "서버 점검중" → 로그아웃. 재로그인하면 되지만 2분 후 다시 튕김. 곧이어 다른 사용자들도 같은 증상.

처음에는 특정 계정 문제로 보였다. 비밀번호 초기화를 했던 계정이라 그쪽 문제인가 싶었다. 리프레시 토큰이 누락되고(`AUTH_REFRESH_TOKEN_MISSING`), JWT 만료 로그가 반복됐다. 전형적인 인증 문제 패턴.

하지만 로그를 더 보니 `Broken pipe`가 쏟아지고 있었다. 서버가 응답을 보내기 전에 클라이언트 연결이 끊기는 것이다. 인증 문제가 아니라, **서버가 너무 느려서 모든 응답이 타임아웃**되고 있었다.

## 진단

### CPU 200%

```
app-green: CPU 199.17%, MEM 1.703GiB
```

2코어 서버에서 CPU 200%. 모든 코어가 100% 점유 중이다. 컨테이너를 재시작해봤지만 부팅 직후 다시 200%로 복귀. 부팅 웜업이 아니라 들어오는 요청 자체가 문제.

### 스레드 덤프로 범인 특정

JVM에 `kill -3`을 보내 스레드 덤프를 떴다:

```
at ...TreeQueryService.getTemplateTree(...)
at ...TreeController.getTemplateTree(...)
at ...TreeController.getTemplateTree(...)
... (수십 개 반복)
```

`getTemplateTree` 호출이 수십 개 동시에 RUNNABLE 상태로 쌓여있었다. 하나도 완료되지 못하고, 클라이언트가 타임아웃 후 재시도하면서 눈덩이처럼 불어난 것이다.

### 킬 스위치: 30초

지난번에 만들어둔 nginx kill switch를 눌렀다:

```nginx
location /task-templates/tree {
    return 503;
}
```

nginx reload. CPU가 떨어지기 시작했다:

```
199% → 102% (10초 후) → 36% (25초 후)
```

**원인 특정부터 서비스 안정화까지 30초.** 지난번 ddl-auto 인시던트에서는 코드 수정 + 배포까지 서비스가 죽어있었다. kill switch 하나의 차이가 이렇게 크다.

## 근본 원인: 세 겹의 폭탄

DB를 조회해보니 활성 노드가 **111,773개**였다. 이 코드는 노드가 수백 개일 때 작성됐다.

### 1. 11만 건 전체 로드

```java
if (categoryId != null) {
    templates = repository.findByCategoryIdAndActiveTrue(categoryId);
} else {
    templates = repository.findByActiveTrue();  // 111,773건
}
```

`categoryId` 없이 호출하면 전부 메모리에 올린다.

### 2. N+1 쿼리

```java
// mapper에서 LAZY 연관 접근 — 11만 번 추가 SELECT
Subject subject = template.getCurriculum().getSubject();
```

### 3. O(N²) 트리 빌드

```java
private void buildSubTree(TreeNodeResponse parent,
                          List<ContentNode> allTemplates, ...) {
    // 매 노드마다 11만 건 전체를 stream filter로 순회
    List<TreeNodeResponse> children = allTemplates.stream()
            .filter(t -> parent.getId().equals(t.getParentId()))
            .collect(Collectors.toList());

    for (TreeNodeResponse child : children) {
        buildSubTree(child, allTemplates, ...);  // 재귀
    }
}
```

11만 건 DB 로드 + 11만 번 LAZY 쿼리 + 매 노드마다 11만 건 순회. 대략적으로 계산하면 비교 연산만 **100억 회 이상**이다. 이 셋이 겹치��� 서버가 죽��� 게 당연하다.

## 핫픽스

### categoryId 필수화

```java
if (categoryId == null) {
    throw new BusinessException(
        "categoryId는 필수입니다. 전체 트리 조회는 지원하지 않습니다.");
}
```

### FETCH JOIN으로 N+1 제거

```java
@Query("SELECT t FROM ContentNode t JOIN FETCH t.category " +
       "WHERE t.categoryId = :categoryId AND t.active = true")
List<ContentNode> findByCategoryIdWithCategory(Long categoryId);
```

1개의 쿼리로 노드와 카테고리를 함께 가져온다. 지난번 OOM 인시던트(5만 건 전체 로드로 힙 폭발)의 경험이 있었기 때문에, FETCH JOIN은 반드시 `categoryId` 필터와 함께 사용했다. 필터 없이 11만 건을 FETCH JOIN하면 또 메모리가 터진다.

### O(N) HashMap 트리 빌드

```java
// 1. 전체를 Map에 — O(N)
Map<Long, TreeNodeResponse> nodeMap = new HashMap<>(templates.size());
for (ContentNode t : templates) {
    nodeMap.put(t.getId(), converter.apply(t));
}

// 2. 부모-자식 연결 — O(N)
for (ContentNode t : templates) {
    TreeNodeResponse node = nodeMap.get(t.getId());
    if (t.getParentId() == null || !nodeMap.containsKey(t.getParentId())) {
        roots.add(node);
    } else {
        nodeMap.get(t.getParentId()).getChildren().add(node);
    }
}
```

두 번의 순회로 트리가 완성된다. `allTemplates.stream().filter(...)` 재귀가 사라졌다.

## 타임라인

| 시각 (KST) | 상황 |
|------------|------|
| 22:00 | "로그인 안 됨" 최초 보고 |
| 22:10 | 서버 상태 확인, 특정 계정 문제로 추정 |
| 22:30 | 다른 사용자도 동일 증상 — 전체 장애 판단 |
| 22:32 | CPU 200% 확인 |
| 22:35 | 스레드 덤프 → `getTemplateTree` 특정 |
| **22:37** | **nginx kill switch → CPU 36%로 안정화 (서비스 복구)** |
| 22:45 | 코드 수정 (3개 파일) |
| 23:14 | 핫픽스 배포 완료 |
| 23:21 | nginx 차단 해제, 서비스 정상화 |

최초 보고부터 정상화까지 약 80분. 다만 서비스 자체는 22:37 (kill switch)에 이미 복구됐다. 나머지 44분은 근본 원인 수정.

## 시니어라면 이걸 어떻게 막았을까

이 인시던트를 겪고 나서, 기업에서는 이런 걸 어떻게 사전에 방지하는지 찾아봤다.

**APM 자동 알림**: DataDog이나 New Relic 같은 APM이 있었다면, CPU가 80%를 넘는 순간 Slack 알림이 왔을 것이다. 사용자가 "안 돼요"라고 연락하기 30분 전에 인지할 수 있었다.

**slow query 모니터링**: DB 쿼리 실행 시간을 모니터링했다면, 11만 건 로드가 점점 느려지는 추세를 사전에 잡았을 것이다.

**부하 테스트**: staging 환경에서 실제 데이터 규모로 테스트했다면 배포 전에 발견됐다. N이 100일 때와 100,000일 때의 응답 시간 차이는 부하 테스트에서 바로 드러난다.

**코드 리뷰**: "전체 리스트를 매번 순회하는 재귀" 패턴은 시니어가 보면 바로 잡아낸다. 혼자 개발하면 이런 리뷰가 없다.

아직 이 중 어느 것도 없다. 다음 목표는 APM 알림부터.

## 배운 점

**데이터는 조용히 자란다.** 이 코드는 문제가 없었다 — 데이터가 적을 때는. 11만 건이 되기까지 경고 없이 정상 동작하다가 임계점에서 폭발했다.

**O(N²)는 잠복기 폭탄이다.** N이 100일 때 O(N²)와 O(N)의 차이는 10,000 vs 100. 체감 안 된다. N이 100,000이면 10,000,000,000 vs 100,000. 서버가 죽는다. 트리/그래프에서 "전체를 매번 순회"하는 코드가 보이면 HashMap으로 바꿔놓아야 한다.

**증상에 속지 마라.** "로그인이 안 된다"는 증상은 인증 시스템 문제처럼 보였다. JWT 만료, 리프레시 토큰 누락 — 로그도 그렇게 말하고 있었다. 실제 원인은 인증과 전혀 무관한 트리 데이터 조회였다. CPU 과부하가 모든 응답을 느리게 만들었고, 그 결과 인증 흐름이 깨진 것이다.

**방어 체계는 만들어둬야 쓸 수 있다.** 일주일 전에 kill switch를 만들어두지 않았다면, 이번에도 코드 수정 + 배포까지 서비스가 죽어있었을 것이다. "언젠간 필요하겠지"가 아니라 "지금 만들어두면 다음에 30초 만에 살린다"의 문제다.
