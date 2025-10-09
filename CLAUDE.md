# CLAUDE.md - 작업 가이드

> VSCode Dark+ 테마 재현 블로그 | Jekyll + GitHub Pages

## 📁 핵심 파일

- `_layouts/default.html` - 전체 레이아웃
- `assets/css/vscode-exact.css` - 모든 스타일
- `_posts/ko/YYYY-MM-DD-title.md` - 블로그 글

## 🚨 트러블슈팅

| 문제 | 해결 |
|------|------|
| 폰트 굴림체 | D2Coding CDN 확인: `fastly.jsdelivr.net/gh/projectnoonnu/...` |
| 스크롤 안됨 | `overflow-y: auto`, `min-height: 0` |
| 우측 패널 안보임 | `display: flex !important` |
| Terminal 높이 | `flex-shrink: 0` |

## 🔧 작업 규칙

**DO**: 상대경로 사용, D2Coding 폰트 유지 (`!important`), VSCode 스타일 준수, 반응형 고려(1200px)
**DON'T**: 절대경로 사용 금지, `.backup` 파일 삭제 금지, 폰트 CDN 변경 금지, flex 레이아웃 신중히 변경

## 📝 새 글 작성

```yaml
---
layout: post
title: "글 제목"
date: 2025-10-01 17:30:00 +0900
categories: [Category1, Category2]
tags: [tag1, tag2, tag3]
lang: ko
---
```

**자동 생성**: Outline(H2/H3), Minimap(5000자), Tags, Comments(utterances)

## 🚀 배포

```bash
bundle exec jekyll serve  # 로컬: localhost:4000
git add . && git commit -m "msg" && git push  # 배포: 1-2분 후 반영
```

## 🔮 TODO (우선순위순)

- [ ] 카테고리/태그 클릭 시 필터링
- [ ] 사이드바 뷰 전환 (Explorer ↔ Search)
- [ ] 다크/라이트 테마 전환
- [ ] 영어 블로그, 포스트 시리즈

## 📞 링크

**블로그**: https://yunjeongiya.github.io
**상세 문서**: `BLOG_DEVELOPMENT.md` (필요시 참고)
