# Blog Development Log

> **yunjeongiya.github.io** - VSCode 스타일 기술 블로그

## 📌 프로젝트 개요

- **URL**: https://yunjeongiya.github.io
- **테마**: VSCode Dark+ 완전 재현
- **스택**: Jekyll 4.3, GitHub Pages
- **폰트**: D2Coding (한글 모노스페이스)
- **댓글**: Utterances (GitHub Issues 기반)

## 🎨 디자인 컨셉

**완벽한 VSCode 재현**을 목표로, 실제 VSCode 레이아웃과 동일하게 구현:

```
┌─────────────────────────────────────────────────────────────────┐
│ Title Bar (파일명 표시)                                           │
├───┬──────────┬─────────────────────────────────┬─────────────────┤
│ A │          │ Tab Bar (활성 탭)                 │  Outline       │
│ c │ Explorer │ ─────────────────────────────── │  (H2, H3)      │
│ t │          │                                 │                 │
│ i │ Recent   │ Editor (본문 내용)               │ ────────────── │
│ v │ Posts    │                                 │                 │
│ i │          │                                 │  Minimap       │
│ t │ Category │                                 │  (미리보기)     │
│ y │          │                                 │                 │
├───┴──────────┴─────────────────────────────────┴─────────────────┤
│ Terminal Panel (TAGS / COMMENTS)                                │
├─────────────────────────────────────────────────────────────────┤
│ Status Bar (Jekyll | Markdown | Terminal | UTF-8 | Posts)      │
└─────────────────────────────────────────────────────────────────┘
```

## 🏗️ 주요 구조

### 파일 구조
```
yunjeongiya.github.io/
├── _layouts/
│   ├── default.html          # 메인 레이아웃 (VSCode UI)
│   ├── home.html              # 홈 페이지
│   ├── post.html              # 포스트 페이지
│   ├── page.html              # 일반 페이지
│   └── category.html          # 카테고리 템플릿
├── _posts/
│   └── ko/                    # 한글 포스트
│       └── 2025-09-30-jackson-localdatetime-timezone-fix.md
├── assets/
│   └── css/
│       ├── vscode-exact.css   # VSCode 스타일 (메인)
│       └── fixes.css          # 레이아웃 수정
├── categories.html            # 카테고리 목록
├── search.html                # 실시간 검색
├── settings.html              # 설정 페이지
├── about.md                   # About
├── index.md                   # 홈
└── _config.yml                # Jekyll 설정
```

### 레이아웃 컴포넌트

#### 1. Activity Bar (맨 왼쪽, 48px)
- **Explorer** (📁) → 홈 페이지
- **Search** (🔍) → `/search/` 검색
- **Source Control** (🌿) → GitHub 저장소
- **Settings** (⚙️) → `/settings/` 설정

#### 2. Side Bar (250px)
- **NAVIGATION**: Home, About, All Categories
- **RECENT POSTS**: 최근 글 5개
- **CATEGORIES**: 카테고리별 글 개수

#### 3. Editor (중앙)
- 탭 바 + 본문
- 스크롤 가능
- D2Coding 폰트 적용

#### 4. Right Panel (250px, 포스트만)
- **Outline (40%)**: H2/H3 헤딩, 클릭 시 스크롤
- **Minimap (60%)**: 텍스트 미리보기

#### 5. Terminal Panel (250px, 포스트만)
- **TAGS**: 태그 목록
- **COMMENTS**: 터미널 스타일 댓글

#### 6. Status Bar (22px)
- 왼쪽: Jekyll, Markdown, Terminal 토글
- 오른쪽: UTF-8, 포스트 개수

## 🎨 VSCode 색상 팔레트

```css
--activity-bar-bg: #333333      /* Activity Bar 배경 */
--sidebar-bg: #252526           /* 사이드바 배경 */
--editor-bg: #1e1e1e            /* 에디터 배경 */
--titlebar-bg: #3c3c3c          /* 타이틀바 배경 */
--tab-bg: #2d2d2d               /* 탭 배경 */
--tab-active-bg: #1e1e1e        /* 활성 탭 */
--statusbar-bg: #007acc         /* 상태바 (파란색) */

--text-primary: #cccccc         /* 기본 텍스트 */
--text-secondary: #969696       /* 보조 텍스트 */
--border-color: #1e1e1e         /* 테두리 */

--keyword: #569cd6              /* 키워드 (파란색) */
--string: #ce9178               /* 문자열 (주황색) */
--function: #dcdcaa             /* 함수명 (노란색) */
--comment: #6a9955              /* 주석 (초록색) */
--variable: #9cdcfe             /* 변수 (하늘색) */
```

## 🔧 주요 기능

### 1. 터미널 스타일 댓글
```
user@blog:~/comments$ git comment --post="포스트 제목"
█ (깜빡이는 커서)

# GitHub 계정으로 댓글을 남길 수 있습니다
$ Loading comments from GitHub Issues...

[utterances iframe]
```

