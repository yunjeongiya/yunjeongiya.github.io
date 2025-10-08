# CLAUDE.md - Blog Project Guide

> Claude Code가 이 블로그 프로젝트를 작업할 때 참고하는 가이드

## 🎯 프로젝트 정체성

**yunjeongiya.github.io** - VSCode Dark+ 테마를 완벽하게 재현한 기술 블로그

- **목표**: 실제 VSCode처럼 보이고 작동하는 블로그
- **특징**: Activity Bar, Sidebar, Editor, Right Panel, Terminal Panel 모두 구현
- **스택**: Jekyll + GitHub Pages + D2Coding 폰트 + Utterances 댓글

## 📖 필수 문서

작업 전 **반드시** 읽어야 할 문서:
- `BLOG_DEVELOPMENT.md` - 전체 프로젝트 구조, 기능, 해결한 문제들

## 🏗️ 핵심 구조 (빠른 참고)

```
Activity Bar (48px) | Sidebar (250px) | Editor (flex) | Right Panel (250px)
                                       ─────────────────
                                       Terminal Panel (250px)
                                       ─────────────────
                                       Status Bar (22px)
```

## 📁 주요 파일 위치

### 수정 빈도 높음
- `_layouts/default.html` - 전체 레이아웃 (VSCode UI 구조)
- `assets/css/vscode-exact.css` - 모든 스타일링
- `_posts/ko/YYYY-MM-DD-title.md` - 블로그 포스트

### 기능별 파일
- `search.html` - 실시간 검색 페이지
- `settings.html` - 설정 페이지 (폰트 크기 조절 등)
- `categories.html` - 카테고리 목록
- `about.md` - About 페이지

### 건드리지 말 것
- `.gitignore`
- `Gemfile.lock`
- `_site/` (자동 생성 폴더)
- `*.backup`, `*.old` 파일들

## 🎨 VSCode 색상 (자주 사용)

```css
--editor-bg: #1e1e1e          /* 에디터 배경 */
--sidebar-bg: #252526         /* 사이드바 배경 */
--activity-bar-active: #007acc /* 파란색 강조 */
--text-primary: #cccccc       /* 기본 텍스트 */
--keyword: #569cd6            /* 키워드 파란색 */
--string: #ce9178             /* 문자열 주황색 */
--comment: #6a9955            /* 주석 초록색 */
```

## 🚨 자주 발생하는 문제

### 1. 폰트 굴림체로 보임
**원인**: D2Coding 폰트 로드 실패
**해결**: `vscode-exact.css`에서 CDN URL 확인
```css
/* 현재 사용 중인 CDN */
url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_three@1.0/D2Coding.woff')
```

### 2. 스크롤 안 됨
**원인**: flex 컨테이너 높이 문제
**해결**: `overflow-y: auto`, `min-height: 0` 확인

### 3. 우측 패널 안 보임
**원인**: display 속성 문제
**해결**: `.vscode-right-panel { display: flex !important; }`

### 4. Terminal 패널 높이 이상함
**원인**: flex-shrink 문제
**해결**: `flex-shrink: 0` 추가

## 🔧 작업 규칙

### DO ✅
- **상대 경로 사용**: `./filename.md` (Claude Code 버그 우회)
- **D2Coding 폰트 유지**: `!important` 플래그로 강제 적용
- **VSCode 스타일 준수**: 색상, 레이아웃 일관성 유지
- **반응형 고려**: 1200px 미만에서는 Right Panel 숨김
- **Git 커밋**: 의미있는 단위로 커밋

### DON'T ❌
- **절대 경로 사용 금지**: `C:/Users/...` 경로는 Edit 도구 에러 발생
- **기존 .backup 파일 삭제 금지**: 롤백 가능성 보존
- **폰트 CDN 함부로 변경 금지**: 403 에러 재발 가능
- **레이아웃 구조 변경 시 신중**: flex 레이아웃은 복잡하게 연결됨

## 📝 블로그 글 작성

### Front Matter 템플릿
```yaml
---
layout: post
title: "글 제목"
date: 2025-10-01 17:30:00 +0900
categories: [Spring Boot, Jackson]
tags: [spring-boot, jackson, localdatetime, timezone]
lang: ko
---
```

### 자동 생성되는 것
- **Outline**: H2, H3 헤딩 자동 추출 → 우측 패널
- **Minimap**: 본문 텍스트 5000자 → 우측 패널
- **Tags**: Front Matter tags → Terminal Panel
- **Comments**: utterances 자동 로드 → Terminal Panel

