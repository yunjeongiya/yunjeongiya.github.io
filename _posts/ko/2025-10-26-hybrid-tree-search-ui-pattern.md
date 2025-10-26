---
layout: post
title: "트리 검색 UI, 필터링만이 답일까? - 검색 결과와 전체 맥락을 동시에 보여주는 하이브리드 패턴"
date: 2025-10-26 14:30:00 +0900
categories: [Frontend, React]
tags: [React, UI/UX, 트리구조, 검색, useRef, scrollIntoView, 사용자경험]
lang: ko
---

## TL;DR

232KB짜리 CSV에서 불러온 수백 개 템플릿 트리, 검색 기능 추가하면서 "검색 결과만 보여줄까? 전체 트리를 보여줄까?" 고민했다. 최종적으로 둘 다 보여주는 **하이브리드 패턴**으로 해결. React useRef Map으로 재귀 트리에서 DOM 찾고, scrollIntoView로 부드럽게 이동시키는 과정을 다룬다.

---

## 배경: 검색 없이는 못 쓰겠더라

교육 관리 시스템에서 교사가 학생에게 과제를 할당할 때, 우측 패널에 수백 개의 템플릿이 트리 구조로 나열된다.

```
고등
├─ 공통수학1
│  ├─ LV1
│  │  ├─ 001강. 다항식의 연산
│  │  ├─ 002강. 나머지정리와 인수분해
│  │  ├─ ... (50개 이상)
│  └─ LV2
│     ├─ 001강. 복소수와 방정식
│     └─ ... (50개 이상)
└─ 공통수학2
   └─ ... (계속)
```

문제는 명확했다:
- 트리가 너무 커서 원하는 항목 찾기 어려움
- 폴더를 하나하나 펼쳐야 함
- "002강 나머지정리" 찾으려면 계속 스크롤

검색 기능을 추가하기로 했다.

---

## 고민: 세 가지 패턴, 어떤 걸 선택할까?

### Pattern 1: 필터링된 트리

첫 번째로 생각한 건 "매칭되는 노드 + 부모 경로만 보여주기"였다.

```typescript
// 검색어와 매칭되는 노드만 필터링
const filteredTree = filterTreeByQuery(tree, searchQuery);
```

**장점:**
- 검색 결과만 집중해서 볼 수 있음
- 구현이 간단함

**단점:**
- **주변 항목의 맥락을 잃어버림**
- "LV1의 002강" 바로 다음에 뭐가 있는지 알 수 없음
- 비슷한 제목의 항목들을 비교하기 어려움

사용자 피드백: "002강을 찾긴 했는데, 003강도 같이 보고 싶은데 다시 검색해야 하네?"

---

### Pattern 2: 하이라이트 패턴

<div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
  <div style="flex: 1; min-width: 300px;">

두 번째로 시도한 건 "전체 트리를 유지하되, 검색 결과를 하이라이트"하는 방식이다.

```typescript
// 전체 트리 유지 + 매칭 노드 하이라이트
const highlightMatchingNodes = (node: TreeNode, query: string) => {
  return node.title.includes(query);
};
```

**장점:**
- 트리 전체 맥락 유지
- 주변 항목들도 함께 볼 수 있음

**단점:**
- **검색 결과가 많으면 찾기 어려움**
- 스크롤하며 하이라이트된 항목을 일일이 확인해야 함
- 검색 결과가 몇 개인지 한눈에 파악 불가

사용자 피드백: "노란색으로 표시는 되는데, 이게 전체 몇 개인지 모르겠고 찾기 힘들어"

  </div>
  <div style="flex: 0 0 300px;">
    <img src="/assets/images/posts/2025-10-26-hybrid-tree-search/before.png" alt="하이라이트 패턴" style="width: 100%; max-width: 300px;">
    <p style="text-align: center; margin-top: 10px;"><em>Pattern 2: 전체 트리에서 검색 결과를 하이라이트</em></p>
  </div>
</div>

---

### Pattern 3: 하이브리드 패턴 (최종 선택)

<div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
  <div style="flex: 1; min-width: 300px;">

그래서 생각한 게 "검색 결과 리스트 + 전체 트리"를 동시에 보여주는 방식이다. 상단에는 검색된 템플릿 목록을 표시하고, 하단에는 전체 트리 구조를 유지하면서 검색된 항목을 하이라이트하는 방식이다.

