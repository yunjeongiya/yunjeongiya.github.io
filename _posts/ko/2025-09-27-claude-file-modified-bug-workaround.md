---
layout: post
title: "Claude '파일이 예기치 않게 수정되었습니다' 버그: 해결 방법 모음"
date: 2025-09-27 10:00:00 +0900
categories: [Claude, DevTools]
tags: [claude, claude-code, bug, workaround, file-editing, debugging]
lang: ko
---

갑자기 Claude에서 **File has been unexpectedly modified** 에러가 계속 나온다면, 당신이 미쳐가고 있는 게 아닙니다 (뭐, 이 버그 때문에 약간은 그럴 수도 있지만요). 이건 몇 주 전부터 많은 개발자들이 겪고 있는 최근 버그입니다.

이 버그는 상황, 사용자, 심지어 시간대에 따라 동작이 바뀌는 변덕스러운 녀석입니다. 이 글은 단 하나의 "정답"을 선언하는 게 아닙니다. 대신 커뮤니티의 집단 지성과 제 경험을 공유하는 가이드입니다.

![Claude Code Error](/assets/images/posts/2025-09-28-claude-bug/1_BPfY5nXCsBge-KoLsdbNkA.png)

이 버그가 터졌을 때, 마치 누군가 제 손을 잘라버린 것 같았습니다. 아무것도 할 수 없었죠. Claude 하나 망가지니 저도 무용지물이 되더라고요. 이게 바로 **Single Point of Failure**의 현실이구나 싶었습니다.

Claude는 심지어 자체적인 "수정"을 제안했는데, bash에서 수동으로 파일을 패치하는 방법이었습니다. 황당하면서도 토큰 낭비가 심각했죠. 어느 순간 Claude의 제안을 제가 직접 복사-붙여넣기하고 있었는데... 그때 실존적 위기감이 밀려왔습니다. "아, 나 지금 인간 Ctrl+C/Ctrl+V 파이프라인이구나." 다음번엔 백업 성격도 준비해야겠다는 생각이 들었습니다.

---

## 🕵️‍♂️ 버그의 정체: GitHub Issue #7443

이 문제의 핵심은 [GitHub Issue #7443](https://github.com/anthropics/claude-code/issues/7443)입니다. 커뮤니티 논의를 요약하면:

- **확인된 이슈**: Claude Code 버전 `1.0.111`에서 발생한 치명적인 회귀 버그
- **주요 증상**: `Edit` 도구가 실패하고 파일을 수정할 수 없음
- **현재 상태**: 이 글 작성 시점 기준 공식 수정 없음, 이슈는 여전히 open 상태

---

## 💡 커뮤니티 해결법 모음 (시도해볼 것들)

공식 패치는 없지만, 전 세계 개발자들이 다양한 해결법을 공유했습니다. 하나씩 시도해보세요.

### 1. 상대 경로 사용

버그가 처음 나타났을 때 가장 널리 보고된 해결법입니다. 많은 개발자들(저 포함)이 이 방법으로 성공했습니다. `CLAUDE.md` 파일에 다음을 추가하세요.

```markdown
## 파일 경로 규칙 (Claude Code v1.0.111 버그 우회)
- 파일을 읽거나 편집할 때 **항상 상대 경로를 사용하세요.**
- 예시: `./src/components/Component.tsx` ✅
- **절대 경로를 사용하지 마세요.**
- 예시: `C:/Users/user/project/src/components/Component.tsx` ❌
- 이유: Claude Code v1.0.111의 알려진 버그 우회 (GitHub Issue #7443)
```

### 2. 버전 다운그레이드: `1.0.100`

마지막으로 안정적이었던 버전으로 롤백하는 것도 신뢰할 수 있는 방법입니다.

```bash
npm install -g @anthropic-ai/claude-code@1.0.100
```

### 3. IDE 파일 감시자 비활성화

일부 개발자들은 `formatOnSave`나 `autoSave` 같은 IDE 기능이 Claude의 파일 편집 프로세스와 충돌할 수 있다고 제안했습니다. 임시로 비활성화해보세요.

```json
// .vscode/settings.json
{
  "editor.formatOnSave": false,
  "files.autoSave": "off"
}
```

### 4. Pro Tip

당신은 **VIBE CODER**라는 걸 압니다. Claude 에이전트에게 이 블로그 포스트의 URL을 주고 이렇게 말하세요: "알려진 버그에 걸린 것 같아. 이 가이드의 지시사항을 따라서 해결해줘."

---

## ⚠️ 중요 업데이트

처음 이 이슈에 대해 글을 쓸 때는 상대 경로 사용이 100% 신뢰할 수 있는 수정법이었습니다. 하지만 이 포스트를 업데이트하는 지금, 제 환경에서는 절대 경로와 상대 경로 둘 다 완벽하게 작동하고 있습니다.

가능한 설명은 두 가지입니다:

1. **백그라운드에서 무언의 핫픽스**가 Claude Code에 푸시되었을 가능성

2. **버그 자체가 매우 특정한 조건에서만 발생**할 가능성 (예: 특정 프로젝트 유형, 충돌하는 IDE 확장 프로그램)

---

## 🤔 그래서, 우리는 뭘 해야 할까?

이 버그의 유동적인 상태를 고려하여, 다음과 같은 행동 방침을 권장합니다:

### 1. 먼저: 시도해보기

다른 것을 시도하기 전에, 절대 경로와 상대 경로 둘 다로 파일을 편집해보세요. 이미 문제가 해결되었을 수도 있습니다.

### 2. 실패하면: 커뮤니티 해결법 시도

위의 해결법 목록을 하나씩 시도해보세요.

### 3. 업데이트 확인

가장 신뢰할 수 있는 정보의 출처는 [공식 GitHub 이슈](https://github.com/anthropics/claude-code/issues/7443)입니다. 최신 상태를 알고 싶다면 해당 스레드를 주시하세요.

---

이 포스트에 나온 방법 중 하나가 여러분의 문제를 해결하는 데 도움이 되기를 바랍니다. 이 끊임없이 변화하는 버그와의 싸움에서 우리 모두에게 행운이 있기를!

---

**Also available on**: [Medium](https://medium.com/@yunjeongiya/the-elusive-claude-file-has-been-unexpectedly-modified-bug-a-workaround-solution-831182038d1d)

**관련 링크**: [GitHub Issue #7443](https://github.com/anthropics/claude-code/issues/7443)
