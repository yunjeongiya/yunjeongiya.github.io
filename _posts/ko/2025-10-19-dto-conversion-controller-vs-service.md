---
layout: post
title: "Spring Boot DTO 변환 위치 논쟁 종결: Controller vs Service 계층"
date: 2025-10-19 14:00:00 +0900
categories: [Spring Boot, Architecture]
tags: [spring-boot, dto, controller, service, architecture, clean-code, martin-fowler, best-practices]
lang: ko
---

## TL;DR

DTO 변환은 **Controller에서 하는 것이 업계 표준**이다. Service는 도메인 객체(Entity)만 다뤄야 하며, DTO는 HTTP 계층의 관심사로 분리해야 한다. 이 글은 Martin Fowler 공식 문서, Stack Overflow 350+ 추천 답변, 실무 사례를 기반으로 명확한 해답을 제시한다.

---

## 문제 상황

Spring Boot 애플리케이션을 개발하다 보면 항상 마주치는 질문:

```java
// Controller에서 DTO 변환?
@PostMapping
public ResponseEntity<Response> create(@RequestBody CreateRequest request) {
    Entity entity = request.toEntity();  // 여기서 변환?
    Entity saved = service.save(entity);
    return ResponseEntity.ok(Response.from(saved));
}

// vs Service에서 DTO 변환?
@PostMapping
public ResponseEntity<Response> create(@RequestBody CreateRequest request) {
    Response response = service.create(request);  // Service가 DTO를 받음?
    return ResponseEntity.ok(response);
}
```

이 글에서는 **공식 문서, 업계 관행, 실무 사례**를 기반으로 명확한 답을 제시한다.

---

## 1. Martin Fowler의 DTO 패턴 정의

### DTO의 원래 목적

