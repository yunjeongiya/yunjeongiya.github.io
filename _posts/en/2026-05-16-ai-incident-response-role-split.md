---
layout: post
title: "Solo incident response with AI sessions — split rescue from root-cause analysis"
date: 2026-05-16 21:00:00 +0900
categories: [DevOps, Vibe Coding]
tags: [claude-code, incident-response, sre, ai, vibe-coding, multi-session]
lang: en
slug: "084-en"
thumbnail: /assets/images/posts/084-ai-incident-response-role-split/thumbnail-en.png
image: /assets/images/posts/084-ai-incident-response-role-split/thumbnail-en.png
published: true
---

![A chessboard where one hand moves a shield piece and a magnifying-glass piece separately](/assets/images/posts/084-ai-incident-response-role-split/thumbnail-en.png){: width="700"}

The server is down. You are alone. You need to restore it now, but you also need to understand why it died.

Trying to do both at the same time slows both down. Teams with SRE practices open a war room and split roles: restoration, investigation, and communication. When operating alone, I found a smaller version of that structure: two AI sessions.

---

## Two Modes of Incident Response

The Google SRE incident guidance is roughly: stop the bleeding, restore service, and preserve evidence for root cause analysis.

For a solo operator, that means service restoration and root-cause investigation should be separated.

When one person does both at once:

- The service stays down while investigation continues
- Restoration urgency can destroy clues
- The two tracks interrupt each other

A war room separates those modes across people. AI sessions can create a similar split.

![Two AI sessions split into rescue and investigation roles](/assets/images/posts/084-ai-incident-response-role-split/role-split-diagram-en.svg){: width="700"}

---

## Session Split: /rescue and /incident

With Claude Code, you can run two sessions at the same time. Running two sessions does not meaningfully load the local CPU; the heavy work happens on Anthropic servers and the local machine mostly handles API calls.

### Session 1: /rescue

This session does only one thing: **restore service**.

```text
"The server is down. /rescue"
```

The rescue session:

1. Checks current state: containers, health checks, logs
2. Executes restoration: blue-green swap or container restart
3. Confirms recovery: repeated health checks and normal response
4. Summarizes the result: "Restored by restart. Last error before restart: [...]"

This session does **not** edit code. It does not claim root cause. If the service is up, its job is done.

### Session 2: /incident

This session does only one thing: **find why it died**.

```text
"Session 1 is restoring service. You investigate root cause only. Do not edit code."
```

The investigation session:

1. Checks deploy commits from the last 24 hours first
2. Looks for error-log patterns
3. Checks DB state: slow queries, locks, processlist
4. Checks metrics: CPU, heap, GC pause, connection pool
5. Forms theories, validates them, then implements the fix after recovery

---

## Actual Flow

When the alert fires:

```text
[Alert]
     ↓
Open session 1 → "/rescue restore the server"
     ↓ (at the same time)
Open session 2 → "Session 1 is restoring. You investigate only.
                  Do not touch code. Start with last 24h deploy commits."
     ↓
Session 1: blue-green swap or restart
Session 2: logs, deploy commits, metrics in parallel
     ↓
Session 1 → recovery summary with last error logs
User → pass that summary to session 2
     ↓
Session 2: confirm theory → implement fix
```

![Parallel timeline for rescue and investigation sessions](/assets/images/posts/084-ai-incident-response-role-split/incident-flow-en.svg){: width="700"}

The important instruction is that the two sessions must not edit the same code at the same time. Otherwise they can overwrite each other's work.

---

## Why the Rescue Session Should Not Own RCA

At first, I thought: why not let the rescue session also find the root cause?

In practice, that caused problems. If the rescue session quickly guesses a root cause and edits code:

- Restarting can erase clues such as logs and metrics
- A wrong theory leaves no stable baseline to return to
- A rushed fix can enter prod based on a bad guess

In the actual incident, we made three wrong guesses:

1. "It is a slow DB query" -> EXPLAIN analysis found victims, not the cause
2. "It is infrastructure saturation" -> EC2 CPU hit 98%, but that was also a result
3. "The latest deploy commit" -> this should have been checked first

Separating rescue and investigation lets the investigation session collect evidence without panic.

---

## Are More Sessions Better?

I first thought multiple investigation sessions might help:

Investigation A: "DB query problem"  
Investigation B: "deploy commit problem"  
Investigation C: "infrastructure problem"

In practice, this adds coordination load. During an incident, the user now has to merge competing theories and decide which session is right.

Best setup: **one rescue session + one investigation session.**

If more parallelism is needed, the investigation session can use parallel tool calls inside the same thread.

---

## Turning It into Skills

I turned the workflow into `/rescue` and `/incident` skills.

The **`/rescue` skill** is a restoration checklist:

- Check active containers
- Perform blue-green swap or container restart
- Repeat health checks
- Summarize recovery in a handoff format
- Explicitly state: do not edit code

The **`/incident` skill** is an investigation checklist extracted from real incidents:

- Phase 1, within 5 minutes: last 24h deploy commits + logs + metrics
- Phase 2: root-cause theory with trap-avoidance list
- Phase 3: fix + prevention
- Phase 4: documentation

That removes the "what should I check first?" delay during the next incident.

---

## The Reality of AI SRE

Anthropic's Claude Cookbook has an [SRE incident response agent](https://platform.claude.com/cookbook/managed-agents-sre-incident-responder): PagerDuty webhook -> Lambda -> Claude API -> automated analysis -> Slack report.

That is full automation. Reality is less clean:

- Claude Code reacts when a user opens a chat and gives it work; it does not automatically consume every Slack alert by itself
- An agent that automatically analyzes and raises PRs can also ship a wrong fix if the analysis is wrong

The practical setup today is: alert fires -> human opens chat -> run `/rescue` and `/incident`. It is not fully automated, but it is structured.

The same conclusion appears in [incident.io's AI SRE writeup](https://incident.io/blog/how-it-feels-to-run-an-incident-with-ai-sre): AI is most useful as a companion that reads, correlates, drafts, and lets a human decide the next move.

---

## Summary

| | /rescue session | /incident session |
|--|--|--|
| Goal | Restore service | Find root cause |
| Code changes | No | Yes, after recovery |
| Timeline | Within 10 minutes | After service is back |
| Output | "Service is UP" | Fix PR + prevention |

When an incident happens, open two sessions and make the role boundary explicit. That is the whole trick.

---

## References

- [Google SRE Book: Managing Incidents](https://sre.google/sre-book/managing-incidents/)
- [War Room Protocols: Coordinating Critical Incident Response](https://upstat.io/blog/war-room-protocols)
- [How it feels to run an incident with AI SRE — incident.io](https://incident.io/blog/how-it-feels-to-run-an-incident-with-ai-sre)
- [AI SRE with Claude Code: 5 On-Call Reliability Workflows — Arcade](https://www.arcade.dev/blog/claude-code-ai-sre-oncall-workflows/)
- [Build an SRE incident response agent with Claude Managed Agents](https://platform.claude.com/cookbook/managed-agents-sre-incident-responder)
