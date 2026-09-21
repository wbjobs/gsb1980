/*
 * 应用入口:组装模型/渲染器/交互/布局执行器,处理工具栏、导入导出与全局异常。
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  const toast = new Toast();
  const canvas = $('canvas');
  const state = {
    selectedNodes: new Set(),
    selectedEdges: new Set(),
    hover: null,
    activePort: null,
    showPortsFor: null
  };

  const ctx2d = canvas.getContext('2d');
  const model = new GraphModel(ctx2d);
  const renderer = new Renderer(canvas, model, state);
  const runner = new LayoutRunner({ workerUrl: 'js/layout.worker.js', toast: toast });

  let currentJobId = null;

  // ---------- 示例数据 ----------

  function buildSample(kind) {
    const data = { nodes: [], edges: [] };
    if (kind === 'dag') {
      const defs = [
        ['start', '用户提交订单'], ['check', '风控校验'], ['stock', '库存检查'],
        ['pay', '支付处理'], ['coupon', '优惠券核销'], ['ship', '仓库发货'],
        ['notify', '短信通知'], ['done', '订单完成'], ['manual', '人工审核'],
        ['refund', '退款流程']
      ];
      defs.forEach((d) => data.nodes.push({ id: d[0], label: d[1] }));
      [
        ['start', 'check'], ['start', 'stock'], ['check', 'pay'], ['stock', 'pay'],
        ['pay', 'coupon'], ['pay', 'ship'], ['check', 'manual'], ['manual', 'pay'],
        ['ship', 'notify'], ['coupon', 'done'], ['ship', 'done'], ['notify', 'done'],
        ['manual', 'refund']
      ].forEach((e) => data.edges.push({ source: e[0], target: e[1] }));
    } else if (kind === 'circle') {
      const services = ['网关', '认证', '用户', '订单', '商品', '库存', '支付', '通知', '日志', '配置'];
      services.forEach((s, i) => data.nodes.push({ id: 's' + i, label: s + '服务' }));
      services.forEach((s, i) => {
        data.edges.push({ source: 's0', target: 's' + i });
        if (i > 1) data.edges.push({ source: 's' + (i - 1), target: 's' + i });
      });
    } else {
      const count = kind === 'stress' ? 800 : 200;
      const rng = Geo.mulberry32(kind === 'stress' ? 99 : 42);
      for (let i = 0; i < count; i++) {
        data.nodes.push({ id: 'n' + i, label: '实体 ' + i });
      }
      for (let i = 1; i < count; i++) {
        // 偏连向前面少数"枢纽"节点,形成社群结构
        const hub = Math.floor(Math.pow(rng(), 2.2) * i);
        data.edges.push({ source: 'n' + hub, target: 'n' + i });
        if (rng() < 0.35) {
          data.edges.push({ source: 'n' + Math.floor(rng() * i), target: 'n' + i });
        }
      }
    }
    return data;
  }

  function loadData(data, autoLayoutAlgo) {
    try {
      const result = model.load(data);
      state.selectedNodes.clear();
      state.selectedEdges.clear();
      updateStats();
      if (result.warnings && result.warnings.length) {
        toast.warn('导入完成,但有 ' + result.warnings.length + ' 条问题连线被跳过');
      }
      runLayout(autoLayoutAlgo || $('algo-select').value, true);
    } catch (err) {
      toast.showError(err);
    }
  }

  // ---------- 布局 ----------

  function setProgressUI(running, progress) {
    const bar = $('layout-progress');
    bar.hidden = !running;
    $('progress-fill').style.width = Math.round((progress || 0) * 100) + '%';
    $('progress-text').textContent = running
      ? '布局计算中… ' + Math.round((progress || 0) * 100) + '%'
      : '';
    $('btn-layout').disabled = running;
    $('btn-cancel-layout').disabled = !running;
  }

  function runLayout(algo, fitAfter) {
    if (!model.nodes.length) {
      toast.warn('画布为空,请先添加或导入节点');
      return;
    }
    const payload = model.toJSON();
    const t0 = performance.now();
    setProgressUI(true, 0.02);
    $('stat-layout').textContent = '布局:计算中…';

    currentJobId = runner.run({
      algo: algo,
      nodes: payload.nodes,
      edges: payload.edges,
      options: { seed: 7 },
      onProgress: function (p) { setProgressUI(true, p); },
      onDone: function (result) {
        currentJobId = null;
        model.applyPositions(result.nodes);
        setProgressUI(false);
        const cost = Math.round(performance.now() - t0);
        $('stat-layout').textContent = '布局:' + algo.toUpperCase() + ' · ' + cost + 'ms';
        if (fitAfter) renderer.fitView();
        renderer.invalidate();
        if (result.warnings && result.warnings.length) {
          result.warnings.forEach(function (w) { toast.warn(w.split(':').slice(1).join(':') || w); });
        } else {
          toast.success('布局完成:' + result.nodes.length + ' 个节点,用时 ' + cost + 'ms');
        }
      },
      onError: function (err, code) {
        currentJobId = null;
        setProgressUI(false);
        $('stat-layout').textContent = '布局:失败';
        if (code === 'GRAPH_EMPTY') toast.warn('画布为空,无法布局');
        else toast.showError(err);
      }
    });
  }

  // ---------- 导出 ----------

  function timestamp() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function exportSVG() {
    try {
      const svg = SVGExporter.exportSVG(model, {
        selectedNodes: state.selectedNodes,
        selectedEdges: state.selectedEdges
      });
      SVGExporter.download('graph_' + timestamp() + '.svg', svg, 'image/svg+xml;charset=utf-8');
      toast.success('SVG 已导出,共 ' + model.nodes.length + ' 个节点');
    } catch (err) {
      toast.showError(err);
    }
  }

  function exportPNG() {
    try {
      const svg = SVGExporter.exportSVG(model, {});
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = new Image();
      img.onload = function () {
        const scale = 2;
        const cvs = document.createElement('canvas');
        cvs.width = img.width * scale;
        cvs.height = img.height * scale;
        const c = cvs.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, cvs.width, cvs.height);
        c.drawImage(img, 0, 0, cvs.width, cvs.height);
        try {
          const a = document.createElement('a');
          a.download = 'graph_' + timestamp() + '.png';
          a.href = cvs.toDataURL('image/png');
          a.click();
          toast.success('PNG 已导出');
        } catch (err) {
          toast.showError(err);
        }
      };
      img.onerror = function () {
        toast.error('PNG 栅格化失败,请改用 SVG 导出');
      };
      img.src = url;
    } catch (err) {
      toast.showError(err);
    }
  }

  // ---------- 导入 ----------

  function importJSONFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result));
        loadData(data);
        toast.success('已导入 ' + (data.nodes ? data.nodes.length : 0) + ' 个节点');
      } catch (err) {
        if (err instanceof SyntaxError) toast.error('JSON 解析失败:' + err.message);
        else toast.showError(err);
      }
    };
    reader.onerror = function () { toast.error('文件读取失败'); };
    reader.readAsText(file);
  }

  // ---------- 状态栏 ----------

  function updateStats() {
    $('stat-count').textContent = '节点 ' + model.nodes.length + ' · 连线 ' + model.edges.length;
  }
  model.subscribe(updateStats);

  renderer.onFps = function (fps) {
    const el = $('stat-fps');
    el.textContent = 'FPS ' + fps;
    el.style.color = fps >= 50 ? '' : fps >= 30 ? '#e0a020' : '#d04a3d';
  };

  // ---------- 事件绑定 ----------

  $('btn-layout').addEventListener('click', function () {
    runLayout($('algo-select').value, false);
  });
  $('btn-cancel-layout').addEventListener('click', function () {
    if (currentJobId) runner.cancel(currentJobId);
    setProgressUI(false);
    $('stat-layout').textContent = '布局:已取消';
    toast.info('已取消布局');
  });
  $('btn-fit').addEventListener('click', function () { renderer.fitView(); });
  $('btn-export-svg').addEventListener('click', exportSVG);
  $('btn-export-png').addEventListener('click', exportPNG);
  $('btn-clear').addEventListener('click', function () {
    if (!model.nodes.length) return;
    if (window.confirm('确定清空当前画布?')) {
      model.clear();
      state.selectedNodes.clear();
      state.selectedEdges.clear();
      updateStats();
      toast.info('画布已清空');
    }
  });
  $('btn-import').addEventListener('click', function () { $('file-input').click(); });
  $('file-input').addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) importJSONFile(e.target.files[0]);
    e.target.value = '';
  });
  $('sample-select').addEventListener('change', function (e) {
    const kind = e.target.value;
    if (!kind) return;
    const algo = kind === 'force' || kind === 'stress' ? 'force' : kind === 'circle' ? 'circle' : 'dag';
    $('algo-select').value = algo;
    loadData(buildSample(kind), algo);
    e.target.value = '';
  });
  $('btn-help').addEventListener('click', function () {
    const panel = $('help-panel');
    panel.hidden = !panel.hidden;
  });

  // 拖拽 JSON 文件到页面
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && /\.json$/i.test(file.name)) importJSONFile(file);
    else if (file) toast.warn('仅支持 .json 文件');
  });

  // 全局异常兜底,保证用户可见
  window.addEventListener('error', function (e) {
    const msg = e && e.message ? e.message : '未知错误';
    toast.error('程序异常:' + msg);
  });
  window.addEventListener('unhandledrejection', function (e) {
    const reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    toast.error('异步任务异常:' + reason);
  });

  // ---------- 启动 ----------

  const interaction = new Interaction(canvas, renderer, model, toast, {
    onConnect: function () { /* 状态已自动更新 */ },
    onNodeCreate: function () { renderer.invalidate(); }
  });
  window.__app = { model: model, renderer: renderer, runner: runner, interaction: interaction, toast: toast };

  loadData(buildSample('dag'), 'dag');
})();
