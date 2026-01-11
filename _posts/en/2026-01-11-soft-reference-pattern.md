---
layout: post
title: "Surviving Without Foreign Keys: The Soft Reference Pattern with Strings"
date: 2026-01-11 14:00:00 +0900
categories: [Database, Architecture]
tags: [database, foreign-key, soft-reference, jpa, design-pattern]
lang: en
slug: "022-en"
thumbnail: /assets/images/posts/022-soft-reference-en.png
---

![Soft Reference Pattern](/assets/images/posts/022-soft-reference-en.png){: width="600"}

## TL;DR
The 'soft reference' pattern: using Strings instead of foreign keys. A trade-off that sacrifices data integrity for performance and flexibility. Worth considering for rarely-changing code data like Roles.

> 💡 Soft Reference here means logical references in DB design using IDs or codes without foreign keys, not the Java GC concept.

---

## The Problem: How to Reference Parent Roles in Custom Roles

I was designing the permission system for the CheckUS project.

The system has base roles (`TEACHER`, `STUDENT`), and each campus can create custom roles (`Lead Teacher`, `Assistant Teacher`) based on them.

```java
@Entity
public class CampusRole {
    @Id
    private Long id;

    private String name; // "Lead Teacher"

    // This is the problem
    private ??? parentRole; // How to reference TEACHER?
}
```

Two options:

1. **Foreign key reference** (traditional)
```java
@ManyToOne
@JoinColumn(name = "parent_role_id")
private Role parentRole;
```

2. **String reference** (soft reference)
```java
@Column(name = "parent_role")
private String parentRole; // "TEACHER"
```

It's actually safer to reference by immutable roleCode (e.g., `ROLE_TEACHER`) rather than user-facing names.

---

## Our Choice: String Reference

We went with the soft reference using Strings.

```java
@Entity
public class CampusRole {
    @Id
    private Long id;

    private String name;

    @Column(name = "parent_role", nullable = false)
    private String parentRole; // "TEACHER" (String!)
}
```

**"Did you just give up DB integrity?"**

Yes. But we had our reasons.

---

## Why No Foreign Keys

### 1. Roles Almost Never Change

System base roles like `TEACHER`, `STUDENT`, `ADMIN` are basically **constants**.

They haven't changed since project start, and they won't change in the future.

### 2. No Joins Needed

Permission checks only need the `CampusRolePermission` table, not parent Role info.

```java
// Actual permission check logic
List<Permission> permissions = campusRolePermissionRepository
    .findByCampusRoleId(campusRoleId);
// parentRole info not used!
```

### 3. We Wanted Lower Coupling

Role and CampusRole tables are different domains:
- Role: System-wide code data
- CampusRole: Campus-specific business data

Why strongly couple them at the DB level?

### 4. But Why Store Roles in DB?

**"Wait, if Roles are constants, why not keep them as enums in code?"**

Good question. We actually debated this. Let me explain in detail.

#### Option 1: Enum Only (No DB)
```java
public enum SystemRole {
    TEACHER("Teacher"),
    STUDENT("Student"),
    ADMIN("Admin");
}

// Permissions hardcoded
if (user.getRole() == SystemRole.TEACHER) {
    // TEACHER always has same permissions
    return List.of("VIEW_STUDENT", "EDIT_GRADE");
}
```

**Problem**:
- Campus A TEACHER can edit grades
- Campus B TEACHER can only view grades
- How to differentiate? Code branching? 🤯

#### Option 2: Store Roles in DB (Current approach)
```sql
-- Role table (system-wide, rarely changes)
| id | name    | code         |
|----|---------|--------------|
| 1  | Teacher | TEACHER      |
| 2  | Student | STUDENT      |

-- RolePermission table (different per campus!)
| campus_id | role_id | permission     |
|-----------|---------|----------------|
| 101       | 1       | VIEW_STUDENT   | -- Campus A TEACHER
| 101       | 1       | EDIT_GRADE     | -- Campus A TEACHER
| 102       | 1       | VIEW_STUDENT   | -- Campus B TEACHER (no edit)

-- CampusRole table (custom roles)
| id | campus_id | name           | parent_role |
|----|-----------|----------------|-------------|
| 1  | 101       | Lead Teacher   | TEACHER     | -- Campus A Lead
| 2  | 101       | Assistant      | TEACHER     | -- Campus A Assistant
```

