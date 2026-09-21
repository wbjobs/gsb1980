/* 轻量 Toast 提示：info / success / error */
(function (global) {
  'use strict';

  function getContainer() {
    let el = document.getElementById('toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function show(message, type, duration) {
    try {
      const toast = document.createElement('div');
      toast.className = 'toast ' + (type || 'info');
      toast.textContent = String(message);
      getContainer().appendChild(toast);
      const ttl = duration || (type === 'error' ? 5000 : 2500);
      setTimeout(() => {
        toast.classList.add('fade');
        setTimeout(() => toast.remove(), 450);
      }, ttl);
    } catch (e) {
      // Toast 自身失败时退化为 console，避免二次异常
      console.error('[toast]', message, e);
    }
  }

  global.Toast = {
    info: (m, d) => show(m, 'info', d),
    success: (m, d) => show(m, 'success', d),
    error: (m, d) => show(m, 'error', d),
  };
})(window);
