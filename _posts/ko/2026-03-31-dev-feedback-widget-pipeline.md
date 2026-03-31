---
layout: post
title: "인앱 피드백 위젯 만들기 — 스크린샷 캡처부터 Slack 알림까지"
date: 2026-03-31 11:00:00 +0900
categories: [FullStack, Automation]
tags: [React, GitHub Actions, Slack, Feedback, Automation, TypeScript, Vibe Coding]
lang: ko
slug: "050"
thumbnail: /assets/images/posts/050-dev-feedback-widget/thumbnail-ko.png
published: true
---

![인앱 피드백 위젯 만들기](/assets/images/posts/050-dev-feedback-widget/thumbnail-ko.png)

## 문제: 버그 리포트가 카카오톡으로 온다

1인 개발로 학원 출결 관리 시스템을 운영하고 있다. 선생님들과 학부모들이 매일 쓰는 앱인데, 테스트를 혼자 다 하기엔 한계가 있다. 실사용 중 버그가 발생하면 리포트가 카카오톡이나 전화로 온다.

"그 화면에서 뭔가 안 돼요."

어떤 화면인지, 무엇을 하다가 발생한 건지, 어떤 상태였는지 — 맥락이 전부 빠져 있다. 스크린샷이 오기도 하는데, 컴퓨터 모니터를 핸드폰으로 찍은 사진이다. 해상도가 낮은 건 둘째 치고, 모아레 패턴이 겹쳐서 텍스트가 안 읽힌다.

이걸 받고 나면 역추적이 시작된다. "그게 어떤 페이지였나요?" "로그인은 어떤 계정으로 하셨어요?" "브라우저가 크롬인가요?" — 질문 몇 번 주고받으면 하루가 간다.

버그를 고치는 것보다 버그를 재현하는 데 시간이 더 걸리는 상황이 반복됐다.

Ybug.io나 Usersnap 같은 유료 피드백 도구가 있다는 건 알고 있었다. 하지만 월 수십 달러 비용에, GitHub Issue 직접 연동이 안 되고, 해결 알림까지 이어지는 파이프라인은 없다. 필요한 건 딱 "스크린샷 + 맥락 → GitHub Issue → 해결 시 Slack 알림"이었다.

## 해결: 인앱 피드백 위젯 (F278)

앱 안에서 바로 스크린샷을 찍고, 그 위에 그림을 그려 어디가 문제인지 표시한 뒤, 메모와 함께 제출하면 GitHub Issue로 생성되는 위젯을 만들었다.

개발/테스트 환경에서만 화면 우하단에 보라색 플로팅 버튼이 뜬다. 누르면 브라우저가 현재 탭 캡처 권한을 요청하고, 허용하면 바로 어노테이션 모드로 전환된다.

동작 흐름은 네 단계다:

1. **idle** — 플로팅 버튼 대기
2. **capturing** — Display Media API로 브라우저 탭 캡처
3. **annotating** — 캡처된 이미지 위에 그리기 + 메모 작성
4. **submitting** — GitHub에 스크린샷 업로드 + Issue 생성

상태 머신으로 관리하니 각 단계별 UI 전환이 깔끔하다.

```typescript
type WidgetState = 'idle' | 'capturing' | 'annotating' | 'submitting';
```

## Display Media API를 선택한 이유

처음에는 html2canvas를 검토했다. DOM을 canvas로 변환해주니 사용자 동의 없이 캡처할 수 있어서 UX가 좋을 것 같았다. 하지만 실제 앱에 적용하면 문제가 많다.

- **cross-origin iframe** — 외부 서비스를 iframe으로 임베드하면 tainted canvas가 된다
- **canvas/WebGL 요소** — 차트 라이브러리 같은 게 렌더링한 canvas는 비어 보인다
- **CSS 호환성** — backdrop-filter, clip-path 같은 최신 CSS가 무시되거나 깨진다
- **성능** — DOM이 복잡한 페이지에서는 캡처에 수 초가 걸린다

`navigator.mediaDevices.getDisplayMedia()`는 브라우저가 실제로 렌더링한 화면을 그대로 캡처한다. 사용자에게 탭 선택 다이얼로그가 뜨긴 하지만, 정확한 캡처가 보장된다. `preferCurrentTab: true` 옵션을 주면 현재 탭이 기본 선택되어 클릭 한 번이면 끝난다.

```typescript
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { displaySurface: 'browser' } as MediaTrackConstraints,
  audio: false,
  preferCurrentTab: true,
} as DisplayMediaStreamOptions);

const track = stream.getVideoTracks()[0];
const video = document.createElement('video');
video.srcObject = stream;
video.muted = true;
await video.play();

const canvas = document.createElement('canvas');
canvas.width = video.videoWidth;
canvas.height = video.videoHeight;
canvas.getContext('2d')!.drawImage(video, 0, 0);

track.stop();
```

