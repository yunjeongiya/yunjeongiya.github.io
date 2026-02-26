---
layout: post
title: "I Didn't Know What to Call Myself — Then Job Postings Started Naming It"
date: 2026-02-25 18:00:00 +0900
categories: [Development, AI]
tags: [ai-native, claude-code, agentic-generalist, developer-career, solo-development, vibe-coding, musinsa-rookie]
lang: en
slug: "036-en"
thumbnail: /assets/images/posts/036-agentic-generalist/thumbnail-en.png
---

![I Didn't Know What to Call Myself — Then Job Postings Started Naming It](/assets/images/posts/036-agentic-generalist/thumbnail-en.png){: width="700"}

Around graduation, I had an opportunity to join a startup. It wasn't a typical developer hire. During the interview, I was told: "We're not hiring you purely for your coding ability." When it came time to decide on a title, they deliberated for a while and eventually borrowed "PO" from Toss's Technical Product Owner role.

Starting at a large company or an SI firm would have been the safe bet. Choosing this undefined role at a tiny startup — I agonized over it. I went with it in the end, but there were moments when I wasn't sure I'd made the right call. People around me said "that's going to be the next big thing" and "you're ahead of the curve," but without a name for what I actually did, it wasn't so much anxiety as frustration.

Once I started working, "PO" didn't quite fit either. Toss defines their TPO as someone who "drives product success through technology in a squad of about 5." I do all five roles myself. I set the product direction, design the architecture, build backend, frontend, and mobile, and solder hardware when needed. With nobody else doing the same thing nearby, I had no one to benchmark myself against.

Then recently, two job postings caught my eye.

## Two Job Postings

**One was "Agentic Generalist" at a company called Across.**

> Eliminate repetitive work and systematize it. Build AI tool chains, templates, bots, and pipelines.

It wasn't a familiar title like "Frontend Developer" or "Backend Developer." No specialization boundary. The word "development" didn't even appear. They were looking for **"someone who systematizes problems with AI."**

**The other was Musinsa's "AI Native Engineer" new-grad hiring.**

The coding test required building a university course registration system in 3 hours. Using Claude and Codex wasn't just *allowed* — it was practically *assumed*. What caught my attention was the evaluation criteria.

## What Musinsa Valued More Than Code

The submission structure for Musinsa's coding test:

```
project-root/
├── README.md          # Build & run instructions
├── CLAUDE.md          # AI agent instructions ← required
├── docs/
│   ├── REQUIREMENTS.md  # Requirement analysis & design decisions ← required
│   └── (API docs)       # API spec ← required
├── prompts/            # AI prompt history ← required, penalized if missing
└── src/               # Source code
```

Four items are mandatory. Three of them are **documentation**.

The evaluation criteria explicitly stated:

> AI utilization: We evaluate the thought process in prompts and quality of agent instructions as a priority. **"Weighted more heavily than code quality."**

It's not about writing good code — it's about **how you leveraged AI and documented your decisions.** The fact that `CLAUDE.md` is a required deliverable is proof the era has shifted.

A friend who took the test told me: "Since I've been doing AI-assisted development a lot, I could delegate the coding to AI and focus on documentation."

A sound strategy. But what I thought was slightly different — **couldn't that documentation itself be systematized?**

## What It Means to Systematize Documentation

I'm currently solo-developing a B2B SaaS in the education domain. Backend, frontend, mobile, hardware integration — all of it. To make this sustainable, "hey AI, write this function" isn't enough.

Instead, I **designed the development process itself as a system.**

**CLAUDE.md — A device that makes today's AI follow decisions made 3 months ago**

```markdown
# Time handling: Store UTC, convert to KST on frontend
# Permissions: Only {RESOURCE}_VIEW, {RESOURCE}_MANAGE pairs
# API URL: No /api prefix (already in domain)
# Error codes: RESOURCE_ACTION_REASON format
```

I viscerally understand why Musinsa required `CLAUDE.md` in their coding test. Without it, you repeat the same mistakes and re-explain the same context every time.

**Custom commands — Processes that automate documentation**

Typing `/finish` triggers all of this automatically:

1. Check modified files
2. Verify API docs match the code
3. Check error code doc updates
4. Update requirement tracking status
5. Write work log
6. Commit

What Musinsa required with "API docs in docs/" and "design decisions in REQUIREMENTS.md" — instead of doing this manually each time, **I coded it as a process.** When code changes, the system won't let you skip doc sync.

**Feature tracking — Tracing "why does this code look like this"**

Every task is tracked by Feature ID. Each Feature links to the requirement IDs it implements. When I pause with `/pause`, the current state is recorded. The next day, `/resume` auto-restores it.

What Musinsa's `REQUIREMENTS.md` demanded — "judgments on ambiguous parts, design decisions and rationale" — this too runs as **a system that accumulates throughout the project**, not a one-off document.

## The Name "Agentic Generalist"

Even while doing all this, I didn't know what to call myself.

- "Developer"? — I spend more time on system design than writing code
- "PO"? — I don't just set product direction, I build everything myself
- "Full-stack"? — I design processes beyond tech stacks

When I first saw "Agentic Generalist" in the Across job posting, it felt like recognition. Like someone had finally named what I'd been doing.

- **Agentic**: Judges independently and builds systems to execute
- **Generalist**: Crosses all domains needed to solve the problem, not confined to a specific stack

Whether this name sticks, I don't know. It's likely still early, but at least some companies seemed to be recognizing this role. Musinsa requiring CLAUDE.md in their coding test, Across making "systematization" a core competency, Toss defining TPO as a role bridging tech and business — these postings all point in the same direction.

## After Vibe Coding

Since 2025, "vibe coding" has been trending. Give AI a rough instruction, code comes out, paste it in, and something works. Good enough for prototypes.

But apply it to a real service and you hit walls fast.

- To modify code AI wrote 3 days ago, you don't know **why it was written that way**
- Once features exceed 10, you can't **track what broke where**
- When requirements change, you can't recover **the reasoning behind previous decisions**

Some conclude "vibe coding is a toy" and go back to traditional development.

What I found was the space in between — **using AI not as a coding tool but as development infrastructure.** Externalize decisions via CLAUDE.md, automate processes via custom commands, prevent context loss via feature tracking. Keep vibe coding's speed while maintaining production-grade structure.

That Musinsa's test required `CLAUDE.md`, `REQUIREMENTS.md`, and `prompts/` likely reflects a similar conclusion — at least from my experience, development capability in the AI era shows more clearly in **design and documentation than in code itself.**

## It's Already Happening Overseas

In Korea, only two postings stood out. But when I looked overseas out of curiosity, it was already quite active.

The name isn't unified yet. The same role goes by many names:

| Title | Where |
|-------|-------|
| Vibe Coder / AI Engineer | YC startups (Domu, Cartage) |
| AI Native Engineer | Enterprises (Ferrovial, Accenture, EUROIMMUN) |
| AI-Accelerated Full-Stack Engineer | Wellfound startups |
| Founding Product Engineer (aka Vibe Coder) | YC — literally "aka Vibe Coder" in parentheses |
| Professional Vibe Coder | Lovable — full-time role featured on Lenny's Podcast |

Some notable numbers:

- MIT Technology Review named "Generative Coding" one of the **10 Breakthrough Technologies of 2026**
- 25% of the current YC batch reportedly has near-entirely AI-generated codebases
- Research shows AI roles command a **25% wage premium** over traditional software roles
- **VibeCodeCareers.com** — a dedicated job board for this role — now exists

And some postings explicitly require:

> "At least 50% of the code you write should be generated by AI. Vibe coding experience is required." — Domu Technology (YC S24)

> "Hands-on experience developing with AI agents (e.g., Claude Code)" — Healthpeak Properties

What felt novel in Korea — "submit your CLAUDE.md" — is already a hiring requirement overseas: "Claude Code hands-on experience."

## Will This Role Become Established?

In Korea, it's still just two postings. But overseas, there are already dedicated job boards, Discord communities of 70,000+, and paid training programs. The names vary — "Vibe Coder," "AI Native Engineer," "Agentic Generalist" — but they point the same way: **not "someone who writes good code" but "someone who builds systems with AI."**

Honestly, I'm glad these postings are appearing. Whenever people around me called me "an early mover," I appreciated it, but the only proof was my own word. Now the hiring market is naming this role, and coding tests are requiring CLAUDE.md. It was at least some reassurance that I wasn't heading in a completely wrong direction.

And one more thing — communities of people working this way already exist. People sharing AI development workflows on Threads and open chats, many of them going far deeper than I have. I'd been focused on building and using things alone, but going forward, I want to actively participate in those spaces. Share each other's CLAUDE.md files, compare workflows, and find better approaches together.

I hope someday there'll be a natural name for people who work this way. At least next time someone asks "So what do you do?" I'll have a better answer than "Well, I'm a PO but I also code and sometimes solder..."

---

### Key Takeaways

1. **Musinsa's coding test required CLAUDE.md and REQUIREMENTS.md.** Evaluation criteria are shifting from code to design and documentation.
2. **Vibe coding alone felt insufficient for production.** A structured process that uses AI as infrastructure was needed.
3. **Documentation can be systematized.** Code processes via custom commands so doc sync can't be skipped on code changes.
4. **Overseas, dedicated job boards and 70K+ communities already exist.** Korea is early, but globally this trend has already started.
5. **The name "Agentic Generalist" has appeared.** The name isn't unified yet, but the market is clearly starting to recognize this role.
