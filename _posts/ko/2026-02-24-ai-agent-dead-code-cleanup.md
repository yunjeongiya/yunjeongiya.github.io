---
layout: post
title: "AI에게 데드코드를 맡겼더니 5,156줄을 지웠다"
date: 2026-02-24 15:00:00 +0900
categories: [DevOps, Refactoring]
tags: [dead-code, static-analysis, ai-coding-agent, refactoring, spring-boot, react, clean-code, claude-code]
lang: ko
slug: "035"
thumbnail: /assets/images/posts/035-ai-agent-dead-code/thumbnail-ko.png
---

![AI에게 데드코드를 맡겼더니 5,156줄을 지웠다](/assets/images/posts/035-ai-agent-dead-code/thumbnail-ko.png){: width="700"}

모든 코드베이스에는 묘지가 있다. 아무도 호출하지 않는 함수, 아무도 매핑하지 않는 DTO, 아무도 import하지 않는 export. 있다는 건 안다. 정리할 시간이 없을 뿐이다.

우리 프로젝트 — Spring Boot 3.4 + React/TypeScript 모노레포, 백엔드 모듈 35개 이상, 프론트엔드 기능 15개 이상 — 에도 상당량이 쌓여 있었다. SonarQube를 설치하거나 Knip을 도입하는 대신, AI 코딩 에이전트에게 프로젝트 전체를 던져주고 "데드코드 찾아"라고 했다. 2시간 뒤, **143개 파일에서 5,156줄이 사라졌고**, 빌드는 여전히 통과했다.

---

## 기존 도구를 안 쓴 이유

당연한 질문: 전용 정적 분석 도구를 쓰면 되지 않나?

**SonarQube** — 서버, DB, CI 연동이 필요하다. 아직 프리프로덕션인 프로젝트에 이건 대포로 파리 잡는 격이다.

**ESLint `no-unused-vars`** — 미사용 *지역 변수*만 잡는다. `utils/phone.ts`에서 export한 `formatPhoneNumber()`이 프로젝트 어디에서도 import되지 않는다는 건 알려주지 않는다.

**Knip** — JavaScript/TypeScript에는 좋지만, 우리 백엔드는 Java다. 두 개의 도구를 설정해야 하고, Knip은 Spring의 DI를 이해하지 못한다.

**IntelliJ "Unused" 검사** — 파일 단위로 동작한다. 1,032개 Java 파일을 일괄 처리할 수는 없다.

원하는 건 이런 거였다: 설정 없이, 두 언어 모두 지원하고, git 이력을 참고하며, 삭제 전에 리뷰할 수 있는 도구. AI 에이전트 + grep이 딱 그거였다.

## 접근 방법: Grep 기반 정적 분석 + AI 오케스트레이션

핵심 아이디어는 단순하다. 코드베이스의 모든 export된 심볼에 대해, 프로젝트 전체를 grep으로 검색한다. 참조가 0이면 삭제 후보다.

이걸 6단계 프로세스로 정리했다:

```
Phase 1: 프론트엔드 스캔 (542개 .ts/.tsx 파일)
Phase 2: 백엔드 스캔 (1,032개 .java 파일)
Phase 3: Git 이력 분석 (각 후보에 git log -S 실행)
Phase 4: 리포트 (구조화된 테이블, 삭제 전)
Phase 5: 대화형 정리 (사용자가 삭제 방식 선택)
Phase 6: 빌드 검증 (npm run build + gradlew compileJava)
```

프론트엔드 스캔 범위:

- **1A: 미사용 파일** — 다른 파일에서 한 번도 import되지 않은 `.ts/.tsx` 파일
- **1B: 미사용 named export** — import하는 곳이 0인 export된 심볼
- **1C: 낡은 barrel re-export** — 아무도 소비하지 않는 `index.ts` re-export

백엔드 스캔 범위:

- **2A: 미사용 DTO** — 참조가 0인 `*Request.java`, `*Response.java`, `*Dto.java`
- **2B: 미사용 리포지토리 메서드** — Service에서 호출하지 않는 커스텀 쿼리 메서드
- **2C: 미사용 유틸리티 메서드** — `util/helper/common` 패키지의 public 메서드
- **2D: 미사용 클래스** — Spring 어노테이션 없이 참조도 없는 클래스

프론트엔드와 백엔드 스캔은 별도의 Task 에이전트로 병렬 실행해서 소요 시간을 절반으로 줄였다.

## Spring의 "Always Alive" 문제

