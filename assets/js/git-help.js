export const GIT_HELP = `
<span style="color: #4EC9B0">git-comment</span> - Git-style terminal comment system

<span style="color: #DCDCAA">SYNOPSIS</span>
    git log [--oneline] [--comments]
    git commit [-m <message>] [--author=<name>]
    git show <hash>
    git rebase -i <hash>
    git reset --hard <hash>
    git config user.name <name>
    git reflog
    help

<span style="color: #DCDCAA">COMMANDS</span>

  <span style="color: #4FC1FF">git log</span> [--oneline]
      Show comment history in git log format

      Options:
        --oneline    Show compact one-line format
        --comments   Show only comments (default)

      Example:
        $ git log
        $ git log --oneline

  <span style="color: #4FC1FF">git commit</span> -m "<message>" [--author="<name>"]
      Create a new comment

      Options:
        -m <message>       Comment message (required)
        --author=<name>    Author name (default: Guest)
        --password=<pass>  Password for edit/delete (optional)

      Example:
        $ git commit -m "Great post!"
        $ git commit --author="홍길동" -m "멋진 글이네요!"
        $ git commit --author="홍길동" --password="1234" -m "수정 가능한 댓글"

      Interactive mode:
        $ git commit
        Author: 홍길동
        Password (optional): ****
        Message: 멋진 글이네요!

  <span style="color: #4FC1FF">git show</span> <hash>
      Show detailed information about a specific comment

      Example:
        $ git show a3f8e2b1

  <span style="color: #4FC1FF">git rebase -i</span> <hash>
      Edit an existing comment (requires password)

      Example:
        $ git rebase -i a3f8e2b1
        Password: ****
        Message: 수정된 댓글 내용

  <span style="color: #4FC1FF">git reset --hard</span> <hash>
      Delete a comment (requires password)

      Example:
        $ git reset --hard a3f8e2b1
        Password: ****
        Comment a3f8e2b1 deleted.

  <span style="color: #4FC1FF">git commit --fixup=</span><hash>
      Reply to a comment

      Example:
        $ git commit --fixup=a3f8e2b1 -m "답글입니다!"

  <span style="color: #4FC1FF">git config</span> user.name "<name>"
      Set default author name (stored in localStorage)

      Example:
        $ git config user.name "홍길동"
        $ git config --get user.name

  <span style="color: #4FC1FF">git reflog</span>
      Show comments you created (stored in browser)

      Example:
        $ git reflog

  <span style="color: #4FC1FF">help</span>, <span style="color: #4FC1FF">git --help</span>
      Show this help message

<span style="color: #DCDCAA">PASSWORD & AUTHENTICATION</span>

  • Comments without password: <span style="color: #CE9178">read-only</span> (cannot edit/delete)
  • Comments with password: <span style="color: #4EC9B0">editable</span> (can edit/delete with password)

  Password is hashed and stored securely.
  Comment hashes are stored in browser localStorage for convenience.

<span style="color: #DCDCAA">EXAMPLES</span>

  # Quick anonymous comment
  $ git commit -m "Nice blog!"

  # Comment with author name
  $ git commit --author="John Doe" -m "Great article!"

  # Comment with password (editable)
  $ git commit --author="홍길동" --password="1234" -m "나중에 수정할 수 있어요"

  # View all comments
  $ git log

  # Edit your comment
  $ git rebase -i a3f8e2b1

  # Delete your comment
  $ git reset --hard a3f8e2b1

  # Reply to a comment
  $ git commit --fixup=a3f8e2b1 -m "Thanks for the comment!"

  # Set default name
  $ git config user.name "홍길동"

<span style="color: #DCDCAA">SEE ALSO</span>

  Blog: <span style="color: #4FC1FF">https://yunjeongiya.github.io</span>
  Source: <span style="color: #4FC1FF">https://github.com/yunjeongiya/yunjeongiya.github.io</span>

<span style="color: #6A9955">Git-style comment system v1.0.0</span>
`;

export const SHORT_HELP = `
<span style="color: #DCDCAA">Available commands:</span>
  git log              - View comments
  git commit -m "..."  - Write comment
  git show <hash>      - View comment detail
  git rebase -i <hash> - Edit comment
  git reset <hash>     - Delete comment
  help                 - Show detailed help

Type '<span style="color: #4FC1FF">help</span>' for detailed usage.
`;
