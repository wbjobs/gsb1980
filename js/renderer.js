/*
 * Canvas 视口渲染器:
 *  - 世界/屏幕坐标变换(平移 + 缩放),支持 devicePixelRatio
 *  - 视口裁剪,大图谱下只绘制可见元素
 *  - 脏标记 + requestAnimationFrame 合帧,拖拽时只重绘一次/帧
 *  - 节点/连线/端口命中测试
 */
(function (root, factory) {
  const api = factory(root.Geo);
  root.Renderer = api;
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  const NODE_FILL = '#ffffff';
  const NODE_STROKE = '#c4cad6';
  const NODE_SELECTED_STROKE = '#3b82f6';
  const EDGE_STROKE = '#8a94a6';
  const EDGE_SELECTED = '#3b82f6';
  const GRID_COLOR = '#e8ebf1';
  const PORT_COLOR = '#9aa4b6';
  const PORT_ACTIVE = '#3b82f6';

  function Renderer(canvas, model, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.model = model;
    this.state = state || { selectedNodes: new Set(), selectedEdges: new Set(), hover: null };
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.minScale = 0.15;
    this.maxScale = 3;
    this.dirty = true;
    this._lastFrame = 0;
    this._fps = 60;
    this._fpsSamples = [];
    this.onFps = null;
    this.tempEdge = null; // {from:{x,y}, to:{x,y}, sourceId, validTarget}
    this.marquee = null;  // {x,y,w,h} 屏幕坐标
    this.smallGraph = model.nodes.length <= 200;

    const self = this;
    this._resizeObserver = new ResizeObserver(function () {
      self.resize();
      self.invalidate();
    });
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();

    model.subscribe(function () { self.invalidate(); self.smallGraph = model.nodes.length <= 200; });
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  Renderer.prototype.resize = function () {
    const parent = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent ? parent.clientWidth : window.innerWidth;
    const cssH = parent ? parent.clientHeight : window.innerHeight;
    this.viewW = cssW;
    this.viewH = cssH;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.dpr = dpr;
  };

  Renderer.prototype.invalidate = function () { this.dirty = true; };

  Renderer.prototype.toWorld = function (sx, sy) {
    return { x: (sx - this.panX) / this.scale, y: (sy - this.panY) / this.scale };
  };

  Renderer.prototype.toScreen = function (wx, wy) {
    return { x: wx * this.scale + this.panX, y: wy * this.scale + this.panY };
  };

  Renderer.prototype.zoomAt = function (sx, sy, factor) {
    const newScale = Geo.clamp(this.scale * factor, this.minScale, this.maxScale);
    const real = newScale / this.scale;
    this.panX = sx - (sx - this.panX) * real;
    this.panY = sy - (sy - this.panY) * real;
    this.scale = newScale;
    this.invalidate();
  };

  Renderer.prototype.fitView = function (padding) {
    const nodes = this.model.nodes;
    if (!nodes.length) { this.panX = 0; this.panY = 0; this.scale = 1; this.invalidate(); return; }
    const b = Geo.graphBounds(nodes);
    const pad = padding == null ? 80 : padding;
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    const scale = Geo.clamp(Math.min((this.viewW - pad * 2) / w, (this.viewH - pad * 2) / h), this.minScale, this.maxScale);
    this.scale = scale;
    this.panX = this.viewW / 2 - ((b.minX + b.maxX) / 2) * scale;
    this.panY = this.viewH / 2 - ((b.minY + b.maxY) / 2) * scale;
    this.invalidate();
  };

  Renderer.prototype._loop = function (ts) {
    if (this._lastFrame) {
      const dt = ts - this._lastFrame;
      if (dt > 0) {
        this._fpsSamples.push(1000 / dt);
        if (this._fpsSamples.length > 30) this._fpsSamples.shift();
        const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
        this._fps = Math.round(avg);
        if (this.onFps) this.onFps(this._fps);
      }
    }
    this._lastFrame = ts;
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
    requestAnimationFrame(this._loop);
  };

  Renderer.prototype._viewBounds = function () {
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.viewW, this.viewH);
    return { minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y };
  };

  Renderer.prototype._nodeVisible = function (n, vb, margin) {
    const m = margin || 60;
    return n.x + n.w / 2 + m > vb.minX && n.x - n.w / 2 - m < vb.maxX &&
      n.y + n.h / 2 + m > vb.minY && n.y - n.h / 2 - m < vb.maxY;
  };

  Renderer.prototype.draw = function () {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.fillStyle = '#f7f8fb';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    this._drawGrid();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    const vb = this._viewBounds();
    const byId = new Map();
    const visibleNodes = new Set();
    this.model.nodes.forEach((n) => {
      if (this._nodeVisible(n, vb)) { byId.set(n.id, n); visibleNodes.add(n.id); }
    });

    // 边
    for (const edge of this.model.edges) {
      if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
      this._drawEdge(ctx, edge, byId);
    }

    // 节点
    for (const n of byId.values()) this._drawNode(ctx, n);

    // 拖拽中的临时连线
    if (this.tempEdge) this._drawTempEdge(ctx);

    // 还原变换后绘制框选矩形
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.marquee) {
      ctx.save();
      ctx.fillStyle = 'rgba(59,130,246,0.10)';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(this.marquee.x, this.marquee.y, this.marquee.w, this.marquee.h);
      ctx.strokeRect(this.marquee.x, this.marquee.y, this.marquee.w, this.marquee.h);
      ctx.restore();
    }
  };

  Renderer.prototype._drawGrid = function () {
    const ctx = this.ctx;
    const step = 24 * this.scale;
    if (step < 6) return; // 缩放过小时不画网格,避免性能浪费
    ctx.save();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const offX = ((this.panX % step) + step) % step;
    const offY = ((this.panY % step) + step) % step;
    for (let x = offX; x < this.viewW; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.viewH);
    }
    for (let y = offY; y < this.viewH; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.viewW, Math.round(y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype._drawEdge = function (ctx, edge, byId) {
    const pts = Geo.edgeEndpoints(edge, byId);
    const path = Geo.edgePathD(pts);
    const selected = this.state.selectedEdges.has(edge.id);
    const hovered = this.state.hover === 'edge:' + edge.id;
    ctx.save();
    ctx.beginPath();
    const trace = this._tracePath(ctx, pts);
    ctx.strokeStyle = selected || hovered ? EDGE_SELECTED : EDGE_STROKE;
    ctx.lineWidth = selected ? 2.2 : hovered ? 2.4 : 1.5;
    ctx.stroke();
    this._drawArrow(ctx, pts.tx, pts.ty, path, selected || hovered ? EDGE_SELECTED : EDGE_STROKE);
    ctx.restore();
  };

  Renderer.prototype._tracePath = function (ctx, pts) {
    const p = Geo.edgePathD(pts);
    const nums = p.d.match(/-?\d+(\.\d+)?/g).map(Number);
    ctx.moveTo(nums[0], nums[1]);
    ctx.bezierCurveTo(nums[2], nums[3], nums[4], nums[5], nums[6], nums[7]);
    return p;
  };

  Renderer.prototype._drawArrow = function (ctx, tx, ty, path, color) {
    const vx = tx - path.tangent.x;
    const vy = ty - path.tangent.y;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len, uy = vy / len;
    const size = 9 / Math.max(this.scale, 0.6);
    const bx = tx - ux * size, by = ty - uy * size;
    const px = -uy, py = ux;
    const w = size * 0.42;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(bx + px * w, by + py * w);
    ctx.lineTo(bx - px * w, by - py * w);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  Renderer.prototype._drawTempEdge = function (ctx) {
    const te = this.tempEdge;
    const path = Geo.edgePathD({ sx: te.from.x, sy: te.from.y, tx: te.to.x, ty: te.to.y });
    ctx.save();
    ctx.beginPath();
    const nums = path.d.match(/-?\d+(\.\d+)?/g).map(Number);
    ctx.moveTo(nums[0], nums[1]);
    ctx.bezierCurveTo(nums[2], nums[3], nums[4], nums[5], nums[6], nums[7]);
    ctx.strokeStyle = te.validTarget ? '#3b82f6' : '#c0584d';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    this._drawArrow(ctx, te.to.x, te.to.y, path, te.validTarget ? '#3b82f6' : '#c0584d');
    ctx.restore();
  };

  Renderer.prototype._drawNode = function (ctx, node) {
    const selected = this.state.selectedNodes.has(node.id);
    const x = node.x - node.w / 2;
    const y = node.y - node.h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(31,41,55,0.10)';
    ctx.shadowBlur = 6 / this.scale;
    ctx.shadowOffsetY = 1.5 / this.scale;
    this._roundRect(ctx, x, y, node.w, node.h, 8);
    ctx.fillStyle = node.color || NODE_FILL;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = selected ? NODE_SELECTED_STROKE : NODE_STROKE;
    ctx.lineWidth = selected ? 2.2 : 1.3;
    ctx.stroke();

    // 端口:小图常显,大图悬停节点时显示(交互层控制 showPortsFor)
    if (this.smallGraph || (this.state.showPortsFor && this.state.showPortsFor.has(node.id))) {
      this._drawPorts(ctx, node);
    }

    ctx.fillStyle = '#1f2937';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxChars = Math.max(2, Math.floor((node.w - 16) / 7));
    let label = String(node.label || '');
    if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '…';
    ctx.fillText(label, node.x, node.y + 1);
    ctx.restore();
  };

  Renderer.prototype._drawPorts = function (ctx, node) {
    const r = 4.2 / Math.max(this.scale, 0.6);
    const active = this.state.activePort && this.state.activePort.nodeId === node.id;
    const ports = [
      { x: node.x, y: node.y - node.h / 2 },
      { x: node.x + node.w / 2, y: node.y },
      { x: node.x, y: node.y + node.h / 2 },
      { x: node.x - node.w / 2, y: node.y }
    ];
    for (let i = 0; i < ports.length; i++) {
      const p = ports[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = active && this.state.activePort.side === i ? PORT_ACTIVE : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = active && this.state.activePort.side === i ? PORT_ACTIVE : PORT_COLOR;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  };

  Renderer.prototype._roundRect = function (ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  // ---------- 命中测试(世界坐标) ----------

  Renderer.prototype.portAt = function (wx, wy) {
    const tol = 12;
    // 从顶层(数组末尾)往下
    for (let i = this.model.nodes.length - 1; i >= 0; i--) {
      const n = this.model.nodes[i];
      const ports = [
        { side: 0, x: n.x, y: n.y - n.h / 2 },
        { side: 1, x: n.x + n.w / 2, y: n.y },
        { side: 2, x: n.x, y: n.y + n.h / 2 },
        { side: 3, x: n.x - n.w / 2, y: n.y }
      ];
      for (const p of ports) {
        if (Math.abs(wx - p.x) <= tol && Math.abs(wy - p.y) <= tol) {
          return { nodeId: n.id, side: p.side, x: p.x, y: p.y };
        }
      }
    }
    return null;
  };

  Renderer.prototype.nodeAt = function (wx, wy) {
    for (let i = this.model.nodes.length - 1; i >= 0; i--) {
      const n = this.model.nodes[i];
      if (Math.abs(wx - n.x) <= n.w / 2 && Math.abs(wy - n.y) <= n.h / 2) return n;
    }
    return null;
  };

  Renderer.prototype.edgeAt = function (wx, wy) {
    const tol = 8 / this.scale;
    const byId = new Map();
    this.model.nodes.forEach((n) => byId.set(n.id, n));
    let best = null;
    let bestDist = tol;
    for (let i = this.model.edges.length - 1; i >= 0; i--) {
      const edge = this.model.edges[i];
      const s = byId.get(edge.source);
      const t = byId.get(edge.target);
      if (!s || !t) continue;
      const pts = Geo.edgeEndpoints(edge, byId);
      const dist = Geo.distanceToEdgePath(wx, wy, pts, 20);
      if (dist < bestDist) {
        bestDist = dist;
        best = edge;
      }
    }
    return best;
  };

  // 综合命中:端口 > 节点 > 连线
  Renderer.prototype.hitTest = function (wx, wy) {
    const port = this.portAt(wx, wy);
    if (port) return { type: 'port', port: port };
    const node = this.nodeAt(wx, wy);
    if (node) return { type: 'node', node: node };
    const edge = this.edgeAt(wx, wy);
    if (edge) return { type: 'edge', edge: edge };
    return { type: 'empty' };
  };

  Renderer.prototype.nodesInRect = function (worldRect) {
    const r = worldRect;
    const result = [];
    for (const n of this.model.nodes) {
      if (
        n.x + n.w / 2 > r.minX && n.x - n.w / 2 < r.maxX &&
        n.y + n.h / 2 > r.minY && n.y - n.h / 2 < r.maxY
      ) {
        result.push(n);
      }
    }
    return result;
  };

  return { Renderer: Renderer };
});
