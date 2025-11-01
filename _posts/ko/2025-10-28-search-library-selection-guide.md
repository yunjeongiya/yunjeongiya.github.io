---
layout: post
title: "Fuse.js가 브라우저를 멈추게 했다 - 검색 라이브러리 선택 가이드"
date: 2025-10-28 20:00:00 +0900
categories: [Frontend, Performance]
tags: [검색, Fuse.js, SymSpell, 성능최적화, 클라이언트검색, 서버검색, 아키텍처]
lang: ko
---

## TL;DR

Fuse.js로 fuzzy search 구현했더니 브라우저가 얼어붙었다. Lbox의 SymSpell 사례를 조사하고, 데이터 규모에 맞는 기술 선택의 중요성을 깨달았다. 결론: 우리 규모에서는 es-hangul만으로 충분했다.

---

## 문제 상황: 검색하면 브라우저가 멈춘다

한글 검색 기능을 구현하면서 "오타 허용" 기능을 추가하기 위해 Fuse.js를 도입했다.

```typescript
// Phase 4: Fuse.js로 오타 허용
import Fuse from 'fuse.js';

const fuseInstance = useMemo(() => {
  const allNodes = getAllNodes(templateTree); // 트리 평탄화
  return new Fuse(allNodes, {
    keys: ['title'],
    threshold: 0.3,        // 오타 허용 범위
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}, [templateTree]);

// 검색
const results = fuseInstance.search(query);
```

**결과**:
- "점과 지선" → "점과 직선" 오타 교정 ✅
- **브라우저 프리징 발생** ❌

---

## 원인 분석: 왜 느렸나?

### Fuse.js의 동작 방식

```
사용자 타이핑: "점과" 입력
    ↓ 300ms 디바운싱
    ↓ Fuse.js 검색 시작
    ↓ 전체 트리 평탄화 (getAllNodes) - 100ms
    ↓ Fuse 인덱스 재구축 - 200ms
    ↓ Fuzzy matching (모든 노드) - 300ms
    ↓ React 리렌더링 - 100ms

총 시간: 700ms → UI 블로킹! 🔥
```

### 병목 지점

1. **트리 구조의 복잡성**
   - 단순 리스트가 아니라 중첩된 트리 구조
   - `getAllNodes()` 함수로 평탄화 필요 → 추가 비용

2. **검색마다 전체 스캔**
   - 타이핑할 때마다 모든 노드에 대해 fuzzy matching 계산
   - Bitap 알고리즘: O(n × m) (n=노드 수, m=문자열 길이)

3. **React 리렌더링**
   - 검색 결과 변경 → 트리 컴포넌트 리렌더링
   - Fuse 계산 + React 렌더링이 동시에 발생

---

## 대안 탐색: Lbox의 검색 시스템

문제를 해결하기 위해 대기업 검색 시스템을 조사했다. Lbox(판례 검색 서비스)의 기술 블로그에서 흥미로운 내용을 발견했다:

> "SymSpell 알고리즘을 사용하여 오타 교정을 구현했습니다. 이 알고리즘은 edit distance 기준 '삭제'만을 추가하여 메모리와 검색 속도 면에서 기존 방식보다 훨씬 빠릅니다."

**핵심 질문**:
- SymSpell이 Fuse.js보다 빠른가?
- 우리도 서버 검색으로 전환해야 하나?

---

## SymSpell vs Fuse.js 기술 비교

### 1. 알고리즘 차이

#### Fuse.js: Bitap 알고리즘 (실시간 계산)

```typescript
// 동작 방식
const fuse = new Fuse(allNodes, { threshold: 0.3 });

// 검색할 때마다 매번 계산
fuse.search("점과 지선");
// → 모든 노드에 대해 Levenshtein Distance 계산
// → "점과 직선" (distance=1), "점과 평면" (distance=4) 등
```

**과정**:
```
입력: "점과 지선"
대상: "점과 직선"

1. 문자 하나하나 비교
   점 = 점 ✓
   과 = 과 ✓
   공백 = 공백 ✓
   지 ≠ 직 ✗ (distance +1)
   선 = 선 ✓

2. 최종 distance = 1
3. threshold(0.3) 이하면 매칭
```