비디오 트랙에서 한 프레임만 추출한 뒤 즉시 `track.stop()`으로 스트림을 끊는다. 캡처 표시기(빨간 테두리, 공유 중 표시)가 잠깐 깜빡이고 사라진다.

## 어노테이션 캔버스: Pointer Events로 통일

캡처한 이미지 위에 직접 그림을 그릴 수 있어야 한다. 도구는 세 가지 — 자유 그리기(freehand), 사각형(rectangle), 화살표(arrow). 색상은 빨강, 파랑, 검정 세 가지.

마우스와 터치를 동시에 지원하기 위해 Pointer Events API를 사용했다. `mousedown`/`touchstart`를 따로 처리하지 않아도 된다.

```typescript
const handlePointerDown = (e: React.PointerEvent) => {
  e.preventDefault();
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  setIsDrawing(true);
  const point = getCanvasPoint(e);
  setCurrentStroke({ tool, color, points: [point] });
};
```

![피드백 위젯 어노테이션 UI](/assets/images/posts/050-dev-feedback-widget/widget-mockup.png)

`setPointerCapture`가 핵심이다. 이걸 호출하면 포인터가 캔버스 밖으로 나가도 이벤트가 계속 해당 엘리먼트로 전달된다. 드래그 중 마우스가 캔버스 경계를 벗어나도 그리기가 끊기지 않는다.

### 캔버스 다시 그리기 전략

그리기 상태를 React state로 관리한다.

- `strokes` — 확정된 획들의 배열
- `currentStroke` — 현재 그리고 있는 진행 중 획

`useEffect`에서 매 변경마다 전체 캔버스를 다시 그린다: 배경 이미지 + 확정된 획들 + 현재 획.

```typescript
useEffect(() => {
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);

  for (const stroke of strokes) {
    drawStroke(ctx, stroke);
  }

  if (currentStroke) {
    drawStroke(ctx, currentStroke);
  }
}, [backgroundImage, strokes, currentStroke]);
```

매번 전체를 다시 그리는 게 비효율적으로 보일 수 있는데, 실제로는 스크린샷 한 장 위에 몇 개의 도형을 그리는 정도라 성능 문제가 없다. 오히려 이 방식이 Undo(`Ctrl+Z`)를 간단하게 만들어준다 — `strokes` 배열에서 마지막 원소만 제거하면 이전 상태로 돌아간다.

## 스크린샷을 GitHub에 저장하는 방법

GitHub Issue body에 base64 이미지를 넣을 수 있을까? 안 된다. Issue body 크기 제한이 65KB고, 스크린샷 하나가 보통 수백 KB다.

대신 GitHub Contents API로 스크린샷 파일을 리포지토리에 직접 커밋한다.

```typescript
async function uploadScreenshot(config: DevFeedbackConfig, blob: Blob): Promise<string> {
  const base64Content = await blobToRawBase64(blob);
  const filename = `feedback-screenshots/${Date.now()}.jpg`;

  await githubFetch(
    `https://api.github.com/repos/${config.githubRepo}/contents/${filename}`,
    config.githubToken,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `[feedback] screenshot ${new Date().toISOString()}`,
        content: base64Content,
      }),
    },
  );

  return `https://github.com/${config.githubRepo}/blob/main/${filename}?raw=true`;
}
```

`feedback-screenshots/` 디렉토리 아래에 타임스탬프 이름으로 JPEG 파일이 쌓인다. 업로드 전에 가로 1280px 이하로 리사이즈하고 JPEG quality 80%로 압축해서 파일 크기를 줄인다.

반환값으로 `?raw=true` 파라미터가 붙은 blob URL을 사용한다. `download_url`을 쓰면 임시 토큰이 포함되어 있어서 시간이 지나면 이미지가 깨진다.

## Issue Body 구조: 정규식으로 파싱 가능하게

Issue body는 나중에 GitHub Actions에서 파싱해야 하므로 구조화된 포맷으로 작성한다.

```markdown
## Feedback

출석 체크 화면에서 시간표가 안 보입니다

## Screenshot

