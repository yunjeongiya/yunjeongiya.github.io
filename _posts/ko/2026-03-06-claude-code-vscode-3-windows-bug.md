---
layout: post
title: "Claude Code 실행하면 VSCode 창이 3개 열리는 버그 해결법"
date: 2026-03-06 11:00:00 +0900
categories: [Claude, DevTools]
tags: [claude, claude-code, bug, workaround, vscode, windows]
lang: ko
slug: "038"
thumbnail: /assets/images/posts/038-claude-vscode-3-windows/thumbnail-ko.png
---

또 왔습니다. Claude Code 버그 포스트.

[저번 포스트](https://yunjeongiya.github.io/claude/devtools/2025/09/27/claude-file-modified-bug-workaround.html)가 "파일이 예기치 않게 수정되었습니다" 버그였다면, 이번엔 **VSCode 창이 무한증식하는 버그**입니다.

---

## 증상

VSCode 내장 터미널에서 `claude`를 실행하면, **빈 VSCode 창이 3개** 뜹니다. 매번. 예외 없이.

- 별도 PowerShell/터미널에서 실행하면? 안 뜹니다.
- VSCode 내장 터미널에서만? 100% 재현.

처음엔 제 설정 문제인 줄 알았습니다. VSCode 태스크도 건드려보고, 확장도 비활성화해보고... 하루를 날렸습니다.

---

## 원인

**Claude Code v2.1.68** (2026-03-04 릴리즈)에서 도입된 버그입니다.

VSCode 내장 터미널에는 `TERM_PROGRAM=vscode`라는 환경변수가 설정되어 있습니다. Claude Code는 이걸 감지해서 IDE 연동을 시도하는데, **MCP 서버가 초기화될 때마다 새 VSCode 창을 열어버리는 버그**가 있습니다.

MCP 서버를 3개 쓰고 있으면 → 창 3개. 간단한 산수입니다.

GitHub에 이슈가 쏟아지고 있습니다:
- [#30848](https://github.com/anthropics/claude-code/issues/30848) — v2.1.68에서 3개의 빈 VS Code 창이 열림
- [#31016](https://github.com/anthropics/claude-code/issues/31016) — VSCode 터미널에서 Claude 시작 시 3개의 새 창
- [#31136](https://github.com/anthropics/claude-code/issues/31136) — Windows: 세션 시작마다 3개의 빈 VS Code 창 생성

v2.1.69에서도 수정되지 않았습니다. 공식 패치는 아직 없습니다.

---

## 해결법

VSCode 터미널이 Claude Code에게 "여기 VSCode야"라고 알려주는 환경변수를 제거하면 됩니다.

### 방법 1: VSCode 설정에서 영구 적용 (추천)

`.vscode/settings.json`에 추가:

```json
{
    "terminal.integrated.env.windows": {
        "TERM_PROGRAM": "",
        "VSCODE_INJECTION": ""
    }
}
```

이미 `terminal.integrated.env.windows`가 있다면, 기존 설정에 두 줄만 추가하세요.

설정 후 VSCode를 **리로드**해야 합니다 (새 터미널을 여는 것만으론 부족할 수 있습니다).

### 방법 2: 매번 수동으로 실행

PowerShell에서:
```powershell
$env:TERM_PROGRAM=''; $env:VSCODE_INJECTION=''; claude
```

Bash에서:
```bash
TERM_PROGRAM= VSCODE_INJECTION= claude
```

---

## 부작용은?

이 환경변수를 제거하면 Claude Code의 **VSCode IDE 연동 기능**이 비활성화됩니다. 구체적으로:
- 파일을 VSCode에서 직접 열어주는 기능
- VSCode diff 뷰어 연동
- "Connected to VSCode" 표시

하지만 솔직히, 터미널에서 Claude Code를 여러 개 병렬로 쓰는 워크플로우에서는 이 기능이 애초에 제대로 작동하지 않습니다 (하나만 연결되고 나머지는 "disconnected"). 잃을 게 별로 없습니다.

공식 패치가 나오면 이 설정을 제거하면 됩니다.

---

## 교훈

또 하나의 "Claude Code 업데이트 → 뭔가 깨짐" 사이클입니다. 그래도 커뮤니티가 빠르게 우회법을 찾아내니까 다행이죠.

[저번 포스트](https://yunjeongiya.github.io/claude/devtools/2025/09/27/claude-file-modified-bug-workaround.html)에서도 말했지만, 가장 신뢰할 수 있는 정보의 출처는 항상 [GitHub Issues](https://github.com/anthropics/claude-code/issues)입니다.

---

**관련 링크**:
- [GitHub Issue #30848](https://github.com/anthropics/claude-code/issues/30848)
- [GitHub Issue #31136](https://github.com/anthropics/claude-code/issues/31136)
- [이전 포스트: Claude '파일이 예기치 않게 수정되었습니다' 버그 해결법](https://yunjeongiya.github.io/claude/devtools/2025/09/27/claude-file-modified-bug-workaround.html)
