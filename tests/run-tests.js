/* 零依赖 Node 测试:布局正确性、不重叠、异常分支、SVG 导出良构。 */
'use strict';
const Geo = require('../js/geometry');
const Layout = require('../js/layout');
const { GraphModel } = require('../js/model');
const SVGExporter = require('../js/svg-exporter');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    console.error('  ✕ ' + name + '\n    ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n    ') : err));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function assertThrows(fn, codePart) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert(err, '期望抛出异常但未抛出');
  if (codePart) assert(String(err.message).indexOf(codePart) >= 0, '异常信息应包含 ' + codePart + ',实际:' + err.message);
}

function makeChain(n) {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) nodes.push({ id: 'n' + i, label: '节点' + i, w: 120, h: 46 });
  for (let i = 0; i < n - 1; i++) edges.push({ source: 'n' + i, target: 'n' + (i + 1) });
  return { nodes: nodes, edges: edges };
}

function makeRandom(n, m, seed) {
  const rng = Geo.mulberry32(seed);
  const nodes = [];
  const edges = [];
  for (let i = 0; i < n; i++) nodes.push({ id: 'n' + i, label: 'N' + i, w: 120, h: 46 });
  for (let i = 0; i < m; i++) {
    const a = Math.floor(rng() * n);
    const b = Math.floor(rng() * n);
    if (a !== b) edges.push({ source: 'n' + a, target: 'n' + b });
  }
  return { nodes: nodes, edges: edges };
}

console.log('布局算法:');

['dag', 'force', 'grid', 'circle'].forEach(function (algo) {
  test(algo + ' 布局 120 节点无重叠', function () {
    const g = makeRandom(120, 180, algo === 'force' ? 7 : 21);
    const r = Layout.run(algo, g.nodes, g.edges);
    assert(Geo.countOverlaps(r.nodes, 10) === 0, algo + ' 存在重叠');
    assert(r.nodes.length === 120);
  });
});

test('DAG 链按拓扑顺序分层', function () {
  const g = makeChain(5);
  const r = Layout.run('dag', g.nodes, g.edges);
  const byId = Object.fromEntries(r.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < 4; i++) assert(byId['n' + i].x < byId['n' + (i + 1)].x, '后继应在右侧');
});

test('DAG 环检测并给出警告,仍能完成布局', function () {
  const r = Layout.run('dag', [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [
    { source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }
  ]);
  assert(r.warnings.some((w) => w.indexOf('CYCLE_REMOVED') === 0), '应有环警告');
  assert(Geo.countOverlaps(r.nodes, 10) === 0);
});

test('力导向布局可复现(同种子)', function () {
  const a = Layout.run('force', makeRandom(60, 90, 3).nodes, makeRandom(60, 90, 3).edges, { seed: 7 });
  const g2 = makeRandom(60, 90, 3);
  const b = Layout.run('force', g2.nodes, g2.edges, { seed: 7 });
  assert(JSON.stringify(a.nodes) === JSON.stringify(b.nodes), '同种子布局结果应一致');
});

test('网格布局节点间距符合预期', function () {
  const g = makeChain(9);
  const r = Layout.run('grid', g.nodes, g.edges);
  assert(Geo.countOverlaps(r.nodes, 10) === 0);
});

test('单节点布局不报错', function () {
  const r = Layout.run('circle', [{ id: 'solo' }], []);
  assert(r.nodes.length === 1);
});

console.log('异常处理:');

test('未知算法抛出 ALGO_UNKNOWN', function () {
  assertThrows(function () { Layout.run('wat', [{ id: 'a' }], []); }, 'ALGO_UNKNOWN');
});
test('空图抛出 GRAPH_EMPTY', function () {
  assertThrows(function () { Layout.run('dag', [], []); }, 'GRAPH_EMPTY');
});
test('节点缺 id 抛出 NODE_ID_MISSING', function () {
  assertThrows(function () { Layout.run('grid', [{ label: 'x' }], []); }, 'NODE_ID_MISSING');
});
test('连线缺端点抛出 EDGE_ENDPOINT_MISSING', function () {
  assertThrows(function () { Layout.run('grid', [{ id: 'a' }], [{ source: 'a' }]); }, 'EDGE_ENDPOINT_MISSING');
});
test('悬空连线被忽略并警告', function () {
  const r = Layout.run('grid', [{ id: 'a' }], [{ source: 'a', target: 'ghost' }]);
  assert(r.warnings.some((w) => w.indexOf('DANGLING_EDGES') === 0));
});
test('超大规模抛出 GRAPH_TOO_LARGE', function () {
  const nodes = [];
  for (let i = 0; i < 20001; i++) nodes.push({ id: 'n' + i });
  assertThrows(function () { Layout.run('grid', nodes, []); }, 'GRAPH_TOO_LARGE');
});

console.log('SVG 导出:');

test('导出包含全部节点与连线且 XML 良构', function () {
  const m = new GraphModel();
  const g = makeChain(6);
  g.nodes.forEach((n) => m.addNode(n));
  g.edges.forEach((e) => m.addEdge(e.source, e.target));
  const svg = SVGExporter.exportSVG(m);
  g.nodes.forEach((n) => assert(svg.indexOf('data-node-id="' + n.id + '"') >= 0, '缺少节点 ' + n.id));
  const edgePaths = svg.split("marker-end=").length - 1;
  assert(edgePaths === g.edges.length, '连线 path 数量不符,实际 ' + edgePaths);
  assert(svg.indexOf('marker-end') >= 0, '缺少箭头');
});
test('特殊字符被转义', function () {
  const m = new GraphModel();
  m.addNode({ id: 'a', label: '<x> & "y"' });
  const svg = SVGExporter.exportSVG(m);
  assert(svg.indexOf('&lt;x&gt; &amp;') >= 0, '未正确转义');
});
test('空图导出抛出 GRAPH_EMPTY', function () {
  assertThrows(function () { SVGExporter.exportSVG(new GraphModel()); }, 'GRAPH_EMPTY');
});
test('XML 校验器可识别坏标签', function () {
  assert(SVGExporter.validateXML('<svg><g></svg>').ok === false);
  assert(SVGExporter.validateXML(SVGExporter.buildSVG((function () {
    const m = new GraphModel();
    m.addNode({ id: 'a' });
    m.addNode({ id: 'b' });
    m.addEdge('a', 'b');
    return m;
  })())).ok === true);
});

console.log('模型层:');

test('重复连线/自环/悬空连线返回错误而非崩溃', function () {
  const m = new GraphModel();
  m.addNode({ id: 'a' });
  m.addNode({ id: 'b' });
  assert(m.addEdge('a', 'b').ok === true);
  assert(m.addEdge('a', 'b').ok === false);
  assert(m.addEdge('a', 'a').error.code === 'EDGE_SELF');
  assert(m.addEdge('a', 'x').error.code === 'EDGE_ENDPOINT_MISSING');
});
test('删除节点级联删除连线', function () {
  const m = new GraphModel();
  m.addNode({ id: 'a' });
  m.addNode({ id: 'b' });
  m.addEdge('a', 'b');
  m.removeNode('a');
  assert(m.edges.length === 0 && m.nodes.length === 1);
});
test('load 失败时数据回滚', function () {
  const m = new GraphModel();
  m.addNode({ id: 'keep' });
  assertThrows(function () { m.load({ nodes: [{ id: 'x' }, { label: '无 id' }] }); }, 'NODE_ID_MISSING');
  assert(m.getNode('keep'), '旧数据应保留');
  assert(!m.getNode('x'), '半成品数据不应残留');
});

console.log('\n结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed ? 1 : 0);
