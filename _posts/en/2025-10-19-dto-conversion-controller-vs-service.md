---
layout: post
title: "DTO Conversion: Controller or Service? - I Actually Researched It"
date: 2025-10-19 14:00:00 +0900
categories: [Spring Boot, Architecture]
tags: [spring-boot, dto, controller, service, architecture, clean-code, martin-fowler, best-practices]
lang: en
---

## TL;DR

I've always been confused about whether DTO conversion should happen in the Controller or Service layer. So I dug deep: Martin Fowler's official docs, top Stack Overflow answers, and real project examples. The answer? **Controller does the conversion**.

---

## I Was Always Confused Too

This is what I kept struggling with in Spring Boot:

```java
// Should I convert in the Controller?
@PostMapping
public ResponseEntity<Response> create(@RequestBody CreateRequest request) {
    Entity entity = request.toEntity();  // Here?
    Entity saved = service.save(entity);
    return ResponseEntity.ok(Response.from(saved));
}

// Or just pass the DTO straight to Service?
@PostMapping
public ResponseEntity<Response> create(@RequestBody CreateRequest request) {
    Response response = service.create(request);  // Looks cleaner?
    return ResponseEntity.ok(response);
}
```

Every team had different opinions. Every senior dev said something different. No clear standard. So I finally decided to figure this out with Claude's help.

---

## 1. Started With Martin Fowler's Official Docs

> **💡 Note:** Martin Fowler is a world-renowned authority on software architecture. He's an Agile Manifesto signatory, author of "Refactoring" and "Patterns of Enterprise Application Architecture," and the person who defined the DTO pattern in 2002.

### What Was DTO Originally For?

From Martin Fowler's [Patterns of Enterprise Application Architecture](https://martinfowler.com/eaaCatalog/dataTransferObject.html):

> **"An object that carries data between processes to reduce the number of method calls."**

The key: DTOs are for **"Remote Boundaries"** (between processes).

### Fowler's Warning

