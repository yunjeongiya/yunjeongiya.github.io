---
layout: post
title: "Claude '파일이 예기치 않게 수정되었습니다' 버그 해결법"
date: 2025-09-27 10:00:00 +0900
categories: [Claude, DevTools]
tags: [claude, claude-code, bug, workaround, file-editing, debugging]
lang: ko
slug: "001"
---

갑자기 Claude에서 **File has been unexpectedly modified** 에러가 계속 나온다면, 당신이 미친 게 아닙니다 (뭐, 이 버그 때문에 약간은 그럴 수도 있지만요). 최근 몇 주 사이에 많은 개발자들이 겪고 있는 버그예요.

이 버그는 상황이나 사용자, 심지어 시간대에 따라서도 다르게 작동합니다. 그래서 이 글에서 제시하는 솔루션이 통하지 않을 수도 있습니다...

![Claude Code Error](/assets/images/posts/001-claude-bug/1_BPfY5nXCsBge-KoLsdbNkA.png)

이 버그가 터졌을 때는 진짜 손이 잘린 기분이었어요. 아무것도 못하겠더라고요. Claude 하나 죽으니까 저도 같이 쓸모없어지는 거예요. 이게 바로 **Single Point of Failure**구나 싶었죠.

Claude는 심지어 자체적인 '수정'을 위해해 bash로 직접 파일 패치하기 시작했습니다. 황당하기도 하고 토큰도 엄청 날려먹고... 그래서 그냥 수정사항 알려주면 제가 반영하기로 했는데... 그때 깨달았죠. "아, 나 지금 인간 Ctrl+C/Ctrl+V 머신이구나."

---

## 🕵️‍♂️ 버그의 정체: GitHub Issue #7443

이 문제는 [GitHub Issue #7443](https://github.com/anthropics/claude-code/issues/7443)에 정리되어 있습니다다. 요약하면:

- **확인된 문제**: Claude Code 버전 `1.0.111`에서 생긴 심각한 버그
- **증상**: `Edit` 도구가 안 되고 파일을 수정할 수 없음
- **현재 상태**: 아직 공식 패치 없음, 이슈는 계속 열려있음

---

## 💡 커뮤니티가 찾은 해결법들

공식 패치는 없지만, 전 세계 개발자들이 여러 해결법을 공유했어요. 하나씩 해보세요.

### 1. 상대 경로 쓰기

버그가 처음 나타났을 때 가장 널리 보고된 해결법입니다. 많은 개발자들(저 포함)이 이 방법으로 성공했습니다. `CLAUDE.md` 파일에 다음을 추가하세요.

```markdown
## 파일 경로 규칙 (Claude Code v1.0.111 버그 우회)
- 파일 읽거나 수정할 때 **무조건 상대 경로 쓰기**
- 예시: `./src/components/Component.tsx` ✅
- **절대 경로 쓰지 말기**
- 예시: `C:/Users/user/project/src/components/Component.tsx` ❌
- 이유: Claude Code v1.0.111 버그 때문 (GitHub Issue #7443)
```

### 2. 버전 다운그레이드: `1.0.100`

마지막으로 안정적이었던 버전으로 롤백하는 것도 신뢰할 수 있는 방법입니다.

```bash
npm install -g @anthropic-ai/claude-code@1.0.100
```

### 3. IDE 자동 저장 기능 끄기

`formatOnSave`나 `autoSave` 같은 IDE 기능이 Claude랑 충돌할 수 있다고 하니 임시로 비활성화 해볼 수 있습니다.

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

처음 이 글 쓸 땐 상대 경로 쓰면 100% 해결됐는데, 지금은 제 환경에서 절대 경로랑 상대 경로 둘 다 잘 되더라고요.

이유는 두 가지 정도 생각해볼 수 있어요:

1. **Claude Code가 몰래 핫픽스를 배포**했을 수도 있고

2. **버그가 특정 조건에서만 생기는 거**일 수도 있어요 (예: 특정 프로젝트 타입, IDE 확장 충돌 등)

---

## 🤔 그래서 어쩌라고고?

버그 상황이 계속 바뀌니까, 이렇게 해보세요:

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
