/*
 * 轻量全局提示:info / success / warn / error,自动消失与手动关闭。
 */
(function (root) {
  'use strict';

  const ICONS = { info: 'ℹ', success: '✓', warn: '!', error: '✕' };

  function Toast(target) {
    this.container = target || null;
  }

  Toast.prototype._ensureContainer = function () {
    if (this.container) return this.container;
    const el = document.createElement('div');
    el.className = 'toast-container';
    document.body.appendChild(el);
    this.container = el;
    return el;
  };

  Toast.prototype.show = function (type, message, duration) {
    if (typeof document === 'undefined') return null;
    const container = this._ensureContainer();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'alert');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = ICONS[type] || ICONS.info;
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '×';
    el.appendChild(icon);
    el.appendChild(text);
    el.appendChild(close);
    container.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });

    const self = this;
    const remove = function () {
      el.classList.remove('show');
      el.addEventListener('transitionend', function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    };
    close.addEventListener('click', remove);
    const ttl = duration == null ? (type === 'error' ? 6000 : 3500) : duration;
    const timer = setTimeout(remove, ttl);
    el.addEventListener('mouseenter', function () { clearTimeout(timer); });
    return { el: el, dismiss: remove };
  };

  Toast.prototype.info = function (m, d) { return this.show('info', m, d); };
  Toast.prototype.success = function (m, d) { return this.show('success', m, d); };
  Toast.prototype.warn = function (m, d) { return this.show('warn', m, d); };
  Toast.prototype.error = function (m, d) { return this.show('error', m, d); };

  // 把 "CODE:中文说明" 拆出可读说明(模型/布局层抛出的错误格式)
  Toast.prototype.showError = function (err) {
    const message = err && err.message ? String(err.message) : String(err);
    const human = message.indexOf(':') >= 0 ? message.split(':').slice(1).join(':').trim() : message;
    this.error(human || message);
  };

  root.Toast = Toast;
})(typeof self !== 'undefined' ? self : this);