![screenshot](https://github.com/.../feedback-screenshots/1711843200000.jpg?raw=true)

## Context
- **Author**: 김선생
- **Account**: teacher01 (T001)
- **Slack**: @김선생
- **URL**: https://app.checkus.kr/attendance
- **Browser**: Mozilla/5.0 ...
- **Viewport**: 1920x1080
- **Timestamp**: 2026-03-31T09:30:00.000Z
- **App**: teacher-web
```

![자동 생성된 GitHub Issue](/assets/images/posts/050-dev-feedback-widget/github-issue.png)

모든 메타데이터가 `**Key**: Value` 패턴으로 되어 있어서 정규식 한 줄로 추출할 수 있다.

```python
m = re.search(r'\*\*Author\*\*: (.+)', body)
author = m.group(1).strip() if m else "Unknown"
```

## 이슈 닫으면 Slack 알림이 간다

피드백을 제출하는 것만으로는 반쪽짜리다. 리포트한 사람이 "내 피드백이 처리됐는지" 알 수 있어야 피드백 루프가 완성된다.

GitHub Actions 워크플로우를 하나 만들었다. `feedback` 라벨이 붙은 이슈가 닫히면 트리거된다.

```yaml
on:
  issues:
    types: [closed]

jobs:
  notify:
    if: contains(github.event.issue.labels.*.name, 'feedback')
    runs-on: ubuntu-latest
```

워크플로우가 하는 일:

1. Issue body에서 Author, Slack 닉네임, 작성 시간을 정규식으로 추출
2. 이슈의 마지막 코멘트를 가져와서 해결 내용으로 사용
3. Slack Bot Token으로 `users.list` API를 호출해서 닉네임에 매칭되는 Slack user ID를 찾음
4. Webhook으로 멘션 포함 알림 전송

Slack 사용자 매칭은 `display_name`, `real_name`, `username` 세 필드를 비교한다.

```python
for member in users.get("members", []):
    p = member.get("profile", {})
    dn = p.get("display_name", "")
    rn = p.get("real_name", "")
    un = member.get("name", "")
    if slack_nick in (dn, rn, un):
        mention = f"\n👋 <@{member['id']}>"
        break
```

최종 Slack 메시지는 이런 형태로 온다:

```
03/31 09:30 👋 @김선생님이 리포트한 피드백이 해결되었습니다.
내용: 출석 체크 화면에서 시간표가 안 보입니다
로그인 계정: teacher01 (T001)

해결 내용:
시간표 쿼리에서 날짜 필터 조건이 빠져 있었습니다. 수정 완료.
링크: https://github.com/.../issues/42
```

![피드백 해결 Slack 알림](/assets/images/posts/050-dev-feedback-widget/slack-notification.png)

리포트한 사람 입장에서는 따로 GitHub에 들어가 확인할 필요 없이, Slack 알림 하나로 "아 고쳐졌구나" 하고 끝난다.

## 전체 흐름

```
사용자가 버그 발견
    |
    v
플로팅 버튼 클릭
    |
    v
Display Media API → 브라우저 탭 캡처
    |
    v
어노테이션 캔버스 (그리기 + 메모)
    |
    v
Submit 클릭
    |
    +→ GitHub Contents API: 스크린샷 파일 커밋
    |
    +→ GitHub Issues API: 이슈 생성 (feedback 라벨)
    |
    v
개발자가 버그 수정 → 이슈 닫기 (코멘트에 해결 내용)
    |
    v
GitHub Actions 트리거 (issues.closed + feedback 라벨)
    |
    v
Python 스크립트: Issue body 파싱 → Slack user lookup
    |
    v
Slack Webhook → 리포터에게 멘션 알림
```

## 컴포넌트 구조

```
DevFeedback/
├── DevFeedbackWidget.tsx   # 상태 머신 (idle → capturing → annotating → submitting)
├── ScreenCapture.ts        # Display Media API 래퍼
├── DrawingCanvas.tsx        # 어노테이션 캔버스 (Pointer Events + Canvas 2D)
├── FeedbackSender.ts        # GitHub API 호출 (스크린샷 업로드 + Issue 생성)
└── types.ts                 # 공유 타입 (DrawingTool, FeedbackPayload, FeedbackContext)
```

한 기능이 다섯 파일로 분리되어 있다. 각 파일이 하나의 책임만 갖고, 서로의 내부 구현을 모른다. `DevFeedbackWidget`이 오케스트레이터 역할을 하면서 나머지를 조합한다.

## 결과

도입 전후가 확연히 다르다.

**도입 전**: "어디서 뭐가 안 된다" → 역추적 질문 3~4회 → 재현 시도 → 수정 → "고쳤습니다" 카톡

**도입 후**: 정확한 스크린샷(URL, 브라우저, 뷰포트 포함) + 어노테이션 + 메모가 GitHub Issue로 자동 생성 → 수정 후 이슈 닫기 → 리포터에게 Slack 알림 자동 전송

개발자가 수동으로 하는 일은 딱 두 개다: 버그를 고치는 것, 이슈를 닫는 것. 나머지 — 맥락 수집, 리포트 정리, 해결 통보 — 는 전부 자동이다.

지금은 개발/테스트 환경에서만 활성화해 두었다. 운영 환경으로 넓힐지는 사용 패턴을 더 보고 결정할 생각이다. 위젯 자체가 React 컴포넌트 하나니까, 나중에 npm 패키지로 분리해서 다른 프로젝트에도 쓸 수 있을 것이다.
