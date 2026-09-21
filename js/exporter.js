/* SVG 导出：内联样式、计算包围盒、生成独立 SVG 文件并下载 */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function buildExportSvg(graph) {
    if (graph.size === 0) {
      throw new Error('画布为空，没有可导出的内容');
    }

    // 计算包围盒
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph.nodes.values()) {
      minX = Math.min(minX, n.x - n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      maxY = Math.max(maxY, n.y + n.h / 2);
    }
    const margin = 40;
    minX -= margin; minY -= margin; maxX += margin; maxY += margin;
    const width = Math.ceil(maxX - minX);
    const height = Math.ceil(maxY - minY);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);

    // 内联样式，保证脱离页面也能正确显示
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = [
      'rect.node-bg{fill:#fff;stroke:#4a8fd4;stroke-width:1.5;}',
      'text{font:13px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:#24303f;text-anchor:middle;dominant-baseline:central;}',
      'path.edge-line{fill:none;stroke:#8a97a8;stroke-width:1.8;marker-end:url(#arrowhead);}',
    ].join('\n');
    svg.appendChild(style);

    // 箭头 marker
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = '<marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8a97a8"/></marker>';
    svg.appendChild(defs);

    // 背景
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', minX); bg.setAttribute('y', minY);
    bg.setAttribute('width', width); bg.setAttribute('height', height);
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);

    // 边（先画，置于节点下层）
    for (const e of graph.edges.values()) {
      const s = graph.nodes.get(e.source);
      const t = graph.nodes.get(e.target);
      if (!s || !t) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'edge-line');
      path.setAttribute('d', global.edgePath(s, t));
      svg.appendChild(path);
    }

    // 节点
    for (const n of graph.nodes.values()) {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', `translate(${n.x},${n.y})`);
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'node-bg');
      rect.setAttribute('x', -n.w / 2);
      rect.setAttribute('y', -n.h / 2);
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', n.h);
      rect.setAttribute('rx', 8);
      const text = document.createElementNS(SVG_NS, 'text');
      text.textContent = n.label;
      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);
    }

    return svg;
  }

  function exportSvg(graph, filename) {
    const svg = buildExportSvg(graph);
    const serializer = new XMLSerializer();
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || ('graph-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.svg');
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  global.Exporter = { exportSvg, buildExportSvg };
})(window);
