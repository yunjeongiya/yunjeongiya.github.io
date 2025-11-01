import { GitCommentAPI } from './git-api.js';
import { GitStorage } from './git-parser.js';

export class GitCommentsList {
  constructor(containerId, postId, apiBaseUrl) {
    this.container = document.getElementById(containerId);
    this.postId = postId;
    this.api = new GitCommentAPI(apiBaseUrl);
    this.storage = new GitStorage();

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

      // Attach delete button event listeners
      this.attachDeleteListeners();
    } catch (error) {
      this.container.innerHTML = `
        <div style="color: var(--error); padding: 20px;">
          Failed to load comments: ${this.escapeHtml(error.message)}
        </div>
      `;
    }
  }

  attachDeleteListeners() {
    const deleteButtons = this.container.querySelectorAll('.comment-delete-btn');
    deleteButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const hash = e.target.getAttribute('data-hash');
        const password = this.storage.getPassword(hash);

        if (!password) {
          alert('Password not found. You can only delete your own comments.');
          return;
        }

        if (!confirm('Are you sure you want to delete this comment?')) {
          return;
        }

        try {
          await this.api.deleteComment(hash, password);
          this.storage.removeFromReflog(hash);
          await this.refresh();
        } catch (error) {
          alert(`Failed to delete comment: ${error.message}`);
        }
      });
    });
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

    // Check if user has password saved for this comment
    const hasPassword = !!this.storage.getPassword(comment.hash);
    const deleteButton = hasPassword
      ? `<button class="comment-delete-btn" data-hash="${comment.hash}">Delete</button>`
      : '';

    return `
      <div class="comment-item" data-hash="${comment.hash}">
        <div class="comment-header">
          <span class="comment-author">${this.escapeHtml(comment.author)}</span>
          <span class="comment-hash">#${comment.hash.substring(0, 7)}</span>
          <span class="comment-date">${date}</span>
          ${deleteButton}
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