Java/Spring이 데드코드 탐지를 근본적으로 어렵게 만드는 지점이다.

React 앱에서는 아무것도 import하지 않으면 죽은 코드다. 단순하다. 그런데 Spring Boot에서는 `@Service`가 붙은 클래스는 어떤 `.java` 파일에서도 명시적으로 참조하지 않아도 살아있다 — Spring의 컴포넌트 스캔이 런타임에 찾아서 주입하기 때문이다.

"import하는 곳을 찾는" 방식을 그대로 적용하면 거의 모든 Service 클래스가 데드코드로 잡힌다.

해결책은 엄격한 제외 목록이다. **"Always Alive" 규칙**이라고 불렀다:

```
절대 데드코드로 표시하지 않는 클래스:
  @Component, @Service, @Repository, @Controller, @RestController
  @Configuration, @Bean
  @Entity, @MappedSuperclass, @Embeddable
  @Scheduled, @EventListener, @Async
  @Aspect, @ControllerAdvice, @RestControllerAdvice
  @Converter, @JsonComponent
  *Initializer 클래스
  src/test/ 하위 전체
```

의도적으로 보수적이다. 데드코드 몇 개 놓치는 게 Spring이 시작 시 연결하는 서비스를 삭제하는 것보다 낫다. grep 기반 접근은 *데이터 객체* — DTO, 유틸리티 메서드, 리포지토리 쿼리 메서드 — 만 대상으로 한다. 참조 체인이 소스 코드에서 완전히 보이는 것들만.

## 결과

**프론트엔드 정리 (542 파일 스캔):**

| 카테고리 | 삭제 수 |
|----------|:---:|
| 미사용 파일 삭제 | 3 |
| 미사용 export 제거 | ~105 |
| 낡은 barrel re-export 정리 | 33 |
| **삭제된 줄 수** | **2,070** |

삭제된 3개 파일: `TeacherTaskForm.tsx`, `TeacherScheduleDialog.tsx`, `lib/errorUtils.ts` — 나중에 재설계된 기능의 이전 구현체였다.

**백엔드 정리 (1,032 파일 스캔):**

| 카테고리 | 삭제 수 |
|----------|:---:|
| 미사용 DTO 삭제 | 13 |
| 미사용 유틸리티 클래스 삭제 | 3 |
| 미사용 리포지토리 메서드 제거 | ~185 |
| 미사용 유틸리티 메서드 제거 | 11 |
| **삭제된 줄 수** | **3,086** |

삭제된 3개 유틸리티 클래스: `DomainUtils`, `StringValidationUtils`, `CampusTimeUtils`. 각각 몇 달 전에 더 나은 구현으로 대체되었지만 정리되지 않고 남아있었다.

**전체 합계:**

| 지표 | 값 |
|------|------:|
| 스캔한 파일 수 | 1,574 |
| 발견된 데드코드 항목 | ~356 |
| 변경된 파일 수 | 143 |
| 삭제된 줄 수 | 5,156 |
| 빌드로 잡힌 false positive | 2 |
| 총 소요 시간 | ~2시간 |

## False Positive 이야기 (빌드 검증이 필수인 이유)

2개 항목이 스캔에서 "데드"로 분류됐지만, 실제로는 살아있었다. 둘 다 스캔이 아닌 빌드 단계에서 잡혔다.

**False positive #1: 필드명 별칭 문제**

`OrderService`의 두 메서드 — `generateFirstOrder()`와 `generateBetweenOrder()`. grep 스캔은 `OrderService.generateFirstOrder`를 검색했고 아무것도 안 나왔다. 데드코드 맞지?

아니다. `TaskTemplateOrderService`가 `OrderService`를 `orderService`(소문자)라는 필드로 주입받아 `orderService.generateFirstOrder()`로 호출하고 있었다. grep 패턴이 클래스 이름으로 검색했지, 필드 이름으로 검색하지 않았던 것이다.

`./gradlew compileJava` 실행 -> 컴파일 에러 -> `git checkout`으로 자동 복원.

**False positive #2: 호출 패턴 불일치**

`SeatWaitingEntryRepository`의 3개 메서드가 미사용으로 표시됐다. 실제로는 `SeatWaitingService`에서 호출하고 있었지만, 스캔 에이전트의 grep 패턴이 해당 호출 구문을 매칭하지 못했다.

같은 패턴: 빌드에서 잡혔고, 자동 복원됐다.

**보너스: 깨진 import**

