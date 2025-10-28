export interface Comment {
  id: string;
  commit_hash: string;
  post_id: string;
  author: string;
  message: string;
  parent_hash?: string;
  created_at: string;
  updated_at?: string;
}

export interface CreateCommentRequest {
  post_id: string;
  author?: string;
  password?: string;
  message: string;
  parent_hash?: string;
}

export interface UpdateCommentRequest {
  commit_hash: string;
  password: string;
  message: string;
}

export interface DeleteCommentRequest {
  commit_hash: string;
  password: string;
}

export interface GitLogResponse {
  commits: Array<{
    hash: string;
    author: string;
    date: string;
    message: string;
    replies?: Array<{
      hash: string;
      author: string;
      date: string;
      message: string;
    }>;
  }>;
}
