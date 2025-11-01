import { GitCommandParser, GitStorage } from './git-parser.js';
import { GitCommentAPI } from './git-api.js';
import { GIT_HELP, SHORT_HELP } from './git-help.js';

export class GitTerminal {
  constructor(containerId, postId, apiBaseUrl) {
    this.container = document.getElementById(containerId);
    this.postId = postId;
    this.parser = new GitCommandParser(apiBaseUrl, postId);
    this.storage = new GitStorage();
    this.api = new GitCommentAPI(apiBaseUrl);
    this.commandHistory = [];
    this.historyIndex = -1;
    this.currentPromptState = null; // 대화형 입력 상태

    this.init();
  }

  init() {
    this.render();
    this.attachEventListeners();
    this.showWelcome();
  }

  render() {
    this.container.innerHTML = `
      <div class="git-terminal">
        <div class="terminal-output" id="terminal-output"></div>
        <div class="terminal-input-line">
          <span class="terminal-prompt" id="terminal-prompt">guest@post:~$</span>
          <input type="text" class="terminal-input" id="terminal-input" autocomplete="off" spellcheck="false">
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    const input = document.getElementById('terminal-input');

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await this.handleCommand(input.value);
        input.value = '';
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateHistory('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateHistory('down');
      }
    });

    // 터미널 클릭 시 input에 포커스
    this.container.addEventListener('click', () => {
      input.focus();
    });
  }

  showWelcome() {
    this.print(`<span style="color: #6A9955"># Write a comment using git commands</span>`);
    this.print(`<span style="color: #858585"># Example: git commit --author="Your Name" -m "Your comment"</span>`);
    this.print(`<span style="color: #858585"># Type 'help' for more commands\n</span>`);
  }

  async handleCommand(input) {
    const trimmed = input.trim();

    // 대화형 모드 처리 (빈 입력도 허용)
    if (this.currentPromptState) {
      await this.handlePromptInput(trimmed);
      return;
    }

    // 일반 명령어는 빈 입력 무시
    if (!trimmed) return;

    // 명령어 히스토리에 추가
    this.commandHistory.push(trimmed);
    this.historyIndex = this.commandHistory.length;

    // 입력된 명령어 출력
    this.print(`<span style="color: #858585">guest@post:~$</span> ${this.escapeHtml(trimmed)}`);

    // 명령어 파싱
    const parsed = this.parser.parse(trimmed);
    if (!parsed) return;

    // 명령어 실행
    await this.executeCommand(parsed);
  }

  async executeCommand(parsed) {
    switch (parsed.command) {
      case 'help':
        this.print(GIT_HELP);
        break;

      case 'log':
        this.print(`<span style="color: #858585">Comments are displayed above. Use 'git reflog' to see your own comments.</span>`);
        break;

      case 'commit':
        await this.cmdCommit(parsed);
        break;

      case 'show':
        await this.cmdShow(parsed.hash);
        break;

      case 'rebase':
        await this.cmdRebase(parsed.hash);
        break;

      case 'reset':
        await this.cmdReset(parsed.hash);
        break;

      case 'config':
        this.cmdConfig(parsed);
        break;

      case 'reflog':
        await this.cmdReflog();
        break;

      case 'error':
        this.print(`<span style="color: #F48771">${parsed.message}</span>`);
        break;

      default:
        this.print(`<span style="color: #F48771">Unknown command</span>`);
    }
  }

  // git log - 댓글 목록 조회
  async cmdLog(options) {
    try {
      const { commits } = await this.api.getComments(this.postId);

      if (commits.length === 0) {
        this.print('<span style="color: #858585">No comments yet.</span>');
        return;
      }

      commits.forEach(commit => {
        if (options.oneline) {
          this.print(`<span style="color: #DCDCAA">${commit.hash}</span> ${this.escapeHtml(commit.message)}`);
        } else {
          this.print(`<span style="color: #DCDCAA">commit ${commit.hash}</span>`);
          this.print(`Author: ${this.escapeHtml(commit.author)}`);
          this.print(`Date:   ${new Date(commit.date).toLocaleString()}\n`);
          this.print(`    ${this.escapeHtml(commit.message)}\n`);

          // 답글 표시
          if (commit.replies && commit.replies.length > 0) {
            commit.replies.forEach(reply => {
              this.print(`  <span style="color: #858585">└─ commit ${reply.hash}</span>`);
              this.print(`     Author: ${this.escapeHtml(reply.author)}`);
              this.print(`     Date:   ${new Date(reply.date).toLocaleString()}\n`);
              this.print(`         ${this.escapeHtml(reply.message)}\n`);
            });
          }
        }
      });
    } catch (error) {
      this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
    }
  }

