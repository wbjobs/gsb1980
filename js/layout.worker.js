/*
 * 布局 Web Worker:避免大图谱布局阻塞主线程渲染。
 * 消息协议:
 *   主线程 -> worker: {type:'run', jobId, algo, nodes, edges, options}
 *                      {type:'cancel', jobId}
 *   worker -> 主线程: {type:'progress', jobId, progress}
 *                      {type:'done', jobId, result}
 *                      {type:'error', jobId, message, code}
 */
'use strict';

if (typeof importScripts === 'function') {
  importScripts('geometry.js', 'layout.js');
}

let currentJob = null;

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.type === 'cancel') {
    if (currentJob === msg.jobId) currentJob = null;
    return;
  }
  if (msg.type !== 'run') return;

  currentJob = msg.jobId;
  try {
    const options = Object.assign({}, msg.options || {}, {
      onProgress: function (p) {
        if (currentJob !== msg.jobId) {
          throw Object.assign(new Error('CANCELLED:布局已取消'), { code: 'CANCELLED' });
        }
        self.postMessage({ type: 'progress', jobId: msg.jobId, progress: p });
      }
    });
    const result = self.Layout.run(msg.algo, msg.nodes, msg.edges, options);
    if (currentJob !== msg.jobId) return;
    currentJob = null;
    self.postMessage({ type: 'done', jobId: msg.jobId, result: result });
  } catch (err) {
    if (err && err.code === 'CANCELLED') return;
    currentJob = null;
    self.postMessage({
      type: 'error',
      jobId: msg.jobId,
      message: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : 'LAYOUT_FAILED'
    });
  }
};
