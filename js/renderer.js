/* SVG 渲染器：节点 / 边的 DOM 同步与视口变换 */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  class Renderer {
    constructor(svg, graph) {
      this.svg = svg;
      this.graph = graph;
      this.viewportG = svg.querySelector('#viewport-g');
      this.edgesG = svg.querySelector('#edges-g');
      this.nodesG = svg.querySelector('#nodes-g');
      this.nodeEls = new Map(); // id -> <g>
      this.edgeEls = new Map(); // id -> <g>
      // 视口变换（平移 + 缩放）
      this.view = { x: 0, y: 0, k: 1 };
      this._ensureDefs();
    }

    _ensureDefs() {
      const defs = document.createElementNS(SVG_NS, 'defs');
      const marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', 'arrowhead');
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '7');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('orient', 'auto-start-reverse');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      path.setAttribute('fill', '#8a97a8');
      marker.appendChild(path);
      defs.appendChild(marker);
      this.svg.insertBefore(defs, this.svg.firstChild);
    }

    /* ---- 视口 ---- */
    applyView() {
      const { x, y, k } = this.view;
      this.viewportG.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
    }

    screenToWorld(px, py) {
      const rect = this.svg.getBoundingClientRect();
      return {
        x: (px - rect.left - this.view.x) / this.view.k,
        y: (py - rect.top - this.view.y) / this.view.k,
      };
    }

    /* ---- 节点 ---- */
    addNode(node) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'node');
      g.dataset.id = node.id;

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', -node.w / 2);
      rect.setAttribute('y', -node.h / 2);
      rect.setAttribute('width', node.w);
      rect.setAttribute('height', node.h);
      rect.setAttribute('rx', 8);

      const text = document.createElementNS(SVG_NS, 'text');
      text.textContent = node.label;

      g.appendChild(rect);
      g.appendChild(text);
      this.nodesG.appendChild(g);
      this.nodeEls.set(node.id, g);
      this.updateNodePosition(node.id);
    }

    removeNode(id) {
      const el = this.nodeEls.get(id);
      if (el) el.remove();
      this.nodeEls.delete(id);
    }

    updateNodePosition(id) {
      const node = this.graph.nodes.get(id);
      const el = this.nodeEls.get(id);
      if (!node || !el) return;
      el.setAttribute('transform', `translate(${node.x},${node.y})`);
    }

    /* ---- 边 ---- */
    addEdge(edge) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'edge');
      g.dataset.id = edge.id;
      const path = document.createElementNS(SVG_NS, 'path');
      g.appendChild(path);
      this.edgesG.appendChild(g);
      this.edgeEls.set(edge.id, g);
      this.updateEdge(edge.id);
    }

    removeEdge(id) {
      const el = this.edgeEls.get(id);
      if (el) el.remove();
      this.edgeEls.delete(id);
    }

    /* 三次贝塞尔连接两节点边缘中点 */
    updateEdge(id) {
      const edge = this.graph.edges.get(id);
      const el = this.edgeEls.get(id);
      if (!edge || !el) return;
      const s = this.graph.nodes.get(edge.source);
      const t = this.graph.nodes.get(edge.target);
      if (!s || !t) return;
      const path = el.firstChild;
      path.setAttribute('d', edgePath(s, t));
    }

    updateEdgesForNode(nodeId) {
      for (const e of this.graph.edges.values()) {
        if (e.source === nodeId || e.target === nodeId) this.updateEdge(e.id);
      }
    }

    /* ---- 全量 ---- */
    renderAll() {
      this.nodesG.textContent = '';
      this.edgesG.textContent = '';
      this.nodeEls.clear();
      this.edgeEls.clear();
      for (const e of this.graph.edges.values()) this.addEdge(e);
      for (const n of this.graph.nodes.values()) this.addNode(n);
    }

    updateAllPositions() {
      for (const n of this.graph.nodes.values()) this.updateNodePosition(n.id);
      for (const e of this.graph.edges.keys()) this.updateEdge(e);
    }
  }

  /* 计算节点边缘交点并生成贝塞尔路径 */
  function edgePath(s, t) {
    const p1 = boundaryPoint(s, t);
    const p2 = boundaryPoint(t, s);
    const dx = p2.x - p1.x;
    const dist = Math.max(Math.abs(dx), 60);
    const c1x = p1.x + dist * 0.4 * Math.sign(dx || 1);
    const c2x = p2.x - dist * 0.4 * Math.sign(dx || 1);
    return `M ${p1.x} ${p1.y} C ${c1x} ${p1.y}, ${c2x} ${p2.y}, ${p2.x} ${p2.y}`;
  }

  function boundaryPoint(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
    const hw = from.w / 2, hh = from.h / 2;
    const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);
    return { x: from.x + dx * scale, y: from.y + dy * scale };
  }

  global.Renderer = Renderer;
  global.edgePath = edgePath;
})(window);
