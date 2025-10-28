import { VercelRequest, VercelResponse } from '@vercel/node';
import { hashPassword, verifyPassword } from '../lib/auth';
import {
  getComments as kvGetComments,
  createComment as kvCreateComment,
  getComment,
  updateComment as kvUpdateComment,
  deleteComment as kvDeleteComment,
  getPasswordHash,
  getReplies
} from '../lib/kv';
import { CreateCommentRequest, UpdateCommentRequest, DeleteCommentRequest } from '../types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { post_id } = req.query;

  try {
    switch (req.method) {
      case 'GET':
        return await getCommentsHandler(req, res, post_id as string);
      case 'POST':
        return await createCommentHandler(req, res);
      case 'PUT':
        return await updateCommentHandler(req, res);
      case 'DELETE':
        return await deleteCommentHandler(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// git log - 댓글 목록 조회
async function getCommentsHandler(req: VercelRequest, res: VercelResponse, post_id: string) {
  const comments = await kvGetComments(post_id);

  // Git log 형식으로 변환
  const parentComments = comments.filter(c => !c.parent_hash);

  const commits = await Promise.all(
    parentComments.map(async comment => ({
      hash: comment.commit_hash,
      author: comment.author,
      date: comment.created_at,
      message: comment.message,
      replies: await getReplies(comment.commit_hash, comments).then(replies =>
        replies.map(reply => ({
          hash: reply.commit_hash,
          author: reply.author,
          date: reply.created_at,
          message: reply.message,
        }))
      ),
    }))
  );

  return res.status(200).json({ commits });
}

// git commit - 댓글 작성
async function createCommentHandler(req: VercelRequest, res: VercelResponse) {
  const { post_id, author, password, message, parent_hash }: CreateCommentRequest = req.body;

  const passwordHash = password ? await hashPassword(password) : null;

  const comment = await kvCreateComment(
    post_id,
    author || 'Guest',
    passwordHash,
    message,
    parent_hash
  );

  return res.status(201).json({
    commit_hash: comment.commit_hash,
    author: comment.author,
    message: `[comment ${comment.commit_hash}] ${message}`,
  });
}

// git rebase -i - 댓글 수정
async function updateCommentHandler(req: VercelRequest, res: VercelResponse) {
  const { commit_hash, password, message }: UpdateCommentRequest = req.body;

  // 댓글 조회
  const comment = await getComment(commit_hash);
  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  // 비밀번호 확인
  const passwordHash = await getPasswordHash(commit_hash);
  if (!passwordHash) {
    return res.status(403).json({ error: 'This comment cannot be edited (no password set)' });
  }

  const isValid = await verifyPassword(password, passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // 수정
  await kvUpdateComment(commit_hash, message);

  return res.status(200).json({
    message: `[${commit_hash}] Comment updated successfully`,
  });
}

// git reset --hard - 댓글 삭제
async function deleteCommentHandler(req: VercelRequest, res: VercelResponse) {
  const { commit_hash, password }: DeleteCommentRequest = req.body;

  // 댓글 조회
  const comment = await getComment(commit_hash);
  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  // 비밀번호 확인
  const passwordHash = await getPasswordHash(commit_hash);
  if (!passwordHash) {
    return res.status(403).json({ error: 'This comment cannot be deleted (no password set)' });
  }

  const isValid = await verifyPassword(password, passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // 삭제
  await kvDeleteComment(comment.post_id, commit_hash);

  return res.status(200).json({
    message: `Comment ${commit_hash} deleted.`,
  });
}
