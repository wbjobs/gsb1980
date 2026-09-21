# 节点图编辑器

零依赖的纯前端节点图编辑器,支持**自动布局、节点拖拽、端口连线、SVG 导出**。
技术栈:SVG(导出层)+ Canvas(高性能视口)+ 自定义布局算法 + Web Worker。

## 运行

需要通过 HTTP 访问(Web Worker 在 `file://` 下会被浏览器阻止,应用会自动降级到主线程并提示):

```bash
node tests/server.js        # http://localhost:8123
# 或任意静态服务器,例如:
python3 -m http.server 8123
```

## 功能

- **自动布局(Web Worker)**
  - 分层 DAG:拓扑分层 + 重心排序减少交叉 + 列内/列间去重叠;自动检测环并断开回边
  - 力导向:电荷排斥(空间哈希加速)、弹簧吸引、向心力,迭代退火,结果可复现
  - 网格:行列对齐,天然无重叠
  - 环形:半径按节点尺寸自适应,弧长不足时自动扩大
  - 所有算法统一执行迭代松弛去重叠,保证**节点矩形互不重叠**
  - 支持进度条、取消;Worker 不可用时自动降级主线程分帧计算
- **拖拽**:节点单选/多选拖拽,每帧合一次重绘;中键或空格平移
- **连线**:节点四周端口拖出贝塞尔曲线,目标非法(自环/重复/悬空)时红色提示并 toast 报错
- **缩放**:滚轮以指针位置为锚点(0.15x–3x),`F` 适配视图
- **选择**:点选、Ctrl/Shift 多选、空白框选、Ctrl+A 全选、Delete 删除
- **导出 SVG**:与 Canvas 共享同一套路径几何(`Geo.edgePathD`),导出后做 XML 良构校验;另附 PNG 栅格化
- **导入**:按钮选择 JSON,或直接把 JSON 文件拖进页面;校验失败自动回滚,不破坏现有数据
- **异常提示**:空图、缺 id、坏连线、环、悬空边、超限(>20000 节点)、Worker 失败、全局 error/unhandledrejection 均有 toast

## 验收标准对照

| 标准 | 实现 |
| --- | --- |
| 布局不重叠 | 所有算法后处理去重叠;`npm test` 对 4 种算法各 120 节点断言重叠数为 0 |
| 导出正确 | 节点/连线/箭头数量与数据一致,特殊字符转义,XML 良构校验 |
| 拖拽流畅 | 指针事件 + 直接世界坐标位移 + rAF 脏矩形合帧 + DPR 适配 |
| 性能可接受 | 视口裁剪、空间哈希排斥/去重叠、网格小步长才绘制;状态栏实时 FPS;Worker 不阻塞 UI(800 节点压测示例) |
| 异常有提示 | toast(info/success/warn/error)+ 布局 warning 通道 + 全局兜底 |

## 操作速查

| 操作 | 方式 |
| --- | --- |
| 拖拽节点 | 左键按住节点移动 |
| 连线 | 节点端口(四周圆点)拖向目标节点 |
| 平移 | 中键拖动 / 空格+左键拖动 / Shift+滚轮 |
| 缩放 | 滚轮 |
| 新建节点 | 双击空白处 |
| 多选 | Ctrl/Shift+点击,或空白处框选 |
| 删除 | Delete / Backspace |
| 适配视图 | F |
| 取消连线/选择 | Esc |

## JSON 数据格式

```json
{
  "nodes": [
    { "id": "a", "label": "开始", "x": 0, "y": 0 }
  ],
  "edges": [
    { "source": "a", "target": "b" }
  ]
}
```

`x/y/w/h` 可省略,布局后会重新计算。

## 目录结构

```
js/
  geometry.js       几何工具:端口、贝塞尔路径、空间哈希去重叠、包围盒
  layout.js         四种布局算法(Worker / Node 共用)
  layout.worker.js  Worker 入口:run/progress/done/error/cancel 协议
  layout-runner.js  主线程执行器:Worker 调度与主线程降级
  model.js          图模型:增删改查、校验、事务回滚、订阅
  renderer.js       Canvas 渲染器:变换、裁剪、绘制、命中测试、FPS
  interaction.js    指针/滚轮/键盘交互
  svg-exporter.js   SVG 生成、XML 校验、下载
  toast.js          全局提示
  main.js           应用入口、示例数据、导入导出、全局异常
tests/
  run-tests.js      Node 零依赖测试(npm test)
  server.js         零依赖静态服务器(npm start)
```

## 测试

```bash
npm test
```

覆盖:四种算法无重叠、DAG 拓扑顺序、环检测、力导向可复现、异常码、悬空边、
SVG 节点/连线数量与转义、XML 良构、模型连线约束与导入回滚。