  // git commit - 댓글 작성
  async cmdCommit(parsed) {
    // 대화형 모드
    if (!parsed.message) {
      this.currentPromptState = {
        step: 'author',
        data: { author: null, password: null, message: null, parentHash: parsed.parentHash }
      };
      this.setPrompt('Author (optional, press Enter to skip):');
      return;
    }

    // 직접 입력 모드 - 비밀번호 필수
    const author = parsed.author || this.storage.getConfig('user.name') || 'Guest';
    const password = parsed.password;

    if (!password) {
      this.print(`<span style="color: #F48771">Error: Password is required. Use --password="your_password"</span>`);
      return;
    }

    try {
      const result = await this.api.createComment(
        this.postId,
        author,
        password,
        parsed.message,
        parsed.parentHash
      );

      this.print(`<span style="color: #4EC9B0">${result.message}</span>`);
      this.print(` Author: ${author}`);
      this.print(` 1 comment created\n`);

      // reflog에 추가
      this.storage.addToReflog(result.commit_hash, password);

      // 콜백 호출 (댓글 목록 갱신용)
      if (this.onCommentCreated) {
        this.onCommentCreated();
      }
    } catch (error) {
      this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
    }
  }

  // 대화형 입력 처리
  async handlePromptInput(input) {
    const state = this.currentPromptState;
    const trimmed = input.trim();

    switch (state.step) {
      case 'author':
        if (trimmed === '') {
          this.print('<span style="color: #858585">Author skipped, using Guest</span>');
          state.data.author = this.storage.getConfig('user.name') || 'Guest';
        } else {
          state.data.author = trimmed;
        }
        state.step = 'password';
        this.setPrompt('Password (required for edit/delete):');
        break;

      case 'password':
        if (trimmed === '') {
          this.print('<span style="color: #F48771">Error: Password is required</span>');
          this.setPrompt('Password (required for edit/delete):');
          return;
        }
        state.data.password = trimmed;
        state.step = 'message';
        this.setPrompt('Message:');
        break;

      case 'message':
        if (trimmed === '') {
          this.print('<span style="color: #F48771">Error: Message cannot be empty</span>');
          this.setPrompt('Message:');
          return;
        }

        state.data.message = trimmed;
        this.resetPrompt();

        // 댓글 작성 실행
        try {
          const result = await this.api.createComment(
            this.postId,
            state.data.author,
            state.data.password,
            state.data.message,
            state.data.parentHash
          );

          this.print(`<span style="color: #4EC9B0">${result.message}</span>`);
          this.print(` Author: ${state.data.author}`);
          this.print(` 1 comment created\n`);

          if (state.data.password) {
            this.storage.addToReflog(result.commit_hash, state.data.password);
          }

          // 콜백 호출 (댓글 목록 갱신용)
          if (this.onCommentCreated) {
            this.onCommentCreated();
          }
        } catch (error) {
          this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
        }

        this.currentPromptState = null;
        break;

      case 'rebase-password':
        state.data.password = input;
        state.step = 'rebase-message';
        this.setPrompt('Message:');
        break;

      case 'rebase-message':
        this.resetPrompt();
        try {
          const result = await this.api.updateComment(
            state.data.hash,
            state.data.password,
            input
          );
          this.print(`<span style="color: #4EC9B0">${result.message}</span>`);
          await this.cmdLog({ oneline: false });
        } catch (error) {
          this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
        }
        this.currentPromptState = null;
        break;

      case 'reset-password':
        this.resetPrompt();
        try {
          const result = await this.api.deleteComment(state.data.hash, input);
          this.print(`<span style="color: #4EC9B0">${result.message}</span>`);
          this.storage.removeFromReflog(state.data.hash);
          await this.cmdLog({ oneline: false });
        } catch (error) {
          this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
        }
        this.currentPromptState = null;
        break;
    }
  }

  // git show - 댓글 상세 조회
  async cmdShow(hash) {
    try {
      const { commits } = await this.api.getComments(this.postId);
      const allComments = commits.flatMap(c => [c, ...(c.replies || [])]);
      const comment = allComments.find(c => c.hash === hash);

      if (!comment) {
        this.print(`<span style="color: #F48771">fatal: bad object ${hash}</span>`);
        return;
      }

      this.print(`<span style="color: #DCDCAA">commit ${comment.hash}</span>`);
      this.print(`Author: ${this.escapeHtml(comment.author)}`);
      this.print(`Date:   ${new Date(comment.date).toLocaleString()}\n`);
      this.print(`    ${this.escapeHtml(comment.message)}\n`);
    } catch (error) {
      this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
    }
  }