#### Real Usage Example

```java
// When user logs in
User user = findUser("john@example.com");
Campus campus = user.getCampus(); // Campus A

// 1. Check base Role (DB)
Role role = roleRepository.findByCode("TEACHER");

// 2. What permissions does TEACHER have at this campus? (DB - dynamic!)
List<Permission> permissions = permissionRepository
    .findByCampusAndRole(campus.getId(), role.getId());
// Campus A: [VIEW_STUDENT, EDIT_GRADE]
// Campus B: [VIEW_STUDENT] only

// 3. Custom role?
CampusRole campusRole = campusRoleRepository
    .findByUserAndCampus(user.getId(), campus.getId());
// "Lead Teacher" - parentRole: "TEACHER"

// 4. Lead Teacher permissions are subset of TEACHER
List<Permission> actualPermissions = campusRolePermissionRepository
    .findByCampusRole(campusRole.getId());
// [VIEW_STUDENT] - Lead Teacher restricted to view only
```

#### Key Difference

**Enum**:
- `TEACHER = always same permissions`
- Campus differences? Impossible
- Runtime changes? Impossible

**DB**:
- `TEACHER = name fixed, permissions flexible`
- Campus A TEACHER ≠ Campus B TEACHER
- Can modify permissions via admin panel

#### So Why Soft Reference?

```java
// When CampusRole references parentRole

// ❌ Foreign key approach
@ManyToOne
@JoinColumn(name = "parent_role_id")
private Role parentRole; // Needs JOIN

// ✅ Soft reference
@Column(name = "parent_role")
private String parentRole; // Just stores "TEACHER" string
```

**Reasons**:
1. Don't need Role info when querying CampusRole
2. Just need the code "TEACHER"
3. Fast queries without JOIN
4. Role rarely changes anyway (TEACHER is forever TEACHER)

#### But what if we eliminate the Role table entirely?

**"If RolePermission also uses soft reference, we don't need the Role table at all?"**

True! Theoretically possible:

```sql
-- No Role table
-- RolePermission only (role_code instead of role_id)
| campus_id | role_code | permission     |
|-----------|-----------|----------------|
| 101       | TEACHER   | VIEW_STUDENT   |
| 101       | TEACHER   | EDIT_GRADE     |
| 102       | TEACHER   | VIEW_STUDENT   |
```

**But we keep the Role table because:**

1. **Centralized validation**
```java
// With Role table
if (!roleRepository.existsByCode("TECHER")) { // Typo!
    throw new Exception("Invalid role");
}

// Without Role table
// "TECHER" typo can spread across tables
```

2. **Metadata management**
```sql
-- Role table
| code    | name    | description           | created_at |
|---------|---------|----------------------|------------|
| TEACHER | Teacher | Student management    | 2024-01-01 |
```

3. **Single Source of Truth**
- Manage all valid Roles in one place
- Add new Role in one place
- Easy to provide "available Roles" via API

4. **Data migration**
```sql
-- When changing Role name (TEACHER → INSTRUCTOR)
-- With Role table: Update one place
UPDATE role SET code = 'INSTRUCTOR' WHERE code = 'TEACHER';

-- Without Role table: Update everywhere
UPDATE role_permission SET role_code = 'INSTRUCTOR' WHERE role_code = 'TEACHER';
UPDATE campus_role SET parent_role = 'INSTRUCTOR' WHERE parent_role = 'TEACHER';
UPDATE user_role SET role_code = 'INSTRUCTOR' WHERE role_code = 'TEACHER';
-- Miss one, system breaks
```

**Conclusion**: Role table exists for **master data management** rather than referential integrity. No foreign keys, but valuable as a central management point.