**장점:**
- 검색 결과를 빠르게 스캔할 수 있음 (상단 리스트)
- 트리 전체 맥락도 유지됨 (하단 트리)
- "트리에서 보기" 버튼으로 원하는 위치로 바로 점프
- 검색 결과 개수를 명확히 표시

**사용자 피드백:** "이게 훨씬 낫네! 리스트에서 빠르게 보고, 위치도 바로 확인할 수 있어"

  </div>
  <div style="flex: 0 0 300px;">
    <img src="/assets/images/posts/2025-10-26-hybrid-tree-search/after.png" alt="하이브리드 패턴" style="width: 100%; max-width: 300px;">
    <p style="text-align: center; margin-top: 10px;"><em>Pattern 3 (Hybrid): 검색 결과 리스트(상단) + 전체 트리(하단)</em></p>
  </div>
</div>

---

## 구현: React useRef로 동적 DOM 참조 관리

하이브리드 패턴에서 핵심은 "트리에서 보기" 버튼이다. 검색 결과에서 항목을 클릭하면, 아래 트리에서 해당 위치로 스크롤하고 하이라이트해야 한다.

### 문제: 재귀적 트리 구조에서 DOM 요소 찾기

트리는 재귀 컴포넌트로 구현되어 있다:

```typescript
const TaskNode: React.FC<TaskNodeProps> = ({ node, level }) => {
  return (
    <div>
      <div>{node.title}</div>
      {node.children?.map(child => (
        <TaskNode key={child.id} node={child} level={level + 1} />
      ))}
    </div>
  );
};
```

여기서 특정 노드의 DOM 요소를 어떻게 참조할까? `document.querySelector`? 너무 느리고 불안정하다.

### 해결: useRef + Map

**아이디어:** 각 노드가 렌더링될 때 자신의 DOM 요소를 Map에 등록하게 만들자.

```typescript
// 1. 노드 ID → DOM 요소 매핑을 위한 Map
const nodeRefs = useRef<Map<number, HTMLDivElement>>(new Map());

// 2. 재귀 컴포넌트의 각 노드에 ref callback 추가
<div
  ref={(el) => {
    if (el) {
      nodeRefs.current.set(node.id, el);
    }
  }}
  className={`tree-node ${isHighlighted ? 'highlight' : ''}`}
>
  {node.title}
</div>
```

이제 `nodeRefs.current.get(nodeId)`로 어떤 노드든 DOM 요소를 바로 가져올 수 있다.

### "트리에서 보기" 구현

```typescript
const showNodeInTree = useCallback((nodeId: number) => {
  // 1. 부모 폴더들을 찾아서 펼치기
  const nodesToExpand = new Set<number>();
  findAndExpandParents(templateTree, nodeId, nodesToExpand);
  setExpandedNodes(prev => new Set([...prev, ...nodesToExpand]));

  // 2. DOM 업데이트 대기 후 스크롤
  setTimeout(() => {
    const nodeElement = nodeRefs.current.get(nodeId);
    if (nodeElement) {
      nodeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }

    // 3. 하이라이트 적용 (2초)
    setHighlightedNodeId(nodeId);
    setTimeout(() => setHighlightedNodeId(null), 2000);
  }, 100);
}, [templateTree]);
```

**핵심 포인트:**

1. **폴더 펼치기 먼저**: 타겟 노드가 보이게 만들기
2. **100ms 대기**: React 상태 업데이트 → DOM 반영 시간 필요
3. **scrollIntoView**: 부드러운 스크롤
4. **2초 하이라이트**: 사용자가 어디로 이동했는지 명확히 인지

### setTimeout이 필요한 이유

```typescript
// ❌ 이렇게 하면 스크롤 안 됨
setExpandedNodes(newNodes);
nodeElement.scrollIntoView();  // 폴더가 아직 안 펼쳐져서 요소가 숨겨진 상태

// ✅ DOM 업데이트를 기다려야 함
setExpandedNodes(newNodes);
setTimeout(() => {
  nodeElement.scrollIntoView();  // 이제 요소가 보임
}, 100);
```

