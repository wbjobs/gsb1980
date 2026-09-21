/*
 * 交互控制器:
 *  - 节点拖拽(指针移动直接改世界坐标,每帧合一次重绘)
 *  - 端口拉线连线(自环/重复/悬空有错误反馈)
 *  - 空白处平移 / 滚轮缩放(指针位置为锚点) / 空格临时平移
 *  - 点选 / Ctrl|Cmd 多选 / 框选 / 双击空白新建节点
 *  - Delete 删除,Esc 取消,F 适配视图
 */
(function (root) {
  'use strict';

  function Interaction(canvas, renderer, model, toast, callbacks) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.model = model;
    this.toast = toast;
    this.callbacks = callbacks || {};
    this.state = renderer.state;

    this.dragMode = null; // 'node' | 'pan' | 'marquee' | 'connect'
    this.drag = null;
    this.spaceDown = false;
    this.moved = false;

    this._bind();
  }

  Interaction.prototype._bind = function () {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    el.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    el.addEventListener('dblclick', (e) => this._onDblClick(e));
    el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));
  };

  Interaction.prototype._eventPos = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  Interaction.prototype._setCursor = function (cursor) {
    this.canvas.style.cursor = cursor;
  };

  Interaction.prototype._onPointerDown = function (e) {
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
      this._startPan(e);
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
    const sp = this._eventPos(e);
    const wp = this.renderer.toWorld(sp.x, sp.y);
    const hit = this.renderer.hitTest(wp.x, wp.y);
    this._downPos = sp;
    this.moved = false;

    if (hit.type === 'port') {
      this._startConnect(hit.port);
      return;
    }

    if (hit.type === 'node') {
      const node = hit.node;
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!this.state.selectedNodes.has(node.id)) {
        if (!additive) {
          this.state.selectedNodes.clear();
          this.state.selectedEdges.clear();
        }
        this.state.selectedNodes.add(node.id);
      } else if (additive) {
        this.state.selectedNodes.delete(node.id);
      }
      this._startNodeDrag(node, sp);
      this.renderer.invalidate();
      return;
    }

    if (hit.type === 'edge') {
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!additive) {
        this.state.selectedNodes.clear();
        this.state.selectedEdges.clear();
      }
      this.state.selectedEdges.add(hit.edge.id);
      this.renderer.invalidate();
      return;
    }

    // 空白
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
      this.state.selectedNodes.clear();
      this.state.selectedEdges.clear();
      this.renderer.invalidate();
    }
    this.dragMode = 'marquee';
    this.drag = { startX: sp.x, startY: sp.y };
  };

  Interaction.prototype._startPan = function (e) {
    this.dragMode = 'pan';
    this.drag = { x: e.clientX, y: e.clientY, panX: this.renderer.panX, panY: this.renderer.panY };
    this._setCursor('grabbing');
  };

  Interaction.prototype._startNodeDrag = function (node, sp) {
    const wp = this.renderer.toWorld(sp.x, sp.y);
    this.dragMode = 'node';
    const selected = this.state.selectedNodes.has(node.id)
      ? this.model.nodes.filter((n) => this.state.selectedNodes.has(n.id))
      : [node];
    this.drag = {
      startWX: wp.x,
      startWY: wp.y,
      nodes: selected.map((n) => ({ node: n, x0: n.x, y0: n.y }))
    };
  };

  Interaction.prototype._startConnect = function (port) {
    this.dragMode = 'connect';
    this.drag = { sourceId: port.nodeId };
    this.renderer.tempEdge = {
      from: { x: port.x, y: port.y },
      to: { x: port.x, y: port.y },
      validTarget: false
    };
    this._setCursor('crosshair');
  };

  Interaction.prototype._onPointerMove = function (e) {
    const sp = this._eventPos(e);
    const wp = this.renderer.toWorld(sp.x, sp.y);

    if (!this.dragMode) {
      this._updateHover(sp, wp);
      return;
    }
    if (this._downPos) {
      if (Math.hypot(sp.x - this._downPos.x, sp.y - this._downPos.y) > 4) this.moved = true;
    }

    if (this.dragMode === 'pan') {
      this.renderer.panX = this.drag.panX + (e.clientX - this.drag.x);
      this.renderer.panY = this.drag.panY + (e.clientY - this.drag.y);
      this.renderer.invalidate();
      return;
    }

    if (this.dragMode === 'node') {
      const dx = (wp.x - this.drag.startWX);
      const dy = (wp.y - this.drag.startWY);
      for (const item of this.drag.nodes) {
        item.node.x = Math.round(item.x0 + dx);
        item.node.y = Math.round(item.y0 + dy);
      }
      this.renderer.invalidate();
      if (this.callbacks.onNodeDrag) this.callbacks.onNodeDrag();
      return;
    }

    if (this.dragMode === 'connect') {
      const targetNode = this.renderer.nodeAt(wp.x, wp.y);
      const port = this.renderer.portAt(wp.x, wp.y);
      const targetId = port ? port.nodeId : targetNode ? targetNode.id : null;
      this.renderer.tempEdge.to = { x: wp.x, y: wp.y };
      this.renderer.tempEdge.validTarget = !!targetId && targetId !== this.drag.sourceId;
      this.renderer.invalidate();
      return;
    }

    if (this.dragMode === 'marquee') {
      const x = Math.min(sp.x, this.drag.startX);
      const y = Math.min(sp.y, this.drag.startY);
      const w = Math.abs(sp.x - this.drag.startX);
      const h = Math.abs(sp.y - this.drag.startY);
      this.renderer.marquee = { x: x, y: y, w: w, h: h };
      this.renderer.invalidate();
      return;
    }
  };

  Interaction.prototype._updateHover = function (sp, wp) {
    const port = this.renderer.portAt(wp.x, wp.y);
    if (port) {
      const changed = !this.state.activePort ||
        this.state.activePort.nodeId !== port.nodeId || this.state.activePort.side !== port.side;
      if (changed) {
        this.state.activePort = { nodeId: port.nodeId, side: port.side };
        this.state.showPortsFor = new Set([port.nodeId]);
        this.renderer.invalidate();
      }
      this._setCursor('crosshair');
      return;
    }
    if (this.state.activePort || (this.state.showPortsFor && this.state.showPortsFor.size)) {
      this.state.activePort = null;
      this.state.showPortsFor = null;
      this.renderer.invalidate();
    }
    const node = this.renderer.nodeAt(wp.x, wp.y);
    const edge = node ? null : this.renderer.edgeAt(wp.x, wp.y);
    const hoverKey = node ? 'node:' + node.id : edge ? 'edge:' + edge.id : null;
    if (this.state.hover !== hoverKey) {
      this.state.hover = hoverKey;
      this.renderer.invalidate();
    }
    this._setCursor(node ? 'grab' : edge ? 'pointer' : 'default');
  };

  Interaction.prototype._onPointerUp = function (e) {
    if (!this.dragMode) return;
    const mode = this.dragMode;
    const drag = this.drag;

    if (mode === 'connect') {
      const sp = this._eventPos(e);
      const wp = this.renderer.toWorld(sp.x, sp.y);
      const port = this.renderer.portAt(wp.x, wp.y);
      const targetNode = this.renderer.nodeAt(wp.x, wp.y);
      const targetId = port ? port.nodeId : targetNode ? targetNode.id : null;
      if (targetId && this.moved) {
        const result = this.model.addEdge(drag.sourceId, targetId);
        if (!result.ok) {
          this.toast.error(result.error.message);
        } else {
          this.state.selectedEdges.clear();
          this.state.selectedEdges.add(result.edge.id);
          if (this.callbacks.onConnect) this.callbacks.onConnect(result.edge);
        }
      }
      this.renderer.tempEdge = null;
      this.state.activePort = null;
      this.state.showPortsFor = null;
      this._setCursor('default');
    } else if (mode === 'pan') {
      this._setCursor('default');
    } else if (mode === 'marquee' && this.moved) {
      const tl = this.renderer.toWorld(this.renderer.marquee.x, this.renderer.marquee.y);
      const br = this.renderer.toWorld(
        this.renderer.marquee.x + this.renderer.marquee.w,
        this.renderer.marquee.y + this.renderer.marquee.h
      );
      const nodes = this.renderer.nodesInRect({ minX: tl.x, minY: tl.y, maxX: br.x, maxY: br.y });
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        nodes.forEach((n) => this.state.selectedNodes.add(n.id));
      } else {
        this.state.selectedNodes.clear();
        this.state.selectedEdges.clear();
        nodes.forEach((n) => this.state.selectedNodes.add(n.id));
      }
      this.renderer.marquee = null;
    }

    try { this.canvas.releasePointerCapture && this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    this.dragMode = null;
    this.drag = null;
    this._downPos = null;
    this.renderer.marquee = null;
    this.renderer.invalidate();
  };

  Interaction.prototype._onDblClick = function (e) {
    const sp = this._eventPos(e);
    const wp = this.renderer.toWorld(sp.x, sp.y);
    const hit = this.renderer.hitTest(wp.x, wp.y);
    if (hit.type === 'empty') {
      const label = '节点 ' + (this.model.nodes.length + 1);
      const node = this.model.addNode({
        label: label,
        x: Math.round(wp.x),
        y: Math.round(wp.y)
      });
      this.state.selectedNodes.clear();
      this.state.selectedEdges.clear();
      this.state.selectedNodes.add(node.id);
      this.renderer.invalidate();
      if (this.callbacks.onNodeCreate) this.callbacks.onNodeCreate(node);
    } else if (hit.type === 'node' && this.callbacks.onNodeDblClick) {
      this.callbacks.onNodeDblClick(hit.node);
    }
  };

  Interaction.prototype._onWheel = function (e) {
    e.preventDefault();
    const sp = this._eventPos(e);
    if (e.shiftKey) {
      this.renderer.panX -= e.deltaY;
      this.renderer.invalidate();
      return;
    }
    const factor = Math.exp(-e.deltaY * 0.0014);
    this.renderer.zoomAt(sp.x, sp.y, factor);
  };

  Interaction.prototype._onKeyDown = function (e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space') {
      this.spaceDown = true;
      this._setCursor('grab');
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this._deleteSelection();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.state.selectedNodes.clear();
      this.state.selectedEdges.clear();
      this.renderer.tempEdge = null;
      this.dragMode = null;
      this.drag = null;
      this.renderer.invalidate();
    } else if (e.key === 'f' || e.key === 'F') {
      this.renderer.fitView();
      this.toast.info('已适配视图');
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      this.state.selectedNodes.clear();
      this.model.nodes.forEach((n) => this.state.selectedNodes.add(n.id));
      this.renderer.invalidate();
    }
  };

  Interaction.prototype._onKeyUp = function (e) {
    if (e.code === 'Space') {
      this.spaceDown = false;
      this._setCursor('default');
    }
  };

  Interaction.prototype._deleteSelection = function () {
    let nodeCount = 0;
    let edgeCount = 0;
    Array.from(this.state.selectedEdges).forEach((id) => {
      if (this.model.removeEdge(id)) edgeCount++;
    });
    this.state.selectedEdges.clear();
    Array.from(this.state.selectedNodes).forEach((id) => {
      try {
        this.model.removeNode(id);
        nodeCount++;
      } catch (err) {
        this.toast.showError(err);
      }
    });
    this.state.selectedNodes.clear();
    if (nodeCount || edgeCount) {
      this.toast.info('已删除 ' + nodeCount + ' 个节点、' + edgeCount + ' 条连线');
    }
    this.renderer.invalidate();
  };

  root.Interaction = Interaction;
})(typeof self !== 'undefined' ? self : this);
