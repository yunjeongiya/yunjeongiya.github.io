---
layout: post
title: "React 앱이 브라우저 확장 프로그램 때문에 크래시되는 이유와 해결법"
date: 2026-04-13 14:00:00 +0900
categories: [Frontend]
tags: [React, DOM, Browser Extension, Production, TypeScript]
lang: ko
slug: "052"
thumbnail: /assets/images/posts/052-react-insertbefore-crash/thumbnail.png
published: true
---

![React insertBefore crash](/assets/images/posts/052-react-insertbefore-crash/thumbnail.png)

## 프로덕션에서 만난 간헐적 크래시

프로덕션 React 앱에서 간헐적으로 이런 에러를 만난 적이 있는가?

```
Uncaught DOMException: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
```

사용자가 보고하면 "재시도하면 됩니다"로 넘기기 쉽지만, ErrorBoundary가 전체 앱을 crash시키면 사용자 경험은 치명적이다. 이 글에서는 이 에러의 근본 원인과 프로덕션에서 검증된 두 가지 해결법을 다룬다.

## 증상

학원 관리 시스템의 스터디 모니터링 페이지에서 간헐적으로 앱 전체가 crash되는 보고가 들어왔다. 특징은 다음과 같았다:

- **간헐적** — 항상 재현되지 않음
- **재시도 시 정상** — 페이지 새로고침하면 문제 없음
- **특정 브라우저** — Microsoft Edge (Chromium 146) 사용자에게서만 보고
- **Sentry에 기록 없음** — ErrorBoundary가 잡았지만 Sentry에는 올라오지 않음

그리고 모니터링 페이지 코드는 최근 변경이 없었다. 변한 건 사용자의 **브라우저 버전**이었다.

## 원인 분석

### React의 DOM 관리 방식

React는 Virtual DOM과 실제 DOM 사이의 **1:1 매핑**을 전제로 동작한다. 컴포넌트가 리렌더링되면 React는 이전 Virtual DOM과 새 Virtual DOM을 비교(reconciliation)하고, 차이가 있는 부분만 실제 DOM에 반영한다.

이때 DOM 노드의 삽입/이동/제거에 `insertBefore`, `removeChild` 같은 네이티브 DOM API를 사용한다. React는 내부적으로 각 DOM 노드의 부모-자식 관계를 추적하고 있으며, 이 관계가 실제 DOM과 일치한다고 **가정**한다.

### 브라우저 확장 프로그램의 개입

문제는 브라우저 확장 프로그램이 React가 모르는 사이에 DOM을 수정한다는 것이다:

1. **번역 확장 프로그램** (Google Translate, Edge 내장 번역기) — 텍스트 노드를 번역된 텍스트로 교체
2. **광고 차단기** — DOM 노드를 삭제하거나 숨김
3. **접근성 도구** — 텍스트 노드에 ARIA 속성 추가
4. **Grammarly 같은 입력 도구** — 텍스트 노드를 감싸는 wrapper 추가

이렇게 외부에서 DOM이 수정되면:

```
React가 아는 DOM 구조:
  <div>            ← parent
    <span>A</span>  ← referenceNode
    <span>B</span>

실제 DOM 구조 (확장 프로그램이 수정한 후):
  <div>            ← parent
    <font>         ← 확장 프로그램이 삽입한 wrapper
      <span>A</span>  ← referenceNode (이제 parent의 직접 자식이 아님!)
    </font>
    <span>B</span>
```

React가 `parent.insertBefore(newNode, referenceNode)`를 호출하면, `referenceNode`가 더 이상 `parent`의 직접 자식이 아니므로 `DOMException`이 발생한다.

### 왜 React 팀은 안 고치나?