React는 상태를 비동기로 업데이트한다. `setExpandedNodes`를 호출해도 DOM은 즉시 바뀌지 않는다. 다음 렌더링 사이클을 기다려야 한다.

---

## 버그: 검색어가 사라지는 문제

초기 구현에서는 "트리에서 보기" 버튼을 누르면 검색어가 사라졌다.

```typescript
// ❌ 초기 구현
const showNodeInTree = useCallback((nodeId: number) => {
  setExpandedNodes(/* ... */);
  setSearchQuery('');  // 검색창 비우기 - 나쁜 아이디어!
  // ...
});
```

**의도:** 검색 모드를 종료하고 트리 전체를 보여주기

**문제:** 사용자가 다시 검색 결과를 보고 싶으면? 검색어를 다시 입력해야 함.

**해결:** `setSearchQuery('')` 제거. 검색 결과를 유지하면서 트리 위치로 이동.

```typescript
// ✅ 개선된 구현
const showNodeInTree = useCallback((nodeId: number) => {
  setExpandedNodes(/* ... */);
  // 검색어는 그대로 유지!
  // ...
});
```

이제 사용자는:
1. 검색 결과 리스트를 보고
2. "트리에서 보기" 버튼으로 트리 위치 확인
3. 다시 검색 결과 리스트로 돌아와서 다른 항목 선택

이 플로우를 자연스럽게 반복할 수 있다.

---

## 결과

### 측정 가능한 개선

- **검색 결과 리스트:** 평균 3~5개 항목만 표시 (전체 200개 중)
- **스크롤 거리 감소:** 10+ 스크롤 → 검색 1회 + 클릭 1회
- **트리 맥락 유지:** 전체 구조를 보며 탐색 가능

### 사용자 피드백

- "002강을 찾고, 바로 옆의 003강도 확인할 수 있어서 좋다"
- "검색 결과가 사라지지 않아서 여러 항목을 비교하기 편하다"
- "트리가 자동으로 펼쳐지고 스크롤되니까 위치를 놓치지 않는다"

---

## 정리

### 1. 검색 UI는 필터링만이 답이 아니다

필터링된 검색 결과는 깔끔하지만, 대규모 계층 구조에서는 맥락을 잃는다. 하이브리드 패턴으로 "빠른 접근 + 전체 맥락"을 동시에 제공할 수 있다.

### 2. useRef Map 패턴은 재귀 구조에 유용하다

재귀 컴포넌트에서 특정 노드의 DOM 참조가 필요할 때:
- ref callback으로 각 노드가 스스로 등록
- Map으로 O(1) 조회
- querySelector보다 안전하고 빠름

### 3. DOM 타이밍 이슈는 setTimeout으로 해결

React 상태 업데이트 후 DOM 반영까지는 시간이 걸린다. `scrollIntoView` 같은 DOM 조작은 `setTimeout`으로 한 틱 미루는 게 안전하다.

### 4. UX 디테일이 중요하다

- 검색어 유지 vs 제거 - 작은 차이 같지만 사용성에 큰 영향
- 2초 하이라이트 - 시각적 피드백으로 사용자가 현재 위치를 바로 인지
- 부드러운 스크롤 - 갑작스러운 화면 이동을 방지

---

## 주의할 점

### 1. 메모리 관리

`nodeRefs` Map이 계속 커질 수 있다. 컴포넌트 언마운트 시 정리:

```typescript
useEffect(() => {
  return () => {
    nodeRefs.current.clear();
  };
}, []);
```

### 2. 대규모 트리 성능

수천 개 노드가 있다면:
- 가상 스크롤 (react-window, react-virtualized) 고려
- 검색 결과 페이지네이션
- Debounce로 검색 입력 최적화

### 3. 접근성 (Accessibility)

- 키보드 내비게이션 지원 (Arrow keys, Enter)
- ARIA 속성 추가 (`role="tree"`, `aria-expanded`)
- 스크린 리더 사용자를 위한 대체 텍스트

---

## 참고 자료

- [MDN - Element.scrollIntoView()](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView)
- [React Hooks: useRef](https://react.dev/reference/react/useRef)
- [WAI-ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

---

**다음 단계:**
- Fuzzy search 알고리즘 적용 (예: "나머지" → "나머지정리" 매칭)
- 최근 검색어 저장 기능
- 즐겨찾기 템플릿 기능
