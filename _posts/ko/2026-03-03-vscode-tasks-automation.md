---
layout: post
title: "바이브코딩은 셋업부터 — VS Code 자동화 가이드"
date: 2026-03-03 20:00:00 +0900
categories: [Development, DevEx]
tags: [vscode, tasks-json, 개발환경, powershell, 자동화, claude-code]
lang: ko
slug: "037"
thumbnail: /assets/images/posts/037-vscode-tasks-automation/thumbnail-ko.png
---

![바이브코딩은 셋업부터](/assets/images/posts/037-vscode-tasks-automation/thumbnail-ko.png){: width="700"}

요즘 내 개발 루틴은 이렇다.

VS Code를 열고, SSH 터널 띄우고, 백엔드 서버 켜고, 프론트엔드 2개 `npm run dev` 하고, Claude Code 4개를 띄운다. 터미널 9개. 매번 수동이었다.

이 글은 VS Code Tasks 기능 소개가 아니다. 바이브코딩을 위한 실전 셋업을 자동화한 기록이다.

`tasks.json` 하나로 VS Code 여는 순간 전부 자동 실행되게 만들었다.

<img src="/assets/images/posts/037-vscode-tasks-automation/01-claude-group.png" alt="VS Code에서 9개 태스크가 자동 실행된 모습 — Claude Code 4개가 4분할로 동시에 뜬다" style="max-width: 600px; width: 100%;">

---

## 왜 터미널이 9개나 필요한가

내가 작업하는 프로젝트는 모노레포 구조의 풀스택 프로젝트다.

```
my-project/
├── server/        # Spring Boot (Java 21)
├── web-app/       # React (Vite + TS)
├── mobile-app/    # React (Vite + TS)
└── infra/         # Docker
```

개발을 시작하려면 최소 4개 프로세스가 필요하다. DB 접속용 SSH 터널, 백엔드 서버, 프론트엔드 2개.

여기에 바이브코딩 셋업이 더해진다. Claude Code를 4개 동시에 띄워서 메인 작업, 리서치, 테스트, 리뷰를 병렬로 돌린다. 모노레포에서 서버/프론트를 동시에 작업할 때 특히 유용하다.

합치면 터미널 9개. 이걸 VS Code 열 때마다 하나하나 여는 건 비효율적이다.

---

## 자동화: tasks.json + folderOpen

VS Code에는 `.vscode/tasks.json`이라는 태스크 자동화 기능이 있다. 빌드나 린트 같은 명령을 등록해두고 단축키로 실행하는 용도인데, 여기에 `runOn: "folderOpen"` 옵션을 주면 **프로젝트를 열자마자 자동 실행**된다.

```json
{
  "label": "Web App",
  "type": "shell",
  "command": "npm",
  "args": ["run", "dev"],
  "options": {
    "cwd": "${workspaceFolder}/web-app"
  },
  "isBackground": true,
  "problemMatcher": [],
  "presentation": {
    "label": "Web App",
    "group": "dev",
    "reveal": "silent"
  },
  "runOptions": {
    "runOn": "folderOpen"
  }
}
```

이 패턴을 9개 태스크에 반복하면 된다. 핵심 옵션 세 가지:

- **`runOn: "folderOpen"`** — VS Code 열면 자동 실행
- **`isBackground: true`** — 종료를 기다리지 않는 백그라운드 프로세스
- **`presentation.group`** — 같은 그룹끼리 터미널 분할

`presentation.group`이 같은 태스크들은 하나의 터미널 패널 안에서 분할된다. 이걸로 역할별로 터미널을 묶을 수 있다.

![dev 그룹 — SSH Tunnel, Web App, Mobile App이 3분할로 실행 중](/assets/images/posts/037-vscode-tasks-automation/02-dev-group.png)

```
┌─────────────────────────────────────────┐
│ Server Group                            │
│ ┌──────────────────┬──────────────────┐ │
│ │ Spring Boot      │ SSH Shell        │ │
│ └──────────────────┴──────────────────┘ │
├─────────────────────────────────────────┤
│ Dev Group                               │
│ ┌────────┬─────────────┬──────────────┐ │
│ │SSH Tun.│  Web App    │ Mobile App   │ │
│ └────────┴─────────────┴──────────────┘ │
├─────────────────────────────────────────┤
│ Claude Group                            │
│ ┌────────┬────────┬────────┬──────────┐ │
│ │Claude 1│Claude 2│Claude 3│ Claude 4 │ │
│ └────────┴────────┴────────┴──────────┘ │
└─────────────────────────────────────────┘
```

서버 로그처럼 자주 확인하는 건 별도 그룹으로 분리하고, Claude Code처럼 띄워만 두는 건 `reveal: "silent"`로 뒤에 깔아둔다.

---

## Claude Code 4개 자동 실행

이번 셋업의 핵심이다.

