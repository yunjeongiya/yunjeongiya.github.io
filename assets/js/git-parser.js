// Git 명령어 파싱 및 실행
export class GitCommandParser {
  constructor(apiBaseUrl, postId) {
    this.apiBaseUrl = apiBaseUrl;
    this.postId = postId;
  }

  // 명령어 파싱
  parse(input) {
    const trimmed = input.trim();

    if (!trimmed) return null;

    // help 명령어
    if (trimmed === 'help' || trimmed === 'git --help') {
      return { command: 'help' };
    }

    // git 명령어가 아니면 에러
    if (!trimmed.startsWith('git ')) {
      return {
        command: 'error',
        message: `Command not found: ${trimmed.split(' ')[0]}\nType 'help' for available commands.`
      };
    }

    const parts = this.parseCommand(trimmed);
    const gitCommand = parts[1]; // git 다음 명령어

    switch (gitCommand) {
      case 'log':
        return this.parseLog(parts);
      case 'commit':
        return this.parseCommit(parts);
      case 'show':
        return this.parseShow(parts);
      case 'rebase':
        return this.parseRebase(parts);
      case 'reset':
        return this.parseReset(parts);
      case 'config':
        return this.parseConfig(parts);
      case 'reflog':
        return { command: 'reflog' };
      default:
        return {
          command: 'error',
          message: `git: '${gitCommand}' is not a git command. See 'help'.`
        };
    }
  }

  // 명령어 토큰화 (따옴표 안의 공백 보존)
  parseCommand(input) {
    const regex = /[^\s"]+|"([^"]*)"/gi;
    const parts = [];
    let match;

    while ((match = regex.exec(input))) {
      parts.push(match[1] || match[0]);
    }

    return parts;
  }

  // git log 파싱
  parseLog(parts) {
    const options = {
      oneline: parts.includes('--oneline'),
      comments: parts.includes('--comments') || true, // 기본값
    };
    return { command: 'log', options };
  }

  // git commit 파싱
  parseCommit(parts) {
    const result = {
      command: 'commit',
      author: null,
      password: null,
      message: null,
      parentHash: null,
    };

    for (let i = 2; i < parts.length; i++) {
      const part = parts[i];

      if (part === '-m' && i + 1 < parts.length) {
        result.message = parts[i + 1];
        i++;
      } else if (part.startsWith('--author=')) {
        result.author = part.substring(9);
      } else if (part.startsWith('--password=')) {
        result.password = part.substring(11);
      } else if (part.startsWith('--fixup=')) {
        result.parentHash = part.substring(8);
      }
    }

    return result;
  }

  // git show 파싱
  parseShow(parts) {
    if (parts.length < 3) {
      return {
        command: 'error',
        message: 'usage: git show <hash>'
      };
    }
    return { command: 'show', hash: parts[2] };
  }

  // git rebase -i 파싱
  parseRebase(parts) {
    if (!parts.includes('-i')) {
      return {
        command: 'error',
        message: 'Only interactive rebase is supported. Use: git rebase -i <hash>'
      };
    }

    const hashIndex = parts.findIndex(p => p === '-i') + 1;
    if (hashIndex >= parts.length) {
      return {
        command: 'error',
        message: 'usage: git rebase -i <hash>'
      };
    }

    return { command: 'rebase', hash: parts[hashIndex] };
  }

  // git reset --hard 파싱
  parseReset(parts) {
    if (!parts.includes('--hard')) {
      return {
        command: 'error',
        message: 'Only hard reset is supported. Use: git reset --hard <hash>'
      };
    }

    const hashIndex = parts.findIndex(p => p === '--hard') + 1;
    if (hashIndex >= parts.length) {
      return {
        command: 'error',
        message: 'usage: git reset --hard <hash>'
      };
    }

    return { command: 'reset', hash: parts[hashIndex] };
  }

  // git config 파싱
  parseConfig(parts) {
    if (parts.length < 3) {
      return {
        command: 'error',
        message: 'usage: git config user.name "<name>"'
      };
    }

    if (parts[2] === 'user.name') {
      if (parts[3]) {
        return { command: 'config', key: 'user.name', value: parts[3] };
      } else {
        return { command: 'config', key: 'user.name', get: true };
      }
    }

    if (parts.includes('--get') && parts[3] === 'user.name') {
      return { command: 'config', key: 'user.name', get: true };
    }

    return {
      command: 'error',
      message: 'Only user.name config is supported.'
    };
  }
}

// LocalStorage 관리
export class GitStorage {
  constructor() {
    this.CONFIG_KEY = 'git_config';
    this.REFLOG_KEY = 'git_reflog';
  }

  // 설정 저장
  setConfig(key, value) {
    const config = this.getConfig();
    config[key] = value;
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
  }

  // 설정 조회
  getConfig(key = null) {
    const config = JSON.parse(localStorage.getItem(this.CONFIG_KEY) || '{}');
    return key ? config[key] : config;
  }

  // reflog에 추가 (내가 작성한 댓글 기록)
  addToReflog(commitHash, password) {
    const reflog = this.getReflog();
    reflog[commitHash] = password; // 비밀번호를 평문으로 저장 (클라이언트 측)
    localStorage.setItem(this.REFLOG_KEY, JSON.stringify(reflog));
  }

  // reflog 조회
  getReflog() {
    return JSON.parse(localStorage.getItem(this.REFLOG_KEY) || '{}');
  }

  // 특정 해시의 비밀번호 조회
  getPassword(commitHash) {
    const reflog = this.getReflog();
    return reflog[commitHash] || null;
  }

  // reflog에서 제거
  removeFromReflog(commitHash) {
    const reflog = this.getReflog();
    delete reflog[commitHash];
    localStorage.setItem(this.REFLOG_KEY, JSON.stringify(reflog));
  }
}