His [LocalDTO](https://martinfowler.com/bliki/LocalDTO.html) post says:

> **"Using DTOs in a local context is usually a bad idea."**

With one exception:

> **"One case where it is useful is when you have a significant mismatch between the model in your presentation layer and the domain model."**

So use DTOs only when your API response format differs significantly from your Entity.

---

## 2. What Do Stack Overflow Experts Say?

### The 350+ Upvoted Answer

[Which layer should convert entities to DTOs?](https://stackoverflow.com/questions/47822938/which-layer-should-be-used-for-conversion-to-dto-from-domain-object)

**Top-voted answer:**
> **"The controller should know service, service should know repository, but service layer should NOT know controller endpoint DTOs."**

Why:
1. **Service knowing DTOs** → Coupled to specific Controllers
2. **Other Services or batch jobs** → Need Entities, not DTOs
3. **Dependency direction** → Service should only know Repository

The Controller handles DTO ↔ Entity conversion.

---

## 3. How Should You Actually Code This?

### ✅ Recommended Pattern (Controller Conversion)

```java
@RestController
@RequestMapping("/tasks")
@RequiredArgsConstructor
public class TaskController {
    private final TaskService taskService;

    @PostMapping
    public ResponseEntity<TaskResponse> createTask(
            @Valid @RequestBody TaskCreateRequest request) {

        // 1️⃣ DTO → Entity conversion (Controller's job)
        Task task = request.toEntity();

        // 2️⃣ Business logic (Service's job)
        Task savedTask = taskService.createTask(task);

        // 3️⃣ Entity → DTO conversion (Controller's job)
        TaskResponse response = TaskResponse.from(savedTask);

        return ResponseEntity.ok(response);
    }
}

@Service
@Transactional
public class TaskService {
    private final TaskRepository taskRepository;

    // ✅ Only deals with Entities - no HTTP knowledge needed
    public Task createTask(Task task) {
        validateTask(task);
        calculateOrderIndex(task);
        return taskRepository.save(task);
    }
}
```

**Benefits:**
- ✅ Service doesn't know DTOs → Reusable
- ✅ Clear separation of concerns (Controller = conversion, Service = business logic)
- ✅ Batch jobs can call Service directly

### ❌ My Common Mistake (Service Conversion)

```java
@Service
@Transactional
public class TaskService {
    // ❌ Takes DTO, returns DTO
    public TaskResponse createTask(TaskCreateRequest request) {
        Task task = request.toEntity();  // Conversion hidden here
        validateTask(task);
        Task saved = taskRepository.save(task);
        return TaskResponse.from(saved);  // Another conversion
    }
}
```

**Problems:**
- ❌ Service coupled to specific Controller DTOs
- ❌ Other Services need to create DTOs to call this (annoying)
- ❌ Batch jobs forced to do unnecessary DTO conversion

---

## 4. Real Example From My Project

### The Situation

In a student management system:
- Regular tasks: Teachers assign to students
- Student self-tasks: Students can only assign to themselves

Initially I wrote:

```java
// ❌ Created 2 almost identical Service methods
public TaskResponse createTask(TaskCreateRequest request) { ... }
public TaskResponse createTaskAsStudent(StudentTaskRequest request) { ... }
```

Almost identical code, just different DTO types... Something felt wrong.

### The Refactor

Moving conversion to Controller:

```java
// Controller
@PostMapping("/as-student")
public ResponseEntity<TaskResponse> createAsStudent(
        @Valid @RequestBody StudentTaskRequest request,
        @AuthenticationPrincipal CustomUserPrincipal principal) {

    // 1️⃣ DTO conversion only
    TaskCreateRequest fullRequest = request.toTaskCreateRequest(principal.getId());

    // 2️⃣ Reuse existing Service method
    TaskResponse response = taskService.createTask(fullRequest, principal.getId());

    return ResponseEntity.ok(response);
}

// Service keeps just 1 method
public TaskResponse createTask(TaskCreateRequest request, Long userId) {
    // 100 lines of business logic (unchanged)
}
```

**Results:**
- Eliminated duplicate Service methods
- Adding teacher-specific endpoint only needs Controller changes
- Service stays clean

---

## 5. DTO Conversion vs Business Logic - What's the Difference?

### DTO Conversion = Simple Copying (Not Business Logic)

```java
// Just field mapping
public Task toEntity() {
    return Task.builder()
        .title(this.title)
        .dueDate(this.dueDate)
        .build();
}
```

### Business Logic = Domain Rules (Service Territory)

```java
// This is business logic
public Task createTask(Task task) {
    // 1️⃣ Validation
    if (task.getDueDate().isBefore(LocalDate.now())) {
        throw new BusinessException("Due date cannot be in the past");
    }

    // 2️⃣ Check other Entities
    Student student = studentRepository.findById(task.getStudentId())
        .orElseThrow();

    // 3️⃣ Auto-calculation
    int orderIndex = calculateNextOrderIndex(task.getStudentId());
    task.setOrderIndex(orderIndex);

    // 4️⃣ Save
    return taskRepository.save(task);
}
```

---

## 6. Common Real-World Issue: LazyInitializationException

### Ever Seen This Error?

```java
// Controller
@GetMapping("/{id}")
public ResponseEntity<TaskResponse> getTask(@PathVariable Long id) {
    Task task = taskService.getTask(id);  // Get Entity

    // ❌ Error thrown here!
    TaskResponse response = TaskResponse.from(task);
    return ResponseEntity.ok(response);
}

// Service
@Transactional(readOnly = true)
public Task getTask(Long id) {
    return taskRepository.findById(id).orElseThrow();
    // Method ends = Transaction ends = JPA session closed
}
```

**Why does it fail?**
1. Service method ends = Transaction ends
2. JPA session closed = Lazy Loading disabled
3. Controller calls `task.getStudent()` = No session = 💥

### Solution 1: Convert in Service

```java
@Transactional(readOnly = true)
public TaskResponse getTask(Long id) {
    Task task = taskRepository.findById(id).orElseThrow();
    return TaskResponse.from(task);  // Convert within transaction
}
```

**Pros:** No error
**Cons:** Service coupled to DTOs

### Solution 2: Fetch Join (My Preferred Approach)

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
    // Returns Entity but related entities already loaded
}

// Controller
@GetMapping("/{id}")
public ResponseEntity<TaskResponse> getTask(@PathVariable Long id) {
    Task task = taskService.getTask(id);  // Related entities loaded
    TaskResponse response = TaskResponse.from(task);  // ✅ No problem
    return ResponseEntity.ok(response);
}
```

**Pros:**
- Service still returns Entity (reusable)
- Solves N+1 problem too

---

## 7. Summary: What Goes Where

### ✅ Controller Responsibilities
- DTO ↔ Entity conversion
- Extract auth info (`@AuthenticationPrincipal`)
- Build HTTP responses (`ResponseEntity`)
- Basic input validation (`@Valid`)

### ✅ Service Responsibilities
- Business logic (validation, calculations)
- Transaction management (`@Transactional`)
- Combine multiple Repositories
- Only deal with Entities

### ❌ What Services Should NOT Do
- HTTP-related DTOs (Request/Response)
- Simple DTO conversion wrapper methods
- Controller-coupled code

---

## 8. Practical Tips

### Tip 1: Put Conversion Methods in DTOs

```java
public class TaskCreateRequest {
    private String title;
    private LocalDate dueDate;

    // DTO converts itself to Entity
    public Task toEntity() {
        return Task.builder()
            .title(this.title)
            .dueDate(this.dueDate)
            .build();
    }
}

// Controller stays clean
@PostMapping
public ResponseEntity<TaskResponse> createTask(@RequestBody TaskCreateRequest request) {
    Task task = request.toEntity();  // One line
    Task saved = taskService.createTask(task);
    return ResponseEntity.ok(TaskResponse.from(saved));
}
```

### Tip 2: Static Factory Methods

```java
public class TaskResponse {
    // Static method for conversion
    public static TaskResponse from(Task task) {
        return TaskResponse.builder()
            .id(task.getId())
            .title(task.getTitle())
            .studentName(task.getStudent().getName())
            .build();
    }

    // List conversion too
    public static List<TaskResponse> fromList(List<Task> tasks) {
        return tasks.stream()
            .map(TaskResponse::from)
            .toList();
    }
}
```

---

## 9. FAQ

### Q1. "I keep getting LazyInitializationException?"

**Fix:**
```java
// Option A: Fetch Join
@Query("SELECT t FROM Task t JOIN FETCH t.student WHERE t.id = :id")
Optional<Task> findByIdWithStudent(@Param("id") Long id);

// Option B: Convert in Service
@Transactional
public TaskResponse getTask(Long id) {
    Task task = taskRepository.findById(id).orElseThrow();
    return TaskResponse.from(task);  // Convert within transaction
}
```

### Q2. "Different DTOs for different screens?"

```java
// ✅ Service returns Entity, Controller converts each way
// Service
public Task getTask(Long id) {
    return taskRepository.findByIdWithDetails(id).orElseThrow();
}

// Controller A - Summary
@GetMapping("/summary/{id}")
public TaskSummaryResponse getSummary(@PathVariable Long id) {
    Task task = taskService.getTask(id);
    return TaskSummaryResponse.from(task);
}

// Controller B - Details
@GetMapping("/detail/{id}")
public TaskDetailResponse getDetail(@PathVariable Long id) {
    Task task = taskService.getTask(id);
    return TaskDetailResponse.from(task);
}
```

---

## Wrapping Up

### What I Learned

| Criteria | Controller Conversion | Service Conversion |
|---------|----------------------|-------------------|
| Reusability | ✅ Service independent | ❌ Coupled to DTOs |
| Code Duplication | ✅ None | ❌ Wrapper methods pile up |
| Separation of Concerns | ✅ Clear | ❌ Service does conversion + logic |
| Maintainability | ✅ Easy | ❌ Hard |

**Bottom line:** Controller conversion is the standard. Exception: complex aggregation logic only.

---

## References

### Official Docs
- [Martin Fowler - Data Transfer Object](https://martinfowler.com/eaaCatalog/dataTransferObject.html)
- [Martin Fowler - LocalDTO](https://martinfowler.com/bliki/LocalDTO.html)
- [Baeldung - Entity To DTO Conversion](https://www.baeldung.com/entity-to-and-from-dto-for-a-java-spring-application)
- [Baeldung - The DTO Pattern](https://www.baeldung.com/java-dto-pattern)

### Stack Overflow
- [Which layer should convert entities to DTOs?](https://stackoverflow.com/questions/47822938/which-layer-should-be-used-for-conversion-to-dto-from-domain-object) (350+ upvotes)
- [Which layer should place mapper code?](https://stackoverflow.com/questions/47457009/which-is-best-layer-to-place-mapper-code-service-layer-or-controller-layer) (200+ upvotes)

---

Hope this helps anyone who's been as confused as I was.