처음에는 VS Code 확장프로그램으로 Claude Code를 썼다. 문제는 창을 무한으로 열 수 있으니까 무한으로 열게 된다는 거다. 한때 동시에 16개까지 띄워놓고 작업한 적이 있는데, 결과는 역효과였다. 컨텍스트가 분산되고, 뭘 어디에 시켰는지 추적이 안 됐다.

그래서 터미널 기반 CLI로 바꾸고, 4개로 고정했다. 터미널은 tasks.json에서 정한 만큼만 뜨니까 물리적으로 제한이 된다. 새로 시작하려면 하던 걸 마무리해야 한다. 의도적인 제약이다.

4개의 역할은 대략 이렇다:

- 메인 작업
- 리서치/탐색
- 테스트 실행
- 리뷰/문서

```json
{
  "label": "Claude Code 1",
  "type": "shell",
  "command": "claude",
  "args": ["/resume"],
  "isBackground": true,
  "problemMatcher": [],
  "presentation": {
    "label": "Claude 1",
    "group": "claude",
    "reveal": "always"
  },
  "runOptions": {
    "runOn": "folderOpen"
  }
}
```

이런 태스크를 4개 만들고, 모두 `"group": "claude"`로 묶으면 4분할 터미널로 나란히 뜬다.

`args: ["/resume"]`이 포인트다. Claude Code CLI는 첫 번째 인수를 초기 프롬프트로 받기 때문에, VS Code를 열자마자 이전 세션이 자동 복원된다. 어제 작업하던 맥락 그대로 이어갈 수 있다.

---

## 삽질 1: PowerShell `-Command` 충돌

셋업은 간단한데, 삽질이 좀 있었다.

한글 깨짐 방지를 위해 이런 PowerShell 프로파일을 쓰고 있었다.

```json
// settings.json
"terminal.integrated.profiles.windows": {
    "PowerShell (UTF-8)": {
        "source": "PowerShell",
        "args": ["-NoExit", "-Command", "chcp 65001 > $null"]
    }
},
"terminal.integrated.defaultProfile.windows": "PowerShell (UTF-8)"
```

이 상태에서 tasks.json을 실행하면 모든 태스크가 이 에러를 뱉는다.

```
매개 변수 형식이 틀립니다 - -Command
```

원인은 간단하다. VS Code가 `"type": "shell"` 태스크를 실행할 때 기본 프로파일의 args를 가져온 뒤, 태스크 명령을 실행하기 위해 `-Command`를 **또** 붙인다. 결과적으로 이런 명령이 만들어진다.

```
powershell.exe -NoExit -Command "chcp 65001 > $null" -Command "npm run dev"
```

PowerShell은 `-Command`를 두 번 받으면 첫 번째 이후의 모든 인수를 하나로 해석하려다 실패한다.

**해결은 한 줄이다.**

```json
"terminal.integrated.automationProfile.windows": {
    "path": "powershell.exe"
}
```

`automationProfile`을 설정하면 태스크는 기본 프로파일 대신 이 프로파일을 사용한다. 일반 터미널은 UTF-8 프로파일, 태스크 터미널은 깨끗한 PowerShell. 역할이 분리된다.

---

## 삽질 2: `type: "process"` vs `type: "shell"`

Claude Code 태스크를 처음에 `"type": "process"`로 설정했더니 같은 `-Command` 에러가 발생했다.

`"type": "process"`는 `automationProfile`을 **사용하지 않는다**. 기본 프로파일의 shell을 경유하기 때문에 `-Command` 충돌이 그대로 발생한다.

`"type": "shell"`로 바꿔야 `automationProfile`이 적용된다. 이건 문서에도 잘 나와 있지 않아서 찾는 데 시간이 좀 걸렸다.

---

## 최종 구성

| 그룹 | 태스크 | 역할 |
|------|--------|------|
| `server` | Server, SSH Shell | 서버 로그 + 원격 쉘 |
| `dev` | SSH Tunnel, Web App, Mobile App | 인프라 + 프론트엔드 |
| `claude` | Claude 1~4 | AI 병렬 개발 |

9개 태스크, 3개 그룹, 약 160줄.

VS Code를 여는 순간 개발이 시작된다. 그게 셋업의 전부다.

---

## 참고 자료

- [VS Code Tasks 공식 문서](https://code.visualstudio.com/docs/debugtest/tasks)
- [VS Code Terminal Profiles](https://code.visualstudio.com/docs/terminal/profiles)
- [Visual Studio Code Tasks and Split Terminals](https://dev.to/pzelnip/visual-studio-code-tasks-and-split-terminals-2ghk)
- [Auto-Open Multiple Terminals in VS Code](https://jackharner.com/blog/auto-open-terminals-vs-code-workspace/)
- [Automating multi-projects Execution using VS Code Tasks](https://medium.com/@simonescigliuzzi/automating-multi-projects-execution-using-vscodes-tasks-10e102da5d96)
