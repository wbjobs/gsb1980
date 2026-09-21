/*
 * 自定义布局算法集合:
 *  - dag:    分层布局(拓扑分层 + 重心排序 + 去重叠),适用于流程图
 *  - force:  力导向(电荷排斥/弹簧吸引/向心,空间哈希加速) + 去重叠
 *  - grid:   网格布局(天然不重叠)
 *  - circle: 环形布局(半径按节点数自适应,保证不重叠)
 * 所有算法返回以节点中心为坐标的结果,并保证节点矩形互不重叠。
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./geometry') : root.Geo);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Layout = api;
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  const GAP_X = 48;
  const GAP_Y = 28;

  function normalizeNodes(input) {
    if (!Array.isArray(input)) throw new Error('NODES_INVALID:nodes 必须是数组');
    return input.map(function (raw, i) {
      if (raw == null || typeof raw !== 'object') {
        throw new Error('NODE_INVALID:第 ' + i + ' 个节点格式错误');
      }
      if (raw.id == null || String(raw.id) === '') {
        throw new Error('NODE_ID_MISSING:第 ' + i + ' 个节点缺少 id');
      }
      return {
        id: String(raw.id),
        label: raw.label != null ? String(raw.label) : String(raw.id),
        w: raw.w || 120,
        h: raw.h || 46,
        x: 0,
        y: 0
      };
    });
  }

  function indexEdges(edges) {
    if (!Array.isArray(edges)) throw new Error('EDGES_INVALID:edges 必须是数组');
    return edges
      .map(function (raw) {
        if (raw == null || typeof raw !== 'object') {
          throw new Error('EDGE_INVALID:连线格式错误');
        }
        if (raw.source == null || raw.target == null) {
          throw new Error('EDGE_ENDPOINT_MISSING:连线必须包含 source 与 target');
        }
        return { source: String(raw.source), target: String(raw.target) };
      })
      .filter(function (e) {
        return e.source !== e.target;
      });
  }

  // ---------- DAG ----------

  // 迭代 DFS 检测环,返回环上的边(若无环返回 null)
  function findCycle(nodes, edges) {
    const adj = new Map();
    nodes.forEach(function (n) { adj.set(n.id, []); });
    edges.forEach(function (e) {
      if (adj.has(e.source) && adj.has(e.target)) adj.get(e.source).push(e.target);
    });
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    nodes.forEach(function (n) { color.set(n.id, WHITE); });
    for (const startId of color.keys()) {
      if (color.get(startId) !== WHITE) continue;
      const stack = [{ id: startId, next: 0 }];
      color.set(startId, GRAY);
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const neighbors = adj.get(frame.id);
        if (frame.next < neighbors.length) {
          const nxt = neighbors[frame.next++];
          if (color.get(nxt) === GRAY) return { from: frame.id, to: nxt };
          if (color.get(nxt) === WHITE) {
            color.set(nxt, GRAY);
            stack.push({ id: nxt, next: 0 });
          }
        } else {
          color.set(frame.id, BLACK);
          stack.pop();
        }
      }
    }
    return null;
  }

  // Kahn 拓扑排序
  function topoSort(ids, edges) {
    const indeg = new Map();
    const adj = new Map();
    ids.forEach(function (id) { indeg.set(id, 0); adj.set(id, []); });
    edges.forEach(function (e) {
      if (!indeg.has(e.source) || !indeg.has(e.target)) return;
      indeg.set(e.target, indeg.get(e.target) + 1);
      adj.get(e.source).push(e.target);
    });
    const queue = [];
    indeg.forEach(function (d, id) { if (d === 0) queue.push(id); });
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      adj.get(id).forEach(function (nxt) {
        const d = indeg.get(nxt) - 1;
        indeg.set(nxt, d);
        if (d === 0) queue.push(nxt);
      });
    }
    return order;
  }

  function layoutDAG(nodes, edges, options) {
    const warnings = [];
    let workEdges = edges;
    const cycle = findCycle(nodes, edges);
    if (cycle) {
      warnings.push('CYCLE_REMOVED:检测到环(如 ' + cycle.from + ' -> ' + cycle.to + '),已忽略回边以完成分层');
      workEdges = edges.filter(function (e) {
        return !(e.source === cycle.from && e.target === cycle.to);
      });
    }
    const ids = nodes.map(function (n) { return n.id; });
    const order = topoSort(ids, workEdges);
    // 理论上去环后无残留环;防御性处理
    if (order.length < ids.length) {
      ids.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    }

    const rankOf = new Map();
    order.forEach(function (id) { rankOf.set(id, 0); });
    let maxRank = 0;
    order.forEach(function (id) {
      const r = rankOf.get(id);
      workEdges.forEach(function (e) {
        if (e.source === id && rankOf.has(e.target)) {
          const nr = Math.max(rankOf.get(e.target), r + 1);
          rankOf.set(e.target, nr);
          if (nr > maxRank) maxRank = nr;
        }
      });
    });

    const columns = [];
    for (let r = 0; r <= maxRank; r++) columns.push([]);
    nodes.forEach(function (n) { columns[rankOf.get(n.id)].push(n); });

    // 初始纵向排列 + 列内去重叠
    columns.forEach(function (col) {
      let y = 0;
      col.forEach(function (n) {
        n.y = y + n.h / 2;
        y += n.h + GAP_Y;
      });
      // 列内两个节点若宽高差异导致重叠(同列 x 相同,必重叠),上面的排布已保证间距
    });

    // 重心排序,减少连线交叉(按前驱平均位置),迭代两遍
    for (let pass = 0; pass < 2; pass++) {
      for (let r = 1; r < columns.length; r++) {
        columns[r].sort(function (a, b) {
          function bary(n) {
            const preds = workEdges.filter(function (e) { return e.target === n.id; })
              .map(function (e) {
                const p = columns[r - 1].find(function (x) { return x.id === e.source; });
                return p ? p.y : null;
              })
              .filter(function (v) { return v != null; });
            return preds.length ? preds.reduce(function (s, v) { return s + v; }, 0) / preds.length : n.y;
          }
          return bary(a) - bary(b);
        });
        let y = columns[r].reduce(function (s, n) { return s + n.h; }, 0) +
          GAP_Y * (columns[r].length - 1);
        let cursor = -y / 2;
        columns[r].forEach(function (n) {
          n.y = cursor + n.h / 2;
          cursor += n.h + GAP_Y;
        });
      }
    }

    // 水平位置
    let x = 0;
    for (let r = 0; r < columns.length; r++) {
      const colWidth = Math.max.apply(null, columns[r].map(function (n) { return n.w; }).concat([0]));
      columns[r].forEach(function (n) { n.x = x + colWidth / 2; });
      x += colWidth + GAP_X;
    }

    // 每列垂直居中到最高列
    let totalH = 0;
    columns.forEach(function (col) {
      const h = col.reduce(function (s, n) { return s + n.h; }, 0) + GAP_Y * (col.length - 1);
      if (h > totalH) totalH = h;
    });
    columns.forEach(function (col) {
      const h = col.reduce(function (s, n) { return s + n.h; }, 0) + GAP_Y * (col.length - 1);
      let cursor = -totalH / 2 + (totalH - h) / 2;
      col.forEach(function (n) {
        n.y = cursor + n.h / 2;
        cursor += n.h + GAP_Y;
      });
    });

    return { warnings: warnings };
  }

  // ---------- Force ----------

  function layoutForce(nodes, edges, options) {
    const opts = options || {};
    const rng = Geo.mulberry32(opts.seed == null ? 7 : opts.seed);
    const n = nodes.length;
    const byId = new Map();
    nodes.forEach(function (nd) { byId.set(nd.id, nd); });

    const spread = Math.max(320, Math.sqrt(n) * 110);
    const vx = new Array(n), vy = new Array(n);
    nodes.forEach(function (nd, i) {
      if (isFinite(nd.x) && (nd.x !== 0 || nd.y !== 0)) {
        // 保留已有位置作为初始态,加少量扰动
        nd.x += (rng() - 0.5) * 20;
        nd.y += (rng() - 0.5) * 20;
      } else {
        const a = rng() * Math.PI * 2;
        const r = rng() * spread;
        nd.x = Math.cos(a) * r;
        nd.y = Math.sin(a) * r;
      }
      vx[i] = 0;
      vy[i] = 0;
    });

    const links = [];
    edges.forEach(function (e) {
      const si = nodes.findIndex(function (nd) { return nd.id === e.source; });
      const ti = nodes.findIndex(function (nd) { return nd.id === e.target; });
      if (si >= 0 && ti >= 0) links.push({ s: si, t: ti });
    });

    const iterations = opts.iterations || 140;
    const idealLen = opts.linkDistance || 150;
    const repulsion = 52000;
    const gravity = 0.028;
    const cooling = Math.pow(0.02 / 1, 1 / iterations);
    let temperature = 42;

    const reportEvery = 40;
    for (let it = 0; it < iterations; it++) {
      const fx = new Array(n).fill(0);
      const fy = new Array(n).fill(0);

      // 排斥(空间哈希)
      let maxSize = 0;
      for (const nd of nodes) maxSize = Math.max(maxSize, nd.w, nd.h);
      const cell = Math.max(idealLen, maxSize + 60);
      const hash = Geo.rectsOverlap ? null : null;
      const grid = new Map();
      nodes.forEach(function (nd, i) {
        const key = Math.floor(nd.x / cell) + ':' + Math.floor(nd.y / cell);
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(i);
      });
      const pairSeen = new Set();
      grid.forEach(function (bucket, key) {
        const parts = key.split(':');
        const cx = +parts[0], cy = +parts[1];
        const neighbors = [];
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const b = grid.get(cx + dx + ':' + (cy + dy));
            if (b) for (const idx of b) neighbors.push(idx);
          }
        }
        for (const i of bucket) {
          for (const jRaw of neighbors) {
            const j = jRaw;
            if (i === j) continue;
            const pk = i < j ? i + '_' + j : j + '_' + i;
            if (pairSeen.has(pk)) continue;
            pairSeen.add(pk);
            let ddx = nodes[i].x - nodes[j].x;
            let ddy = nodes[i].y - nodes[j].y;
            let dist2 = ddx * ddx + ddy * ddy;
            if (dist2 < 1) {
              ddx = (rng() - 0.5) * 2;
              ddy = (rng() - 0.5) * 2;
              dist2 = ddx * ddx + ddy * ddy + 1;
            }
            const dist = Math.sqrt(dist2);
            const force = repulsion / dist2;
            fx[i] += (ddx / dist) * force;
            fy[i] += (ddy / dist) * force;
          }
        }
      });

      // 弹簧吸引
      for (const lk of links) {
        const a = nodes[lk.s], b = nodes[lk.t];
        const ddx = b.x - a.x, ddy = b.y - a.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const force = ((dist - idealLen) / dist) * 0.06;
        const ax = ddx * force, ay = ddy * force;
        fx[lk.s] += ax; fy[lk.s] += ay;
        fx[lk.t] -= ax; fy[lk.t] -= ay;
      }

      // 向心
      for (let i = 0; i < n; i++) {
        fx[i] -= nodes[i].x * gravity;
        fy[i] -= nodes[i].y * gravity;
        vx[i] = (vx[i] + fx[i]) * 0.85;
        vy[i] = (vy[i] + fy[i]) * 0.85;
        const speed = Math.hypot(vx[i], vy[i]);
        if (speed > temperature) {
          vx[i] = (vx[i] / speed) * temperature;
          vy[i] = (vy[i] / speed) * temperature;
        }
        nodes[i].x += vx[i];
        nodes[i].y += vy[i];
      }
      temperature *= cooling;

      if (opts.onProgress && it % reportEvery === 0) {
        opts.onProgress(it / iterations);
      }
    }
    return {};
  }

  // ---------- Grid ----------

  function layoutGrid(nodes) {
    if (!nodes.length) return {};
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const colWidths = [];
    const rowHeights = [];
    nodes.forEach(function (nd, i) {
      const c = i % cols, r = Math.floor(i / cols);
      colWidths[c] = Math.max(colWidths[c] || 0, nd.w);
      rowHeights[r] = Math.max(rowHeights[r] || 0, nd.h);
    });
    const colX = [];
    let acc = 0;
    for (let c = 0; c < colWidths.length; c++) {
      colX.push(c === 0 ? colWidths[0] / 2 : acc + colWidths[c] / 2);
      acc += colWidths[c] + GAP_X;
    }
    const rowY = [];
    acc = 0;
    for (let r = 0; r < rowHeights.length; r++) {
      rowY.push(r === 0 ? rowHeights[0] / 2 : acc + rowHeights[r] / 2);
      acc += rowHeights[r] + GAP_Y;
    }
    nodes.forEach(function (nd, i) {
      nd.x = colX[i % cols];
      nd.y = rowY[Math.floor(i / cols)];
    });
    return {};
  }

  // ---------- Circle ----------

  function layoutCircle(nodes) {
    const n = nodes.length;
    if (!n) return {};
    if (n === 1) { nodes[0].x = 0; nodes[0].y = 0; return {}; }
    const maxW = Math.max.apply(null, nodes.map(function (nd) { return nd.w; }));
    const maxH = Math.max.apply(null, nodes.map(function (nd) { return nd.h; }));
    // 相邻节点弧长至少覆盖节点对角线 + 间隙
    const minArc = Math.hypot(maxW, maxH) + 32;
    const radius = Math.max((minArc * n) / (2 * Math.PI), 220);
    nodes.forEach(function (nd, i) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      nd.x = radius * Math.cos(a);
      nd.y = radius * Math.sin(a);
    });
    // 弧长充足时不会重叠,仍执行一次保证(极端宽高比)
    Geo.removeOverlaps(nodes, { gap: 10 });
    return {};
  }

  // ---------- 入口 ----------

  function run(type, rawNodes, rawEdges, options) {
    const algo = type || 'dag';
    const nodes = normalizeNodes(rawNodes);
    const edges = indexEdges(rawEdges || []);
    if (!nodes.length) throw new Error('GRAPH_EMPTY:图中没有节点,无法布局');
    if (nodes.length > 20000) throw new Error('GRAPH_TOO_LARGE:节点数超过 20000,请减少数据量');
    const idSet = new Set(nodes.map(function (n) { return n.id; }));
    const dangling = edges.filter(function (e) { return !idSet.has(e.source) || !idSet.has(e.target); });
    const warnings = [];
    if (dangling.length) {
      warnings.push('DANGLING_EDGES:' + dangling.length + ' 条连线引用了不存在的节点,已忽略');
    }
    const validEdges = edges.filter(function (e) { return idSet.has(e.source) && idSet.has(e.target); });

    let result;
    if (algo === 'dag') result = layoutDAG(nodes, validEdges, options || {});
    else if (algo === 'force') result = layoutForce(nodes, validEdges, options || {});
    else if (algo === 'grid') result = layoutGrid(nodes);
    else if (algo === 'circle') result = layoutCircle(nodes);
    else throw new Error('ALGO_UNKNOWN:未知布局算法: ' + algo);

    const extraWarnings = result.warnings || [];
    if (algo !== 'grid') {
      const remaining = Geo.removeOverlaps(nodes, { gap: 10 });
      if (remaining > 0) warnings.push('OVERLAP_REMAINING:' + remaining + ' 对节点过于密集,请增大间距或使用网格布局');
    }

    return {
      nodes: nodes.map(function (n) {
        return {
          id: n.id, label: n.label, w: n.w, h: n.h,
          x: Math.round(n.x * 100) / 100,
          y: Math.round(n.y * 100) / 100
        };
      }),
      warnings: warnings.concat(extraWarnings)
    };
  }

  return {
    run: run,
    findCycle: findCycle,
    _internals: { layoutDAG: layoutDAG, layoutForce: layoutForce, layoutGrid: layoutGrid, layoutCircle: layoutCircle }
  };
});
