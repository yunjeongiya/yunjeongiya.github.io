# Git 댓글 시스템 파일 구조

## 📁 전체 구조

```
yunjeongiya.github.io/
├── backend/                       # Vercel Serverless Backend
│   ├── api/
│   │   └── comments.ts           # 댓글 API (GET/POST/PUT/DELETE)
│   ├── lib/
│   │   ├── kv.ts                 # Vercel KV (Redis) 유틸리티
│   │   └── auth.ts               # 비밀번호 해싱/검증
│   ├── types/
│   │   └── index.ts              # TypeScript 타입 정의
│   ├── package.json              # 의존성 (@vercel/kv, bcryptjs)
│   ├── tsconfig.json             # TypeScript 설정
│   ├── vercel.json               # Vercel 배포 설정
│   ├── .gitignore
│   ├── .env.example              # 환경변수 예시
│   ├── README.md                 # 상세 문서
│   └── QUICKSTART.md             # 빠른 시작 가이드
│
├── assets/
│   ├── js/
│   │   ├── git-terminal.js       # 터미널 UI 메인 컴포넌트
│   │   ├── git-parser.js         # Git 명령어 파서
│   │   ├── git-api.js            # API 클라이언트
│   │   └── git-help.js           # Help 문서
│   └── css/
│       └── vscode-exact.css      # Git 터미널 CSS 추가됨
│
└── _layouts/
    └── post.html                 # 포스트 레이아웃 (통합 필요)
```

---

## 🔧 Backend 파일 상세

### `backend/api/comments.ts`
- **역할**: 댓글 CRUD API 엔드포인트
- **엔드포인트**:
  - `GET /api/comments?post_id=xxx` - 댓글 목록
  - `POST /api/comments` - 댓글 작성
  - `PUT /api/comments` - 댓글 수정
  - `DELETE /api/comments` - 댓글 삭제
- **의존성**: `kv.ts`, `auth.ts`, `types/index.ts`

### `backend/lib/kv.ts`
- **역할**: Vercel KV (Redis) 데이터 처리
- **주요 함수**:
  - `getComments(postId)` - 댓글 목록 조회
  - `createComment(...)` - 댓글 생성
  - `updateComment(hash, message)` - 댓글 수정
  - `deleteComment(postId, hash)` - 댓글 삭제
  - `generateCommitHash()` - 8자리 해시 생성

### `backend/lib/auth.ts`
- **역할**: 비밀번호 해싱 및 검증
- **주요 함수**:
  - `hashPassword(password)` - bcrypt 해싱
  - `verifyPassword(password, hash)` - 비밀번호 검증

### `backend/types/index.ts`
- **역할**: TypeScript 타입 정의
- **주요 타입**:
  - `Comment` - 댓글 데이터 구조
  - `CreateCommentRequest` - 댓글 작성 요청
  - `UpdateCommentRequest` - 댓글 수정 요청
  - `DeleteCommentRequest` - 댓글 삭제 요청
  - `GitLogResponse` - Git log 응답 형식

---

## 🎨 Frontend 파일 상세

### `assets/js/git-terminal.js`
- **역할**: 터미널 UI 메인 컴포넌트
- **클래스**: `GitTerminal`
- **주요 메서드**:
  - `handleCommand(input)` - 명령어 처리
  - `executeCommand(parsed)` - 명령어 실행
  - `cmdLog()` - git log
  - `cmdCommit()` - git commit
  - `cmdRebase()` - git rebase -i
  - `cmdReset()` - git reset --hard
  - `cmdConfig()` - git config
  - `cmdReflog()` - git reflog

### `assets/js/git-parser.js`
- **역할**: Git 명령어 파싱
- **클래스**:
  - `GitCommandParser` - 명령어 파서
  - `GitStorage` - localStorage 관리
- **주요 메서드**:
  - `parse(input)` - 명령어 문자열 파싱
  - `parseCommit()` - git commit 파싱
  - `parseLog()` - git log 파싱
  - `setConfig()` / `getConfig()` - 설정 저장/조회
  - `addToReflog()` / `getReflog()` - 내 댓글 기록