Martin Fowler는 [Patterns of Enterprise Application Architecture](https://martinfowler.com/eaaCatalog/dataTransferObject.html)에서 DTO를 다음과 같이 정의했다:

> **"An object that carries data between processes to reduce the number of method calls."**
> (프로세스 간 데이터 전송을 위해 메서드 호출 횟수를 줄이는 객체)

핵심은 **"프로세스 간 경계(Remote Boundary)"**에서 사용하는 것이다.

### DTO에 대한 Fowler의 경고

Fowler는 [LocalDTO](https://martinfowler.com/bliki/LocalDTO.html) 글에서 명확히 경고한다:

> **"Using DTOs in a local context is usually a bad idea."**
> (같은 애플리케이션 내에서 DTO를 사용하는 것은 보통 나쁜 생각이다)

단, 예외가 하나 있다:

> **"One case where it is useful is when you have a significant mismatch between the model in your presentation layer and the domain model."**
> (프레젠테이션 계층과 도메인 모델 간 상당한 불일치가 있을 때는 유용하다)

### DTO에서 비즈니스 로직 금지

Baeldung의 [DTO Pattern 가이드](https://www.baeldung.com/java-dto-pattern)에서 강조:

> **"Another common mistake is to add business logic to those classes, which should not happen. The purpose of the pattern is to optimize data transfer and contract structure. Therefore, all business logic should live in the domain layer."**

---

## 2. Spring 커뮤니티의 합의: Controller에서 변환

### Stack Overflow 베스트 답변 분석

#### [Which layer should convert entities to DTOs?](https://stackoverflow.com/questions/47822938/which-layer-should-be-used-for-conversion-to-dto-from-domain-object)

**가장 많이 추천받은 답변 (350+ 추천):**
> **"The controller should know service, service should know repository, but service layer should NOT know controller endpoint DTOs."**
> (컨트롤러는 서비스를 알고, 서비스는 리포지토리를 알지만, 서비스는 컨트롤러의 DTO를 알아서는 안 된다)

**핵심 논리:**
1. **계층 독립성**: Service가 DTO를 알면 특정 Controller에 종속된다
2. **재사용성**: 다른 Service나 배치 작업에서 같은 Service를 호출할 때 Entity를 필요로 함
3. **의존성 방향**: Service는 하위 계층(Repository)만 알아야 함

#### [Which layer should place mapper code?](https://stackoverflow.com/questions/47457009/which-is-best-layer-to-place-mapper-code-service-layer-or-controller-layer)

**핵심 답변 (200+ 추천):**
> **"Controllers are drivers and it's expected from them to transform inputs and outputs so that both elements don't need to know about each other's models."**
> (Controller는 입출력을 변환하는 드라이버이며, 양쪽이 서로의 모델을 몰라도 되게 만드는 것이 목적이다)

---

## 3. 실무 코드 패턴 분석

### 계층별 데이터 흐름도

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (HTTP)                         │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ JSON (DTO)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Controller Layer                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 1. Request DTO → Entity 변환 (toEntity())             │ │
│  │ 2. Service 호출 (Entity 전달)                         │ │
│  │ 3. Entity → Response DTO 변환 (from())                │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Entity (Domain)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Service Layer                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ • 비즈니스 로직 (검증, 계산)                          │ │
│  │ • 트랜잭션 관리 (@Transactional)                     │ │
│  │ • Entity만 다룸 (DTO 모름)                           │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ Entity (Domain)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Repository Layer                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ • 데이터 접근 (JPA)                                   │ │
│  │ • Entity 저장/조회                                    │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ SQL
                              ▼
                          Database
```

### 패턴 A: Controller 변환 (✅ 권장)

```java
@RestController
@RequestMapping("/tasks")
@RequiredArgsConstructor
public class TaskController {
    private final TaskService taskService;

    @PostMapping
    public ResponseEntity<TaskResponse> createTask(
            @Valid @RequestBody TaskCreateRequest request) {

        // 1️⃣ DTO → Domain Entity 변환 (Controller 책임)
        Task task = request.toEntity();

        // 2️⃣ 비즈니스 로직 실행 (Service 책임)
        Task savedTask = taskService.createTask(task);

        // 3️⃣ Domain Entity → DTO 변환 (Controller 책임)
        TaskResponse response = TaskResponse.from(savedTask);

        return ResponseEntity.ok(response);
    }
}

@Service
@Transactional
public class TaskService {
    private final TaskRepository taskRepository;

    // ✅ Domain Entity만 다룸
    public Task createTask(Task task) {
        validateTask(task);
        calculateOrderIndex(task);
        return taskRepository.save(task);
    }
}
```

**장점:**
- ✅ Service가 DTO에 독립적 → 재사용 가능
- ✅ 계층 책임이 명확 (Controller = 변환, Service = 비즈니스 로직)
- ✅ Service를 다른 Service나 배치에서 호출 가능

### 패턴 B: Service 변환 (❌ 안티패턴)

```java
@RestController
@RequestMapping("/tasks")
@RequiredArgsConstructor
public class TaskController {
    private final TaskService taskService;

    @PostMapping
    public ResponseEntity<TaskResponse> createTask(
            @Valid @RequestBody TaskCreateRequest request) {
        // ❌ DTO를 그대로 Service에 전달
        TaskResponse response = taskService.createTask(request);
        return ResponseEntity.ok(response);
    }
}

@Service
@Transactional
public class TaskService {
    private final TaskRepository taskRepository;

    // ❌ DTO를 받고 DTO를 반환
    public TaskResponse createTask(TaskCreateRequest request) {
        Task task = request.toEntity();  // 변환이 Service에 숨겨짐
        validateTask(task);
        calculateOrderIndex(task);
        Task saved = taskRepository.save(task);
        return TaskResponse.from(saved);  // 또 변환
    }
}
```

**문제점:**
- ❌ Service가 HTTP 계층(Controller DTO)에 종속됨
- ❌ 다른 Service에서 `createTask()`를 호출하려면 DTO를 만들어야 함 (불편)
- ❌ 배치 작업에서 호출 시 불필요한 DTO 변환 발생

---

## 4. 실전 사례: 학생 할일 생성 API

### 상황 설명
- 일반 할일 생성: 교사가 학생 지정 (`createTaskInstance`)
- 학생 자가 할일 생성: 학생 본인만 지정 가능 (`createTaskInstanceAsStudent`)

### ❌ 잘못된 설계 (Service 변환)

```java
// Controller
@PostMapping("/as-student")
public ResponseEntity<TaskResponse> createAsStudent(
        @Valid @RequestBody StudentTaskRequest request,
        @AuthenticationPrincipal CustomUserPrincipal principal) {

    // DTO를 Service로 위임
    TaskResponse response = taskService.createTaskAsStudent(request, principal.getId());
    return ResponseEntity.ok(response);
}

// Service에 메서드 2개 필요
public TaskResponse createTask(TaskCreateRequest request, Long userId) {
    // 100줄의 비즈니스 로직
}

public TaskResponse createTaskAsStudent(StudentTaskRequest request, Long studentId) {
    // 단 1줄 차이 - DTO 변환만 추가
    TaskCreateRequest fullRequest = request.toTaskCreateRequest(studentId);
    return createTask(fullRequest, studentId);
}
```

**문제:**
- 거의 동일한 메서드 2개 (코드 중복)
- 교사 자가 할일 추가 시 또 메서드 추가 필요 (`createTaskAsTeacher`)
- Service가 불필요하게 비대해짐

### ✅ 올바른 설계 (Controller 변환)

```java
// Controller
@PostMapping("/as-student")
@PreAuthorize("hasRole('STUDENT')")
public ResponseEntity<TaskResponse> createAsStudent(
        @Valid @RequestBody StudentTaskRequest request,
        @AuthenticationPrincipal CustomUserPrincipal principal) {

    // 1️⃣ DTO 변환 (Controller 책임)
    TaskCreateRequest fullRequest = request.toTaskCreateRequest(principal.getId());

    // 2️⃣ 비즈니스 로직 실행 (기존 Service 메서드 재사용)
    TaskResponse response = taskService.createTask(fullRequest, principal.getId());

    return ResponseEntity.ok(response);
}

// Service는 메서드 1개만 유지
public TaskResponse createTask(TaskCreateRequest request, Long userId) {
    // 100줄의 비즈니스 로직 (변화 없음)
}
```

**장점:**
- ✅ Service 메서드 1개로 모든 시나리오 처리
- ✅ 새로운 역할(교사) 추가 시 Controller만 확장
- ✅ 비즈니스 로직 중복 없음

---

## 5. DTO 변환, 정확히 무엇이 "비즈니스 로직"이 아닌가?

### DTO 변환 = 데이터 매핑 (비즈니스 로직 ❌)

```java
// 이건 단순 매핑 (비즈니스 로직 X)
public TaskCreateRequest toTaskCreateRequest(Long studentId) {
    return TaskCreateRequest.builder()
        .title(this.title)
        .studentId(studentId)  // 인증 정보 주입
        .dueDate(this.dueDate)
        .build();
}
```

이건 그냥 **"A 형식 데이터를 B 형식으로 복사"**일 뿐이다.

### 비즈니스 로직 = 도메인 규칙 (Service 책임 ✅)

```java
// 이건 비즈니스 로직 (Service에 있어야 함)
public Task createTask(Task task) {
    // 1️⃣ 도메인 규칙 검증
    if (task.getDueDate().isBefore(LocalDate.now())) {
        throw new BusinessException("마감일은 과거일 수 없습니다");
    }

    // 2️⃣ 다른 Entity와의 관계 검증
    Student student = studentRepository.findById(task.getStudentId())
        .orElseThrow(() -> new NotFoundException("학생을 찾을 수 없습니다"));

    // 3️⃣ 자동 계산 로직
    int orderIndex = calculateNextOrderIndex(task.getStudentId());
    task.setOrderIndex(orderIndex);

    // 4️⃣ 트랜잭션 처리
    return taskRepository.save(task);
}
```

---

## 6. 실무에서 자주 만나는 문제: 트랜잭션과 LazyInitializationException

### 문제 상황: Service에서 Entity 반환 시

```java
// Controller
@GetMapping("/{id}")
public ResponseEntity<TaskResponse> getTask(@PathVariable Long id) {
    Task task = taskService.getTask(id);  // Entity 반환

    // ❌ LazyInitializationException 발생!
    TaskResponse response = TaskResponse.from(task);  // task.getStudent() 호출 시 에러
    return ResponseEntity.ok(response);
}

// Service
@Transactional(readOnly = true)
public Task getTask(Long id) {
    return taskRepository.findById(id)
        .orElseThrow(() -> new NotFoundException("할일을 찾을 수 없습니다"));
    // 메서드 종료 = 트랜잭션 종료 = 세션 종료
}
```

**왜 에러가 날까?**
1. Service 메서드가 끝나면 `@Transactional` 범위 종료
2. JPA 세션 종료 → Lazy Loading 불가능
3. Controller에서 `task.getStudent()` 호출 시 세션 없음 → **LazyInitializationException**

### 해결 방법 2가지

#### 방법 1: Service에서 DTO로 변환 (✅ 권장)

```java
// Service
@Transactional(readOnly = true)
public TaskResponse getTask(Long id) {
    Task task = taskRepository.findById(id)
        .orElseThrow(() -> new NotFoundException("할일을 찾을 수 없습니다"));

    // 트랜잭션 내에서 DTO 변환 (Lazy Loading 가능)
    return TaskResponse.from(task);
}

// Controller
@GetMapping("/{id}")
public ResponseEntity<TaskResponse> getTask(@PathVariable Long id) {
    TaskResponse response = taskService.getTask(id);  // DTO 받음
    return ResponseEntity.ok(response);
}
```

**장점:**
- ✅ LazyInitializationException 방지
- ✅ 트랜잭션 내에서 필요한 데이터 모두 로드

**단점:**
- ❌ Service가 특정 DTO에 종속됨
- ❌ 조회 메서드마다 다른 DTO가 필요하면 메서드 중복

#### 방법 2: Fetch Join 사용 (✅ 권장)

```java
// Repository
@Query("SELECT t FROM Task t " +
       "JOIN FETCH t.student " +
       "JOIN FETCH t.template " +
       "WHERE t.id = :id")
Optional<Task> findByIdWithDetails(@Param("id") Long id);

// Service
@Transactional(readOnly = true)
public Task getTask(Long id) {
    return taskRepository.findByIdWithDetails(id)
        .orElseThrow(() -> new NotFoundException("할일을 찾을 수 없습니다"));
    // Entity 반환하지만 필요한 연관 Entity는 모두 로드됨
}

// Controller
@GetMapping("/{id}")
public ResponseEntity<TaskResponse> getTask(@PathVariable Long id) {
    Task task = taskService.getTask(id);  // Entity 받음 (연관 Entity 로드됨)
    TaskResponse response = TaskResponse.from(task);  // ✅ 에러 없음
    return ResponseEntity.ok(response);
}
```

**장점:**
- ✅ Service가 DTO 독립적 (재사용 가능)
- ✅ N+1 문제 해결

**단점:**
- ❌ Repository 메서드가 증가 (조회 시나리오마다)
- ❌ 복잡한 연관관계에서는 쿼리가 복잡해짐

### 실무 권장 패턴

| 시나리오 | 권장 방법 |
|---------|---------|
| 단순 조회 (연관 Entity 적음) | Fetch Join + Controller 변환 |
| 복잡한 집계 (여러 Service 조합) | Service에서 DTO 변환 (Facade 패턴) |
| 단순 CRUD (연관 Entity 없음) | Controller 변환 |

---

## 7. 예외 케이스: Facade 패턴

### 언제 Service에서 DTO를 다뤄야 하나?

**시나리오:** 복잡한 집계 데이터를 여러 Service에서 조합

```java
// ❌ Controller에서 직접 조합 (너무 복잡)
@GetMapping("/dashboard")
public DashboardResponse getDashboard() {
    List<Task> tasks = taskService.getAllTasks();
    List<StudyTime> studyTimes = studyTimeService.getStudyTimes();
    Statistics stats = statisticsService.calculate(tasks, studyTimes);

    // Controller가 비즈니스 로직을 포함하게 됨
    return DashboardResponse.builder()
        .tasks(tasks.stream().map(TaskDto::from).toList())
        .studyTimes(studyTimes.stream().map(StudyTimeDto::from).toList())
        .statistics(StatsDto.from(stats))
        .build();
}

// ✅ Facade 패턴 사용
@Service
public class DashboardFacadeService {
    private final TaskService taskService;
    private final StudyTimeService studyTimeService;
    private final StatisticsService statisticsService;

    public DashboardResponse getDashboard(Long studentId) {
        List<Task> tasks = taskService.getTasksByStudent(studentId);
        List<StudyTime> studyTimes = studyTimeService.getStudyTimesByStudent(studentId);
        Statistics stats = statisticsService.calculate(tasks, studyTimes);

        // 복잡한 조합 로직이 Facade에 캡슐화됨
        return DashboardResponse.builder()
            .tasks(tasks.stream().map(TaskDto::from).toList())
            .studyTimes(studyTimes.stream().map(StudyTimeDto::from).toList())
            .statistics(StatsDto.from(stats))
            .build();
    }
}
```

**주의:** Facade는 **여러 Service를 조합하는 복잡한 시나리오**에만 사용해야 한다. 단순 CRUD에는 불필요하다.

---

## 8. 정리: 계층 책임 체크리스트

### ✅ Controller에 있어야 하는 것
- DTO ↔ Domain Entity 변환
- 인증 정보 추출 (`@AuthenticationPrincipal`)
- HTTP 응답 구성 (`ResponseEntity`)
- 간단한 입력 검증 (`@Valid`)

### ✅ Service에 있어야 하는 것
- 비즈니스 로직 (도메인 규칙, 계산, 검증)
- 트랜잭션 관리 (`@Transactional`)
- 여러 Repository 조합
- 도메인 이벤트 발행

### ❌ Service에 없어야 하는 것
- HTTP 관련 DTO (Request/Response)
- 단순 DTO 변환 래핑 메서드
- Controller에 종속된 코드

---

## 9. 실무 팁: DTO 변환 패턴 모음

### 💡 팁 1: DTO에 변환 메서드 추가하기

```java
// ✅ DTO에 변환 메서드 캡슐화
public class TaskCreateRequest {
    private String title;
    private String description;
    private LocalDate dueDate;
    private String priority;

    // DTO가 자신을 Entity로 변환하는 책임
    public Task toEntity() {
        return Task.builder()
            .title(this.title)
            .description(this.description)
            .dueDate(this.dueDate)
            .priority(Priority.valueOf(this.priority))
            .build();
    }
}

// Controller는 깔끔하게
@PostMapping
public ResponseEntity<TaskResponse> createTask(@RequestBody TaskCreateRequest request) {
    Task task = request.toEntity();  // 한 줄로 해결
    Task saved = taskService.createTask(task);
    return ResponseEntity.ok(TaskResponse.from(saved));
}
```

### 💡 팁 2: 정적 팩토리 메서드로 Entity → DTO 변환

```java
public class TaskResponse {
    private Long id;
    private String title;
    private String studentName;
    private String status;

    // 정적 팩토리 메서드
    public static TaskResponse from(Task task) {
        return TaskResponse.builder()
            .id(task.getId())
            .title(task.getTitle())
            .studentName(task.getStudent().getName())  // 연관 Entity 접근
            .status(task.getStatus().name())
            .build();
    }

    // 리스트 변환도 편리
    public static List<TaskResponse> fromList(List<Task> tasks) {
        return tasks.stream()
            .map(TaskResponse::from)
            .toList();
    }
}
```

---

## 10. FAQ: 자주 묻는 질문

### Q1. "LazyInitializationException이 자꾸 나는데요?"

**원인:** Service에서 Entity를 반환하는데, Controller에서 연관 Entity에 접근하려고 함

**해결:**
```java
// 방법 A: Fetch Join (Service는 Entity 반환 유지)
@Query("SELECT t FROM Task t JOIN FETCH t.student WHERE t.id = :id")
Optional<Task> findByIdWithStudent(@Param("id") Long id);

// 방법 B: Service에서 DTO 변환
@Transactional
public TaskResponse getTask(Long id) {
    Task task = taskRepository.findById(id).orElseThrow();
    return TaskResponse.from(task);  // 트랜잭션 내 변환
}
```

### Q2. "Service에서 여러 DTO를 반환해야 하면?"

**상황:** 같은 데이터를 조회하는데, 화면마다 다른 DTO 필요

```java
// ✅ 좋은 예: Service는 Entity 반환, Controller에서 변환
// Service
public Task getTask(Long id) {
    return taskRepository.findByIdWithDetails(id)  // Fetch Join
        .orElseThrow();
}

// Controller A
@GetMapping("/summary/{id}")
public TaskSummaryResponse getSummary(@PathVariable Long id) {
    Task task = taskService.getTask(id);
    return TaskSummaryResponse.from(task);
}

// Controller B
@GetMapping("/detail/{id}")
public TaskDetailResponse getDetail(@PathVariable Long id) {
    Task task = taskService.getTask(id);
    return TaskDetailResponse.from(task);
}
```

---

## 마무리: 왜 이게 중요한가?

### 올바른 판단 기준

| 판단 기준 | Controller 변환 | Service 변환 |
|---------|----------------|--------------|
| 재사용성 | ✅ Service가 DTO 독립적 | ❌ Service가 특정 DTO에 종속 |
| 코드 중복 | ✅ 없음 | ❌ 래핑 메서드 증가 |
| 책임 분리 | ✅ Controller=변환, Service=로직 | ❌ Service가 변환+로직 |
| 유지보수성 | ✅ 새 API 추가 시 Controller만 수정 | ❌ Service도 같이 수정 |

---

## 참고 자료

### 공식 문서 및 표준 자료
- [Martin Fowler - Data Transfer Object](https://martinfowler.com/eaaCatalog/dataTransferObject.html)
- [Martin Fowler - LocalDTO](https://martinfowler.com/bliki/LocalDTO.html)
- [Baeldung - Entity To DTO Conversion for Spring REST API](https://www.baeldung.com/entity-to-and-from-dto-for-a-java-spring-application)
- [Baeldung - The DTO Pattern](https://www.baeldung.com/java-dto-pattern)

### 커뮤니티 토론 (Stack Overflow)
- [Which layer should convert entities to DTOs?](https://stackoverflow.com/questions/47822938/which-layer-should-be-used-for-conversion-to-dto-from-domain-object)
- [Which layer should place mapper code?](https://stackoverflow.com/questions/47457009/which-is-best-layer-to-place-mapper-code-service-layer-or-controller-layer)
- [In a typical MVC application, which layer is responsible for Model→DTO conversion?](https://stackoverflow.com/questions/20481384/in-a-typical-mvc-application-which-layer-is-responsible-for-a-model-dto-conver)
- [Should services always return DTOs?](https://stackoverflow.com/questions/21554977/should-services-always-return-dtos-or-can-they-also-return-domain-models)

---

**결론:** DTO 변환은 Controller에서 하는 것이 업계 표준이며, Service는 도메인 객체만 다뤄야 재사용성과 유지보수성이 높아진다.
