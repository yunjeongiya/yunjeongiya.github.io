---
layout: home
title: Home
lang: ko
---

# YJ's Dev Blog

기술 블로그입니다.

## 최근 글

{% for post in site.posts limit:5 %}
  {% if post.lang == "ko" or post.lang == nil %}
  - [{{ post.title }}]({{ post.url }}) - {{ post.date | date: "%Y-%m-%d" }}
  {% endif %}
{% endfor %}

---

[English](/en) | 한글
