---
layout: post
title: "What is Multi-Tenancy? - CheckUS Architecture Series (1/5)"
date: 2025-11-16 10:00:00 +0900
categories: [Architecture, Backend]
tags: [multi-tenancy, database, architecture, saas, checkus]
series: "CheckUS Multi-Tenancy Architecture"
lang: en
---

# What is Multi-Tenancy? - CheckUS Architecture Series (1/5)

> **Series Navigation**
> - **Part 1: Multi-Tenancy Concept** ← Current
> - Part 2: CheckUS 4-Tier Architecture Implementation
> - Part 3: Security and Performance Optimization
> - Part 4: Comparing Implementation Methods
> - Part 5: Legacy Migration Strategy

---

## Introduction

While developing CheckUS, an academy management service, one of the most critical challenges we faced was: **"How do we safely isolate data across multiple academies?"**

Student information from the Gangnam study center should never be exposed to the Bundang math academy, and each campus's schedules and attendance data must be strictly isolated. At the same time, when a student attends multiple academies, they should be able to view all their information through a single account.

This article explains the **multi-tenancy** concept we used to solve these requirements and the architecture pattern CheckUS chose.

---

## What is Multi-Tenancy?

**Multi-tenancy** is an architectural pattern where a single software instance serves multiple customers (tenants) simultaneously.

### Real-Life Analogy

- **Single-tenant**: Each family lives in a separate detached house 🏠
- **Multi-tenant**: Multiple families share an apartment building, but each unit is independent 🏢

In CheckUS, each academy/campus is a "tenant." All campuses share the same system, but their data is completely isolated.

---

## Three Multi-Tenancy Implementation Approaches

There are three main patterns for implementing multi-tenancy.

### 1. Database-per-Tenant (Complete Isolation)

Each tenant uses a separate database.

```
Gangnam Study Center → MySQL DB (Gangnam)
Bundang Math Academy → MySQL DB (Bundang)
Daechi English Academy → MySQL DB (Daechi)
```

**Advantages**
- ✅ **Perfect data isolation**: Physically separated, most secure
- ✅ **Easy customization**: Each tenant can have different schema structures
- ✅ **Performance isolation**: One tenant's traffic doesn't affect others

**Disadvantages**
- ❌ **High operational costs**: Database instance costs scale with tenant count
- ❌ **Complex maintenance**: Schema changes require migration across all DBs
- ❌ **Difficult cross-tenant analysis**: Need to query multiple DBs for overall data analysis

**Suitable For**
- Large enterprise customers (banks, government agencies)
- Data sovereignty requirements
- Each tenant needs completely different features

---

### 2. Schema-per-Tenant (Logical Isolation)

Each tenant uses a separate schema within a single database.

```
MySQL DB
├─ schema_gangnam    (Gangnam Study Center)
├─ schema_bundang    (Bundang Math Academy)
└─ schema_daechi     (Daechi English Academy)
```

**Advantages**
- ✅ **Appropriate isolation level**: Safe separation at schema level
- ✅ **Cheaper than Database-per-Tenant**: Only one DB instance needed
- ✅ **Easy backup/restore**: Can backup per schema

**Disadvantages**
- ❌ **Schema count limits**: Some DBs like PostgreSQL have schema limits
- ❌ **DDL required for new tenants**: Need to create new schemas
- ❌ **Limited performance isolation**: Physical DB is shared, resource competition possible

**Suitable For**
- Medium-scale B2B SaaS (tens to hundreds of tenants)
- Similar data sizes across tenants
- Schema-level isolation meets security requirements

---

### 3. Row-Level Security (Shared DB + Filtering)

All tenants share the same database and tables, but each row stores a tenant identifier for filtering.

```sql
-- students table (shared by all campuses)
CREATE TABLE students (
    id BIGINT PRIMARY KEY,
    campus_id BIGINT NOT NULL,  -- 🔑 Tenant identifier
    name VARCHAR(100),
    grade INT,
    ...
);

-- Auto-filtering during queries
SELECT * FROM students
WHERE campus_id = 1;  -- Only Gangnam Study Center students
```

**Advantages**
- ✅ **Minimal operational costs**: Only one DB and one schema to manage
- ✅ **Easy tenant addition**: Just add new rows, no DDL required
- ✅ **Easy cross-tenant analysis**: Analyze all tenant data with a single query
- ✅ **Simple schema migrations**: One ALTER TABLE applies to all tenants

**Disadvantages**
- ❌ **Risk of missing filters**: Data leak if developer forgets `WHERE campus_id`
- ❌ **Performance**: Index design is critical for large-scale data
- ❌ **Limited customization**: All tenants use the same schema structure

**Suitable For**
- Large-scale B2C SaaS (thousands to tens of thousands of tenants)
- All tenants use identical features
- Startups where rapid scalability is important

---

## Why CheckUS Chose Row-Level Security

