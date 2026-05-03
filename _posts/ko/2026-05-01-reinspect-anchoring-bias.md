---
layout: post
title: "같은 문장을 60번 타이핑했다면, 그건 스킬이다 — 1.5GB 대화 로그에서 찾아낸 AI 코드 리뷰의 anchoring bias와 /reinspect"
date: 2026-05-01 14:30:00 +0900
categories: [Development, Claude Code]
tags: [claude-code, skill-design, anchoring-bias, code-review, ai-pair-programming]
lang: ko
slug: "071"
thumbnail: /assets/images/posts/071-reinspect-anchoring-bias/thumbnail.png
published: true
---

![AI 코드 리뷰의 anchoring bias와 독립된 2차 검토](/assets/images/posts/071-reinspect-anchoring-bias/thumbnail.png){: width="700"}

## 도입

Claude Code에 `/inspect`라는 코드 리뷰 스킬을 만들어 쓴다. 4-pass 구조화 리뷰 (correctness / convention / security / completeness). 잘 작동한다.

그런데 어느 날 깨달았다 — `/inspect`가 끝난 다음 거의 매번 자연어로 한 번 더 친다.

> inspect once more with a fresh eye

이걸 60번 넘게 타이핑했다. 스킬이 있는데도. 왜?

이 글은 두 가지를 다룬다:
1. 1.5GB짜리 Claude Code 대화 로그를 grep + Python으로 마이닝해 implicit skill을 찾아낸 과정
2. 그 결과로 만든 `/reinspect` 스킬과, AI 코드 리뷰의 anchoring bias

## 배경 — implicit skill의 신호

`/inspect`는 첫 패스용으로 설계됐다. 4-pass 구조화. 잘 돈다.

그런데 끝난 다음 "fresh eye로 한 번 더"를 매번 친다. 이상하지 않은가? 같은 스킬을 다시 돌리면 되는데.

가설: 같은 컨텍스트에서 같은 스킬을 다시 돌리면 **같은 결론**이 나온다. 그래서 자연어로 "fresh eye"라고 명시해서, AI가 다른 방식으로 보게 유도하고 있던 것이다.

질문: 이게 진짜 다른 동작인가? 아니면 내 기분 문제인가?

## 해결 과정

### 1. 대화 로그 마이닝

Claude Code는 대화를 JSONL로 `~/.claude/projects/<project-path>/`에 저장한다. CheckUS 프로젝트는 1.5GB / 630개 파일.

전부 읽으면 token bomb이다. grep + Python으로 user 메시지만 추출했다:

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
            # 짧은 사용자 입력만 — 긴 건 transcript replay
            if 'fresh eye' not in text.lower() or len(text) > 2000:
                continue
            results.append((jf.stem[:8], ln, text[:200]))

