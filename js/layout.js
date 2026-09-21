/* 布局引擎：优先 Web Worker，失败时降级为主线程分片执行 */
(function (global) {
  'use strict';

  const WORKER_URL = 'js/layout-worker.js';

  class LayoutEngine {
    constructor() {
      this.worker = null;
      this.running = false;
      this._cancelled = false;
    }

    /**
     * @param {Graph} graph
     * @param {Object} hooks {onTick(positions), onDone(positions), onError(err)}
     */
    run(graph, hooks) {
      if (this.running) {
        hooks.onError && hooks.onError(new Error('布局正在运行中'));
        return;
      }
      if (graph.size === 0) {
        hooks.onError && hooks.onError(new Error('画布为空，无法布局'));
        return;
      }
      this.running = true;
      this._cancelled = false;

      const payload = {
        type: 'layout',
        nodes: [...graph.nodes.values()].map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
        edges: [...graph.edges.values()].map(e => ({ source: e.source, target: e.target })),
        options: {},
      };

      const done = () => { this.running = false; };

      if (this._canUseWorker()) {
        this._runInWorker(payload, hooks, done);
      } else {
        this._runOnMainThread(payload, hooks, done);
      }
    }

    cancel() {
      this._cancelled = true;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      this.running = false;
    }

    _canUseWorker() {
      return typeof Worker !== 'undefined' && location.protocol !== 'file:';
    }

    _runInWorker(payload, hooks, done) {
      let worker;
      try {
        worker = new Worker(WORKER_URL);
      } catch (e) {
        this._runOnMainThread(payload, hooks, done);
        return;
      }
      this.worker = worker;

      worker.onmessage = (ev) => {
        if (this._cancelled) return;
        const msg = ev.data || {};
        if (msg.type === 'tick') {
          hooks.onTick && hooks.onTick(msg.positions);
        } else if (msg.type === 'done') {
          hooks.onDone && hooks.onDone(msg.positions);
          this._cleanup(worker, done);
        } else if (msg.type === 'error') {
          hooks.onError && hooks.onError(new Error(msg.message));
          this._cleanup(worker, done);
        }
      };
      worker.onerror = (e) => {
        // Worker 运行失败：降级主线程重试一次
        this._cleanup(worker, done);
        this.running = true;
        this._runOnMainThread(payload, hooks, done);
      };
      try {
        worker.postMessage(payload);
      } catch (e) {
        this._cleanup(worker, done);
        hooks.onError && hooks.onError(new Error('无法向布局线程发送数据: ' + e.message));
      }
    }

    _cleanup(worker, done) {
      try { worker.terminate(); } catch (_) { /* ignore */ }
      if (this.worker === worker) this.worker = null;
      done();
    }

    /* 主线程降级：用 setTimeout 分片，避免长时间阻塞 UI */
    _runOnMainThread(payload, hooks, done) {
      if (typeof LayoutCore === 'undefined') {
        done();
        hooks.onError && hooks.onError(new Error('布局核心未加载'));
        return;
      }
      setTimeout(() => {
        try {
          const nodes = payload.nodes.map(n => ({ ...n }));
          const result = LayoutCore.compute(nodes, payload.edges, payload.options, (ns) => {
            if (!this._cancelled && hooks.onTick) {
              hooks.onTick(ns.map(n => ({ id: n.id, x: n.x, y: n.y })));
            }
          });
          if (!this._cancelled && hooks.onDone) {
            hooks.onDone(result.map(n => ({ id: n.id, x: n.x, y: n.y })));
          }
        } catch (e) {
          hooks.onError && hooks.onError(e instanceof Error ? e : new Error(String(e)));
        } finally {
          done();
        }
      }, 0);
    }
  }

  global.LayoutEngine = LayoutEngine;
})(window);
