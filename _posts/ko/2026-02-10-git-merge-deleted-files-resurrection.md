---
layout: post
title: "Git 머지할 때 삭제한 파일이 되살아나는 이유"
date: 2026-02-10 14:00:00 +0900
categories: [Development, Git]
tags: [git, merge, conflict, three-way-merge, merge-base, rebase]
lang: ko
slug: "033"
thumbnail: /assets/images/posts/033-git-merge-deleted-files/thumbnail-ko.png
---

## 문제 상황: "main에 아무것도 안 건드렸는데...?"

오늘 PR을 만들려다 이상한 상황을 겪었다.

```
main 브랜치에 직접 커밋한 적 없음
dev 브랜치에서만 작업
```

그런데 `main`을 `dev`로 머지하니까 **63개 파일에서 충돌**이 났다. 그것도 내가 **삭제한 파일들이 되살아나려고** 했다.

```bash
Changes to be committed:
    new file:   src/.../AssignedStudyTime.java
    new file:   src/.../AssignedStudyTimeService.java
```

분명히 `dev` 브랜치에서 깔끔하게 삭제한 파일들인데, 머지하니까 다시 추가되려고 한다. 왜?

## Three-Way Merge의 함정

Git은 머지할 때 **세 개의 시점**을 비교한다:

1. **Merge Base**: 두 브랜치가 갈라진 공통 조상
2. **Ours**: 현재 브랜치 (dev)
3. **Theirs**: 머지할 브랜치 (main)

![Three-way merge 다이어그램](/assets/images/posts/033-git-merge-deleted-files/three-way-merge.png)

문제는 Git이 **중간 히스토리를 보지 않는다**는 점이다.

Git은 오직 세 시점의 **최종 상태**만 비교한다:

| 시점 | 파일 상태 | Git의 해석 |
|------|----------|-----------|
| Merge Base (A) | 존재함 | "이게 시작점이야" |
| dev (Ours) | 삭제됨 | "이 사람은 삭제를 원해" |
| main (Theirs) | 존재함 | "이 브랜치는 아직 필요해/가지고 있어" |
| **결과** | **충돌** | "삭제가 의도적인지, main에 누락된 수정이 있는지 확신할 수 없어" |

## 왜 "main에 커밋 없음"인데 문제가 되나?

핵심은 **main이 언제 마지막으로 dev와 동기화됐는지**다.

### 시나리오

```
PR #195 머지 (1주 전)
         ↓
main:  --A--B--C (PR #195 시점 상태 유지)
              \
dev:           D--E--F--G--H (파일 삭제 포함)
                          ↑
                      현재 dev
```

- **main**: PR #195 이후 "커밋 없음" (맞음)
- 하지만 **main의 상태는 1주 전**에 고정됨
- 그 사이 dev에서 삭제한 파일들이 **main에는 아직 존재**

### Recursive Merge 전략의 함정

브랜치 히스토리가 복잡하면 (예: dev를 main에 머지하고, 다시 main을 다른 브랜치로 머지하는 경우), Git이 선택하는 "Merge Base"가 예상과 다를 수 있다.

> **참고**: main에서 분기점 이후 파일에 작은 수정이라도 있으면 (메타데이터 변경 포함), dev에서 삭제해도 "삭제 vs 수정" 충돌이 발생한다. Git은 main의 "작업"을 잃고 싶지 않기 때문이다.

### 결과

```bash
git merge origin/main
# → main에 있는 파일들이 "새로 추가"되려고 함
```

main에 직접 커밋이 없어도, **오래된 상태**가 머지 시 문제를 일으킨다.

## Git이 파일 삭제를 자동 처리하는 경우 vs 아닌 경우

| 시나리오 | 결과 |
|----------|------|
| dev 삭제, main 변경 없음 | 자동 삭제 유지 |
| dev 삭제, main 수정 | 충돌 (delete/modify) |
| dev 삭제, main에도 삭제 | 자동 삭제 유지 |
| 브랜치 크게 분기 + 복잡한 히스토리 | 예측 불가 |

오늘 내 경우는 마지막 케이스였다. 분기가 너무 오래되고, 중간에 많은 변경이 있어서 Git이 자동 판단하지 못했다.

## 해결 방법

### 1. `-Xours` 전략으로 자동 해결 (추천)

충돌 시 dev(우리 것)가 항상 이기도록 설정:

```bash
# "충돌 나면 우리 버전(dev)을 자동으로 선택해"
git merge origin/main -Xours
```

삭제든 수정이든, dev의 상태가 최종 결과가 된다.

### 2. 머지 중 삭제 파일 수동 제거

```bash
# 스테이징에서 제거 (실제 파일도 삭제됨)
git rm --cached src/.../AssignedStudyTime.java

# 머지 커밋 완료
git commit -m "Merge main into dev - keep deletions"
```

### 3. "우리 것" 선택 (충돌 파일 전체)

```bash
# dev 브랜치의 상태 유지
git checkout --ours src/.../AssignedStudyTime.java
git add .
```

### 4. 자주 머지하기 (예방)

```bash
# 매주 main을 dev로 머지
git fetch origin
git merge origin/main
```

분기가 길어지면 머지 지옥. **자주 동기화**하는 게 답이다.

## 대안: Rebase로 문제 회피하기

머지 대신 **리베이스**를 사용하면 이 문제를 피할 수 있다.

### Merge vs Rebase

| 특성 | Git Merge | Git Rebase |
|------|-----------|------------|
| 히스토리 | 그대로 보존 (복잡함) | 깔끔한 직선 (정리됨) |
| 충돌 처리 | 한 번에 큰 "머지 충돌" | 커밋별로 순차 처리 |
| 삭제된 파일 | 종종 "부활"함 | 의도대로 삭제 유지 |

### Rebase가 작동하는 이유

```
Before Rebase:
          (여기서 파일 삭제)
dev:       D -- E -- F
          /
main:  A -- B -- C (파일 아직 존재)

After Rebase (git rebase main):
main:  A -- B -- C
                  \
dev:               D' -- E' -- F'
```

리베이스는 dev의 커밋들을 main의 최신 상태 위에 다시 적용한다. 삭제 커밋(D)이 main(C) 위에서 실행되니까, 파일이 존재하는 상태에서 삭제가 이루어진다. Three-way 비교 없이 "의도"가 그대로 반영된다.

### 리베이스 방법

```bash
# 1. main 최신화
git checkout main
git pull origin main

# 2. dev로 돌아가서
git checkout dev

# 3. main 위로 리베이스
git rebase main
```

> ⚠️ **리베이스 황금 규칙**: 이미 공유 저장소에 푸시한 브랜치는 리베이스하지 말 것! 히스토리가 재작성되어 팀원들에게 문제가 생긴다. 로컬 피처 브랜치에서만 사용하자.

## 핵심 정리

1. **Git은 상태 머신이지, 역사책이 아니다**: 세 시점의 결과만 보고, 그 과정은 신경 안 쓴다
2. **오래된 브랜치는 위험하다**: main에 새 커밋이 없어도 문제가 된다. "오래됨" 자체가 문제
3. **"삭제 vs 수정" 함정**: main이 분기 이후 파일을 건드렸으면, Git은 삭제를 의심한다
4. **리베이스는 대안이다**: 직선 히스토리로 이 문제를 회피할 수 있다

---

## 참고 자료

- [Git Advanced Merging](https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging)
- [Resolve modify/delete merge conflicts](https://4sysops.com/archives/resolve-modifydelete-merge-conflicts-in-git/)