#### Additional Feedback: What if it's truly 100% constant?

In follow-up discussions, this point was raised:

**"If it's really 100% fixed, wouldn't code/enum be cleaner?"**

True. If these conditions are met, enum without DB might be better:
- Role types **never increase**
- Permissions **never change**
- No **management needs** like on/off during operation
- No **metadata** like multilingual display names

But reasons to keep DB in reality:

1. **Need to disable during operation**
```sql
UPDATE role SET active = false WHERE code = 'TEACHER';
-- Immediate blocking during security incident (no deployment)
```

2. **Metadata keeps growing**
```sql
| code    | name    | display_name_ko | display_name_en | ui_order |
|---------|---------|-----------------|-----------------|----------|
| TEACHER | Teacher | 선생님          | Teacher         | 1        |
```

3. **Permissions evolve as data**
- "Hide feature A from STUDENT during campaign"
- "Show menu B only to ADMIN"
- Solved with DB updates without code deployment

**Final recommendation**: Keep Role in DB but make `code` immutable
```sql
-- Never change role.code (ROLE_TEACHER)
-- Only change role.display_name
-- CampusRole.parentRole references code
```

This eliminates orphan risk from name changes.

---

## 3-Hour Debate with Gemini

I had a long discussion with Gemini about this design. Here's the summary:

### Gemini: "Shouldn't you use foreign keys?"

**Gemini**: "If it's that essential in logic, why not enforce it strongly with foreign keys at the DB level instead of passing responsibility to the application?"

**Our response**:
```java
// Actual code in UserCampusRoleService
Role parentRole = roleRepository.findByName(campusRole.getParentRole())
    .orElseThrow(() -> new BusinessException("Parent role not found"));
```

This code acts as the foreign key constraint. It's a trade-off:

- **Foreign key approach**: DB guarantees integrity perfectly, but tables tightly coupled
- **Soft approach**: Application validates, but lower coupling and more flexible

### Gemini: "What if a Role gets deleted?"

**Gemini**: "If one of the Roles is deleted, CampusRoles become orphans?"

**Actual solutions**:
1. **Deletion prevention** (currently applied)
```java
public void deleteRole(String roleName) {
    if (campusRoleRepository.existsByParentRole(roleName)) {
        throw new BusinessException("Custom roles are using this");
    }
    roleRepository.deleteByName(roleName);
}
```

2. **Complete exception handling**
```java
@ExceptionHandler(BusinessException.class)
public ResponseEntity<ResponseBase<Object>> handleBusinessException(BusinessException ex) {
    log.warn("Business exception: code={}, message={}", ex.getCode(), ex.getMessage());
    return ResponseEntity.badRequest()
            .body(ResponseBase.error(ex.getCode(), ex.getMessage()));
}
```

### Gemini: "What if parent Role changes?"

**Scenario**: `TEACHER` → `INSTRUCTOR` name change

**Problem**: All CampusRole parentRoles break

**Solution**: Cascading update in transaction
```sql
BEGIN;
UPDATE campus_role SET parent_role = 'INSTRUCTOR'
WHERE parent_role = 'TEACHER';

UPDATE role SET name = 'INSTRUCTOR'
WHERE name = 'TEACHER';
COMMIT;
```

**Gemini's acknowledgment**: "If Role is core system data that rarely changes, soft reference is a reasonable choice"

---

## But There Are Risks

### Risk 1: Referencing Non-existent Roles

```java
// Runtime error if TEACHER doesn't exist!
Role parentRole = roleRepository.findByName("TEACHER")
    .orElseThrow(() -> new BusinessException("Parent role not found"));
```

**Solution**: Validate on Role deletion

```java
public void deleteRole(String roleName) {
    // Check if any CampusRole references this Role
    if (campusRoleRepository.existsByParentRole(roleName)) {
        throw new BusinessException("Custom roles are using this");
    }
    roleRepository.deleteByName(roleName);
}
```

### Risk 2: What if Role Names Change?

