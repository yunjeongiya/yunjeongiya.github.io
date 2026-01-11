---
layout: post
title: "Surviving Without Foreign Keys: The Soft Reference Pattern with Strings"
date: 2026-01-11 14:00:00 +0900
categories: [Database, Architecture]
tags: [database, foreign-key, soft-reference, jpa, design-pattern]
lang: en
slug: "022-en"
thumbnail: /assets/images/posts/022-soft-reference.png
---

![Soft Reference Pattern](/assets/images/posts/022-soft-reference.png){: width="600"}

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

Good question. We actually debated this.

```java
// Could have done this
public enum SystemRole {
    TEACHER("Teacher", Set.of(PERMISSION_A, PERMISSION_B)),
    STUDENT("Student", Set.of(PERMISSION_C)),
    ADMIN("Admin", Set.of(PERMISSION_ALL));
}
```

But there are reasons for DB storage:

1. **Dynamic permission management**: Change Role-Permission mappings without code deployment
2. **Campus customization**: Different permissions for same TEACHER role per campus
3. **Audit trail**: Track who got which Role when at DB level
4. **External system integration**: Easier to provide Role info via API or sync

So while Roles themselves are constants, the **permissions and metadata linked to Roles are dynamic**, requiring DB storage.

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