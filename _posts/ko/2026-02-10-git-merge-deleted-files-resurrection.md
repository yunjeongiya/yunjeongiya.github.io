---
layout: post
title: "Git 머지할 때 삭제한 파일이 되살아나는 이유"
date: 2026-02-10 14:00:00 +0900
categories: [Development, Git]
tags: [git, merge, conflict, three-way-merge, merge-base]
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

| 시점 | AssignedStudyTime.java |
|------|------------------------|
| Merge Base (A) | 존재함 |
| dev (현재) | 삭제됨 |
| main (머지 대상) | 존재함 |

Git의 판단: "dev는 삭제, main은 유지... 충돌!"

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

### 1. 머지 중 삭제 파일 제거

```bash
# 스테이징에서 제거 (실제 파일도 삭제됨)
git rm --cached src/.../AssignedStudyTime.java

# 머지 커밋 완료
git commit -m "Merge main into dev - keep deletions"
```

### 2. "우리 것" 선택 (충돌 파일 전체)

```bash
# dev 브랜치의 상태 유지
git checkout --ours src/.../AssignedStudyTime.java
git add .
```

### 3. 자주 머지하기 (예방)

```bash
# 매주 main을 dev로 머지
git fetch origin
git merge origin/main
```

분기가 길어지면 머지 지옥. **자주 동기화**하는 게 답이다.

## 배운 점

1. **"커밋 없음" ≠ "문제 없음"**: main에 커밋이 없어도 오래된 상태 자체가 문제
2. **Three-way merge는 중간 히스토리를 무시**: 최종 상태만 비교
3. **브랜치 분기 최소화**: 오래 분기할수록 머지 복잡도 증가
4. **삭제한 파일은 명시적으로 처리**: `git rm --cached`로 확실히 제거

---

## 참고 자료

- [Git Advanced Merging](https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging)
- [Resolve modify/delete merge conflicts](https://4sysops.com/archives/resolve-modifydelete-merge-conflicts-in-git/)
