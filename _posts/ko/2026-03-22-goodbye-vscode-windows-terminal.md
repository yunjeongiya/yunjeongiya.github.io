---
layout: post
title: "VS Code를 버렸다 — Windows Terminal + bat 파일이면 충분하다"
date: 2026-03-22 09:00:00 +0900
categories: [Development, DevEx]
tags: [windows-terminal, 개발환경, 자동화, claude-code, vscode, powershell]
lang: ko
slug: "040"
thumbnail: /assets/images/posts/040-goodbye-vscode-windows-terminal/thumbnail-ko.jpg
---

[첫 번째 글](https://yunjeongiya.github.io/development/devex/2026/03/03/vscode-tasks-automation.html)에서 VS Code tasks.json으로 터미널 9개를 자동 실행하는 셋업을 만들었다. [두 번째 글](https://yunjeongiya.github.io/claude/devtools/2026/03/06/claude-code-vscode-3-windows-bug.html)에서 Claude Code가 VS Code 창을 3개씩 여는 버그를 겪었다. [세 번째 글](https://yunjeongiya.github.io/development/devex/2026/03/06/vscode-task-terminal-auto-restart.html)에서 Ctrl+C로 터미널이 죽는 문제를 해결했다.

세 편의 글을 쓰면서 깨달은 게 있다.

**나는 VS Code를 에디터로 안 쓰고 있었다.**

코드는 Claude Code가 읽고, 쓰고, 수정한다. 내가 VS Code에서 하는 건 터미널 탭을 클릭하는 것뿐이었다. 1GB 넘는 메모리를 먹는 Electron 앱을 터미널 런처로 쓰고 있었던 거다.

나만 이런 건 아닌 것 같다. Steve Yegge(전 Google/Amazon)는 ["2026년이면 IDE는 죽는다"](https://www.latent.space/p/steve-yegges-vibe-coding-manifesto)고 했고, Google Chrome 엔지니어링 리드 Addy Osmani는 개발자의 메인 루프가 바뀌고 있다고 [썼다](https://addyo.substack.com/p/death-of-the-ide). 파일 열기 → 편집 → 빌드 → 디버그가 아니라, **의도 전달 → 에이전트에 위임 → diff 리뷰 → 머지**. Anthropic의 [2026 Agentic Coding Trends Report](https://resources.anthropic.com/2026-agentic-coding-trends-report)에 따르면 개발자의 60%가 이미 AI를 작업에 통합하고 있다.

"에이전트 오케스트레이션"이라고 하면 거창하지만, 내 경우에는 그냥 터미널 4개에서 Claude Code를 돌리는 거다. 에디터는 필요 없고, 터미널만 있으면 된다.

---

## VS Code가 해주던 것

정리하면 딱 두 가지다.

1. **터미널 자동 실행** — `tasks.json`의 `runOn: "folderOpen"`
2. **터미널 그룹 분할** — `presentation.group`으로 역할별 묶기

이 두 가지를 위해 VS Code를 띄우고 있었다. tasks.json 삽질 3편, PowerShell `Start-Job` 프로세스 격리까지 해가면서.

---

## Windows Terminal이 이미 다 된다

Windows 11에 기본 설치되어 있는 Windows Terminal은 `wt` 명령어 하나로 여러 탭을 동시에 열 수 있다.

```
wt -d "C:\project" --title "Tab 1" cmd /k "echo hello" ; new-tab -d "C:\project" --title "Tab 2" cmd /k "echo world"
```

`; new-tab`으로 탭을 이어 붙이면 된다. 이걸 bat 파일로 만들면 더블 클릭 한 번에 전부 뜬다.

---

## start-dev.bat

```batch
@echo off
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

wt ^
  -d "%ROOT%" --title "SSH Tunnel" powershell ... -File "%ROOT%\.scripts\ssh-tunnel.ps1" ^
  ; split-pane -V -d "%ROOT%\web-app" --title "Web App" cmd /k "npm run dev" ^
  ; split-pane -V -d "%ROOT%\mobile-app" --title "Mobile App" cmd /k "npm run dev" ^
  ; new-tab -d "%ROOT%" --title "SSH Shell" powershell ... -File "%ROOT%\.scripts\ssh-shell.ps1" ^
  ; split-pane -V -d "%ROOT%\server" --title "Server" powershell ... -File run-local.ps1 ^
  ; new-tab -d "%ROOT%" --title "Claude 1" cmd /k "claude /resume" ^
  ; split-pane -V -d "%ROOT%" --title "Claude 2" cmd /k "claude /resume" ^
  ; move-focus left ^
  ; split-pane -H -d "%ROOT%" --title "Claude 3" cmd /k "claude /resume" ^
  ; move-focus right ^
  ; split-pane -H -d "%ROOT%" --title "Claude 4" cmd /k "claude /resume"
```

3개 탭, 9개 패널. `new-tab`은 새 탭, `split-pane`은 현재 탭 안에서 분할한다. `-V`는 세로 분할(좌우), `-H`는 가로 분할(상하).

```
Tab 1 "Background" — 안 봐도 되는 것들
┌───────────┬─────────────┬────────────────┐
│SSH Tunnel │  Web App    │  Mobile App    │
└───────────┴─────────────┴────────────────┘

Tab 2 "Server" — 로그 확인용
┌──────────────┬──────────────┐
│  SSH Shell   │   Server     │
└──────────────┴──────────────┘

Tab 3 "Claude" — 메인 작업
┌──────────────┬──────────────┐
│  Claude 1    │  Claude 2    │
├──────────────┼──────────────┤
│  Claude 3    │  Claude 4    │
└──────────────┴──────────────┘
```

VS Code의 `presentation.group`은 같은 그룹끼리 분할해주는 기능이었다. Windows Terminal은 `split-pane` 명령어로 같은 걸 한다. 차이는 bat 파일 한 줄이면 된다는 것.

### 한 가지 주의점

처음에는 SSH 터널의 자동 재연결 루프를 bat 파일 안에 인라인으로 넣었다.

```batch
wt --title "SSH Tunnel" powershell -NoExit -Command "while ($true) { ssh -L 3307:db:3306 server -N; Start-Sleep 3 }"
```

이러면 안 된다. `wt`는 `;`를 **탭 구분자**로 쓰는데, PowerShell의 `;`(문장 구분자)과 충돌한다. `wt`가 PowerShell 코드의 `;`를 만나면 새 탭 명령으로 해석해서, 명령이 반으로 잘린다.

해결은 간단하다. 복잡한 명령은 `.ps1` 파일로 분리한다.

```powershell
# .scripts/ssh-tunnel.ps1
while ($true) {
    Write-Host "`nStarting SSH Tunnel...`n" -ForegroundColor Cyan
    ssh -L 3307:db-host:3306 server -N
    Write-Host "`nDisconnected. Restarting in 3 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
}
```

`wt`에서는 `-File`로 호출하면 `;` 충돌이 없다.

---

## `%~dp0`의 트레일링 백슬래시

bat 파일에서 `%~dp0`는 현재 스크립트의 디렉토리 경로를 반환하는데, 항상 **끝에 `\`가 붙는다**.

```
C:\Users\YJL\Desktop\CheckUS\
```

이 상태로 `wt -d "%~dp0"` 하면, 쌍따옴표 안에서 `\"`가 이스케이프 시퀀스로 해석되어 경로가 깨진다.

```batch
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
```

트레일링 백슬래시를 제거하면 문제 없다.

---

## 한글 깨짐 (UTF-8)

Windows Terminal에서 Spring Boot 로그를 보면 한글이 깨진다.

```
s.c.t.service.TriggerRoutineService : ?몃━嫄?猷⑦떞 ?앹꽦
```

Java 프로세스가 시스템 기본 인코딩(EUC-KR)으로 출력하기 때문이다. `run-local.ps1`에 세 줄을 추가한다.

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:JAVA_TOOL_OPTIONS = "-Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8"
chcp 65001 | Out-Null
```

`Start-Job`을 쓰는 경우, Job 스코프 안에서도 같은 설정을 해줘야 한다. Job은 별도 프로세스이므로 부모의 환경변수를 상속받지 않는다.

---

## 코드를 봐야 할 때는?

VS Code를 완전히 지운 건 아니다. 가끔 코드를 시각적으로 훑어봐야 할 때가 있다. 그때는 터미널에서 `code path/to/file.java` 한 줄이면 된다. VS Code가 파일 뷰어로 열린다. 워크스페이스를 통째로 여는 것과는 메모리 사용량이 다르다.

사실 대부분의 경우 Claude Code에게 "이 파일 읽어줘"라고 하면 된다. 파일을 읽고, 설명하고, 수정까지 해준다. 에디터가 필요한 순간은 생각보다 드물다.

---

## VS Code vs Windows Terminal

| | VS Code | Windows Terminal |
|---|---|---|
| 터미널 자동 실행 | `tasks.json` (160줄) | `start-dev.bat` (10줄) |
| 탭 관리 | 그룹 분할 | 탭 + split-pane |
| Ctrl+C 처리 | [버그 있음](https://github.com/microsoft/vscode/issues/87033) | 정상 동작 |
| Claude Code 실행 | [창 3개 버그](https://yunjeongiya.github.io/claude/devtools/2026/03/06/claude-code-vscode-3-windows-bug.html) | 문제 없음 |
| 메모리 사용 | ~1GB+ | ~100MB |
| 셋업 복잡도 | `automationProfile`, `type: process` vs `shell`, `Start-Job` | bat 파일 하나 |

세 편의 글에 걸쳐 해결한 문제들 — `automationProfile` 설정, `type: process` vs `type: shell` 구분, `Start-Job` 프로세스 격리 — 이 전부 VS Code 내장 터미널의 한계에서 비롯된 것이었다. Windows Terminal로 바꾸니까 그냥 된다.

---

## IDE가 필요 없어진 게 아니라, 역할이 바뀐 거다

The New Stack은 2025년을 ["Agentic CLI 시대의 시작"](https://thenewstack.io/ai-coding-tools-in-2025-welcome-to-the-agentic-cli-era/)이라고 불렀다. IDE 안에 챗봇을 넣는 단계를 넘어서, 터미널에서 에이전트가 직접 코드를 쓰는 방식으로 넘어가고 있다는 이야기다.

IDE가 사라진다는 말은 아니다. 디버거를 걸어야 할 때, 복잡한 리팩토링의 diff를 시각적으로 확인해야 할 때, IDE는 여전히 필요하다. 다만 그게 하루 중 대부분의 시간을 보내는 곳은 아니게 됐다.

내 하루를 보면 이렇다:
- **80%** — 터미널에서 Claude Code에게 의도 전달, diff 리뷰
- **15%** — 로그 확인, 서버 상태 체크 (역시 터미널)
- **5%** — VS Code로 파일 열어서 눈으로 확인

그 5%를 위해 VS Code를 워크스페이스째로 띄워놓을 이유가 없다. `code file.java` 한 줄이면 충분하다.

---

## 시리즈 정리

1. [바이브코딩은 셋업부터 — VS Code 자동화 가이드](https://yunjeongiya.github.io/development/devex/2026/03/03/vscode-tasks-automation.html) — tasks.json으로 터미널 9개 자동화
2. [Claude Code 실행하면 VSCode 창이 3개 열리는 버그 해결법](https://yunjeongiya.github.io/claude/devtools/2026/03/06/claude-code-vscode-3-windows-bug.html) — VS Code 내장 터미널 버그
3. [VS Code 태스크 터미널, Ctrl+C 해도 안 죽게 만들기](https://yunjeongiya.github.io/development/devex/2026/03/06/vscode-task-terminal-auto-restart.html) — Windows 콘솔의 Ctrl+C 전파 문제
4. **VS Code를 버렸다** — 결국 터미널 런처가 필요했을 뿐이다

IDE는 안 죽는다. 다만 매일 여는 앱에서, 가끔 여는 앱이 될 뿐이다.
