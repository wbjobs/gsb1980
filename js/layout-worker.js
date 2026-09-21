/* 布局 Web Worker：在后台线程执行力导向布局，逐 tick 回传位置 */
/* global LayoutCore */
'use strict';

try {
  importScripts('layout-core.js');
} catch (e) {
  postMessage({ type: 'error', message: 'Worker 加载布局核心失败: ' + e.message });
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.type !== 'layout') return;
  try {
    const nodes = msg.nodes.map(n => ({ ...n }));
    const result = LayoutCore.compute(nodes, msg.edges, msg.options, (ns, iter, total) => {
      postMessage({
        type: 'tick',
        iter, total,
        positions: ns.map(n => ({ id: n.id, x: n.x, y: n.y })),
      });
    });
    postMessage({
      type: 'done',
      positions: result.map(n => ({ id: n.id, x: n.x, y: n.y })),
    });
  } catch (e) {
    postMessage({ type: 'error', message: '布局计算异常: ' + (e && e.message ? e.message : String(e)) });
  }
};
