# Diff 查看器

零依赖、零构建的双栏 Diff 查看器。直接用现代浏览器打开即可使用。

## 运行

```bash
# 任选其一（需要 http 服务以启用 ES Module Worker）
python3 -m http.server 8899
# 或
npx serve .
```

然后访问 `http://localhost:8899/`。

> 直接用 `file://` 打开时，部分浏览器会拒绝 Module Worker，程序会自动回退到主线程计算并给出提示。

## 测试

```bash
npm test
```

包含三层共 28 个测试：

- `test/run.test.mjs` — diff 算法、行内差异、配对行模型、折叠模型、5 万行性能基线、随机模糊对照
- `test/dom.test.mjs` — 虚拟化渲染窗口、双栏同步滚动、折叠点击、越界钳制（内置轻量 DOM 桩）
- `test/storage.test.mjs` — IndexedDB 存取、缓存键、不可用降级（内存桩）
- `test/worker.test.mjs` — Worker 消息协议、进度、空输入（`vm.SourceTextModule` 模拟）

## 功能与验收对照

| 验收项 | 实现 |
| --- | --- |
| Diff 准确 | Myers O(ND) 最短编辑脚本（`Int32Array` 轨迹，回溯重建）；随机模糊测试中与 Patience 结果互相校验，所有操作脚本能无损还原两侧原文；替换行做词级行内高亮 |
| 同步滚动正确 | 左右两栏共享同一行坐标系（每行固定 20px、变更占行对齐），任一栏滚动用抑制重入标志同步另一栏的 `scrollTop`；水平滚动各自独立 |
| 折叠正确 | 仅折叠「未更改」的连续等同行段；自动/全部/不折叠三档；按行边界生成稳定 id，点击跨栏折叠条展开，展开时保持当前滚动锚点不跳动 |
| 性能可接受 | Web Worker 计算不阻塞 UI；双栏仅渲染视口 ±8 行（文档流 margin 虚拟列表，长行可横向滚动）；每 ~60ms 回报进度；5 万行近相似文件算法 < 3s（Node 基线测试） |
| 异常有提示 | Worker 失败、算法超时/超内存自动回退 Patience、IndexedDB 不可用降级、>20MB 拦截、全局 `error`/`unhandledrejection` 统一 Toast；4 秒长任务看门狗提示 |

## 架构

```
index.html                 页面骨架（工具栏 / 双输入框 / 双栏 / Canvas 缩略图 / 状态栏）
css/style.css              深色 GitHub 风格样式
js/
  diff.js        (纯逻辑)  splitLines / myersDiff / patienceDiff / 行内词级 LCS
  model.js       (纯逻辑)  原子操作 -> 对齐行；折叠状态机（纯函数，可单测）
  diff-worker.js          Worker：行切分 + Myers + 进度/结果消息
  storage.js              IndexedDB：最近输入、diff 缓存、UI 偏好（全部优雅降级）
  diff-view.js            双栏虚拟渲染、同步滚动、跨栏折叠覆盖层
  minimap.js              Canvas 变更缩略图，点击/拖动跳转，HiDPI 适配
  app.js                  编排：防抖、Worker 生命周期、缓存命中、竞态过滤、Toast
```

## 关键设计说明

**算法回退**：Myers 在差异巨大时会退化（编辑距离过长、轨迹内存超 96MB、墙钟超 120ms）。
触发任一条件即抛内部 `bail` 信号并切换到 Patience（唯一公共行 + LIS，线性内存），
状态栏会显示 `Myers 回退 → Patience（time/edits/memory）`。

**同步滚动的正确性来源**：不同于各自独立行高的编辑器，这里每个逻辑行在两栏占据
完全相同的垂直空间（删除行在右栏是占位格、新增行在左栏是占位格），因此同步是
恒等映射，不会产生累积漂移。

**折叠 id 稳定性**：id 为折叠段首尾在新旧文件中的行号（`oldStart-oldEnd|newStart-newEnd`），
相邻内容不变时重新 diff 后 id 不变，因此手动展开状态在编辑后尽量保留；失效 id 自然忽略。

**缓存**：IndexedDB 以「长度 + 采样 FNV 指纹」为 key 命中，Worker 结果另带全量 FNV
哈希存于缓存值，结构保留后续升级为强校验的能力。缓存写入失败不影响功能。

## 已知边界

- 超长单行（数十万字符）的词级行内 diff 有 token 数量与 `n*m<=60000` 的保护，超限降级为整行高亮。
- 不做语法高亮与自动换行（代码 diff 的行对齐优先）；可在此基础上扩展。
