---
layout: post
title: "Latent slow query incident: why \"why today?\" may have no clean answer"
date: 2026-05-12 11:00:00 +0900
categories: [Postmortem, Debugging]
tags: [incident, postmortem, debugging, methodology]
lang: en
slug: "079-en"
thumbnail: /assets/images/posts/079-latent-slow-query/thumbnail-en.jpg
image: /assets/images/posts/079-latent-slow-query/thumbnail-en.jpg
published: true
---

> 5/4 DB incident series
>
> 1. [When a cardinality=1 single-column index beats the compound index](/posts/077-en/)
> 2. [DB pool exhaustion cascade: do not mistake victim traces for causes](/posts/078-en/)
> 3. **Latent slow query incident: why "why today?" may have no clean answer**
> 4. [124 index anti-patterns found, 19 dropped — why the rest stayed](/posts/080-en/)
> 5. [JPA @Index is not prod DB index — 5 Entity-DB drift patterns](/posts/081-en/)

![slow pressure crosses a noisy line](/assets/images/posts/079-latent-slow-query/thumbnail-en.jpg){: width="700"}

## Introduction

Postmortems often get one unavoidable question: **why did it fail today, not yesterday?**

For trigger-driven incidents, that question is productive. For latent slow-query incidents caused by gradual data growth, it can become a trap. The day-to-day difference may be smaller than normal production noise.

## Background / Problem

The root cause was fixed quickly: a bad execution plan around a low-cardinality single-column index. But during wrap-up, the operational question remained: why today?

Known facts:

- The slow query had existed since the feature launched.
- The table grew roughly 50x during the previous month.
- The incident happened during a weekday evening peak.
- The same time window had worked the day before.

## Hypotheses We Chased

### New code shipped today

We reviewed 21 commits from the day. None touched the service path containing the slow query. Hypothesis rejected.

### New traffic pattern started today

Nginx logs appeared to show zero calls yesterday and 1,500+ today. That looked convincing until we found the real issue: yesterday's logs had already rotated away. The premise was false.

### A new group of users triggered the path

We identified candidate users from partial logs and compared their past activity. They were normal daily users, not a new cohort.

## Conclusion

The remaining picture was accumulation:

- The query had been latent for months.
- Data volume kept growing.
- Peak traffic gradually had less headroom.
- One day, tiny differences crossed the threshold.

![Latent threshold diagram](/assets/images/posts/079-latent-slow-query/latent-threshold-diagram.svg){: width="700"}

## Lessons

### Separate trigger-driven from latent incidents

If a deployment, config change, or external event directly caused the failure, find it. If data growth and code age point to a latent defect, do not burn unlimited time inventing a trigger.

![Hypothesis discard timeline](/assets/images/posts/079-latent-slow-query/hypothesis-discard-timeline.svg){: width="700"}

### Ask what data would prove the hypothesis

Before chasing a story, identify the decisive evidence and verify that the data source is trustworthy. Log retention limits are part of the evidence.

### Root-cause fix beats trigger theater

For latent incidents, "we cannot isolate a special today-trigger" can be the honest answer. The prevention work is fixing the latent defect and adding earlier signals.

## Next

After closing the incident, the right follow-up was to ask whether more latent index traps existed. [The next post](/posts/080-en/) covers why 124 audit findings became only 19 immediate drops.

## References

- Google SRE Book: [Postmortem Culture: Learning from Failure](https://sre.google/sre-book/postmortem-culture/)
- Monitor data growth and latency curves together, not separately
- Alert on approaching thresholds before they become incidents