**시간 복잡도**: O(n × m)

---

#### SymSpell: 삭제 기반 해싱 (사전 구축)

```typescript
// 동작 방식
const symspell = new SymSpell();

// 초기화 시 한 번만 실행 (마운트 시)
templates.forEach(t => {
  symspell.createDictionaryEntry(t.title, 1);
});
// → "점과 직선" → 미리 오타 후보 생성 및 저장
//   ["점과 직", "점과 선", "점 직선", ...] → "점과 직선"

// 검색 시: O(1) 해시 조회
symspell.lookup("점과 지선", 2);
// → 사전에서 바로 찾음 ✅
```

**초기화 단계** (한 번만):
```
"점과 직선" 입력
→ Edit Distance 2 이내 "삭제" 후보 생성:
  - "점과 직"
  - "점과 선"
  - "점 직선"
  - "과 직선"
  - ...

→ 해시맵에 저장:
  {
    "점과 직": ["점과 직선"],
    "점과 선": ["점과 직선"],
    ...
  }
```

**검색 단계**:
```
"점과 지선" 입력
→ 이것도 삭제 후보 생성:
  - "점과 선" ← 이미 해시맵에 있음!
→ 해시맵["점과 선"] → "점과 직선" 반환 ✅
```

**시간 복잡도**: O(1) (해시 조회)

---

### 2. 성능 비교

| 항목 | Fuse.js | SymSpell | es-hangul (현재) |
|------|---------|----------|-----------------|
| **초기화** | 빠름 (50ms) | 느림 (300ms) | 빠름 (0ms) |
| **검색 속도** | 느림 (300ms) | 매우 빠름 (1ms) | 빠름 (10ms) |
| **메모리** | 높음 (데이터×2) | 중간 (데이터×10) | 낮음 (데이터×1) |
| **번들 크기** | 12KB | 5-8KB | 3KB |
| **오타 허용** | ✅ 완전히 다른 문자 | ✅ 완전히 다른 문자 | ❌ 불완전 타이핑만 |
| **불완전 타이핑** | ❌ | ❌ | ✅ |

---

### 3. 메모리 사용량 비교

#### Fuse.js
```typescript
// 인덱스 구조
{
  keys: ['title'],
  records: [
    { title: "점과 직선의 거리", $: {...} },
    { title: "삼각형의 넓이", $: {...} },
    // ... 전체 노드 복사본
  ],
  norm: 0.6,
  // Bitap 패턴 등...
}
```

**메모리**:
- 원본 데이터 복사 + 인덱스 구조
- 약 12KB 라이브러리 + 데이터 크기 × 2배

---

#### SymSpell
```typescript
// 사전 구조
{
  "점과 직": Set(["점과 직선"]),
  "점과 선": Set(["점과 직선"]),
  "점 직선": Set(["점과 직선"]),
  // ... Edit Distance 2 이내 모든 삭제 조합
}
```

**메모리 계산**:
```
템플릿 1개: "점과 직선" (4글자)
Edit Distance 2 기준

삭제 후보 수:
- ED=1: 4개 (각 글자 1개씩 삭제)
- ED=2: 6개 (2개씩 삭제 조합)
총 10개 엔트리

템플릿 500개 × 평균 10개 = 5000 엔트리
→ 약 100-200KB 메모리
```

---

## 클라이언트 vs 서버 검색 의사결정

### Lbox는 왜 서버 검색을 하는가?

```
클라이언트: "음주" 입력
    ↓ 300ms 디바운싱
    ↓ API 호출 (50ms)
서버: 미리 구축된 FST에서 O(1) 검색
    ↓ 결과 반환 (10ms)
클라이언트: 결과 렌더링

총 시간: 360ms (사용자는 체감 안 함 - 타이핑 중)
```

**Lbox의 특징**:
- **데이터 규모**: 수십만 개 판례 문서
- **검색어 로그**: 매일 수만 건 (패턴 학습 가능)
- **복잡한 처리**: 형태소 분석, 오타 교정, 띄어쓰기
- **ML 모델**: Learning to Rank 적용

**기술 스택**:
- Elasticsearch (분산 검색 엔진)
- FST (Finite State Transducer)
- Airflow (데이터 파이프라인)
- SymSpell (오타 교정)

