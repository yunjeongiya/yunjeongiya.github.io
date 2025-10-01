# YJ's Dev Blog

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-success)](https://yunjeongiya.github.io)

기술 블로그 | Tech Blog

## 🌐 다국어 지원

- **한글**: [https://yunjeongiya.github.io](https://yunjeongiya.github.io)
- **English**: [https://yunjeongiya.github.io/en](https://yunjeongiya.github.io/en)

## 🚀 빠른 시작

### 1. 의존성 설치

```bash
# Ruby가 설치되어 있어야 합니다
gem install bundler
bundle install
```

### 2. 로컬 서버 실행

```bash
bundle exec jekyll serve
```

브라우저에서 `http://localhost:4000` 접속

### 3. 새 글 작성

#### 한글 포스트
```bash
# _posts/ko/ 폴더에 생성
# 파일명 형식: YYYY-MM-DD-title.md
_posts/ko/2025-10-01-my-post.md
```

#### 영어 포스트
```bash
# _posts/en/ 폴더에 생성
_posts/en/2025-10-01-my-post.md
```

#### Front Matter 템플릿

```yaml
---
layout: post
title: "포스트 제목"
date: 2025-10-01 17:30:00 +0900
categories: [Category1, Category2]
tags: [tag1, tag2, tag3]
lang: ko  # 또는 en
---

포스트 내용...
```

## 📦 프로젝트 구조

```
yunjeongiya.github.io/
├── _config.yml           # Jekyll 설정
├── _posts/
│   ├── ko/              # 한글 포스트
│   └── en/              # 영어 포스트
├── _layouts/            # 레이아웃 템플릿
├── _includes/           # 재사용 가능한 컴포넌트
├── index.md             # 한글 홈페이지
├── en.md                # 영어 홈페이지
├── Gemfile              # Ruby 의존성
└── README.md            # 이 파일

```

## 🌍 GitHub Pages 배포

### 첫 배포

```bash
# 1. GitHub에 yunjeongiya.github.io 저장소 생성

# 2. 로컬 저장소와 연결
git remote add origin https://github.com/yunjeongiya/yunjeongiya.github.io.git

# 3. 첫 커밋 및 푸시
git add .
git commit -m "Initial blog setup with multi-language support"
git push -u origin main
```

### GitHub Pages 활성화

1. GitHub 저장소 → **Settings** 탭
2. 왼쪽 메뉴에서 **Pages** 클릭
3. **Source**: `Deploy from a branch`
4. **Branch**: `main` 선택, 폴더는 `/ (root)` 선택
5. **Save** 클릭

약 1-2분 후 `https://yunjeongiya.github.io`에서 확인 가능!

### 새 글 배포

```bash
# 1. 새 포스트 작성 (_posts/ko/ 또는 _posts/en/)

# 2. 로컬에서 확인
bundle exec jekyll serve

# 3. Git에 커밋 및 푸시
git add .
git commit -m "Add new post: [포스트 제목]"
git push

# 자동으로 GitHub Pages에 배포됩니다!
```

## 🎨 테마 커스터마이징

현재 **Minima** 테마를 사용 중입니다.

### 색상/폰트 변경
`_sass/minima/custom-styles.scss` 파일 생성 후 CSS 추가

### 레이아웃 변경
`_layouts/` 폴더에 커스텀 레이아웃 추가

## 📝 작성 팁

### 코드 블록

\```java
public class Example {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
\```

### 이미지 추가

```markdown
![이미지 설명](/assets/images/image.png)
```

### 링크

```markdown
[링크 텍스트](https://example.com)
```

## 🔧 문제 해결

### Jekyll 서버 실행 안 됨
```bash
# Gemfile.lock 삭제 후 재설치
rm Gemfile.lock
bundle install
bundle exec jekyll serve
```

### 한글 깨짐
- 모든 .md 파일을 UTF-8 인코딩으로 저장해야 합니다

### GitHub Pages 빌드 실패
- GitHub 저장소 → **Actions** 탭에서 에러 로그 확인
- `_config.yml`의 `url`과 `baseurl` 확인

## 📚 참고 자료

- [Jekyll 공식 문서](https://jekyllrb.com/)
- [GitHub Pages 가이드](https://docs.github.com/en/pages)
- [Minima 테마](https://github.com/jekyll/minima)

## 📄 라이선스

MIT License

---

**작성일**: 2025-10-01
**기술 스택**: Jekyll 4.3, GitHub Pages, Minima Theme
