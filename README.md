# Graph Editor

基于 **SVG + Canvas + 自定义力导向布局 + Web Worker** 的节点图编辑器，零依赖、无构建步骤。

## 功能

- **节点拖拽**：Pointer Events + `requestAnimationFrame` 批量重绘，拖拽流畅
- **连线**：连线模式下从源节点拖到目标节点，Canvas 覆盖层实时预览虚线；重复边 / 自环校验
- **自动布局**：Web Worker 中执行力导向布局（Barnes-Hut 斥力 O(n log n) + 弹簧 + 向心力），逐 tick 动画回传；扫描线确定性分离保证**节点零重叠**；Worker 不可用时自动降级主线程
- **导出 SVG**：内联样式 + 自动包围盒，生成独立可用的 `.svg` 文件下载
- **异常提示**：布局失败、导出失败、非法连线等均以 Toast 提示
- **其他**：平移 / 滚轮缩放、Canvas 网格背景、Delete 删除节点、Esc 退出连线模式

## 运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

> 直接双击 `index.html`（file://）也能运行，只是 Web Worker 被浏览器禁用时自动降级为主线程布局。

## 性能参考（布局耗时）

| 节点 / 边 | 耗时 | 重叠 |
|---|---|---|
| 50 / 80 | ~30ms | 0 |
| 200 / 300 | ~220ms | 0 |
| 500 / 800 | ~1.2s | 0 |
| 1000 / 1500 | ~4.4s | 0 |

布局在 Worker 中执行，期间 UI 不阻塞，并有过场动画。

## 结构

```
index.html          页面骨架
css/style.css       样式
js/graph.js         图数据模型（增删查 + 校验）
js/layout-core.js   布局算法（Worker / 主线程共用）
js/layout-worker.js Web Worker 入口
js/layout.js        布局引擎封装（Worker 优先，自动降级）
js/renderer.js      SVG 渲染器 + 视口变换
js/exporter.js      SVG 导出
js/toast.js         异常 / 提示
js/main.js          交互编排
```
