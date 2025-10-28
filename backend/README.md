# Git-style Terminal Comment System

VSCode Dark+ 테마 블로그를 위한 Git 스타일 댓글 시스템입니다.

## 🎯 기능

- **Git 명령어 스타일** 댓글 작성/수정/삭제
- **터미널 UI** - VSCode 터미널과 동일한 디자인
- **비밀번호 선택** - 수정/삭제 원하면 비밀번호 설정
- **답글 지원** - `git commit --fixup=<hash>` 로 답글 작성
- **로컬 인증** - localStorage에 비밀번호 저장으로 편리한 UX

## 📦 기술 스택

### Backend
- **Vercel Serverless Functions** (Node.js/TypeScript)
- **Vercel KV** (Redis)
- **bcryptjs** (비밀번호 해싱)

### Frontend
- **Vanilla JavaScript** (ES6 Modules)
- **VSCode Dark+ Theme** CSS

## 🚀 배포 가이드

### 1. Vercel KV 설정

1. [Vercel Dashboard](https://vercel.com/dashboard)로 이동
2. Storage 탭에서 "Create Database" 클릭
3. **KV (Redis)** 선택
4. 데이터베이스 이름 입력 후 생성
5. 생성된 KV를 프로젝트에 연결

### 2. Vercel 배포

```bash
# 1. backend 폴더로 이동
cd backend

# 2. 의존성 설치
npm install

# 3. Vercel CLI 설치 (없으면)
npm i -g vercel

# 4. Vercel 로그인
vercel login

# 5. 프로젝트 배포
vercel

# 6. 프로덕션 배포
vercel --prod
```

### 3. KV 연결 (자동)

Vercel 대시보드에서 KV를 프로젝트에 연결하면 환경변수가 자동으로 설정됩니다:

- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

### 4. 블로그 통합

`_layouts/post.html` 에 추가:

```html
<!-- Comments Section -->
<div class="terminal-section">
  <div class="terminal-tab">
    <span>TERMINAL - Comments</span>
  </div>
  <div id="git-comments"></div>
</div>

<!-- Scripts -->
<script type="module">
  import { GitTerminal } from '/assets/js/git-terminal.js';

  const postId = '{{ page.id }}'; // Jekyll post ID
  const apiUrl = 'https://your-vercel-app.vercel.app';

  new GitTerminal('git-comments', postId, apiUrl);
</script>
```

## 📖 사용법

### 댓글 조회
```bash
git log                 # 전체 댓글 목록
git log --oneline       # 간단한 목록
git show <hash>         # 특정 댓글 상세
```

### 댓글 작성
```bash
git commit -m "멋진 글이네요!"
git commit --author="홍길동" -m "좋은 글 감사합니다!"
git commit --author="홍길동" --password="1234" -m "수정 가능한 댓글"
```

### 대화형 작성
```bash
git commit
Author: 홍길동
Password (optional): ****
Message: 멋진 블로그네요!
```

### 답글
```bash
git commit --fixup=a3f8e2b1 -m "답글입니다!"
```

### 수정/삭제
```bash
git rebase -i a3f8e2b1      # 수정
git reset --hard a3f8e2b1   # 삭제
```

### 설정
```bash
git config user.name "홍길동"    # 기본 닉네임 설정
git config --get user.name       # 현재 설정 조회
git reflog                       # 내가 쓴 댓글 목록
```

### 도움말
```bash
help
git --help
```

## 🔧 개발

### 로컬 테스트

```bash
# 의존성 설치
npm install

# Vercel KV 연결 (로컬)
# 1. Vercel 대시보드에서 .env.local 다운로드
# 2. backend/ 폴더에 .env.local 배치

# Vercel 개발 서버 실행
vercel dev
```

API는 `http://localhost:3000/api/comments` 에서 실행됩니다.

### 데이터 구조 (Redis)

```
# 댓글 목록 (List)
comments:{post_id} → [hash1, hash2, hash3, ...]

# 댓글 데이터 (Hash)
comment:{hash} → {
  id: "a3f8e2b1",
  commit_hash: "a3f8e2b1",
  post_id: "my-blog-post",
  author: "홍길동",
  message: "멋진 글이네요!",
  parent_hash: null,
  created_at: "2025-10-26T14:30:00Z"
}

# 비밀번호 (String)
password:{hash} → "$2a$10$..."
```

### API 엔드포인트

#### GET /api/comments?post_id=xxx
댓글 목록 조회

**Response:**
```json
{
  "commits": [
    {
      "hash": "a3f8e2b1",
      "author": "홍길동",
      "date": "2025-10-26T14:30:00Z",
      "message": "멋진 글이네요!",
      "replies": []
    }
  ]
}
```

#### POST /api/comments
댓글 작성

**Request:**
```json
{
  "post_id": "my-blog-post",
  "author": "홍길동",
  "password": "1234",
  "message": "좋은 글 감사합니다!",
  "parent_hash": null
}
```

**Response:**
```json
{
  "commit_hash": "a3f8e2b1",
  "author": "홍길동",
  "message": "[comment a3f8e2b1] 좋은 글 감사합니다!"
}
```

#### PUT /api/comments
댓글 수정

**Request:**
```json
{
  "commit_hash": "a3f8e2b1",
  "password": "1234",
  "message": "수정된 댓글입니다!"
}
```

#### DELETE /api/comments
댓글 삭제

**Request:**
```json
{
  "commit_hash": "a3f8e2b1",
  "password": "1234"
}
```

## 🎨 커스터마이징

### 색상 변경
`assets/css/vscode-exact.css` 에서 VSCode 색상 변수 수정:

```css
:root {
  --editor-bg: #1e1e1e;
  --text-primary: #cccccc;
  --keyword: #569cd6;
  /* ... */
}
```

### 명령어 추가
`assets/js/git-parser.js` 에서 파서 확장

### API 로직 수정
`backend/api/comments.ts` 에서 비즈니스 로직 수정

## 📝 라이선스

MIT

## 🤝 기여

이슈와 PR 환영합니다!

## 📞 문의

- Blog: https://yunjeongiya.github.io
- GitHub: https://github.com/yunjeongiya/yunjeongiya.github.io

---

## 🔍 Vercel KV vs Supabase 비교

| 항목 | Vercel KV ⭐ | Supabase |
|------|------------|----------|
| **타입** | Redis | PostgreSQL |
| **설정** | 2분 (클릭 몇 번) | 10분 (SQL 실행) |
| **속도** | 매우 빠름 | 보통 |
| **무료 한도** | 256MB, 30K 명령/월 | 500MB DB |
| **Vercel 통합** | 완벽 (자동) | 수동 |
| **복잡한 쿼리** | 불가능 | 가능 |

**Vercel KV 선택 이유:**
- 블로그 댓글은 간단한 CRUD만 필요
- Vercel과 완벽 통합
- 설정 초간단
- 속도 빠름