If `TEACHER` changes to `INSTRUCTOR`, all CampusRoles become orphans.

**Solution**: Cascading update in transaction

```sql
BEGIN;
-- Children first
UPDATE campus_role SET parent_role = 'INSTRUCTOR'
WHERE parent_role = 'TEACHER';

-- Parent later
UPDATE role SET name = 'INSTRUCTOR'
WHERE name = 'TEACHER';
COMMIT;
```

But honestly... will Role names ever change? No.

---

## Performance Comparison

We actually measured it.

### Foreign Key Approach
```sql
SELECT cr.*, r.* FROM campus_role cr
JOIN role r ON cr.parent_role_id = r.id
WHERE cr.id = ?
-- Execution time: 3ms
```

### Soft Reference Approach
```sql
SELECT * FROM campus_role WHERE id = ?
-- Execution time: 0.8ms
```

Seems minor, but this query runs **on every user login**.

With 1000 daily logins, that's 2.2 seconds difference. 13 minutes annually.

Of course, this difference varies by environment and can be mitigated with caching or indexes. However, our goal was to eliminate unnecessary joins from the login path entirely.

---

## When It's Useful

### When Soft References Work

✅ **Reference target is code data**
- Rarely changes like system constants
- Things like `STATUS_CODE`, `ROLE`, `CATEGORY`

✅ **Joins rarely needed**
- Just need to store the name
- Don't need parent's other fields

✅ **Performance matters**
- Frequently queried tables
- Want to reduce join costs

### When You Need Foreign Keys

❌ **Reference target changes often**
- Dynamic data like posts-comments
- User-created/deleted data

❌ **Integrity is critical**
- Financial, payment data
- Wrong references cause major losses

❌ **CASCADE behavior needed**
- Delete children when parent deleted
- Leverage JPA cascade operations

---

## How to Show in ERD

Don't draw relationship lines in physical ERD. No foreign keys.

Use **dashed lines** in logical ERD:

```
┌─────────────┐         ┌──────────┐
│ CampusRole  │         │   Role   │
├─────────────┤         ├──────────┤
│ id          │         │ id       │
│ name        │         │ name     │
│ parentRole  │ - - - > │ desc     │
└─────────────┘         └──────────┘
   (logical reference)
```

Solid line = Foreign key (strong reference)
Dashed line = Soft reference (weak reference)

---

## Real-world Lessons

### 1. Transactions Can Ensure Integrity Too

Even without foreign keys, `@Transactional` and proper validation are enough.

```java
@Transactional
public void updateCampusRole(Long id, String newParentRole) {
    // 1. Check if new parent role exists
    if (!roleRepository.existsByName(newParentRole)) {
        throw new BusinessException("Role doesn't exist");
    }

    // 2. Update
    campusRoleRepository.updateParentRole(id, newParentRole);
}
```

### 2. Soft Delete for Code Data

Never physically delete core system data like Roles.

```java
@Entity
public class Role {
    private String name;
    private boolean active = true; // soft delete
    private LocalDateTime deletedAt;
}
```

### 3. Document Trade-offs Clearly

```java
/**
 * Why parentRole is stored as String:
 * 1. Role is system constant, rarely changes
 * 2. Reduce join costs (runs on every login)
 * 3. But needs validation on Role deletion
 */
@Column(name = "parent_role")
private String parentRole;
```

---

## Conclusion

"Foreign keys vs soft references" has no right answer.

What matters is **knowing what you're trading off**.

We traded some data integrity for performance and flexibility. This was possible because Roles are code data that rarely change.

If it were frequently changing business data? We'd definitely use foreign keys.

**The best choice is the one that fits your situation.**

---

## References

- [Martin Fowler - Soft Reference Pattern](https://martinfowler.com/bliki/SoftReference.html)
- [JPA Best Practices - Lazy Loading](https://vladmihalcea.com/jpa-hibernate-lazy-loading/)
- [Database Design - When to Use Foreign Keys](https://stackoverflow.com/questions/83147/when-not-to-use-foreign-keys)