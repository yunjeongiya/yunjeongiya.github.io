# 🚀 빠른 시작 가이드

Git 스타일 댓글 시스템을 5분 안에 배포하는 방법입니다.

## 1️⃣ Vercel 프로젝트 생성 (1분)

```bash
cd backend
npm install
vercel login
vercel
```

프롬프트가 나오면:
- `Set up and deploy?` → **Yes**
- `Which scope?` → 본인 계정 선택
- `Link to existing project?` → **No**
- `Project name?` → `blog-comments` (원하는 이름)
- `Directory?` → `./` (현재 디렉토리)

## 2️⃣ Vercel KV 생성 (1분)

1. https://vercel.com/dashboard 접속
2. 왼쪽 메뉴에서 **Storage** 클릭
3. **Create Database** 클릭
4. **KV** 선택
5. 데이터베이스 이름 입력: `blog-comments-kv`
6. **Create** 클릭

## 3️⃣ KV를 프로젝트에 연결 (30초)

1. 생성된 KV 페이지에서 **Connect Project** 클릭
2. 방금 만든 프로젝트 (`blog-comments`) 선택
3. 환경: **Production, Preview, Development** 모두 체크
4. **Connect** 클릭

✅ 환경변수 자동 설정 완료!

## 4️⃣ 프로덕션 배포 (30초)

```bash
vercel --prod
```

배포 완료! URL이 출력됩니다:
```
https://blog-comments-xxxxx.vercel.app
```

## 5️⃣ 블로그에 통합 (2분)

### Jekyll 블로그

`_layouts/post.html` 파일을 열고 utterances 섹션을 찾아서 다음으로 교체:

```html
<!-- Git Terminal Comments -->
<div class="vscode-section comments-section">
  <div class="section-header">
    <span class="section-icon">▶</span>
    <span class="section-title">TERMINAL - Comments</span>
  </div>
  <div id="git-comments"></div>
</div>

<script type="module">
  import { GitTerminal } from '/assets/js/git-terminal.js';

  const postId = '{{ page.id | replace: "/", "-" }}';
  const apiUrl = 'https://blog-comments-xxxxx.vercel.app'; // 👈 본인 URL

  new GitTerminal('git-comments', postId, apiUrl);
</script>
```

## ✅ 완료!

이제 블로그 포스트에 가서 댓글을 테스트해보세요:

```bash
git commit -m "First comment!"
```

---

## 📝 다음 단계

### 로컬 개발 환경 설정

```bash
# 1. Vercel 대시보드 → Storage → blog-comments-kv → .env.local 탭
# 2. "Download Snippet" 클릭
# 3. backend/.env.local 에 붙여넣기

# 로컬 서버 실행
vercel dev
```

### 커스터마이징

- **색상 변경**: `assets/css/vscode-exact.css` 수정
- **명령어 추가**: `assets/js/git-parser.js` 수정
- **API 로직**: `backend/api/comments.ts` 수정

### 문제 해결

**Q: 댓글이 안 보여요**
- Vercel 대시보드에서 KV가 연결되었는지 확인
- 브라우저 개발자 도구에서 API 에러 확인
- CORS 에러면 Vercel 함수가 제대로 배포되었는지 확인

**Q: 비밀번호 설정한 댓글을 수정 못해요**
- localStorage를 확인: 다른 브라우저/시크릿 모드면 못 찾습니다
- `git reflog`로 내가 쓴 댓글 확인

**Q: 데이터를 직접 보고 싶어요**
- Vercel 대시보드 → Storage → blog-comments-kv → Data 탭
- Redis 명령어로 직접 조회 가능

---

## 🎉 축하합니다!

Git 스타일 댓글 시스템 배포 완료!

궁금한 점이 있으면 [Issues](https://github.com/yunjeongiya/yunjeongiya.github.io/issues)에 남겨주세요.
