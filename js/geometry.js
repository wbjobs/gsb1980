/*
 * 几何与共享路径工具。
 * 运行环境: 浏览器主线程 / Web Worker(importScripts) / Node 测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Geo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  // 确定性伪随机(测试与可复现布局使用)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function measureLabelWidth(label, ctx) {
    const text = String(label || '');
    if (ctx && ctx.measureText) {
      ctx.save();
      ctx.font = '13px sans-serif';
      const w = ctx.measureText(text).width;
      ctx.restore();
      return w;
    }
    return text.length * 7.2;
  }

  function nodeSize(node, ctx) {
    const padX = 24;
    const padY = 16;
    const w = Math.max(120, Math.round(measureLabelWidth(node.label, ctx) + padX * 2));
    const h = 46;
    return { w: node.w || w, h: node.h || h };
  }

  function rectsOverlap(a, b, gap) {
    const g = gap || 0;
    return (
      Math.abs(a.x - b.x) * 2 < a.w + b.w + g * 2 &&
      Math.abs(a.y - b.y) * 2 < a.h + b.h + g * 2
    );
  }

  function buildHash(nodes, cell) {
    const map = new Map();
    for (const n of nodes) {
      const cx = Math.floor(n.x / cell);
      const cy = Math.floor(n.y / cell);
      const key = cx + ':' + cy;
      let bucket = map.get(key);
      if (!bucket) map.set(key, (bucket = []));
      bucket.push(n);
    }
    return map;
  }

  function countOverlaps(nodes, gap) {
    if (nodes.length < 2) return 0;
    let maxSize = 0;
    for (const n of nodes) maxSize = Math.max(maxSize, n.w, n.h);
    const cell = maxSize + (gap || 0);
    const hash = buildHash(nodes, cell);
    let count = 0;
    const seen = new Set();
    for (const n of nodes) {
      const cx = Math.floor(n.x / cell);
      const cy = Math.floor(n.y / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = hash.get(cx + dx + ':' + (cy + dy));
          if (!bucket) continue;
          for (const o of bucket) {
            if (o === n) continue;
            const key = n._oid < o._oid ? n._oid + '-' + o._oid : o._oid + '-' + n._oid;
            if (seen.has(key)) continue;
            seen.add(key);
            if (rectsOverlap(n, o, gap)) count++;
          }
        }
      }
    }
    return count;
  }

  function resolvePair(node, other, gap) {
    const g = gap || 0;
    const ox = (node.w + other.w) / 2 + g - Math.abs(node.x - other.x);
    const oy = (node.h + other.h) / 2 + g - Math.abs(node.y - other.y);
    if (ox <= 0 || oy <= 0) return false;
    // 沿穿透量较小的轴推开，重叠面积(用半宽近似)更小
    if (ox < oy) {
      const push = ox / 2 + 0.5;
      const dir = node.x >= other.x ? 1 : -1;
      node.x += dir * push;
      other.x -= dir * push;
    } else {
      const push = oy / 2 + 0.5;
      const dir = node.y >= other.y ? 1 : -1;
      node.y += dir * push;
      other.y -= dir * push;
    }
    return true;
  }

  // 迭代松弛去除节点重叠，返回剩余重叠对数
  function removeOverlaps(nodes, opts) {
    const options = opts || {};
    const gap = options.gap == null ? 8 : options.gap;
    const maxIterations = options.maxIterations || 220;
    if (nodes.length < 2) return 0;
    nodes.forEach((n, i) => {
      if (n._oid == null) n._oid = i;
    });
    let remaining = 0;
    for (let iter = 0; iter < maxIterations; iter++) {
      let maxSize = 0;
      for (const n of nodes) maxSize = Math.max(maxSize, n.w, n.h);
      const cell = maxSize + gap;
      const hash = buildHash(nodes, cell);
      let moved = false;
      let overlaps = 0;
      const seen = new Set();
      for (const n of nodes) {
        const cx = Math.floor(n.x / cell);
        const cy = Math.floor(n.y / cell);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = hash.get(cx + dx + ':' + (cy + dy));
            if (!bucket) continue;
            for (const o of bucket) {
              if (o === n) continue;
              const key = n._oid < o._oid ? n._oid + '-' + o._oid : o._oid + '-' + n._oid;
              if (seen.has(key)) continue;
              seen.add(key);
              if (rectsOverlap(n, o, gap)) {
                overlaps++;
                moved = resolvePair(n, o, gap) || moved;
              }
            }
          }
        }
      }
      remaining = overlaps;
      if (!moved || remaining === 0) break;
    }
    for (const n of nodes) delete n._oid;
    return remaining;
  }

  // 连入/连出端口(世界坐标，节点中心制，x/y 为中心)
  function edgeEndpoints(edge, nodesById) {
    const s = nodesById.get(edge.source);
    const t = nodesById.get(edge.target);
    if (!s || !t) return null;
    const dx = t.x - s.x;
    const vertical = Math.abs(t.y - s.y) > Math.abs(dx) && Math.abs(dx) < 4;
    let sx, sy, tx, ty;
    if (vertical && t.y > s.y) {
      sx = s.x;
      sy = s.y + s.h / 2;
      tx = t.x;
      ty = t.y - t.h / 2;
    } else if (vertical) {
      sx = s.x;
      sy = s.y - s.h / 2;
      tx = t.x;
      ty = t.y + t.h / 2;
    } else if (dx >= 0) {
      sx = s.x + s.w / 2;
      sy = s.y;
      tx = t.x - t.w / 2;
      ty = t.y;
    } else {
      sx = s.x - s.w / 2;
      sy = s.y;
      tx = t.x + t.w / 2;
      ty = t.y;
    }
    return { sx: sx, sy: sy, tx: tx, ty: ty };
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // 共享的三次贝塞尔连线路径(SVG path 与 Canvas 复用，保证导出一致)
  function edgePathD(points) {
    const p = points;
    const dx = p.tx - p.sx;
    const dy = p.ty - p.sy;
    const vertical = Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 4;
    let c1x, c1y, c2x, c2y;
    if (vertical) {
      const my = Math.abs(dy) * 0.5;
      c1x = p.sx;
      c1y = p.sy + Math.sign(dy || 1) * my;
      c2x = p.tx;
      c2y = p.ty - Math.sign(dy || 1) * my;
    } else {
      const mx = Math.abs(dx) * 0.5;
      c1x = p.sx + Math.sign(dx || 1) * mx;
      c1y = p.sy;
      c2x = p.tx - Math.sign(dx || 1) * mx;
      c2y = p.ty;
    }
    return {
      d:
        'M' + round2(p.sx) + ',' + round2(p.sy) +
        ' C' + round2(c1x) + ',' + round2(c1y) +
        ' ' + round2(c2x) + ',' + round2(c2y) +
        ' ' + round2(p.tx) + ',' + round2(p.ty),
      tangent: { x: c2x, y: c2y }
    };
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const x = ax + t * dx;
    const y = ay + t * dy;
    return Math.hypot(px - x, py - y);
  }

  // 采样贝塞尔曲线做点击命中
  function distanceToEdgePath(px, py, points, samples) {
    const info = edgePathD(points);
    const d = info.d;
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    // M sx sy C c1x c1y c2x c2y tx ty
    const sx = nums[0], sy = nums[1];
    const c1x = nums[2], c1y = nums[3], c2x = nums[4], c2y = nums[5];
    const tx = nums[6], ty = nums[7];
    let prevX = sx, prevY = sy;
    let min = Infinity;
    const n = samples || 24;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      const x =
        mt * mt * mt * sx +
        3 * mt * mt * t * c1x +
        3 * mt * t * t * c2x +
        t * t * t * tx;
      const y =
        mt * mt * mt * sy +
        3 * mt * mt * t * c1y +
        3 * mt * t * t * c2y +
        t * t * t * ty;
      const dist = distToSegment(px, py, prevX, prevY, x, y);
      if (dist < min) min = dist;
      prevX = x;
      prevY = y;
    }
    return min;
  }

  function graphBounds(nodes) {
    if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      maxY = Math.max(maxY, n.y + n.h / 2);
    }
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  return {
    clamp: clamp,
    mulberry32: mulberry32,
    nodeSize: nodeSize,
    measureLabelWidth: measureLabelWidth,
    rectsOverlap: rectsOverlap,
    countOverlaps: countOverlaps,
    removeOverlaps: removeOverlaps,
    edgeEndpoints: edgeEndpoints,
    edgePathD: edgePathD,
    distanceToEdgePath: distanceToEdgePath,
    graphBounds: graphBounds
  };
});