### `assets/js/git-api.js`
- **역할**: 백엔드 API 통신
- **클래스**: `GitCommentAPI`
- **주요 메서드**:
  - `getComments(postId)` - GET 요청
  - `createComment(...)` - POST 요청
  - `updateComment(...)` - PUT 요청
  - `deleteComment(...)` - DELETE 요청

### `assets/js/git-help.js`
- **역할**: 도움말 문서
- **상수**:
  - `GIT_HELP` - 전체 도움말
  - `SHORT_HELP` - 간단한 도움말

### `assets/css/vscode-exact.css` (추가 부분)
- **역할**: Git 터미널 스타일
- **클래스**:
  - `.git-terminal` - 터미널 컨테이너
  - `.terminal-output` - 출력 영역
  - `.terminal-input-line` - 입력 라인
  - `.terminal-prompt` - 프롬프트 (`guest@post:~$`)
  - `.terminal-input` - 입력 필드

---

## 🗄️ 데이터 구조 (Vercel KV)

### Redis Keys

```
# 댓글 목록 (List)
comments:{post_id} → [hash1, hash2, hash3, ...]

# 댓글 데이터 (JSON)
comment:{hash} → {
  id: "a3f8e2b1",
  commit_hash: "a3f8e2b1",
  post_id: "my-blog-post",
  author: "홍길동",
  message: "멋진 글이네요!",
  parent_hash: null,
  created_at: "2025-10-26T14:30:00Z",
  updated_at: null
}

# 비밀번호 (String)
password:{hash} → "$2a$10$..."
```

### localStorage (클라이언트)

```javascript
// 설정
git_config: {
  "user.name": "홍길동"
}

// 내가 쓴 댓글 (비밀번호 평문 저장)
git_reflog: {
  "a3f8e2b1": "1234",
  "7c9d4f23": "5678"
}
```

---

## 🔄 데이터 흐름

### 댓글 작성 플로우

```
사용자 입력: git commit -m "Hello"
       ↓
git-parser.js: 명령어 파싱
       ↓
git-terminal.js: cmdCommit() 실행
       ↓
git-api.js: POST /api/comments
       ↓
backend/api/comments.ts: createCommentHandler()
       ↓
backend/lib/kv.ts: createComment()
       ↓
Vercel KV (Redis): 데이터 저장
       ↓
응답 → 터미널에 출력
       ↓
localStorage: reflog에 해시+비밀번호 저장
```

### 댓글 조회 플로우

```
사용자 입력: git log
       ↓
git-parser.js: parseLog()
       ↓
git-terminal.js: cmdLog()
       ↓
git-api.js: GET /api/comments?post_id=xxx
       ↓
backend/api/comments.ts: getCommentsHandler()
       ↓
backend/lib/kv.ts: getComments()
       ↓
Vercel KV: 댓글 목록 조회
       ↓
응답 → Git log 형식으로 변환 → 터미널 출력
```

---

## 🚀 배포 체크리스트

### Backend (Vercel)

- [ ] `cd backend && npm install`
- [ ] `vercel login`
- [ ] `vercel` (프로젝트 생성)
- [ ] Vercel Dashboard에서 KV 생성
- [ ] KV를 프로젝트에 연결
- [ ] `vercel --prod` (프로덕션 배포)
- [ ] API URL 복사: `https://xxx.vercel.app`

### Frontend (Jekyll)

- [ ] `_layouts/post.html` 수정
- [ ] API URL 설정
- [ ] `git push` (GitHub Pages 배포)
- [ ] 블로그에서 테스트

---

## 📝 다음 작업

1. **utterances 제거**: `_layouts/post.html`에서 기존 댓글 시스템 삭제
2. **Git 터미널 통합**: 위 구조대로 스크립트 추가
3. **테스트**: 댓글 작성/수정/삭제 테스트
4. **방명록**: 동일한 구조로 방명록 페이지 추가 (선택)

---

## 🎯 핵심 파일 (꼭 이해해야 할 것)

1. **backend/api/comments.ts** - API 로직
2. **backend/lib/kv.ts** - 데이터 저장/조회
3. **assets/js/git-terminal.js** - UI 및 명령어 처리
4. **assets/js/git-parser.js** - 명령어 파싱

나머지는 보조 파일입니다.
