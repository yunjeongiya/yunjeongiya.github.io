---
layout: post
title: "Surviving Without Foreign Keys: The Soft Reference Pattern with Strings"
date: 2026-01-10 14:00:00 +0900
categories: [Database, Architecture]
tags: [database, foreign-key, soft-reference, jpa, design-pattern]
lang: en
slug: "022-en"
thumbnail: /assets/images/posts/022-soft-reference/thumbnail-en.png
---

![Soft Reference Pattern](/assets/images/posts/022-soft-reference/thumbnail-en.png){: width="600"}


## TL;DR

- This post is **not** an argument against foreign keys.
- The real questions are:
  1. Is `Role` a pure constant or operational data?
  2. What do we reference — **name or immutable code**?
  3. Who is responsible for data integrity — **the database or the application**?
- In CheckUS, the most balanced solution was:
  **keep `Role` in the database, but reference it only by immutable codes using soft references.**

---

## The Question That Started It All

> Does `CampusRole` really need a `parentRole`?  
> And if it does, should that relationship be enforced with a foreign key?

This was the question that kept coming up while designing the authorization system for **CheckUS**.

The system defines global base roles:

- `TEACHER`
- `STUDENT`
- `ADMIN`

Each campus can then define **custom roles**:

- “Senior Teacher”
- “Assistant Teacher”
- “Trial Student”

A custom role is always derived from a base role and can only select **a subset of that base role’s permissions**.

“Senior Teacher” is still a kind of `TEACHER`.

---

## What Does `CampusRole` Represent?

```java
@Entity
public class CampusRole {
    @Id
    private Long id;

    private String name; // "Senior Teacher"

    @Column(name = "parent_role", nullable = false)
    private String parentRole; // "TEACHER"
}
````

The interesting part is that `parentRole` is **not a foreign key**.
It’s just a `String`.

At first glance, this looks dangerous.

> “Aren’t we giving up database-level integrity?”

Yes — intentionally.

---

## Misconception: `parentRole` Is for Permission Checks

It’s not.

At read time (authorization), we only care about `CampusRolePermission`.

```java
List<Permission> permissions =
    campusRolePermissionRepository.findByCampusRoleId(campusRoleId);
```

No joins.
No need to load `Role`.

This is not about `LAZY` vs `EAGER` fetching or query optimization.

---

## Where `parentRole` Actually Matters

`parentRole` is critical during **writes**, not reads.

```java
// UserCampusRoleService.assignCampusRole()
Role parentRole = roleRepository.findByName(campusRole.getParentRole())
    .orElseThrow(() -> new BusinessException("Parent role not found"));
```

When assigning a custom role (“Senior Teacher”) to a user, the system must ensure:

1. Which base role this custom role belongs to
2. Whether the user already has that base role (`TEACHER`)
3. If not, assign the base role first, then attach the custom role

So `parentRole` is not about permissions.
It defines the **lineage of the role**.

---

## Then Shouldn’t This Be a Foreign Key?

That’s a fair question.

```java
@ManyToOne
@JoinColumn(name = "parent_role_id")
private Role parentRole;
```

### Advantages of Foreign Keys

* Database-enforced referential integrity
* Safe deletes and updates
* Renaming a role does not break references (PK-based)

### But Also Trade-offs

* Strong coupling between `CampusRole` and `Role`
* Two conceptually different domains become tightly bound at the DB level
* Less flexibility as the system evolves

So we chose a **soft reference**.

---

## The Real Problem with Soft References

Here’s the key insight:

> **Soft references are not the problem.
> Referencing mutable values is.**

```java
// ❌ Dangerous
private String parentRole; // "TEACHER"
```

`name` is mutable.
People change it.
Product requirements change it.
Rebranding changes it.

And when it changes, everything breaks.

---

## The Critical Failure Scenario: Renaming a Role

```sql
UPDATE role SET name = 'INSTRUCTOR' WHERE name = 'TEACHER';
```

The database is perfectly happy.

The application is not.

```java
roleRepository.findByName("TEACHER")
    .orElseThrow(...)
```

This is the **true risk** of name-based soft references.

---

## Do We Abandon Soft References?

No.

We change **what we reference**.

### Core Rule

> Soft references must always point to **immutable identifiers**.

```java
// ✅ Safe
private String parentRoleCode; // "ROLE_TEACHER"
```

* `code` is internal and immutable
* Renaming is forbidden
* Changes happen via **add + migrate**, never rename

Display names live separately.

```java
Role {
    String code;        // ROLE_TEACHER (immutable)
    String displayName; // Teacher / 강사 (mutable)
    boolean active;
}
```

---

## Then Why Not Remove the Role Table Entirely?

A very reasonable question.

### When Code/Enum Is Enough

You can remove the `Role` table entirely if **all** of these are true:

* The set of roles will never grow
* Role policies and permissions never change
* No enable/disable requirements
* No localization or metadata
* Deploying for every change is acceptable

In that case, roles are just constants.

---

## Reality: Roles Tend to Become Operational Data

Over time, systems usually need:

* Temporary role deactivation (`active = false`)
* Localized display names
* Permission presets
* UI grouping and ordering
* Audit logs
* Multi-tenant customization

At that point, roles are no longer constants.
They are **operational data**.

That’s why keeping `Role` in the database makes sense.

---

## The Two Viable Options

### Option A: Code-Only Roles (Enum-Based)

* No `Role` table
* All references are enum codes
* Very simple
* Low operational flexibility

### Option B: Role Table + Immutable Codes (CheckUS Choice)

* `Role` remains operational data
* `code` is immutable and unique
* `displayName` is mutable
* All references use `code`, not `name`

This removes rename-related risks while keeping flexibility.

---

## “Isn’t This Basically the Same as a Foreign Key?”

It may look similar, but it’s not.

| Aspect                | Foreign Key     | Soft Reference (Code)   |
| --------------------- | --------------- | ----------------------- |
| Integrity enforced by | Database        | Application + process   |
| Rename safety         | High            | High (via immutability) |
| DB-level features     | Cascades, joins | None                    |
| Domain coupling       | Strong          | Loose                   |

The difference is not *what* you reference,
but **who is responsible**.

---

## How to Represent This in ERD

* **Physical ERD**: No relationship line (no foreign key)
* **Logical ERD**: Dashed line (logical reference)

![ERD Notation - Soft Reference](/assets/images/posts/022-soft-reference/erd-diagram.svg){: width="600"}

In the diagram above:
- **Dashed arrow**: Soft reference (no FK constraint)
- **parentRoleCode → code**: Referenced by String value
- Physically independent but logically connected

---

## Final Decision (CheckUS)

* Keep `Role` in the database
* Treat it as operational data
* **Reference only immutable `code` values**
* Avoid `name` in any reference
* Keep existing FK usage where already present (e.g., `UserCampusRole`)

---

## Conclusion

The real design question was never:

> “Foreign key or not?”

It was:

> **What should be immutable, and who should enforce integrity?**

In CheckUS,
**soft references backed by immutable codes** provided the best balance between:

* safety
* flexibility
* and long-term maintainability

Soft references are not a replacement for foreign keys.
They are a **shift in responsibility**.

If you are ready to own that responsibility,
soft references can absolutely survive in production.

---

## References

- [Martin Fowler - Soft Reference Pattern](https://martinfowler.com/bliki/SoftReference.html)
- [JPA Best Practices - Lazy Loading](https://vladmihalcea.com/jpa-hibernate-lazy-loading/)
- [Database Design - When to Use Foreign Keys](https://stackoverflow.com/questions/83147/when-not-to-use-foreign-keys)