이 문제는 [facebook/react#11538](https://github.com/facebook/react/issues/11538)로 **2017년**부터 보고되어 있다. React 팀의 입장은:

> "React는 자신이 관리하는 DOM 트리를 외부에서 수정하지 않을 것을 전제로 설계되었다. 브라우저 확장의 DOM 수정은 React의 책임 범위 밖이다."

합리적인 입장이지만, 프로덕션 앱 운영자 입장에서는 사용자의 브라우저 확장을 통제할 수 없으므로 방어 코드가 필요하다.

## 해결법

### 1. DOM 메서드 방어 패치 (Primary Fix)

앱 진입점(`main.tsx`)에서 `Node.prototype.insertBefore`와 `removeChild`를 패치한다:

```typescript
// main.tsx — React 앱 마운트 전에 실행
if (typeof Node === 'function' && Node.prototype) {
  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      // 참조 노드가 이 노드의 자식이 아님
      // — 확장 프로그램이 DOM을 수정한 것. crash 대신 조용히 무시
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };
}
```

**핵심**: `referenceNode.parentNode !== this` 체크로 부모-자식 관계가 깨진 경우를 감지하고, 예외를 던지는 대신 no-op으로 처리한다.

**부작용은?** React의 다음 렌더링 사이클에서 Virtual DOM과 실제 DOM이 다시 동기화되므로, 일시적인 UI 불일치가 있을 수 있지만 crash보다 훨씬 낫다.

### 2. 조건부 렌더링을 CSS로 전환 (Secondary Fix)

`insertBefore`가 호출되는 주요 원인 중 하나는 **조건부 렌더링**이다:

{% raw %}
```tsx
// Before: 조건부 렌더링 — React가 DOM 노드를 삽입/제거함
{currentTimePosition !== null && (
  <div className="time-indicator" style={{ left: `${position}px` }} />
)}
```
{% endraw %}

이 패턴에서 `currentTimePosition`이 `null` ↔ 값 사이를 오갈 때마다 React는 `insertBefore`로 노드를 삽입하거나 `removeChild`로 제거한다.

CSS 기반으로 전환하면 DOM 삽입/제거 자체가 사라진다:

{% raw %}
```tsx
// After: 항상 렌더링, CSS로 숨김 — DOM 구조가 안정적
<div
  className="time-indicator"
  style={{
    left: `${(currentTimePosition ?? 0) / 100 * TIMELINE_WIDTH}px`,
    display: currentTimePosition !== null ? undefined : 'none'
  }}
/>
```
{% endraw %}

모든 조건부 렌더링을 CSS로 바꿀 필요는 없다. `insertBefore` crash가 실제로 발생하는 지점, 특히 **빈번하게 업데이트되는 동적 컨텐츠 내부의 조건부 요소**에만 적용하면 된다.

## 적용하지 않은 대안들

### ErrorBoundary 세분화

페이지 단위로 ErrorBoundary를 추가하여 crash 범위를 줄이는 방법도 있다. 하지만 이건 **증상 완화**이지 원인 해결이 아니다. 사용자는 여전히 에러 화면을 보게 된다.

### `suppressHydrationWarning`

SSR 환경에서 hydration 불일치를 무시하는 React 속성이다. 이 케이스는 CSR이므로 해당 없음.

## 결과

- 방어 패치 적용 후 동일 증상 **재발 없음**
- 전체 앱에 적용되므로 다른 페이지에서도 동일한 종류의 crash 방지
- 성능 영향 **없음** — 단순 조건 체크 한 줄 추가

## 교훈

1. **코드가 안 바뀌어도 버그는 생긴다** — 브라우저 업데이트, 확장 프로그램 업데이트, OS 업데이트 등 외부 요인으로 기존 코드가 깨질 수 있다
2. **간헐적 crash는 환경 요인을 의심하라** — 재현 불가 + 특정 브라우저 조합이면 확장 프로그램이 유력 용의자
3. **React의 DOM 독점 가정은 프로덕션에서 깨진다** — 실제 사용자 환경에는 React가 통제할 수 없는 DOM 수정이 존재한다
4. **9년 된 미해결 이슈도 있다** — 프레임워크가 안 고치면 앱에서 방어해야 한다

## References

- [facebook/react#11538](https://github.com/facebook/react/issues/11538) — 2017년부터 열린 이슈
- [React Reconciliation](https://react.dev/learn/preserving-and-resetting-state) — React의 DOM 관리 방식
- [Chrome Extensions and the DOM](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) — 확장 프로그램이 DOM을 수정하는 방식
