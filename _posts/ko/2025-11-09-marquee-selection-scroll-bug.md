---
layout: post
title: "마퀴 선택 스크롤 버그: 5번 삽질 끝에 깨달은 좌표계의 진실"
date: 2025-11-09 17:00:00 +0900
categories: [Frontend, Debug]
tags: [javascript, css, scroll, coordinates, debugging]
lang: ko
---

## TL;DR
마퀴 선택하면서 스크롤하니까 선택 영역이 엉망진창. clientY랑 scrollTop 섞어 쓰지 말고, 처음부터 문서 좌표로 통일하자. position: absolute는 문서 좌표 그대로 쓰면 된다.

---

## 마퀴 선택이 스크롤하면 깨지는 이상한 버그

할일 템플릿 목록에서 여러 개를 한 번에 선택하는 기능 만들고 있었다. 마우스로 드래그해서 네모 영역 안의 항목들을 선택하는 거, 윈도우 탐색기에서 파일 선택할 때 그거 말이다.

근데 스크롤하면서 선택하니까 이상한 일이 벌어졌다:
- 마퀴 박스가 스크롤 따라 안 내려옴
- 선택 영역이 끊김
- 마지막 화면에 보이는 것만 선택됨

"아 이거 금방 고치겠네" 싶었는데... 5번이나 다시 짰다. 😭

---

## 1차 시도: "스크롤 오프셋 더하면 되겠지?"

첫 번째 생각은 단순했다. 스크롤한 만큼 더해주면 되는 거 아냐?

```javascript
// 마퀴 영역 계산할 때 스크롤 더하기
const rect = {
  left: Math.min(startX, currentX) + scrollLeft,
  top: Math.min(startY, currentY) + scrollTop,
  // ...
};
```

결과: 여전히 마퀴 박스가 끊긴다. 뭔가 근본적으로 잘못됐다.

---

## 2차 시도: "자동 스크롤 넣으면 해결될걸?"

마우스가 컨테이너 가장자리로 가면 자동으로 스크롤되게 했다.

```javascript
const edgeThreshold = 50;
const scrollSpeed = 10;

if (mouseY < containerTop + edgeThreshold) {
  container.scrollBy(0, -scrollSpeed); // 위로 스크롤
}
```

자동 스크롤은 잘 되는데, 마퀴 박스가 여전히 이상하다. 스크롤할 때마다 시작점이 튀어다닌다.

---

## 3차 시도: "문서 좌표계로 바꿔보자"

여기서 깨달았다. 화면 좌표(clientX/Y)랑 문서 좌표를 섞어 쓰고 있었구나!

```javascript
// 마퀴 시작할 때 초기 스크롤 위치 저장
startScrollX: container.scrollLeft,
startScrollY: container.scrollTop,

// 시작점을 문서 좌표로 변환
startDocX: startX - containerLeft + startScrollX,
startDocY: startY - containerTop + startScrollY,

// 현재 점도 문서 좌표로
currentDocX: currentX - containerLeft + currentScrollLeft,
currentDocY: currentY - containerTop + currentScrollTop,
```

선택은 이제 제대로 되는데... 마퀴 박스가 화면에 고정돼서 안 움직인다?

---

## 4차 시도: "마우스 위치를 컨테이너 안으로 제한"

마우스가 컨테이너 밖으로 나가면 문제가 생기나 싶어서 clamp 처리했다.

```javascript
const clampedX = Math.max(containerLeft, Math.min(currentX, containerRight));
const clampedY = Math.max(containerTop, Math.min(currentY, containerBottom));
```

별 효과 없었다. 문제는 다른 데 있었다.

---

## 5차 시도: "아... position: absolute가 이미 문서 좌표구나"

드디어 깨달았다.

```javascript
// 이전: 문서 좌표를 뷰포트 좌표로 변환하려고 헛짓거리
const style = {
  left: docX - currentScrollLeft,  // ❌ 왜 빼지?
  top: docY - currentScrollTop,     // ❌ 이것도 왜?
};

// 수정: 그냥 문서 좌표 쓰면 됨
const style = {
  left: docX,  // ✅ 이게 답이었어
  top: docY,   // ✅
};
```

**position: absolute는 스크롤 컨테이너 안에서 문서 좌표를 그대로 쓴다!**

브라우저가 알아서 스크롤 위치를 반영해서 그려준다. 내가 괜히 빼고 더하고 난리쳤던 거다.

---

## 최종 해결책

```javascript
// 1. 시작할 때 초기 스크롤 위치 저장
const startScrollX = container.scrollLeft;
const startScrollY = container.scrollTop;

// 2. 모든 좌표를 문서 좌표로 계산
const startDocX = startX - containerRect.left + startScrollX;
const currentDocX = currentX - containerRect.left + currentScrollLeft;

// 3. 마퀴 박스 스타일은 문서 좌표 그대로
return {
  position: 'absolute',
  left: Math.min(startDocX, currentDocX),
  top: Math.min(startDocY, currentDocY),
  width: Math.abs(currentDocX - startDocX),
  height: Math.abs(currentDocY - startDocY),
};
```

이게 전부다. 복잡하게 생각할 필요 없었다.

---

## 배운 점

### 1. 좌표계를 명확히 구분하자

- **화면 좌표 (clientX/Y)**: 브라우저 뷰포트 기준
- **문서 좌표**: 스크롤 포함한 전체 문서 기준
- 섞어 쓰면 100% 버그 발생

### 2. position: absolute의 동작 원리

```html
<div style="position: relative; overflow: auto;">  <!-- 스크롤 컨테이너 -->
  <div style="position: absolute; left: 100px; top: 500px;">
    <!-- 이 div는 스크롤된 콘텐츠 기준 100, 500 위치 -->
    <!-- 브라우저가 알아서 스크롤 반영해서 그림 -->
  </div>
</div>
```

### 3. 디버깅은 단계적으로

5번의 시도 과정:
1. 증상 파악 (마퀴 박스 끊김)
2. 가설 1: 스크롤 오프셋 문제 → 실패
3. 가설 2: 자동 스크롤 없어서 → 부분 해결
4. 가설 3: 좌표계 혼용 → 핵심 발견!
5. 가설 4: 마우스 위치 문제 → 관련 없음
6. 가설 5: CSS 이해 부족 → 정답!

---

## 실제 동작

이제 완벽하게 작동한다:
- ✅ 스크롤하면서 드래그 → 마퀴 박스가 부드럽게 따라옴
- ✅ 컨테이너 밖으로 드래그 → 자동 스크롤 + 선택 영역 확장
- ✅ 수백 개 항목도 한 번에 선택 가능

---

## 결론

복잡해 보이는 버그도 대부분 기본 개념을 제대로 이해 못해서 생긴다.

position: absolute가 어떻게 동작하는지 정확히 알았다면 5번이나 삽질할 필요 없었다. MDN 문서 한 번 더 읽을 걸... 🤦‍♂️

**교훈: 좌표계 섞어 쓰지 말자. 처음부터 끝까지 하나로 통일.**