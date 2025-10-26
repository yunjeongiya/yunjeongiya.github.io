require 'json'
require 'time'

module Jekyll
  class GitGraphGenerator < Generator
    safe true
    priority :low

    def generate(site)
      # Get git commits
      git_commits = `git log --all --pretty=format:'%H|%an|%ai|%s' -50`.split("\n").map do |line|
        hash, author, date, message = line.split('|', 4)
        {
          'type' => 'commit',
          'hash' => hash[0..6],
          'author' => author,
          'date' => Time.parse(date).strftime('%Y-%m-%d %H:%M'),
          'message' => message,
          'branch' => 'dev'
        }
      rescue
        nil
      end.compact

      # Get blog posts
      blog_posts = site.posts.docs.select { |post| post.data['lang'] == 'ko' }.map do |post|
        {
          'type' => 'post',
          'hash' => post.data['date'].strftime('%Y%m%d'),
          'author' => 'Blog',
          'date' => post.data['date'].strftime('%Y-%m-%d %H:%M'),
          'message' => post.data['title'],
          'url' => post.url,
          'categories' => post.data['categories'] || [],
          'branch' => 'blog'
        }
      end

      # Merge and sort by date
      all_items = (git_commits + blog_posts).sort_by { |item| item['date'] }.reverse

      # Save to data
      site.data['git_graph'] = all_items
    end
  end
end
