import { GitCommentAPI } from './git-api.js';

export class GitCommentsList {
  constructor(containerId, postId, apiBaseUrl) {
    this.container = document.getElementById(containerId);
    this.postId = postId;
    this.api = new GitCommentAPI(apiBaseUrl);

    this.init();
  }

  async init() {
    await this.render();
  }

  async refresh() {
    await this.render();
  }

  async render() {
    try {
      const { commits } = await this.api.getComments(this.postId);

      if (commits.length === 0) {
        this.container.innerHTML = `
          <div style="color: var(--comment); padding: 20px; text-align: center;">
            No comments yet. Be the first to comment!
          </div>
        `;
        return;
      }

      const commentsHtml = commits.map(comment => this.renderComment(comment)).join('');
      this.container.innerHTML = `<div class="comments-container">${commentsHtml}</div>`;
    } catch (error) {
      this.container.innerHTML = `
        <div style="color: var(--error); padding: 20px;">
          Failed to load comments: ${this.escapeHtml(error.message)}
        </div>
      `;
    }
  }

  renderComment(comment) {
    const date = new Date(comment.date).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const repliesHtml = comment.replies && comment.replies.length > 0
      ? comment.replies.map(reply => this.renderReply(reply)).join('')
      : '';

    return `
      <div class="comment-item" data-hash="${comment.hash}">
        <div class="comment-header">
          <span class="comment-author">${this.escapeHtml(comment.author)}</span>
          <span class="comment-hash">#${comment.hash.substring(0, 7)}</span>
          <span class="comment-date">${date}</span>
        </div>
        <div class="comment-body">
          ${this.escapeHtml(comment.message)}
        </div>
        ${repliesHtml}
      </div>
    `;
  }

  renderReply(reply) {
    const date = new Date(reply.date).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <div class="comment-reply" data-hash="${reply.hash}">
        <div class="comment-header">
          <span class="comment-author">${this.escapeHtml(reply.author)}</span>
          <span class="comment-hash">#${reply.hash.substring(0, 7)}</span>
          <span class="comment-date">${date}</span>
        </div>
        <div class="comment-body">
          ${this.escapeHtml(reply.message)}
        </div>
      </div>
    `;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
