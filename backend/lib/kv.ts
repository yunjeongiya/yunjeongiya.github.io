import { kv } from '@vercel/kv';
import { Comment } from '../types';

// Redis Key 생성
export function getCommentsKey(postId: string): string {
  return `comments:${postId}`;
}

export function getCommentKey(commitHash: string): string {
  return `comment:${commitHash}`;
}

// Commit Hash 생성 (8자리 랜덤)
export function generateCommitHash(): string {
  return Math.random().toString(36).substring(2, 10);
}

// 댓글 목록 조회
export async function getComments(postId: string): Promise<Comment[]> {
  const key = getCommentsKey(postId);
  const commentHashes = await kv.lrange<string>(key, 0, -1);

  if (!commentHashes || commentHashes.length === 0) {
    return [];
  }

  // 각 해시로 댓글 데이터 조회
  const comments: Comment[] = [];
  for (const hash of commentHashes) {
    const comment = await kv.get<Comment>(getCommentKey(hash));
    if (comment) {
      comments.push(comment);
    }
  }

  return comments;
}

// 댓글 작성
export async function createComment(
  postId: string,
  author: string,
  passwordHash: string | null,
  message: string,
  parentHash: string | null = null
): Promise<Comment> {
  const commitHash = generateCommitHash();
  const comment: Comment = {
    id: commitHash,
    commit_hash: commitHash,
    post_id: postId,
    author,
    message,
    parent_hash: parentHash,
    created_at: new Date().toISOString(),
  };

  // 댓글 데이터 저장
  await kv.set(getCommentKey(commitHash), comment);

  // 댓글 목록에 추가
  await kv.lpush(getCommentsKey(postId), commitHash);

  // 비밀번호가 있으면 별도 저장 (보안을 위해 분리)
  if (passwordHash) {
    await kv.set(`password:${commitHash}`, passwordHash);
  }

  return comment;
}

// 댓글 조회 (단일)
export async function getComment(commitHash: string): Promise<Comment | null> {
  return await kv.get<Comment>(getCommentKey(commitHash));
}

// 댓글 수정
export async function updateComment(
  commitHash: string,
  message: string
): Promise<boolean> {
  const comment = await getComment(commitHash);
  if (!comment) return false;

  comment.message = message;
  comment.updated_at = new Date().toISOString();

  await kv.set(getCommentKey(commitHash), comment);
  return true;
}

// 댓글 삭제
export async function deleteComment(
  postId: string,
  commitHash: string
): Promise<boolean> {
  // 댓글 목록에서 제거
  await kv.lrem(getCommentsKey(postId), 0, commitHash);

  // 댓글 데이터 삭제
  await kv.del(getCommentKey(commitHash));

  // 비밀번호 삭제
  await kv.del(`password:${commitHash}`);

  return true;
}

// 비밀번호 조회
export async function getPasswordHash(commitHash: string): Promise<string | null> {
  return await kv.get<string>(`password:${commitHash}`);
}

// 답글 조회 (특정 댓글의 답글들)
export async function getReplies(parentHash: string, allComments: Comment[]): Promise<Comment[]> {
  return allComments.filter(c => c.parent_hash === parentHash);
}