---

### 우리는 왜 클라이언트 검색을 하는가?

```
클라이언트: "점과" 입력
    ↓ 300ms 디바운싱
    ↓ 정확 매칭 시도 (10ms) → 성공! Early return
    ↓ React 리렌더링 - 20ms

총 시간: 330ms (빠름! ✅)
```

**CheckUS의 특징**:
- **데이터 규모**: 캠퍼스당 수백 개 템플릿
- **검색어 로그**: 없음 (각자 다른 검색어)
- **단순한 처리**: 문자열 매칭만
- **즉각 응답**: 네트워크 지연 없음

**기술 스택**:
- es-hangul (한글 라이브러리, 3KB)
- React 상태 관리
- 메모이제이션 (useMemo, useCallback)

---

### 의사결정 프레임워크

#### 데이터 규모별 가이드

| 데이터 규모 | 권장 방식 | 이유 |
|-----------|----------|------|
| **< 1,000개** | 클라이언트 검색 | 메모리에 모두 로드 가능, 즉각 응답 |
| **1,000 ~ 10,000개** | 클라이언트 + 최적화 | Web Worker, Virtual Scrolling, 인덱싱 |
| **> 10,000개** | 서버 검색 | Elasticsearch, 캐싱, 분산 처리 |

---

#### Trade-off 분석

**클라이언트 검색의 장점**:
- ✅ 즉각 응답 (네트워크 지연 없음)
- ✅ 서버 부담 없음 (API 호출 0건)
- ✅ 오프라인 동작 가능
- ✅ 개발 단순함

**클라이언트 검색의 단점**:
- ❌ 대규모 데이터 처리 어려움
- ❌ 복잡한 검색 기능 제한
- ❌ 사용자 기기 성능 의존

---

**서버 검색의 장점**:
- ✅ 대규모 데이터 처리
- ✅ 강력한 CPU/메모리 활용
- ✅ ML 모델 적용 가능
- ✅ 검색 로그 수집 및 분석

**서버 검색의 단점**:
- ❌ 네트워크 지연 (최소 50ms)
- ❌ 서버 비용 증가
- ❌ API 개발 및 유지보수
- ❌ 오프라인 불가능

---

## 최종 선택: es-hangul의 disassemble만으로 충분

### SymSpell을 도입하지 않은 이유

```typescript
// SymSpell의 장점
✅ 오타 허용: "점과 지선" → "점과 직선"
✅ 빠른 검색: O(1) 해시 조회

// SymSpell의 단점
❌ 초기화 비용: 250ms (템플릿 500개 기준)
❌ 메모리 사용: +200KB
❌ 번들 크기: +5-8KB
❌ 코드 복잡도: 디버깅 어려움
```

### 사용자 요구사항 재검토

**실제로 필요한 기능**:
1. ✅ 띄어쓰기 무시: "점과직선" → "점과 직선"
2. ✅ 불완전 타이핑: "점과 ㅈ" → "점과 직선"
3. ✅ 초성 검색: "ㅈㄱㅈㅅ" → "점과 직선"
4. ✅ 다중 키워드: "점과 직선 공수2"
5. ⚠️ 오타 허용: "점과 지선" → "점과 직선" (빈도 낮음)

**결론**:
- 4개 핵심 기능은 es-hangul만으로 해결됨
- 오타 허용은 **사용자 피드백 후** 재검토
- 성능과 단순성 우선

---

### 최종 구현

