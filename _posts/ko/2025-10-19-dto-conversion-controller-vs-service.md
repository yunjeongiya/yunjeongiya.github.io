---
layout: post
title: "DTO 변환은 Controller? Service? 헷갈려서 제대로 조사해봤다"
date: 2025-10-19 14:00:00 +0900
categories: [Spring Boot, Architecture]
tags: [spring-boot, dto, controller, service, architecture, clean-code, martin-fowler, best-practices]
lang: ko
---

## TL;DR

평소 코드 작성할 때마다 헷갈렸던 "DTO 변환을 Controller에서 해야 할까, Service에서 해야 할까?" 문제를 이번 기회에 제대로 조사해봤다. Martin Fowler 공식 문서, Stack Overflow 고수들의 답변, 실제 프로젝트 사례까지 살펴본 결과, **Controller에서 변환하는 것이 정석**이라는 걸 알게 되었다. 이 글은 내가 Claude와 함께 조사한 내용을 정리한 것이다.

---

## 나도 항상 헷갈렸다

Spring Boot로 개발하면서 매번 고민했던 부분:

```java
// 이렇게 Controller에서 변환?
@PostMapping
public ResponseEntity<Response> create(@RequestBody CreateRequest request) {
    Entity entity = request.toEntity();  // 여기서?
    Entity saved = service.save(entity);
    return ResponseEntity.ok(Response.from(saved));
}

// 아니면 이렇게 Service로 넘겨버리는 게 깔끔한 건가?
@PostMapping
public ResponseEntity<Response> create(@RequestBody CreateRequest request) {
    Response response = service.create(request);  // 이게 더 간단해 보이는데?
    return ResponseEntity.ok(response);
}
```

팀마다, 선배마다 말이 다르고, 정확한 기준을 몰라서 그때그때 편한 대로 짰던 것 같다. 그래서 이번에 Claude와 함께 제대로 파헤쳐봤다.

---

## 1. 먼저 Martin Fowler 공식 문서부터 찾아봤다

> **💡 참고:** Martin Fowler는 소프트웨어 아키텍처 분야의 세계적 권위자로, Agile Manifesto 서명자이자 "Refactoring", "Patterns of Enterprise Application Architecture" 등의 저자입니다. DTO 패턴을 2002년에 정의한 창시자이기도 합니다.

###DTO가 원래 뭐였지?