### 2. 실시간 검색 (`/search/`)
- JavaScript 기반 클라이언트 검색
- 제목, 본문, 카테고리, 태그 검색
- 타이핑 즉시 결과 표시

### 3. 설정 페이지 (`/settings/`)
- 폰트 크기 조절 (12-18px)
- localStorage로 저장
- 블로그 정보 표시
- Quick Links (GitHub, About, RSS)

### 4. Outline & Minimap
- **Outline**: H2/H3 자동 추출, 클릭 스크롤
- **Minimap**: 글 전체 미리보기 (5000자)

### 5. Terminal Panel 토글
- Status Bar에서 "Terminal" 클릭 → 숨김/표시
- 진짜 VSCode 처럼!

## 📝 블로그 글 작성 가이드

### 새 글 작성
```bash
# 파일 위치
_posts/ko/YYYY-MM-DD-title.md

# Front Matter
---
layout: post
title: "글 제목"
date: 2025-09-30 17:30:00 +0900
categories: [Spring Boot, Jackson]
tags: [spring-boot, jackson, timezone]
lang: ko
---

## 내용...
```

### 자동 생성되는 것들
- **Outline**: H2, H3 헤딩 자동 추출
- **Minimap**: 본문 텍스트 자동 로드
- **Comments**: utterances 자동 로드
- **Tags**: Front Matter의 tags 자동 표시

## 🐛 해결한 주요 문제들

### 1. D2Coding 폰트 403 에러
**문제**: `wan2land` CDN이 403으로 차단
**해결**: `projectnoonnu` CDN으로 변경
```css
@font-face {
  font-family: 'D2Coding';
  src: url('https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_three@1.0/D2Coding.woff');
  font-display: swap;
}
```

### 2. 본문 스크롤 안 됨
**문제**: Terminal Panel 추가 후 본문 고정
**해결**:
```css
.vscode-editor {
  overflow-y: auto !important;
}
.vscode-main {
  min-height: 0;
}
```

### 3. 우측 패널 안 보임
**해결**:
```css
.vscode-right-panel {
  display: flex !important;
  flex-shrink: 0;
}
```

### 4. 굴림체로 표시
**해결**:
```css
.post-content,
.post-content p,
.post-content li {
  font-family: 'D2Coding', monospace !important;
}
```

## 🚀 배포 방법

### 로컬 테스트
```bash
cd yunjeongiya.github.io
bundle install
bundle exec jekyll serve

# http://localhost:4000
```

### GitHub Pages 배포
```bash
git add .
git commit -m "커밋 메시지"
git push

# 자동으로 GitHub Pages 빌드
# 1-2분 후 https://yunjeongiya.github.io 반영
```

### GitHub Pages 설정
- **Settings** → **Pages**
- **Source**: Deploy from a branch
- **Branch**: main, / (root)

## 🔗 중요 링크

- **블로그**: https://yunjeongiya.github.io
- **저장소**: https://github.com/yunjeongiya/yunjeongiya.github.io
- **첫 글**: LocalDateTime Timezone Fix

## 💡 다음 개선 아이디어

### 단기
- [ ] 카테고리 클릭 시 필터링
- [ ] 태그 클릭 시 관련 글 표시
- [ ] 사이드바 뷰 전환 (Explorer/Search 토글)

### 중기
- [ ] 다크/라이트 테마 전환
- [ ] 영어 블로그 글 작성
- [ ] RSS 구독자 표시

### 장기
- [ ] 방문자 통계
- [ ] 포스트 추천 시스템
- [ ] 시리즈 글 기능

## 📚 기술 스택 상세

- **Jekyll**: 4.3.0
- **Theme**: Custom (VSCode-inspired)
- **Font**: D2Coding (Korean monospace)
- **Icons**: @vscode/codicons 0.0.35
- **Comments**: Utterances (GitHub Issues)
- **Hosting**: GitHub Pages
- **CDN**: jsDelivr (fonts, icons)

## 🎯 핵심 파일들

### 반드시 알아야 할 파일
1. **_layouts/default.html** - 전체 레이아웃 (수정 빈도 높음)
2. **assets/css/vscode-exact.css** - 모든 스타일
3. **_config.yml** - Jekyll 설정

### 건드리지 말 것
- `.gitignore`
- `Gemfile.lock`
- `_site/` (자동 생성)

## 🔍 디버깅 팁

### 빌드 에러
```bash
bundle exec jekyll build --trace
```

### 캐시 문제
```bash
# 브라우저: Ctrl+Shift+R (하드 리프레시)
# 또는 시크릿 모드
```

### 폰트 안 보임
- 콘솔에서 403 에러 확인
- `vscode-exact.css`의 CDN URL 확인

### 레이아웃 깨짐
- `min-height: 0` 확인
- `overflow` 속성 확인
- Flex 설정 확인

## 📞 Contact

궁금한 점이나 개선 사항은 GitHub Issues에 등록해주세요!

---

**마지막 업데이트**: 2025-10-01
**작성자**: YJ
**Version**: 1.0.0 (VSCode Theme Complete)
