/* 应用入口：交互编排（拖拽 / 连线 / 平移缩放 / 布局 / 导出） */
(function () {
  'use strict';

  /* ---------- 初始化 ---------- */
  const graph = new Graph();
  const svg = document.getElementById('graph-svg');
  const renderer = new Renderer(svg, graph);
  const layoutEngine = new LayoutEngine();

  const gridCanvas = document.getElementById('grid-canvas');
  const overlayCanvas = document.getElementById('overlay-canvas');
  const statusEl = document.getElementById('status');
  const viewport = document.getElementById('viewport');

  const btnAdd = document.getElementById('btn-add-node');
  const btnConnect = document.getElementById('btn-connect');
  const btnLayout = document.getElementById('btn-layout');
  const btnExport = document.getElementById('btn-export');
  const btnClear = document.getElementById('btn-clear');

  let connectMode = false;
  let connectSourceId = null;
  let selectedId = null;

  /* ---------- 状态栏 ---------- */
  function refreshStatus(extra) {
    statusEl.textContent =
      `节点 ${graph.nodes.size} · 连线 ${graph.edges.size}` + (extra ? ' · ' + extra : '');
  }

  /* ---------- 网格背景（Canvas） ---------- */
  function drawGrid() {
    const dpr = window.devicePixelRatio || 1;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (gridCanvas.width !== w * dpr || gridCanvas.height !== h * dpr) {
      gridCanvas.width = w * dpr;
      gridCanvas.height = h * dpr;
    }
    const ctx = gridCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f4f6fa';
    ctx.fillRect(0, 0, w, h);

    const step = 24 * renderer.view.k;
    if (step > 6) {
      const ox = renderer.view.x % step;
      const oy = renderer.view.y % step;
      ctx.fillStyle = '#d7dee8';
      for (let x = ox; x < w; x += step) {
        for (let y = oy; y < h; y += step) {
          ctx.fillRect(x, y, 1.5, 1.5);
        }
      }
    }
  }

  /* ---------- 连线预览（Overlay Canvas） ---------- */
  let previewLine = null; // {x1,y1,x2,y2} 屏幕坐标
  function drawOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (overlayCanvas.width !== w * dpr || overlayCanvas.height !== h * dpr) {
      overlayCanvas.width = w * dpr;
      overlayCanvas.height = h * dpr;
    }
    const ctx = overlayCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (previewLine) {
      ctx.strokeStyle = '#2fae6e';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(previewLine.x1, previewLine.y1);
      ctx.lineTo(previewLine.x2, previewLine.y2);
      ctx.stroke();
    }
  }

  /* ---------- rAF 批量重绘（拖拽性能） ---------- */
  let rafPending = false;
  const dirtyNodes = new Set();
  function scheduleNodeRedraw(id) {
    dirtyNodes.add(id);
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      for (const nid of dirtyNodes) {
        renderer.updateNodePosition(nid);
        renderer.updateEdgesForNode(nid);
      }
      dirtyNodes.clear();
    });
  }

  /* ---------- 选择 ---------- */
  function selectNode(id) {
    if (selectedId && renderer.nodeEls.get(selectedId)) {
      renderer.nodeEls.get(selectedId).classList.remove('selected');
    }
    selectedId = id;
    if (id && renderer.nodeEls.get(id)) {
      renderer.nodeEls.get(id).classList.add('selected');
    }
  }

  function setConnectSource(id) {
    if (connectSourceId && renderer.nodeEls.get(connectSourceId)) {
      renderer.nodeEls.get(connectSourceId).classList.remove('connect-source');
    }
    connectSourceId = id;
    if (id && renderer.nodeEls.get(id)) {
      renderer.nodeEls.get(id).classList.add('connect-source');
    }
  }

  /* ---------- 指针交互 ---------- */
  const pointers = {
    mode: null,        // 'drag-node' | 'pan' | 'connect'
    nodeId: null,
    startX: 0, startY: 0,
    lastX: 0, lastY: 0,
    moved: false,
  };

  function eventPoint(ev) {
    return { x: ev.clientX, y: ev.clientY };
  }

  function nodeIdFromEvent(ev) {
    const g = ev.target.closest && ev.target.closest('.node');
    return g ? g.dataset.id : null;
  }

  /* pointer capture 会把事件重定向到 svg，需按坐标查找节点 */
  function nodeIdAtPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const g = el && el.closest && el.closest('.node');
    return g ? g.dataset.id : null;
  }

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const p = eventPoint(ev);
    const nodeId = nodeIdFromEvent(ev);

    if (connectMode && nodeId) {
      pointers.mode = 'connect';
      pointers.nodeId = nodeId;
      setConnectSource(nodeId);
      const rect = svg.getBoundingClientRect();
      previewLine = { x1: p.x - rect.left, y1: p.y - rect.top, x2: p.x - rect.left, y2: p.y - rect.top };
      drawOverlay();
    } else if (nodeId) {
      pointers.mode = 'drag-node';
      pointers.nodeId = nodeId;
      pointers.moved = false;
      const node = graph.nodes.get(nodeId);
      const world = renderer.screenToWorld(p.x, p.y);
      pointers.startX = world.x - node.x;
      pointers.startY = world.y - node.y;
      renderer.nodeEls.get(nodeId).classList.add('dragging');
      selectNode(nodeId);
    } else {
      pointers.mode = 'pan';
      pointers.lastX = p.x;
      pointers.lastY = p.y;
      selectNode(null);
    }
    pointers.moved = false;
    svg.setPointerCapture(ev.pointerId);
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!pointers.mode) return;
    const p = eventPoint(ev);
    pointers.moved = true;

    if (pointers.mode === 'drag-node') {
      const node = graph.nodes.get(pointers.nodeId);
      if (!node) { pointers.mode = null; return; }
      const world = renderer.screenToWorld(p.x, p.y);
      node.x = world.x - pointers.startX;
      node.y = world.y - pointers.startY;
      scheduleNodeRedraw(node.id);
    } else if (pointers.mode === 'pan') {
      renderer.view.x += p.x - pointers.lastX;
      renderer.view.y += p.y - pointers.lastY;
      pointers.lastX = p.x;
      pointers.lastY = p.y;
      renderer.applyView();
      drawGrid();
    } else if (pointers.mode === 'connect' && previewLine) {
      const rect = svg.getBoundingClientRect();
      previewLine.x2 = p.x - rect.left;
      previewLine.y2 = p.y - rect.top;
      drawOverlay();
    }
  });

  svg.addEventListener('pointerup', (ev) => {
    const mode = pointers.mode;
    const nodeId = pointers.nodeId;
    pointers.mode = null;
    pointers.nodeId = null;

    if (mode === 'drag-node' && nodeId) {
      const el = renderer.nodeEls.get(nodeId);
      if (el) el.classList.remove('dragging');
      renderer.updateNodePosition(nodeId);
      renderer.updateEdgesForNode(nodeId);
    } else if (mode === 'connect') {
      const targetId = nodeIdAtPoint(ev.clientX, ev.clientY);
      previewLine = null;
      drawOverlay();
      const sourceId = connectSourceId;
      setConnectSource(null);
      if (targetId && sourceId && targetId !== sourceId) {
        try {
          const edge = graph.addEdge(sourceId, targetId);
          renderer.addEdge(edge);
          refreshStatus();
        } catch (err) {
          Toast.error(err.message);
        }
      }
    }
  });

  svg.addEventListener('pointercancel', () => {
    pointers.mode = null;
    pointers.nodeId = null;
    previewLine = null;
    setConnectSource(null);
    drawOverlay();
  });

  /* ---------- 缩放 ---------- */
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const oldK = renderer.view.k;
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    const k = Math.min(4, Math.max(0.2, oldK * factor));
    renderer.view.x = mx - ((mx - renderer.view.x) / oldK) * k;
    renderer.view.y = my - ((my - renderer.view.y) / oldK) * k;
    renderer.view.k = k;
    renderer.applyView();
    drawGrid();
  }, { passive: false });

  /* ---------- 键盘 ---------- */
  window.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedId) {
      try {
        const id = selectedId;
        selectNode(null);
        const removedEdges = [];
        for (const [eid, e] of graph.edges) {
          if (e.source === id || e.target === id) removedEdges.push(eid);
        }
        graph.removeNode(id);
        removedEdges.forEach(eid => renderer.removeEdge(eid));
        renderer.removeNode(id);
        refreshStatus();
        Toast.info('已删除节点');
      } catch (err) {
        Toast.error('删除失败: ' + err.message);
      }
    } else if (ev.key === 'Escape') {
      if (connectMode) toggleConnectMode(false);
      selectNode(null);
    }
  });

  /* ---------- 工具栏 ---------- */
  btnAdd.addEventListener('click', () => {
    try {
      const rect = svg.getBoundingClientRect();
      const center = renderer.screenToWorld(
        rect.left + rect.width / 2 + (Math.random() - 0.5) * 80,
        rect.top + rect.height / 2 + (Math.random() - 0.5) * 80
      );
      const node = graph.addNode(null, center.x, center.y);
      renderer.addNode(node);
      selectNode(node.id);
      refreshStatus();
    } catch (err) {
      Toast.error('添加节点失败: ' + err.message);
    }
  });

  function toggleConnectMode(force) {
    connectMode = typeof force === 'boolean' ? force : !connectMode;
    btnConnect.classList.toggle('active', connectMode);
    btnConnect.textContent = connectMode ? '🔗 连线中…' : '🔗 连线';
    if (!connectMode) {
      setConnectSource(null);
      previewLine = null;
      drawOverlay();
    }
    refreshStatus(connectMode ? '连线模式：从源节点拖到目标节点' : '');
  }
  btnConnect.addEventListener('click', () => toggleConnectMode());

  btnLayout.addEventListener('click', () => {
    btnLayout.disabled = true;
    refreshStatus('布局计算中…');
    layoutEngine.run(graph, {
      onTick(positions) {
        for (const p of positions) {
          const n = graph.nodes.get(p.id);
          if (n) { n.x = p.x; n.y = p.y; }
        }
        requestAnimationFrame(() => renderer.updateAllPositions());
      },
      onDone(positions) {
        for (const p of positions) {
          const n = graph.nodes.get(p.id);
          if (n) { n.x = p.x; n.y = p.y; }
        }
        renderer.updateAllPositions();
        btnLayout.disabled = false;
        refreshStatus();
        Toast.success('布局完成');
      },
      onError(err) {
        btnLayout.disabled = false;
        refreshStatus();
        Toast.error('布局失败: ' + err.message);
      },
    });
  });

  btnExport.addEventListener('click', () => {
    try {
      Exporter.exportSvg(graph);
      Toast.success('SVG 已导出');
    } catch (err) {
      Toast.error('导出失败: ' + err.message);
    }
  });

  btnClear.addEventListener('click', () => {
    if (graph.size === 0) return;
    if (!window.confirm('确定清空画布？此操作不可撤销。')) return;
    try {
      layoutEngine.cancel();
      graph.clear();
      renderer.renderAll();
      selectNode(null);
      refreshStatus();
      Toast.info('画布已清空');
    } catch (err) {
      Toast.error('清空失败: ' + err.message);
    }
  });

  /* ---------- 窗口尺寸 ---------- */
  window.addEventListener('resize', () => {
    drawGrid();
    drawOverlay();
  });

  /* ---------- 示例数据 ---------- */
  function seed() {
    try {
      const names = ['入口', '鉴权', '订单', '支付', '库存', '通知', '日志', '网关'];
      const ids = [];
      names.forEach((label, i) => {
        const angle = (i / names.length) * Math.PI * 2;
        const node = graph.addNode(label, 500 + Math.cos(angle) * 220, 320 + Math.sin(angle) * 180);
        ids.push(node.id);
      });
      const pairs = [[0, 1], [0, 7], [7, 2], [2, 3], [2, 4], [3, 5], [1, 6], [4, 6], [5, 0]];
      for (const [a, b] of pairs) graph.addEdge(ids[a], ids[b]);
      renderer.renderAll();
      refreshStatus();
    } catch (err) {
      Toast.error('初始化示例数据失败: ' + err.message);
    }
  }

  renderer.applyView();
  drawGrid();
  seed();
})();