  // git rebase -i - 댓글 수정
  async cmdRebase(hash) {
    // localStorage에서 비밀번호 확인
    const savedPassword = this.storage.getPassword(hash);

    if (savedPassword) {
      // 비밀번호가 저장되어 있으면 바로 메시지 입력
      this.currentPromptState = {
        step: 'rebase-message',
        data: { hash, password: savedPassword }
      };
      this.setPrompt('Message:');
    } else {
      // 비밀번호 입력 요청
      this.currentPromptState = {
        step: 'rebase-password',
        data: { hash, password: null }
      };
      this.setPrompt('Password:');
    }
  }

  // git reset --hard - 댓글 삭제
  async cmdReset(hash) {
    // Support both full hash and 7-char short hash
    let fullHash = hash;

    // If short hash (7 chars), find the full hash
    if (hash.length === 7) {
      try {
        const { commits } = await this.api.getComments(this.postId);
        const allComments = commits.flatMap(c => [c, ...(c.replies || [])]);
        const comment = allComments.find(c => c.hash.startsWith(hash));

        if (!comment) {
          this.print(`<span style="color: #F48771">fatal: bad object ${hash}</span>`);
          return;
        }

        fullHash = comment.hash;
      } catch (error) {
        this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
        return;
      }
    }

    const savedPassword = this.storage.getPassword(fullHash);

    if (savedPassword) {
      // 비밀번호가 저장되어 있으면 바로 삭제
      try {
        const result = await this.api.deleteComment(fullHash, savedPassword);
        this.print(`<span style="color: #4EC9B0">${result.message}</span>`);
        this.storage.removeFromReflog(fullHash);

        // 콜백 호출 (댓글 목록 갱신용)
        if (this.onCommentCreated) {
          this.onCommentCreated();
        }
      } catch (error) {
        this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
      }
    } else {
      // 비밀번호 입력 요청
      this.currentPromptState = {
        step: 'reset-password',
        data: { hash }
      };
      this.setPrompt('Password:');
    }
  }

  // git config
  cmdConfig(parsed) {
    if (parsed.get) {
      const value = this.storage.getConfig(parsed.key);
      if (value) {
        this.print(value);
      } else {
        this.print(`<span style="color: #858585">${parsed.key} not set</span>`);
      }
    } else {
      this.storage.setConfig(parsed.key, parsed.value);
      this.print(`<span style="color: #4EC9B0">Config saved: ${parsed.key} = ${parsed.value}</span>`);
    }
  }

  // git reflog - 내가 작성한 댓글 목록
  async cmdReflog() {
    const reflog = this.storage.getReflog();
    const hashes = Object.keys(reflog);

    if (hashes.length === 0) {
      this.print('<span style="color: #858585">No reflog entries.</span>');
      return;
    }

    try {
      const { commits } = await this.api.getComments(this.postId);
      const allComments = commits.flatMap(c => [c, ...(c.replies || [])]);

      hashes.forEach(hash => {
        const comment = allComments.find(c => c.hash === hash);
        if (comment) {
          this.print(`<span style="color: #DCDCAA">${hash}</span> ${this.escapeHtml(comment.author)}: ${this.escapeHtml(comment.message)}`);
        }
      });
    } catch (error) {
      this.print(`<span style="color: #F48771">Error: ${error.message}</span>`);
    }
  }

  // 프롬프트 변경
  setPrompt(text) {
    const promptEl = document.getElementById('terminal-prompt');
    promptEl.textContent = text;
  }

  resetPrompt() {
    const promptEl = document.getElementById('terminal-prompt');
    promptEl.textContent = 'guest@post:~$';
  }

  // 출력
  print(html) {
    const output = document.getElementById('terminal-output');
    const line = document.createElement('div');
    line.innerHTML = html;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  // 명령어 히스토리 탐색
  navigateHistory(direction) {
    if (direction === 'up' && this.historyIndex > 0) {
      this.historyIndex--;
      document.getElementById('terminal-input').value = this.commandHistory[this.historyIndex];
    } else if (direction === 'down' && this.historyIndex < this.commandHistory.length - 1) {
      this.historyIndex++;
      document.getElementById('terminal-input').value = this.commandHistory[this.historyIndex];
    } else if (direction === 'down') {
      this.historyIndex = this.commandHistory.length;
      document.getElementById('terminal-input').value = '';
    }
  }

  // HTML 이스케이프
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
