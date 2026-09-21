/*
 * 布局执行器:优先使用 Web Worker;不可用时降级为分帧主线程计算,
 * 并通过 toast 提示用户。
 */
(function (root) {
  'use strict';

  function LayoutRunner(options) {
    const opts = options || {};
    this.workerUrl = opts.workerUrl || 'js/layout.worker.js';
    this.toast = opts.toast || null;
    this.worker = null;
    this.workerBroken = false;
    this.jobSeq = 0;
    this.jobs = new Map();
  }

  LayoutRunner.prototype._ensureWorker = function () {
    if (this.workerBroken || typeof Worker === 'undefined') return false;
    if (this.worker) return true;
    try {
      const worker = new Worker(this.workerUrl);
      worker.onmessage = this._onWorkerMessage.bind(this);
      worker.onerror = this._onWorkerError.bind(this);
      this.worker = worker;
      return true;
    } catch (err) {
      this.workerBroken = true;
      if (this.toast) {
        this.toast.warn('Web Worker 初始化失败,已切换为主线程布局(大图可能短暂卡顿)');
      }
      return false;
    }
  };

  LayoutRunner.prototype._onWorkerMessage = function (ev) {
    const msg = ev.data || {};
    const job = this.jobs.get(msg.jobId);
    if (!job) return;
    if (msg.type === 'progress' && job.onProgress) job.onProgress(msg.progress);
    else if (msg.type === 'done') {
      this.jobs.delete(msg.jobId);
      if (job.onDone) job.onDone(msg.result);
    } else if (msg.type === 'error') {
      this.jobs.delete(msg.jobId);
      if (job.onError) job.onError(new Error(msg.message), msg.code);
    }
  };

  LayoutRunner.prototype._onWorkerError = function (ev) {
    // Worker 加载失败(如 file:// 打开)时,挂起的任务降级执行
    this.workerBroken = true;
    try { if (this.worker) this.worker.terminate(); } catch (e) { /* noop */ }
    this.worker = null;
    if (this.toast) {
      this.toast.warn('布局线程不可用(需通过 http 访问),已切换为主线程布局');
    }
    // onerror 可能在 worker 内部错误消息之后到达,jobs 中剩余的才是需要降级的任务
    Array.from(this.jobs.values()).forEach((job) => {
      this.jobs.delete(job.id);
      this._runOnMain(job);
    });
  };

  LayoutRunner.prototype._runOnMain = function (job) {
    const self = this;
    let frame = 0;
    const options = Object.assign({}, job.options || {}, {
      onProgress: function (p) {
        if (job.cancelled) {
          throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
        }
        if (job.onProgress) job.onProgress(p);
      }
    });
    // 让进度条先渲染一帧
    setTimeout(function () {
      try {
        if (job.cancelled) return;
        const result = root.Layout.run(job.algo, job.nodes, job.edges, options);
        if (!job.cancelled && job.onDone) job.onDone(result);
      } catch (err) {
        if (err && err.code === 'CANCELLED') return;
        if (job.onError) job.onError(err, err && err.code);
      }
    }, 16);
  };

  // {algo, nodes, edges, options, onProgress, onDone, onError} -> jobId
  LayoutRunner.prototype.run = function (config) {
    const jobId = 'job_' + ++this.jobSeq;
    const job = {
      id: jobId,
      algo: config.algo,
      nodes: config.nodes,
      edges: config.edges,
      options: config.options || {},
      onProgress: config.onProgress,
      onDone: config.onDone,
      onError: config.onError,
      cancelled: false
    };
    if (this._ensureWorker()) {
      this.jobs.set(jobId, job);
      this.worker.postMessage({
        type: 'run',
        jobId: jobId,
        algo: job.algo,
        nodes: job.nodes,
        edges: job.edges,
        options: job.options
      });
    } else {
      this._runOnMain(job);
    }
    return jobId;
  };

  LayoutRunner.prototype.cancel = function (jobId) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.cancelled = true;
      this.jobs.delete(jobId);
      if (this.worker) this.worker.postMessage({ type: 'cancel', jobId: jobId });
    }
  };

  root.LayoutRunner = LayoutRunner;
})(typeof self !== 'undefined' ? self : this);