```typescript
import { getChoseong, disassemble } from 'es-hangul';

// 자모 분해 매칭 헬퍼 함수 (불완전 타이핑 지원)
const matchesJamo = (text: string, query: string): boolean => {
  try {
    const textDisassembled = disassemble(text).replace(/\s+/g, '');
    const queryDisassembled = disassemble(query).replace(/\s+/g, '');
    return textDisassembled.includes(queryDisassembled);
  } catch (e) {
    return false;
  }
};

// 4단계 우선순위 검색
const isNodeMatched = (node: TaskTemplate, query: string): boolean => {
  const normalizedTitle = node.title.toLowerCase().replace(/\s+/g, '');
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');

  // 1순위: 띄어쓰기 무시 정확 매칭 (빠름)
  if (normalizedTitle.includes(normalizedQuery)) {
    return true;
  }

  // 2순위: 자모 분해 매칭 (불완전 타이핑)
  if (matchesJamo(node.title, query)) {
    return true;
  }

  // 3순위: 초성 검색
  if (getChoseong(node.title).includes(query)) {
    return true;
  }

  // 4순위: 다중 키워드 AND 검색
  const keywords = query.trim().split(/\s+/);
  if (keywords.length > 1) {
    return keywords.every(kw => {
      const kwNormalized = kw.replace(/\s+/g, '');
      return normalizedTitle.includes(kwNormalized)
             || getChoseong(node.title).includes(kw);
    });
  }

  return false;
};
```

**성능**:
```
평균 검색 시간: 10ms (1순위에서 대부분 매칭)
번들 크기: 3KB (es-hangul)
메모리 사용: 원본 데이터와 동일
```

---

## 배운 점

### 1. 라이브러리 선택의 함정

**잘못된 사고**:
```
Fuse.js = Fuzzy Search = 오타 허용 = 좋은 UX
→ 무조건 도입!
```

**올바른 사고**:
```
1. 사용자가 정말 오타를 많이 내는가?
2. 데이터 규모는 얼마나 되는가?
3. 성능 영향은 어느 정도인가?
4. 더 간단한 대안은 없는가?

→ 상황에 맞는 선택!
```

---

### 2. 규모에 맞는 기술 선택

**대기업 솔루션 ≠ 우리에게 최적**

| 규모 | 적절한 기술 |
|------|-----------|
| 수백 개 | 클라이언트 검색 (es-hangul) |
| 수천 개 | 클라이언트 + 최적화 (Web Worker) |
| 수만 개 | 서버 검색 (Elasticsearch) |

**Lbox의 기술이 좋다고 해서 우리도 따라하면 안 된다.**

---

### 3. 성능 vs 기능의 균형

```
Fuse.js: 기능 ✅, 성능 ❌
SymSpell: 기능 ✅, 성능 ✅, 복잡도 ⚠️
es-hangul: 기능 ⚠️, 성능 ✅, 복잡도 ✅

→ 우리 규모에서는 es-hangul이 최적
```

---

### 4. 데이터 기반 의사결정

**가정에서 시작하지 말고, 데이터로 검증**:

```typescript
// 가정: "사용자가 오타를 많이 낼 것이다"
// 검증: 검색 실패율, 사용자 피드백 수집

// Phase 1: es-hangul만 배포
// → 1개월 후 검색 실패율 3%

// Phase 2: 피드백 분석
// → "오타" 관련 불만 5건 미만

// 결론: SymSpell 불필요
```

---

## 결론

프론트엔드 검색 구현 시 고려사항:

1. **데이터 규모 먼저 파악하기**
   - 1,000개 미만: 클라이언트 검색
   - 10,000개 이상: 서버 검색

2. **사용자 요구사항의 우선순위 정하기**
   - 필수 기능 vs 선택 기능
   - 빈도 높은 문제부터 해결

3. **성능 측정 후 최적화하기**
   - 추측하지 말고 프로파일링
   - 병목 지점 찾아서 해결

4. **단순함 유지하기**
   - 복잡한 솔루션은 유지보수 비용 증가
   - 필요할 때만 추가

**기술은 문제를 해결하는 도구일 뿐, 목적이 아니다.**

---

## 참고 자료

- [Lbox - 검색 시스템 톺아보기](https://medium.com/lbox-team/검색-시스템-톺아보기-1-검색어-자동완성과-오타-교정-기능-bf93fffa5485)
- [SymSpell: 1000x Faster Spelling Correction](https://wolfgarbe.medium.com/1000x-faster-spelling-correction-algorithm-2012-8701fcd87a5f)
- [Fuse.js Documentation](https://fusejs.io/)
- [es-hangul GitHub](https://github.com/toss/es-hangul)
- [SymSpell vs BK-tree Performance Comparison](https://medium.com/data-science/symspell-vs-bk-tree-100x-faster-fuzzy-string-search-spell-checking-c4f10d80a078)
