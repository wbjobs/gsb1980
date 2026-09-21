/* 图数据模型：节点 / 边的增删查与校验 */
(function (global) {
  'use strict';

  const NODE_W = 120;
  const NODE_H = 44;

  class Graph {
    constructor() {
      this.nodes = new Map(); // id -> {id,label,x,y,w,h}
      this.edges = new Map(); // id -> {id,source,target}
      this._seq = 0;
    }

    _nextId(prefix) {
      this._seq += 1;
      return prefix + '_' + this._seq + '_' + Math.random().toString(36).slice(2, 7);
    }

    addNode(label, x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('节点坐标非法: (' + x + ', ' + y + ')');
      }
      const id = this._nextId('n');
      const node = {
        id,
        label: label == null || label === '' ? 'Node ' + id.slice(-4) : String(label),
        x, y, w: NODE_W, h: NODE_H,
      };
      this.nodes.set(id, node);
      return node;
    }

    removeNode(id) {
      if (!this.nodes.has(id)) return false;
      this.nodes.delete(id);
      for (const [eid, e] of [...this.edges]) {
        if (e.source === id || e.target === id) this.edges.delete(eid);
      }
      return true;
    }

    addEdge(source, target) {
      if (!this.nodes.has(source) || !this.nodes.has(target)) {
        throw new Error('连线失败：节点不存在');
      }
      if (source === target) {
        throw new Error('不允许节点连接到自身');
      }
      for (const e of this.edges.values()) {
        if (e.source === source && e.target === target) {
          throw new Error('该连线已存在');
        }
      }
      const id = this._nextId('e');
      const edge = { id, source, target };
      this.edges.set(id, edge);
      return edge;
    }

    removeEdge(id) { return this.edges.delete(id); }

    clear() {
      this.nodes.clear();
      this.edges.clear();
    }

    toJSON() {
      return {
        nodes: [...this.nodes.values()].map(n => ({ ...n })),
        edges: [...this.edges.values()].map(e => ({ ...e })),
      };
    }

    get size() { return this.nodes.size; }
  }

  Graph.NODE_W = NODE_W;
  Graph.NODE_H = NODE_H;

  global.Graph = Graph;
})(window);
