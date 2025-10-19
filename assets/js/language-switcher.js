// Language switcher with cookie persistence
(function() {
  'use strict';

  // Cookie helpers
  const CookieManager = {
    set: function(name, value, days) {
      const expires = days ? `; expires=${new Date(Date.now() + days * 864e5).toUTCString()}` : '';
      document.cookie = `${name}=${value}${expires}; path=/`;
    },

    get: function(name) {
      const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return match ? match[2] : null;
    }
  };

  // Language manager
  const LanguageManager = {
    COOKIE_NAME: 'preferred_lang',
    COOKIE_DAYS: 365,

    getCurrentLang: function() {
      // Priority: cookie > page.lang > default 'ko'
      const cookieLang = CookieManager.get(this.COOKIE_NAME);
      const htmlLang = document.documentElement.getAttribute('lang');
      return cookieLang || htmlLang || 'ko';
    },

    setPreferredLang: function(lang) {
      CookieManager.set(this.COOKIE_NAME, lang, this.COOKIE_DAYS);
    },

    shouldRedirect: function() {
      const cookieLang = CookieManager.get(this.COOKIE_NAME);
      const currentLang = document.documentElement.getAttribute('lang') || 'ko';

      // Only redirect if cookie exists and differs from current page lang
      return cookieLang && cookieLang !== currentLang;
    },

    getRedirectUrl: function() {
      const cookieLang = CookieManager.get(this.COOKIE_NAME);
      const currentPath = window.location.pathname;

      if (cookieLang === 'en') {
        // Redirect to English version
        if (currentPath === '/' || currentPath === '/index.html') {
          return '/en/';
        }
        // For other pages, try to add /en/ prefix
        return currentPath.startsWith('/en/') ? currentPath : `/en${currentPath}`;
      } else {
        // Redirect to Korean version (remove /en/ prefix)
        if (currentPath === '/en/' || currentPath === '/en/index.html') {
          return '/';
        }
        return currentPath.replace(/^\/en\//, '/');
      }
    }
  };

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', function() {
    // Auto-redirect based on cookie preference
    if (LanguageManager.shouldRedirect()) {
      const redirectUrl = LanguageManager.getRedirectUrl();
      if (redirectUrl !== window.location.pathname) {
        window.location.href = redirectUrl;
        return;
      }
    }

    // Setup language switcher click handlers
    const langSwitchers = document.querySelectorAll('.statusbar-lang');
    langSwitchers.forEach(function(switcher) {
      switcher.addEventListener('click', function(e) {
        const currentLang = document.documentElement.getAttribute('lang') || 'ko';
        const targetLang = currentLang === 'ko' ? 'en' : 'ko';

        // Save preference
        LanguageManager.setPreferredLang(targetLang);

        // Let the link's default behavior handle navigation
        // (the href is already set correctly in the HTML)
      });
    });
  });

  // Expose for debugging
  window.LanguageManager = LanguageManager;
})();
