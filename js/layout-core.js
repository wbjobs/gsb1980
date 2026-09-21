/* 力导向布局核心算法（Worker 与主线程共用）
 * - Barnes-Hut 斥力（O(n log n)）
 * - 边弹簧引力 + 向心引力
 * - 矩形碰撞分离迭代，保证节点不重叠
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    iterations: 300,
    repulsion: 8000,
    springLength: 160,
    springK: 0.05,
    gravity: 0.02,
    damping: 0.85,
    padding: 24,        // 节点间最小间距
    collisionPasses: 8, // 每 tick 碰撞分离轮数
    tickEvery: 5,       // 每多少次迭代回调一次
  };

  /* ---- Barnes-Hut 四叉树 ---- */
  function buildQuadtree(nodes, pad) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) + pad * 2;
    const root = { x: minX - pad, y: minY - pad, size, mass: 0, cx: 0, cy: 0, children: null, node: null };

    function insert(cell, node, depth) {
      if (cell.mass === 0 && !cell.node && !cell.children) {
        cell.node = node; cell.mass = 1; cell.cx = node.x; cell.cy = node.y;
        return;
      }
      if (!cell.children && cell.node) {
        // 分裂
        const half = cell.size / 2;
        cell.children = [
          { x: cell.x, y: cell.y, size: half, mass: 0, cx: 0, cy: 0, children: null, node: null },
          { x: cell.x + half, y: cell.y, size: half, mass: 0, cx: 0, cy: 0, children: null, node: null },
          { x: cell.x, y: cell.y + half, size: half, mass: 0, cx: 0, cy: 0, children: null, node: null },
          { x: cell.x + half, y: cell.y + half, size: half, mass: 0, cx: 0, cy: 0, children: null, node: null },
        ];
        const old = cell.node;
        cell.node = null; cell.mass = 0;
        insert(cell, old, depth);
      }
      if (cell.children) {
        const half = cell.size / 2;
        const idx = (node.x >= cell.x + half ? 1 : 0) + (node.y >= cell.y + half ? 2 : 0);
        insert(cell.children[idx], node, depth + 1);
      }
      cell.mass += 1;
      cell.cx = (cell.cx * (cell.mass - 1) + node.x) / cell.mass;
      cell.cy = (cell.cy * (cell.mass - 1) + node.y) / cell.mass;
    }

    for (const n of nodes) insert(root, n, 0);
    return root;
  }

  function applyRepulsion(node, cell, theta, repulsion, fx) {
    if (cell.mass === 0) return;
    const dx = cell.cx - node.x;
    const dy = cell.cy - node.y;
    const distSq = dx * dx + dy * dy + 0.01;
    if (cell.node === node && !cell.children) return;
    if (!cell.children || (cell.size * cell.size) / distSq < theta * theta) {
      const dist = Math.sqrt(distSq);
      const f = repulsion / distSq;
      fx[0] -= (dx / dist) * f;
      fx[1] -= (dy / dist) * f;
      return;
    }
    for (const c of cell.children) applyRepulsion(node, c, theta, repulsion, fx);
  }

  /* ---- 矩形重叠分离：返回本轮是否仍有重叠 ---- */
  function resolveCollisions(nodes, padding) {
    let hadOverlap = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const overlapX = (a.w + b.w) / 2 + padding - Math.abs(a.x - b.x);
        const overlapY = (a.h + b.h) / 2 + padding - Math.abs(a.y - b.y);
        if (overlapX > 0 && overlapY > 0) {
          hadOverlap = true;
          if (overlapX < overlapY) {
            const push = overlapX / 2 + 0.5;
            const dir = a.x <= b.x ? -1 : 1;
            a.x += dir * push; b.x -= dir * push;
          } else {
            const push = overlapY / 2 + 0.5;
            const dir = a.y <= b.y ? -1 : 1;
            a.y += dir * push; b.y -= dir * push;
          }
        }
      }
    }
    return hadOverlap;
  }

  /* 收敛式分离：迭代至无重叠（带上限兜底） */
  function separateUntilClear(nodes, padding, maxPasses) {
    for (let p = 0; p < maxPasses; p++) {
      if (!resolveCollisions(nodes, padding)) return;
    }
  }

  /* 扫描线确定性分离：按 (y,x) 排序，对靠后的节点只向 +x/+y 方向
   * 单调推进（取代价较小者）。坐标单调不减且已解决的节点对不会被
   * 再次破坏，因此保证有限步内达到零重叠。 */
  function separateScanline(nodes, padding) {
    const EPS = 0.5;
    const order = nodes.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    for (let j = 1; j < order.length; j++) {
      const b = order[j];
      let guard = 0;
      let moved = true;
      while (moved && guard++ < 10000) {
        moved = false;
        for (let i = 0; i < j; i++) {
          const a = order[i];
          const needX = (a.w + b.w) / 2 + padding;
          const needY = (a.h + b.h) / 2 + padding;
          if (Math.abs(a.x - b.x) < needX && Math.abs(a.y - b.y) < needY) {
            const targetX = a.x + needX + EPS; // 放到 a 右侧
            const targetY = a.y + needY + EPS; // 放到 a 下侧
            if (targetX - b.x <= targetY - b.y) b.x = targetX;
            else b.y = targetY;
            moved = true;
          }
        }
      }
    }
  }

  /**
   * 同步执行布局。
   * @param {Array} nodes [{id,x,y,w,h}]（会被原地修改的副本）
   * @param {Array} edges [{source,target}]
   * @param {Object} options 见 DEFAULTS
   * @param {Function} [onTick] 每 tickEvery 次迭代回调 (nodes, iter, total)
   */
  function compute(nodes, edges, options, onTick) {
    const opt = Object.assign({}, DEFAULTS, options || {});
    if (!nodes.length) return nodes;

    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const links = [];
    for (const e of edges) {
      const s = index.get(e.source), t = index.get(e.target);
      if (s != null && t != null && s !== t) links.push([s, t]);
    }

    // 质心作为向心锚点
    let cx = 0, cy = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; }
    cx /= nodes.length; cy /= nodes.length;

    const vx = new Float64Array(nodes.length);
    const vy = new Float64Array(nodes.length);
    let temperature = Math.max(40, Math.sqrt(nodes.length) * 10);

    for (let iter = 0; iter < opt.iterations; iter++) {
      const tree = buildQuadtree(nodes, opt.padding);
      const fx = new Float64Array(nodes.length);
      const fy = new Float64Array(nodes.length);
      const tmp = [0, 0];

      // 斥力
      for (let i = 0; i < nodes.length; i++) {
        tmp[0] = 0; tmp[1] = 0;
        applyRepulsion(nodes[i], tree, 0.8, opt.repulsion, tmp);
        fx[i] += tmp[0]; fy[i] += tmp[1];
      }
      // 弹簧
      for (const [s, t] of links) {
        const a = nodes[s], b = nodes[t];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const f = opt.springK * (dist - opt.springLength);
        const fxv = (dx / dist) * f, fyv = (dy / dist) * f;
        fx[s] += fxv; fy[s] += fyv;
        fx[t] -= fxv; fy[t] -= fyv;
      }
      // 向心
      for (let i = 0; i < nodes.length; i++) {
        fx[i] += (cx - nodes[i].x) * opt.gravity;
        fy[i] += (cy - nodes[i].y) * opt.gravity;
      }
      // 积分 + 限温
      for (let i = 0; i < nodes.length; i++) {
        vx[i] = (vx[i] + fx[i]) * opt.damping;
        vy[i] = (vy[i] + fy[i]) * opt.damping;
        const v = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        const cap = Math.min(v, temperature) / (v || 1);
        nodes[i].x += vx[i] * cap;
        nodes[i].y += vy[i] * cap;
      }
      // 碰撞分离：保证不重叠
      separateUntilClear(nodes, opt.padding, opt.collisionPasses);

      temperature *= 0.97;

      if (onTick && (iter % opt.tickEvery === 0 || iter === opt.iterations - 1)) {
        onTick(nodes, iter, opt.iterations);
      }
    }

    // 最终扫描线分离，确保零重叠
    separateScanline(nodes, opt.padding);
    return nodes;
  }

  const api = { compute, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LayoutCore = api;
})(typeof self !== 'undefined' ? self : this);