CheckUS selected the third approach: **Row-Level Security**. This decision was driven by CheckUS's unique business model.

### CheckUS's Core Differentiator: Cross-Campus Support

Typical academy management systems assume "one student = one academy." CheckUS is different.

**Real Usage Scenario**

```
[Student A]
  ├─ Gangnam Study Center (Mon-Fri self-study)
  └─ Bundang Math Academy (Tue/Thu classes)

[Teacher B]
  ├─ Gangnam Study Center (Math instructor)
  └─ Daechi English Academy (English instructor)
```

Student A uses **one account** to:
- Check Gangnam Study Center self-study schedule
- Submit homework for Bundang Math Academy
- View integrated dashboard with schedules from both academies

Teachers also use **one account** to work at multiple academies and can adjust schedules considering students' other academy commitments.

### Why Database-per-Tenant Doesn't Work

With Database-per-Tenant:

```
Gangnam DB: { student_id: 1, name: "Student A", ... }
Bundang DB: { student_id: 1, name: "Student A", ... }  // Duplicate data!
```

- ❌ **No account integration**: Student A needs two separate accounts
- ❌ **No cross-campus queries**: Gangnam teacher can't see student's Bundang schedule
- ❌ **Data sync issues**: If student changes name, must update both DBs

### Solution with Row-Level Security

```sql
-- All campus students in one students table
students
  id | name      | campus_id
  ---+-----------+----------
  1  | Student A | 1 (Gangnam)
  1  | Student A | 2 (Bundang)

-- One user account (user_id=100) accesses both campus data
user_campus_roles
  user_id | campus_id | role
  --------+-----------+--------
  100     | 1         | STUDENT
  100     | 2         | STUDENT
```

**JWT Token with Multiple Campus Info**
```json
{
  "userId": 100,
  "username": "student_a",
  "roles": [
    { "campusId": 1, "role": "STUDENT" },
    { "campusId": 2, "role": "STUDENT" }
  ]
}
```

**Select Campus via Header in API Requests**
```http
GET /students/me/schedules
X-Campus-Id: 1  # Query Gangnam Study Center schedule

GET /students/me/schedules
X-Campus-Id: 2  # Query Bundang Math Academy schedule
```

This enables:
- ✅ **One account** for multiple campuses
- ✅ **Integrated dashboard** to view all schedules
- ✅ **Cross-campus permissions**: Gangnam teacher can view student's Bundang schedule (if authorized)

---

## The Core Challenge of Row-Level Security

The biggest challenge with Row-Level Security is: **"How do we prevent developers from accidentally omitting filters?"**

```java
// ❌ Developer mistake: Missing campus_id filter
@GetMapping("/students")
public List<Student> getStudents() {
    return studentRepository.findAll();  // 💥 Exposes all campus students!
}

// ✅ Correct implementation: campus_id filtering
@GetMapping("/students")
public List<Student> getStudents() {
    Long campusId = CampusContextHolder.getCampusId();
    return studentRepository.findByCampusId(campusId);
}
```

However, **manually adding filters to every query** leads to:
- ⚠️ High risk of human error
- ⚠️ Code duplication (boilerplate)
- ⚠️ Difficult maintenance

**So how can we automate this?**

---

## Next Episode Preview

In Part 1, we explored the three main multi-tenancy patterns and CheckUS's business reasons for choosing Row-Level Security.

**Part 2: CheckUS 4-Tier Architecture Implementation** will cover:

- ✨ 4-tier architecture that **automatically prevents** filter omissions
- 🔒 **4-step security checks** from frontend to database
- 🎯 **Elegant implementation** using Spring AOP and ThreadLocal
- 📝 **Compile-time error prevention** with ESLint rules

We'll reveal how CheckUS actually implemented this, with concrete code examples.

**👉 Continue to [Part 2: CheckUS 4-Tier Architecture Implementation](./part2-4tier-architecture.md)**

---

## References

### Industry Standard Documentation
- [Microsoft Azure - Multi-tenant SaaS Database Patterns](https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns)
- [Google Cloud - Implement Multi-Tenancy in Spanner](https://cloud.google.com/spanner/docs/multi-tenancy-overview)
- [AWS - SaaS Tenant Isolation Strategies](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html)

### Technical Blogs
- [Bytebase - Multi-Tenant Database Architecture Patterns](https://www.bytebase.com/blog/multi-tenant-database/)
- [Vlad Mihalcea - The Ultimate Guide to Database Multitenancy](https://vladmihalcea.com/database-multitenancy/)

> Note: These resources can be found by searching "Multi-tenant database patterns"

---

**CheckUS Architecture Series**
- Part 1: Multi-Tenancy Concept ← Current
- Part 2: CheckUS 4-Tier Architecture Implementation
- Part 3: Security and Performance Optimization
- Part 4: Comparing Implementation Methods
- Part 5: Legacy Migration Strategy