리포지토리 메서드를 일괄 삭제하던 중, 에이전트의 편집이 import 문을 잘못 수정했다 — 패키지 이름 중간에 줄바꿈이 삽입됐다. false positive는 아니지만, 이것도 빌드 단계에서만 잡혔다.

결론은 명확하다: **빌드 검증 없이는 깨진 코드를 커밋할 뻔했다.** 스캔은 휴리스틱이다. 빌드가 진실의 원천이다.

## 재사용 가능한 명령어

일회성으로 끝내고 싶지 않았다. 이 전체 프로세스를 Claude Code의 `/dead-code` 슬래시 명령어로 만들었다.

6단계 플로우:

```
/dead-code
  |
  +-- Phase 1: 프론트엔드 스캔
  |   +-- 1A: 미사용 파일
  |   +-- 1B: 미사용 named export
  |   +-- 1C: 낡은 barrel re-export
  |
  +-- Phase 2: 백엔드 스캔 (Phase 1과 병렬 실행)
  |   +-- 2A: 미사용 DTO
  |   +-- 2B: 미사용 리포지토리 메서드
  |   +-- 2C: 미사용 유틸리티 메서드
  |   +-- 2D: 미사용 클래스
  |
  +-- Phase 3: Git 이력 (STALE / RECENT / ORPHANED 분류)
  |
  +-- Phase 4: 리포트 (테이블, 아직 삭제 없음)
  |
  +-- Phase 5: 대화형 정리
  |   +-- 전체 정리
  |   +-- 카테고리별 정리
  |   +-- 하나씩 리뷰
  |   +-- 리포트만 내보내기
  |
  +-- Phase 6: 빌드 검증
      +-- 실패 시: false positive 자동 복원, 재시도
      +-- 성공 시: 커밋 제안
```

핵심 설계 결정 4가지:

**보수적 스캔** — false positive보다 false negative를 선호한다. 심볼 이름이 문자열 리터럴(리플렉션, 동적 import)에 나타나면 표시하지 않는다.

**Git pickaxe 분류** — `git log -S "<symbol>"`은 마지막 참조가 *언제* 제거됐는지 알려준다. 8개월 전에 import가 명시적으로 삭제된 심볼(ORPHANED)은, 단순히 import된 적이 없는 심볼(WIP일 수 있음)보다 훨씬 강력한 삭제 후보다.

**삭제 전 리포트** — Phase 4는 필수다. 파일 경로, 마지막 수정일, 분류 시그널과 함께 모든 후보를 보여준 후에야 삭제가 시작된다.

**빌드 실패 시 자동 복원** — 정리 후 빌드가 실패하면 깨진 파일을 찾아 `git checkout -- <path>`로 복원하고 빌드를 재실행한다. 수동 개입 불필요.

월 1회 정기적으로 `/dead-code`를 실행할 계획이다.

## 핵심 교훈

**1. 보수적 스캔이 공격적 스캔을 이긴다.** ~356개 후보 중 false positive 2개는 0.56% 비율이며, 둘 다 자동으로 잡혔다. 엄격하게 시작하고 나중에 느슨하게 조정하면 된다.

**2. 빌드 검증만이 유일하게 믿을 수 있는 안전망이다.** Grep 기반 분석은 휴리스틱이다. 필드명 별칭, 리플렉션, 동적 디스패치를 추적할 수 없다. 빌드가 스캔이 놓친 것을 잡는다.

**3. Git 컨텍스트가 "아마 죽은 코드"와 "확실히 죽은 코드"를 구분한다.** 호출자가 0인 함수가 어제 수정됐다면 아마 작업 중이다. 8개월 전에 import가 명시적으로 제거됐다면 거의 확실히 데드코드다. `git log -S`가 이 시그널을 공짜로 준다.

**4. 전용 도구가 필요 없다.** SonarQube, Knip, IDE 검사 모두 자리가 있다. 하지만 빠르게 전체 프로젝트를 크로스 랭귀지로 훑으면서 대화형으로 리뷰하고 싶다면, AI 에이전트 + grep + git + 빌드 명령어가 놀라울 정도로 잘 동작한다. 1,574 파일, 356개 후보, 5,156줄 삭제 — 설정 없이 약 2시간.

---

데드코드는 조용히 쌓이는 기술 부채다. grep 결과를 더럽히고, 온보딩을 어렵게 하고, 리팩토링 리스크를 높인다. 미룰수록 정리 비용이 커진다. 2시간과 AI 에이전트로 깨끗한 기준선을 되찾았다. `/dead-code` 명령어 덕분에 그 상태를 유지할 수 있다.
