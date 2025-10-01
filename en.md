---
layout: home
title: Home
lang: en
permalink: /en/
---

# YJ's Dev Blog

Tech blog about Spring Boot, React, and more.

## Recent Posts

{% for post in site.posts limit:5 %}
  {% if post.lang == "en" %}
  - [{{ post.title }}]({{ post.url }}) - {{ post.date | date: "%Y-%m-%d" }}
  {% endif %}
{% endfor %}

---

English | [한글](/)
