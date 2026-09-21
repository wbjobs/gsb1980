/*
 * 图数据模型:节点 / 连线的增删改查、序列化、订阅通知。
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./geometry') : root.Geo);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GraphModel = api;
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  let uid = 0;
  function nextId() {
    uid += 1;
    return 'n' + Date.now().toString(36) + '_' + uid;
  }

  function edgeId(source, target) {
    return source + '->' + target;
  }

  function GraphModel(ctx) {
    this.ctx = ctx || null;
    this.nodes = [];
    this.edges = [];
    this._nodeMap = new Map();
    this._edgeMap = new Map();
    this._listeners = [];
  }

  GraphModel.prototype.subscribe = function (fn) {
    this._listeners.push(fn);
    const self = this;
    return function () {
      const i = self._listeners.indexOf(fn);
      if (i >= 0) self._listeners.splice(i, 1);
    };
  };

  GraphModel.prototype._emit = function (type, payload) {
    for (const fn of this._listeners) {
      try { fn(type, payload); } catch (e) { /* 监听器异常不影响模型 */ }
    }
  };

  GraphModel.prototype.addNode = function (input) {
    const data = input || {};
    if (data.id != null && this._nodeMap.has(String(data.id))) {
      const err = new Error('NODE_DUPLICATE:节点 id 已存在: ' + data.id);
      err.code = 'NODE_DUPLICATE';
      throw err;
    }
    const size = Geo.nodeSize(data, this.ctx);
    const node = {
      id: data.id != null ? String(data.id) : nextId(),
      label: data.label != null ? String(data.label) : '节点',
      w: data.w || size.w,
      h: data.h || size.h,
      x: isFinite(data.x) ? data.x : 0,
      y: isFinite(data.y) ? data.y : 0,
      color: data.color || null
    };
    this.nodes.push(node);
    this._nodeMap.set(node.id, node);
    this._emit('node-add', { node: node });
    return node;
  };

  GraphModel.prototype.getNode = function (id) {
    return this._nodeMap.get(String(id));
  };

  GraphModel.prototype.removeNode = function (id) {
    const key = String(id);
    const node = this._nodeMap.get(key);
    if (!node) {
      const err = new Error('NODE_NOT_FOUND:节点不存在: ' + key);
      err.code = 'NODE_NOT_FOUND';
      throw err;
    }
    const removedEdges = [];
    this.edges = this.edges.filter(function (e) {
      if (e.source === key || e.target === key) {
        removedEdges.push(e);
        return false;
      }
      return true;
    });
    removedEdges.forEach((e) => this._edgeMap.delete(e.id));
    this.nodes = this.nodes.filter((n) => n.id !== key);
    this._nodeMap.delete(key);
    this._emit('node-remove', { id: key, edges: removedEdges });
    return node;
  };

  // 返回 {ok,error?};重复连线/自环为用户操作错误,不抛异常
  GraphModel.prototype.addEdge = function (source, target) {
    const s = String(source);
    const t = String(target);
    if (s === t) {
      return { ok: false, error: { code: 'EDGE_SELF', message: '不能连接节点自身' } };
    }
    if (!this._nodeMap.has(s) || !this._nodeMap.has(t)) {
      return { ok: false, error: { code: 'EDGE_ENDPOINT_MISSING', message: '连线端点不存在' } };
    }
    const id = edgeId(s, t);
    if (this._edgeMap.has(id)) {
      return { ok: false, error: { code: 'EDGE_DUPLICATE', message: '该连线已存在' } };
    }
    const edge = { id: id, source: s, target: t };
    this.edges.push(edge);
    this._edgeMap.set(id, edge);
    this._emit('edge-add', { edge: edge });
    return { ok: true, edge: edge };
  };

  GraphModel.prototype.removeEdge = function (id) {
    const edge = this._edgeMap.get(String(id));
    if (!edge) return false;
    this._edgeMap.delete(edge.id);
    this.edges = this.edges.filter((e) => e.id !== edge.id);
    this._emit('edge-remove', { id: edge.id });
    return true;
  };

  GraphModel.prototype.clear = function () {
    this.nodes = [];
    this.edges = [];
    this._nodeMap.clear();
    this._edgeMap.clear();
    this._emit('clear', null);
  };

  GraphModel.prototype.toJSON = function () {
    return {
      nodes: this.nodes.map(function (n) {
        return { id: n.id, label: n.label, w: n.w, h: n.h, x: Math.round(n.x), y: Math.round(n.y) };
      }),
      edges: this.edges.map(function (e) {
        return { source: e.source, target: e.target };
      })
    };
  };

  // 严格校验并整体载入,失败时不会破坏当前数据
  GraphModel.prototype.load = function (data) {
    if (!data || typeof data !== 'object') {
      throw Object.assign(new Error('DATA_INVALID:数据必须是包含 nodes/edges 的对象'), { code: 'DATA_INVALID' });
    }
    const rawNodes = data.nodes;
    const rawEdges = data.edges || [];
    if (!Array.isArray(rawNodes)) {
      throw Object.assign(new Error('NODES_INVALID:nodes 必须是数组'), { code: 'NODES_INVALID' });
    }
    if (!Array.isArray(rawEdges)) {
      throw Object.assign(new Error('EDGES_INVALID:edges 必须是数组'), { code: 'EDGES_INVALID' });
    }
    const snapshot = {
      nodes: this.nodes.slice(),
      edges: this.edges.slice(),
      nodePairs: Array.from(this._nodeMap.entries()),
      edgePairs: Array.from(this._edgeMap.entries())
    };
    try {
      this.clear();
      rawNodes.forEach((n, i) => {
        if (!n || n.id == null) {
          throw Object.assign(new Error('NODE_ID_MISSING:第 ' + (i + 1) + ' 个节点缺少 id'), { code: 'NODE_ID_MISSING' });
        }
        this.addNode(n);
      });
      const warnings = [];
      rawEdges.forEach((e, i) => {
        if (!e || e.source == null || e.target == null) {
          throw Object.assign(new Error('EDGE_ENDPOINT_MISSING:第 ' + (i + 1) + ' 条连线缺少端点'), { code: 'EDGE_ENDPOINT_MISSING' });
        }
        const r = this.addEdge(e.source, e.target);
        if (!r.ok && r.error.code !== 'EDGE_DUPLICATE') warnings.push(r.error.message);
      });
      this._emit('load', null);
      return { warnings: warnings };
    } catch (err) {
      this.nodes = snapshot.nodes;
      this.edges = snapshot.edges;
      this._nodeMap = new Map(snapshot.nodePairs);
      this._edgeMap = new Map(snapshot.edgePairs);
      throw err;
    }
  };

  GraphModel.prototype.applyPositions = function (positionedNodes) {
    positionedNodes.forEach((pn) => {
      const node = this._nodeMap.get(String(pn.id));
      if (node) {
        node.x = pn.x;
        node.y = pn.y;
        if (pn.w) node.w = pn.w;
        if (pn.h) node.h = pn.h;
      }
    });
    this._emit('positions', null);
  };

  return { GraphModel: GraphModel, nextId: nextId };
});
