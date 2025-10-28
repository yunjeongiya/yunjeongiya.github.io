// Git 댓글 시스템 API 클라이언트
export class GitCommentAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  // GET /api/comments?post_id=xxx
  async getComments(postId) {
    try {
      const response = await fetch(`${this.baseUrl}/api/comments?post_id=${postId}`);
      if (!response.ok) throw new Error('Failed to fetch comments');
      return await response.json();
    } catch (error) {
      console.error('Get comments error:', error);
      throw error;
    }
  }

  // POST /api/comments
  async createComment(postId, author, password, message, parentHash = null) {
    try {
      const response = await fetch(`${this.baseUrl}/api/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: postId,
          author,
          password,
          message,
          parent_hash: parentHash,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create comment');
      }

      return await response.json();
    } catch (error) {
      console.error('Create comment error:', error);
      throw error;
    }
  }

  // PUT /api/comments
  async updateComment(commitHash, password, message) {
    try {
      const response = await fetch(`${this.baseUrl}/api/comments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commit_hash: commitHash,
          password,
          message,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update comment');
      }

      return await response.json();
    } catch (error) {
      console.error('Update comment error:', error);
      throw error;
    }
  }

  // DELETE /api/comments
  async deleteComment(commitHash, password) {
    try {
      const response = await fetch(`${this.baseUrl}/api/comments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commit_hash: commitHash,
          password,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete comment');
      }

      return await response.json();
    } catch (error) {
      console.error('Delete comment error:', error);
      throw error;
    }
  }
}
