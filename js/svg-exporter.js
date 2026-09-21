/*
 * SVG 导出:与 Canvas 渲染共享 Geo.edgePathD 路径,保证所见即所得。
 */
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./geometry') : root.Geo);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SVGExporter = api;
})(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  function escapeXml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function truncateLabel(label, node) {
    // 粗略估算:每字符约 7px,超出节点宽度则截断
    const maxChars = Math.max(2, Math.floor((node.w - 16) / 7));
    const text = String(label || '');
    return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
  }

  function buildSVG(model, options) {
    const opts = options || {};
    const nodes = model.nodes;
    const edges = model.edges;
    if (!nodes.length) {
      const err = new Error('GRAPH_EMPTY:图中没有节点,无法导出');
      err.code = 'GRAPH_EMPTY';
      throw err;
    }
    const pad = opts.padding == null ? 40 : opts.padding;
    const b = Geo.graphBounds(nodes);
    const width = Math.ceil(b.maxX - b.minX + pad * 2);
    const height = Math.ceil(b.maxY - b.minY + pad * 2);
    const ox = -b.minX + pad;
    const oy = -b.minY + pad;
    const byId = new Map();
    nodes.forEach((n) => byId.set(n.id, n));

    const parts = [];
    parts.push(
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
        '" viewBox="0 0 ' + width + ' ' + height + '" font-family="Helvetica, Arial, \'PingFang SC\', \'Microsoft YaHei\', sans-serif">',
      '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"/>',
      '<defs>',
      '  <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">',
      '    <path d="M0,0 L8,3 L0,6 Z" fill="#8a94a6"/>',
      '  </marker>',
      '  <marker id="arrow-selected" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">',
      '    <path d="M0,0 L8,3 L0,6 Z" fill="#3b82f6"/>',
      '  </marker>',
      '</defs>',
      '<g transform="translate(' + round2(ox) + ',' + round2(oy) + ')">'
    );

    const selectedEdges = new Set(opts.selectedEdges || []);

    edges.forEach(function (edge) {
      const pts = Geo.edgeEndpoints(edge, byId);
      if (!pts) return;
      const path = Geo.edgePathD(pts);
      const selected = selectedEdges.has(edge.id);
      parts.push(
        '  <path d="' + path.d + '" fill="none" stroke="' + (selected ? '#3b82f6' : '#8a94a6') +
          '" stroke-width="' + (selected ? 2.4 : 1.6) +
          '" marker-end="url(#' + (selected ? 'arrow-selected' : 'arrow') + ')"/>'
      );
    });

    const selectedNodes = new Set(opts.selectedNodes || []);
    nodes.forEach(function (node) {
      const x = round2(node.x - node.w / 2);
      const y = round2(node.y - node.h / 2);
      const selected = selectedNodes.has(node.id);
      parts.push(
        '  <g data-node-id="' + escapeXml(node.id) + '">',
        '    <rect x="' + x + '" y="' + y + '" width="' + node.w + '" height="' + node.h +
          '" rx="8" ry="8" fill="' + (node.color || '#ffffff') +
          '" stroke="' + (selected ? '#3b82f6' : '#c4cad6') +
          '" stroke-width="' + (selected ? 2.2 : 1.4) + '"/>',
        '    <text x="' + round2(node.x) + '" y="' + round2(node.y + 4.5) +
          '" text-anchor="middle" font-size="13" fill="#1f2937">' +
          escapeXml(truncateLabel(node.label, node)) + '</text>',
        '  </g>'
      );
    });

    parts.push('</g>', '</svg>');
    return parts.join('\n');
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // 简单 XML 良构校验;Node 与浏览器均可用
  function validateXML(svgText) {
    const stack = [];
    const tokenRe = /<(\/?)([A-Za-z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
    let match;
    while ((match = tokenRe.exec(svgText))) {
      const token = match[0];
      if (token.startsWith('<!--') || token.startsWith('<?')) continue;
      const closing = match[1] === '/';
      const name = match[2];
      const selfClose = match[4] === '/';
      if (selfClose) continue;
      if (closing) {
        if (stack.pop() !== name) {
          return { ok: false, error: 'SVG 标签闭合错误: </' + name + '>' };
        }
      } else {
        stack.push(name);
      }
    }
    if (stack.length) return { ok: false, error: 'SVG 存在未闭合标签: ' + stack.join(',') };
    if (!/^<\?xml/.test(svgText) || !/<svg[\s>]/.test(svgText)) {
      return { ok: false, error: 'SVG 缺少根元素' };
    }
    return { ok: true };
  }

  function exportSVG(model, options) {
    const svgText = buildSVG(model, options);
    const validation = validateXML(svgText);
    if (!validation.ok) {
      throw Object.assign(new Error('SVG_INVALID:' + validation.error), { code: 'SVG_INVALID' });
    }
    return svgText;
  }

  function download(filename, content, mime) {
    if (typeof document === 'undefined') {
      throw new Error('ENV_UNSUPPORTED:当前环境不支持下载');
    }
    const blob = new Blob([content], { type: mime || 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  return {
    buildSVG: buildSVG,
    exportSVG: exportSVG,
    validateXML: validateXML,
    escapeXml: escapeXml,
    download: download
  };
});