Martin Fowler의 [Patterns of Enterprise Application Architecture](https://martinfowler.com/eaaCatalog/dataTransferObject.html)를 읽어보니:

> **"An object that carries data between processes to reduce the number of method calls."**
> (프로세스 간 데이터 전송을 위해 메서드 호출 횟수를 줄이는 객체)

핵심은 **"프로세스 간 경계(Remote Boundary)"**에서 쓰라는 거였다.

### Fowler의 경고를 놓쳤었다

[LocalDTO](https://martinfowler.com/bliki/LocalDTO.html) 글을 보니 이런 말이 있더라:

> **"Using DTOs in a local context is usually a bad idea."**
> (같은 애플리케이션 내에서 DTO를 사용하는 것은 보통 나쁜 생각이다)

예외가 딱 하나:

> **"One case where it is useful is when you have a significant mismatch between the model in your presentation layer and the domain model."**
> (프레젠테이션 계층과 도메인 모델이 많이 다를 때는 유용하다)

아, 그러니까 API 응답 형식이 Entity와 많이 다를 때만 DTO를 써라는 거구나.

---

## 2. Stack Overflow 고수들은 뭐라고 할까?

### 350명이 추천한 답변

[Which layer should convert entities to DTOs?](https://stackoverflow.com/questions/47822938/which-layer-should-be-used-for-conversion-to-dto-from-domain-object)

**가장 많이 추천받은 답변:**
> **"The controller should know service, service should know repository, but service layer should NOT know controller endpoint DTOs."**

이유:
1. **Service가 DTO를 알면** → 특정 Controller에 종속됨
2. **다른 Service나 배치에서 호출할 때** → Entity를 필요로 함
3. **의존성 방향** → Service는 Repository만 알아야 함

아, Controller가 DTO ↔ Entity 변환을 책임지는 게 맞구나!

---

## 3. 그럼 실제로 어떻게 짜야 하나?

### ✅ 권장 패턴 (Controller 변환)

```java
@RestController
@RequestMapping("/tasks")
@RequiredArgsConstructor
public class TaskController {
    private final TaskService taskService;

    @PostMapping
    public ResponseEntity<TaskResponse> createTask(
            @Valid @RequestBody TaskCreateRequest request) {

        // 1️⃣ DTO → Entity 변환 (Controller가 담당)
        Task task = request.toEntity();

        // 2️⃣ 비즈니스 로직은 Service에 맡김
        Task savedTask = taskService.createTask(task);

        // 3️⃣ Entity → DTO 변환 (Controller가 담당)
        TaskResponse response = TaskResponse.from(savedTask);

        return ResponseEntity.ok(response);
    }
}

@Service
@Transactional
public class TaskService {
    private final TaskRepository taskRepository;

    // ✅ Entity만 다룸 - HTTP 몰라도 됨
    public Task createTask(Task task) {
        validateTask(task);
        calculateOrderIndex(task);
        return taskRepository.save(task);
    }
}
```

**이렇게 하면 좋은 점:**
- ✅ Service는 DTO를 몰라도 됨 → 재사용 가능
- ✅ 책임이 명확함 (Controller = 변환, Service = 비즈니스 로직)
- ✅ 배치 작업에서도 Service를 그대로 호출 가능

### ❌ 내가 자주 했던 실수 (Service 변환)

```java
@Service
@Transactional
public class TaskService {
    // ❌ DTO를 받고 DTO를 반환
    public TaskResponse createTask(TaskCreateRequest request) {
        Task task = request.toEntity();  // 변환이 여기 숨겨짐
        validateTask(task);
        Task saved = taskRepository.save(task);
        return TaskResponse.from(saved);  // 또 변환
    }
}
```

**문제점:**
- ❌ Service가 특정 Controller DTO에 종속됨
- ❌ 다른 Service에서 호출하려면 DTO 만들어야 함 (불편)
- ❌ 배치에서 호출 시 불필요한 DTO 변환 발생

---

## 4. 내 프로젝트에서 겪은 실제 사례

### 상황

학생 관리 시스템에서:
- 일반 할일 생성: 교사가 학생 지정
- 학생 자가 할일: 학생 본인만 지정 가능

처음에는 이렇게 짰다:

```java
// ❌ Service에 메서드 2개 만듦
public TaskResponse createTask(TaskCreateRequest request) { ... }
public TaskResponse createTaskAsStudent(StudentTaskRequest request) { ... }
```

거의 똑같은 코드인데 DTO 타입만 다른 메서드가 2개... 뭔가 이상했다.

### 리팩토링

Controller에서 변환하도록 바꿨더니:

```java
// Controller
@PostMapping("/as-student")
public ResponseEntity<TaskResponse> createAsStudent(
        @Valid @RequestBody StudentTaskRequest request,
        @AuthenticationPrincipal CustomUserPrincipal principal) {

    // 1️⃣ DTO 변환만 여기서
    TaskCreateRequest fullRequest = request.toTaskCreateRequest(principal.getId());

    // 2️⃣ 기존 Service 메서드 재사용
    TaskResponse response = taskService.createTask(fullRequest, principal.getId());

    return ResponseEntity.ok(response);
}

// Service는 메서드 1개만 유지
public TaskResponse createTask(TaskCreateRequest request, Long userId) {
    // 100줄의 비즈니스 로직 (변화 없음)
}
```

**결과:**
- Service 메서드 중복 제거
- 교사용 추가해도 Controller만 수정하면 됨
- Service는 깔끔하게 유지

---

## 5. DTO 변환 vs 비즈니스 로직, 뭐가 다른 거야?

### DTO 변환 = 단순 복사 (비즈니스 로직 X)

```java
// 이건 그냥 필드 옮기기
public Task toEntity() {
    return Task.builder()
        .title(this.title)
        .dueDate(this.dueDate)
        .build();
}
```

### 비즈니스 로직 = 도메인 규칙 (Service O)

```java
// 이건 비즈니스 로직
public Task createTask(Task task) {
    // 1️⃣ 검증
    if (task.getDueDate().isBefore(LocalDate.now())) {
        throw new BusinessException("마감일은 과거일 수 없습니다");
    }

    // 2️⃣ 다른 Entity 확인
    Student student = studentRepository.findById(task.getStudentId())
        .orElseThrow();

    // 3️⃣ 자동 계산
    int orderIndex = calculateNextOrderIndex(task.getStudentId());
    task.setOrderIndex(orderIndex);

    // 4️⃣ 저장
    return taskRepository.save(task);
}
```

---

## 6. 실무에서 자주 만나는 문제: LazyInitializationException

### 이런 에러 본 적 있나?

```java
// Controller
@GetMapping("/{id}")
public ResponseEntity<TaskResponse> getTask(@PathVariable Long id) {
    Task task = taskService.getTask(id);  // Entity 받음

    // ❌ 에러 발생!
    TaskResponse response = TaskResponse.from(task);
    return ResponseEntity.ok(response);
}

// Service
@Transactional(readOnly = true)
public Task getTask(Long id) {
    return taskRepository.findById(id).orElseThrow();
    // 메서드 끝 = 트랜잭션 종료 = JPA 세션 종료
}
```

**왜 에러나나?**
1. Service 메서드 끝 = 트랜잭션 종료
2. JPA 세션 종료 = Lazy Loading 불가
3. Controller에서 `task.getStudent()` 호출 = 세션 없음 = 💥

### 해결 방법 1: Service에서 DTO 변환

```java
@Transactional(readOnly = true)
public TaskResponse getTask(Long id) {
    Task task = taskRepository.findById(id).orElseThrow();
    return TaskResponse.from(task);  // 트랜잭션 내에서 변환
}
```

**장점:** 에러 안 남
**단점:** Service가 DTO에 종속됨

### 해결 방법 2: Fetch Join (내가 선호하는 방법)

```java
// Repository
@Query("SELECT t FROM Task t " +
       "JOIN FETCH t.student " +
       "WHERE t.id = :id")
Optional<Task> findByIdWithDetails(@Param("id") Long id);

// Service
@Transactional(readOnly = true)
public Task getTask(Long id) {
    return taskRepository.findByIdWithDetails(id).orElseThrow();
    // Entity 반환하지만 연관 Entity 미리 로드됨
}

// Controller
@GetMapping("/{id}")
public ResponseEntity<TaskResponse> getTask(@PathVariable Long id) {
    Task task = taskService.getTask(id);  // 연관 Entity 로드됨
    TaskResponse response = TaskResponse.from(task);  // ✅ 문제없음
    return ResponseEntity.ok(response);
}
```

**장점:**
- Service는 여전히 Entity 반환 (재사용 가능)
- N+1 문제도 해결

---

## 7. 정리: 어디에 뭘 넣어야 하나

### ✅ Controller 책임
- DTO ↔ Entity 변환
- 인증 정보 추출 (`@AuthenticationPrincipal`)
- HTTP 응답 구성 (`ResponseEntity`)
- 간단한 입력 검증 (`@Valid`)

### ✅ Service 책임
- 비즈니스 로직 (검증, 계산)
- 트랜잭션 관리 (`@Transactional`)
- 여러 Repository 조합
- Entity만 다룸

### ❌ Service에서 하면 안 되는 것
- HTTP 관련 DTO (Request/Response)
- 단순 DTO 변환 래핑 메서드
- Controller에 종속된 코드

---

## 8. 실무 팁

### 팁 1: DTO에 변환 메서드 넣기

```java
public class TaskCreateRequest {
    private String title;
    private LocalDate dueDate;

    // DTO가 자기 자신을 Entity로 변환
    public Task toEntity() {
        return Task.builder()
            .title(this.title)
            .dueDate(this.dueDate)
            .build();
    }
}

// Controller는 깔끔
@PostMapping
public ResponseEntity<TaskResponse> createTask(@RequestBody TaskCreateRequest request) {
    Task task = request.toEntity();  // 한 줄
    Task saved = taskService.createTask(task);
    return ResponseEntity.ok(TaskResponse.from(saved));
}
```

### 팁 2: 정적 팩토리 메서드

```java
public class TaskResponse {
    // 정적 메서드로 변환
    public static TaskResponse from(Task task) {
        return TaskResponse.builder()
            .id(task.getId())
            .title(task.getTitle())
            .studentName(task.getStudent().getName())
            .build();
    }

    // 리스트도 편하게
    public static List<TaskResponse> fromList(List<Task> tasks) {
        return tasks.stream()
            .map(TaskResponse::from)
            .toList();
    }
}
```

---

## 9. 자주 묻는 질문

### Q1. "LazyInitializationException 자꾸 나는데요?"

**해결:**
```java
// 방법 A: Fetch Join
@Query("SELECT t FROM Task t JOIN FETCH t.student WHERE t.id = :id")
Optional<Task> findByIdWithStudent(@Param("id") Long id);

// 방법 B: Service에서 DTO 변환
@Transactional
public TaskResponse getTask(Long id) {
    Task task = taskRepository.findById(id).orElseThrow();
    return TaskResponse.from(task);  // 트랜잭션 내 변환
}
```

### Q2. "화면마다 다른 DTO가 필요하면?"

```java
// ✅ Service는 Entity 반환, Controller에서 각각 변환
// Service
public Task getTask(Long id) {
    return taskRepository.findByIdWithDetails(id).orElseThrow();
}

// Controller A - 요약
@GetMapping("/summary/{id}")
public TaskSummaryResponse getSummary(@PathVariable Long id) {
    Task task = taskService.getTask(id);
    return TaskSummaryResponse.from(task);
}

// Controller B - 상세
@GetMapping("/detail/{id}")
public TaskDetailResponse getDetail(@PathVariable Long id) {
    Task task = taskService.getTask(id);
    return TaskDetailResponse.from(task);
}
```

---

## 마무리

### 내가 배운 것

| 판단 기준 | Controller 변환 | Service 변환 |
|---------|----------------|--------------|
| 재사용성 | ✅ Service가 독립적 | ❌ DTO에 종속 |
| 코드 중복 | ✅ 없음 | ❌ 래핑 메서드 증가 |
| 책임 분리 | ✅ 명확함 | ❌ Service가 변환+로직 |
| 유지보수 | ✅ 쉬움 | ❌ 어려움 |

**결론:** Controller에서 변환하는 게 정석이다. 예외는 복잡한 집계 로직뿐.

---

## 참고 자료

### 공식 문서
- [Martin Fowler - Data Transfer Object](https://martinfowler.com/eaaCatalog/dataTransferObject.html)
- [Martin Fowler - LocalDTO](https://martinfowler.com/bliki/LocalDTO.html)
- [Baeldung - Entity To DTO Conversion](https://www.baeldung.com/entity-to-and-from-dto-for-a-java-spring-application)
- [Baeldung - The DTO Pattern](https://www.baeldung.com/java-dto-pattern)

### Stack Overflow
- [Which layer should convert entities to DTOs?](https://stackoverflow.com/questions/47822938/which-layer-should-be-used-for-conversion-to-dto-from-domain-object) (350+ 추천)
- [Which layer should place mapper code?](https://stackoverflow.com/questions/47457009/which-is-best-layer-to-place-mapper-code-service-layer-or-controller-layer) (200+ 추천)

---

이 글이 나처럼 헷갈렸던 분들에게 도움이 되길 바란다!