print(f"Total: {len(results)}")
```

결과: **60+회**. 73개 세션에 걸쳐 2개월간.

### 2. 동작 검증 — 진짜 다른가?

문구를 60번 친 건 알았다. 진짜 중요한 건 — Claude가 정말 다르게 동작했는가?

같은 세션에서 `/inspect`와 "fresh eye"를 둘 다 친 케이스를 찾아 응답 패턴을 비교했다.

| 패턴 | 빈도 | 설명 |
|---|---|---|
| Fresh re-read | ~40% | "Fresh review from scratch" 선언 후 `git diff` 전체 내용 재읽음 |
| Subagent 2nd opinion | ~30% | `code-reviewer` subagent dispatch → severity 테이블 산출 |
| `/inspect` 재실행 | ~30% | 그냥 같은 스킬 다시 돔 — 의미 없음 |

70%는 정말 다른 동작이었다. 특히 subagent dispatch 패턴 — 별도 컨텍스트로 띄우는 — 이 결과가 가장 좋았다.

### 3. 가설: AI도 anchoring에 걸린다

왜 같은 컨텍스트에서 `/inspect`를 다시 돌리면 안 되는가?

가설: 첫 패스의 결론이 컨텍스트에 남아 있으면, 두 번째 패스는 그 결론을 **검증하는 방향**으로 편향된다. 사람의 anchoring bias와 같다 — 처음 본 정보가 이후 판단의 기준점이 된다.

증거: 30% 케이스에서 `/inspect`를 그냥 다시 돌렸을 때 결론이 거의 동일했다. 새 발견 거의 없음.

해결: **독립된 컨텍스트**가 필요하다. Claude Code의 subagent는 부모 세션의 컨텍스트를 상속받지 않는다. 별도 컨텍스트 = anchor 없음.

![같은 컨텍스트 재실행과 독립 컨텍스트 2차 검토의 차이](/assets/images/posts/071-reinspect-anchoring-bias/diagram-anchoring-ko.svg){: width="700"}

### 4. 스킬 작성

`.claude/skills/reinspect/SKILL.md`. 핵심은 description:

```yaml
---
name: reinspect
description: 코드 리뷰의 두 번째 의견(second-opinion) 패스. 사용자가 "fresh eye", "한 번 더 봐", "inspect once more" 같은 표현을 쓰면 반드시 발동. /inspect를 다시 돌리지 말 것 — 같은 컨텍스트는 같은 anchor에 걸려 같은 결론이 나온다. 반드시 독립된 code-reviewer subagent를 띄워 이전 결론을 적극적으로 challenge한다.
---
```

본문에는 명시적 anti-pattern 섹션을 넣었다. 30%의 실패 모드가 정확히 "스킬을 그냥 재실행"이었기 때문이다:

```markdown
### Anti-pattern: /inspect 재실행
- /reinspect 호출됐는데 /inspect 스킬을 다시 invoke (X)
- subagent 안 띄우고 인라인으로 git diff 다시 읽기 (X)
- 첫 리뷰의 finding 리스트만 나열하고 challenge 없이 confirm (X)
```

Subagent에게 넘기는 프롬프트의 핵심은 "challenge하라"는 명시:

```
이전 리뷰의 결론:
{/inspect가 보고한 finding들}

너의 임무:
1. 변경된 파일의 전체 내용을 읽어라 (git diff가 아니다 — diff context는 anchor를 강화한다)
2. 이전 리뷰의 결론이 옳은지 challenge하라
   - 잘못 본 finding이 있는가? (overturned)
   - 첫 패스가 anchor에 걸려 놓친 게 있는가? (newly found)
```

## 결과

Before: 60번 자연어로 타이핑, 70% 확률로 의도된 동작
After: `/reinspect` 슬래시 커맨드 또는 자연어 트리거 모두 일관된 동작 (목표)

스킬 description에서 "/inspect를 다시 돌리지 말 것"을 명시한 게 핵심이다. AI에게 "이걸 해라"보다 "이걸 **하지 마라**"가 더 강한 신호일 때가 있다 — 비슷한 다른 도구가 있을 때 특히.

## 배운 점

### 1. 자주 타이핑하는 자연어 = implicit skill의 신호

같은 문구를 반복적으로 타이핑한다면, 그건 형식화되지 않은 워크플로다. **이미 스킬이 있어도** 부족하다고 느낀다는 뜻. 그 부족함이 어디인지 알아내면 새 스킬이 된다.

이건 LLM 워크플로 일반에 적용된다. 자연어로 매번 같은 지시를 하고 있다면, 거기 스킬이 있다.

### 2. 가설은 데이터로 검증한다

"이게 정말 다른가?"라는 의문을 머리로 답하지 말고 로그로 답한다. 1.5GB짜리 로그도 grep + Python이면 몇 초.

배보다 배꼽이 클까 걱정했지만 실제 비용은 ~10K 토큰. 답을 얻은 가치보다 훨씬 작았다.

### 3. AI도 anchoring bias가 있다

같은 컨텍스트에서 같은 작업을 두 번 시키면 같은 결과가 나오기 쉽다. 정말 다른 관점이 필요하면 컨텍스트를 분리한다 (subagent / 별도 세션 / 다른 모델).

이건 사람의 코드 리뷰에도 적용된다. 같은 사람이 자기 PR을 두 번 봐도 같은 걸 본다. 다른 사람이 봐야 다른 게 보인다.

### 4. Anti-pattern을 명시하는 게 효과적

스킬 description에 "이걸 해라"만 쓰면 LLM이 비슷한 다른 도구로 흘러간다. "이걸 하지 마라"를 같이 쓰면 트리거가 더 정확해진다. 특히 이름이 비슷한 도구 (`/inspect` vs `/reinspect`)가 공존할 때.

## References

- [Anchoring effect — Wikipedia](https://en.wikipedia.org/wiki/Anchoring_effect)
- [Claude Code subagent docs](https://docs.claude.com/claude-code)
