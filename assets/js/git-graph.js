/**
 * Git Graph Visualization for VSCode-themed Blog
 * Shows both dev commits and blog posts as separate branches
 */

// Will be populated from Jekyll data or fetched dynamically
let gitGraphData = window.gitGraphData || [];

// Branch filter state
let activeBranches = { dev: true, blog: true };

function renderGitGraph() {
  const container = document.getElementById('git-graph-container');
  if (!container) return;

  // Filter by active branches
  const filteredData = gitGraphData.filter(item => activeBranches[item.branch]);

  container.innerHTML = `
    <div class="git-graph-header">
      <div class="git-branch-filters">
        <label class="git-branch-filter">
          <input type="checkbox" id="filter-dev" ${activeBranches.dev ? 'checked' : ''}>
          <span class="branch-color dev">●</span> dev
        </label>
        <label class="git-branch-filter">
          <input type="checkbox" id="filter-blog" ${activeBranches.blog ? 'checked' : ''}>
          <span class="branch-color blog">●</span> blog
        </label>
      </div>
    </div>
    <div class="git-graph-content"></div>
  `;

  const graphContent = container.querySelector('.git-graph-content');

  filteredData.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `git-commit-row ${item.branch}`;

    // Graph visualization
    const graphLine = document.createElement('div');
    graphLine.className = 'git-graph-line';
    graphLine.innerHTML = `
      <span class="git-node ${item.branch}">●</span>
      ${index < filteredData.length - 1 ? `<span class="git-line ${item.branch}">│</span>` : ''}
    `;

    // Commit info
    const commitInfo = document.createElement('div');
    commitInfo.className = 'git-commit-info';

    const messageDiv = document.createElement('div');
    messageDiv.className = 'git-commit-message';
    messageDiv.textContent = item.message;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'git-commit-meta';
    metaDiv.innerHTML = `
      <span class="git-commit-hash">${escapeHtml(item.hash)}</span>
      <span class="git-commit-date">${escapeHtml(item.date)}</span>
      ${item.branch === 'blog' && item.categories ?
        `<span class="git-commit-categories">${item.categories.map(c => `[${c}]`).join(' ')}</span>` : ''}
    `;

    commitInfo.appendChild(messageDiv);
    commitInfo.appendChild(metaDiv);

    row.appendChild(graphLine);
    row.appendChild(commitInfo);

    // Click handler
    if (item.type === 'commit') {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.open(`https://github.com/yunjeongiya/yunjeongiya.github.io/commit/${item.hash}`, '_blank');
      });
    } else if (item.type === 'post' && item.url) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        window.location.href = item.url;
      });
    }

    graphContent.appendChild(row);
  });

  // Attach filter listeners
  const devFilter = container.querySelector('#filter-dev');
  const blogFilter = container.querySelector('#filter-blog');

  if (devFilter) {
    devFilter.addEventListener('change', (e) => {
      activeBranches.dev = e.target.checked;
      renderGitGraph();
    });
  }

  if (blogFilter) {
    blogFilter.addEventListener('change', (e) => {
      activeBranches.blog = e.target.checked;
      renderGitGraph();
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toggle between Explorer and Git Graph
function toggleGitGraph() {
  const sidebar = document.querySelector('.vscode-sidebar');
  const sidebarHeader = document.querySelector('.sidebar-header');
  const explorerContent = document.querySelector('.sidebar-content');
  const gitGraphContainer = document.getElementById('git-graph-container');

  if (!sidebar || !sidebarHeader || !explorerContent) return;

  // Check if git graph is currently active
  const isGitGraphActive = sidebarHeader.textContent === 'SOURCE CONTROL';

  if (isGitGraphActive) {
    // Switch back to Explorer
    sidebarHeader.textContent = 'EXPLORER';
    explorerContent.style.display = 'block';
    if (gitGraphContainer) gitGraphContainer.style.display = 'none';
  } else {
    // Switch to Git Graph
    sidebarHeader.textContent = 'SOURCE CONTROL';
    explorerContent.style.display = 'none';

    // Create git graph container if it doesn't exist
    if (!gitGraphContainer) {
      const newContainer = document.createElement('div');
      newContainer.id = 'git-graph-container';
      newContainer.className = 'git-graph-container';
      sidebar.appendChild(newContainer);
      renderGitGraph();
    } else {
      gitGraphContainer.style.display = 'block';
      renderGitGraph();
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  const sourceControlIcon = document.querySelector('.activity-icon[title="Source Control"]');
  if (sourceControlIcon) {
    // Prevent default link behavior
    const parentLink = sourceControlIcon.closest('a');
    if (parentLink) {
      parentLink.addEventListener('click', function(e) {
        e.preventDefault();
        toggleGitGraph();
      });
    }
  }
});