## 🚀 배포

### 로컬 테스트
```bash
cd yunjeongiya.github.io
bundle exec jekyll serve
# http://localhost:4000
```

### GitHub Pages 배포
```bash
git add .
git commit -m "메시지"
git push
# 1-2분 후 자동 배포
```

### 배포 확인
- URL: https://yunjeongiya.github.io
- GitHub Actions 탭에서 빌드 상태 확인
- 에러 시: Settings → Pages에서 상태 체크

## 💡 개선 작업 시 체크리스트

### 스타일 수정
- [ ] `vscode-exact.css` 수정
- [ ] 브라우저에서 개발자 도구로 확인
- [ ] 반응형 (모바일) 확인
- [ ] D2Coding 폰트 유지 확인

### 레이아웃 수정
- [ ] `_layouts/default.html` 수정
- [ ] Liquid 템플릿 문법 확인
- [ ] flex 레이아웃 깨지지 않는지 확인
- [ ] 스크롤 작동 확인

### 새 기능 추가
- [ ] 관련 HTML 페이지 생성
- [ ] CSS 스타일 추가
- [ ] Activity Bar나 Sidebar에 링크 추가
- [ ] 모바일 반응형 고려

### 커밋 전
- [ ] `bundle exec jekyll serve`로 로컬 테스트
- [ ] 브라우저 콘솔 에러 없는지 확인
- [ ] 폰트, 아이콘 로드 확인 (403 에러 없는지)
- [ ] 커밋 메시지 명확하게 작성

## 🎯 현재 기능 목록

### Activity Bar (왼쪽 아이콘)
- ✅ Explorer → 홈
- ✅ Search → `/search/` 실시간 검색
- ✅ Source Control → GitHub 저장소
- ✅ Settings → `/settings/` 설정 페이지

### Sidebar (네비게이션)
- ✅ NAVIGATION: Home, About, All Categories
- ✅ RECENT POSTS: 최근 글 5개
- ✅ CATEGORIES: 카테고리별 글 개수

### Editor (본문)
- ✅ 탭 바 (파일명 표시)
- ✅ D2Coding 폰트
- ✅ 스크롤 가능
- ✅ 마크다운 렌더링

### Right Panel (우측, 포스트만)
- ✅ Outline: H2/H3 헤딩, 클릭 스크롤
- ✅ Minimap: 텍스트 미리보기

### Terminal Panel (하단, 포스트만)
- ✅ TAGS 탭: 태그 목록
- ✅ COMMENTS 탭: 터미널 스타일 utterances 댓글
- ✅ Status Bar에서 토글 가능

### Status Bar
- ✅ Jekyll, Markdown 표시
- ✅ Terminal 토글 버튼
- ✅ UTF-8, 포스트 개수

### 페이지
- ✅ 홈 (`/`)
- ✅ About (`/about/`)
- ✅ Categories (`/categories/`)
- ✅ Search (`/search/`)
- ✅ Settings (`/settings/`)

## 🔮 다음 개선 아이디어

### 우선순위 높음
- [ ] 카테고리 클릭 시 필터링 기능
- [ ] 태그 클릭 시 관련 글 표시
- [ ] 사이드바 뷰 전환 (Explorer ↔ Search)

### 우선순위 중간
- [ ] 다크/라이트 테마 전환
- [ ] 영어 블로그 글 작성
- [ ] 포스트 시리즈 기능

### 우선순위 낮음
- [ ] 방문자 통계
- [ ] 포스트 추천 시스템
- [ ] RSS 구독자 표시

## 🆘 문제 발생 시

1. **BLOG_DEVELOPMENT.md** 참고
2. **Git history** 확인 (`git log --oneline`)
3. **브라우저 콘솔** 에러 메시지 확인
4. **Jekyll 빌드 에러**: `bundle exec jekyll build --trace`
5. **캐시 문제**: 브라우저 하드 리프레시 (Ctrl+Shift+R)

## 📞 중요 링크

- **블로그**: https://yunjeongiya.github.io
- **저장소**: https://github.com/yunjeongiya/yunjeongiya.github.io
- **Issues**: GitHub Issues 탭
- **Actions**: GitHub Actions 탭 (빌드 상태)

---

**마지막 업데이트**: 2025-10-01
**Claude Code Version**: 최신 VSCode 테마 완성
**다음 작업 추천**: 카테고리/태그 필터링 기능 추가
