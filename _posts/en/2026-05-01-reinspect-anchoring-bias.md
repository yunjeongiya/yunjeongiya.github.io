---
layout: post
title: "If You Typed the Same Sentence 60 Times, That's a Skill — Mining 1.5GB of Chat Logs for AI Code Review Anchoring Bias and /reinspect"
date: 2026-05-01 14:30:00 +0900
categories: [Development, Claude Code]
tags: [claude-code, skill-design, anchoring-bias, code-review, ai-pair-programming]
lang: en
slug: "071-en"
thumbnail: /assets/images/posts/071-reinspect-anchoring-bias/thumbnail-en.png
published: true
---

![Typed 60 Times Became a Skill](/assets/images/posts/071-reinspect-anchoring-bias/thumbnail-en.png){: width="700"}

## Introduction

I use a Claude Code skill called `/inspect` for code reviews. It runs a structured 4-pass review: correctness, convention, security, and completeness. It works well.

Then one day I noticed something odd. Almost every time `/inspect` finished, I typed one more natural-language instruction:

> inspect once more with a fresh eye

I had typed this more than 60 times. Even though I already had a skill. Why?

This post covers two things:
1. How I mined 1.5GB of Claude Code chat logs with grep and Python to find an implicit skill
2. The `/reinspect` skill that came out of it, and the anchoring bias problem in AI code review

## Background — The Signal of an Implicit Skill

`/inspect` was designed for the first pass. It runs a structured 4-pass review. It does its job.

But after it finishes, I keep typing "look at it one more time with fresh eyes." That is strange. If I already have the skill, why not just run the same skill again?

Hypothesis: when I run the same skill in the same context, I get the **same conclusion**. So I had been using natural language, "fresh eye," to push the AI into a different mode of reading.

The question: does that actually change the behavior? Or does it just feel better?

## The Process

### 1. Mining the Chat Logs

Claude Code stores conversations as JSONL under `~/.claude/projects/<project-path>/`. The CheckUS project had 1.5GB of logs across 630 files.

Reading all of that into context would be a token bomb. So I used grep and Python to extract only user messages:

```python
import json
from pathlib import Path

base = Path("~/.claude/projects/C--dev-checkus").expanduser()
results = []

for jf in base.glob("*.jsonl"):
    with open(jf, encoding='utf-8') as f:
        for ln, line in enumerate(f, 1):
            if 'fresh eye' not in line.lower():
                continue
            obj = json.loads(line)
            if obj.get('type') != 'user':
                continue
            content = obj.get('message', {}).get('content', '')
            if isinstance(content, list):
                text = '\n'.join(
                    p.get('text', '') for p in content
                    if isinstance(p, dict) and p.get('type') == 'text'
                )
            else:
                text = str(content)
            # Only short user inputs. Long ones are usually transcript replays.
            if 'fresh eye' not in text.lower() or len(text) > 2000:
                continue
            results.append((jf.stem[:8], ln, text[:200]))

print(f"Total: {len(results)}")
```

Result: **60+ occurrences** across 73 sessions over two months.

### 2. Verifying the Behavior — Was It Actually Different?

Typing the phrase 60 times was one signal. The important question was whether Claude actually behaved differently.

I found sessions where I ran both `/inspect` and a "fresh eye" follow-up, then compared the response patterns.

| Pattern | Frequency | Description |
|---|---|---|
| Fresh re-read | ~40% | Declares "fresh review from scratch" and rereads the full `git diff` |
| Subagent second opinion | ~30% | Dispatches a `code-reviewer` subagent and returns a severity table |
| `/inspect` rerun | ~30% | Just runs the same skill again, with little value |

In about 70% of cases, it really did behave differently. The best results came from the subagent dispatch pattern because it used a separate context.

### 3. Hypothesis: AI Also Gets Anchored

Why is rerunning `/inspect` in the same context weak?

Hypothesis: once the first pass conclusion is in the context, the second pass becomes biased toward **validating that conclusion**. This is similar to anchoring bias in humans: the first piece of information becomes the reference point for later judgment.

Evidence: in about 30% of cases, rerunning `/inspect` produced almost the same conclusion. Very few new findings.

Solution: use an **independent context**. Claude Code subagents do not inherit the parent session's full context. Separate context means no anchor.

![Same-context rerun versus independent second-pass review](/assets/images/posts/071-reinspect-anchoring-bias/diagram-anchoring-en.svg){: width="700"}

### 4. Writing the Skill

The skill lives at `.claude/skills/reinspect/SKILL.md`. The most important part is the description:

```yaml
---
name: reinspect
description: Second-opinion pass for code review. Must trigger when the user says "fresh eye", "look one more time", "inspect once more", or similar. Do not rerun /inspect — the same context will hit the same anchor and return the same conclusion. Always spawn an independent code-reviewer subagent that actively challenges the previous review.
---
```

I also added an explicit anti-pattern section. The failure mode in 30% of cases was exactly "just run the same skill again":

```markdown
### Anti-pattern: rerunning /inspect
- /reinspect was invoked, but /inspect is invoked again (X)
- rereading git diff inline without spawning a subagent (X)
- listing the first review findings and confirming them without challenge (X)
```

The key instruction passed to the subagent is "challenge":

```text
Previous review conclusion:
{findings reported by /inspect}

Your job:
1. Read the full contents of the changed files. Do not rely only on git diff; diff context strengthens the anchor.
2. Challenge the previous review's conclusion.
   - Was any finding interpreted incorrectly? (overturned)
   - Did the first pass miss anything because it was anchored? (newly found)
```

## Result

Before: I typed the natural-language instruction 60 times, and it produced the intended behavior about 70% of the time.

After: `/reinspect` and natural-language triggers both route into one consistent behavior.

The key was explicitly saying "do not rerun /inspect" in the skill description. Sometimes "do this" is weaker than "do not do that," especially when two similar tools exist.

## Lessons Learned

### 1. Repeated Natural Language Is a Signal for an Implicit Skill

If you keep typing the same phrase, that phrase is an unformalized workflow. Even if a skill already exists, the repetition means something is still missing. Find the missing piece, and it becomes a new skill.

This applies to LLM workflows in general. If you keep giving the same natural-language instruction, there is probably a skill hiding there.

### 2. Validate the Hypothesis With Data

Do not answer "is this really different?" by intuition. Answer it with logs. Even a 1.5GB log directory is manageable with grep and a small Python script.

I worried the investigation might cost more than it was worth, but the actual cost was around 10K tokens. The answer was worth much more than that.

### 3. AI Can Have Anchoring Bias Too

If you ask the same context to do the same task twice, it tends to see the same thing twice. If you need a genuinely different perspective, separate the context: subagent, separate session, or different model.

The same is true for human code review. If the same person reviews their own PR twice, they often see the same thing. A different person sees different things.

### 4. Naming Anti-Patterns Helps

If a skill description only says "do this," the model may drift into a nearby tool. Adding "do not do this" makes the trigger sharper. This matters especially when similar tools coexist, like `/inspect` and `/reinspect`.

## References

- [Anchoring effect — Wikipedia](https://en.wikipedia.org/wiki/Anchoring_effect)
- [Claude Code subagent docs](https://docs.claude.com/claude-code)
