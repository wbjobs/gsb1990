# Diff Viewer — 文本对比工具

纯前端文本/代码对比工具：Web Worker 计算 diff、DOM 虚拟滚动渲染、Canvas 缩略图、IndexedDB 会话持久化。无构建步骤，直接用静态服务器打开即可。

## 运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

> 必须通过 HTTP 访问（Web Worker 与 ES Module 不支持 file:// 协议）。

## 测试

```bash
node test/diff-core.test.js   # diff 核心：最小编辑距离性质测试 + 重放校验 + 性能
node test/model.test.mjs      # 折叠区域计算与可见项展开
node test/worker.smoke.js     # Worker 消息协议与行对齐冒烟测试
```

## 架构

| 模块 | 职责 |
| --- | --- |
| `js/diff-core.js` | Myers O(ND) diff：线性空间 middle-snake + 显式栈（防爆栈），编辑距离超预算自动降级为「整块替换」并标记 `fallback` |
| `js/diff-worker.js` | Worker 内执行行级 diff、变更行配对（replace）、行内字符级高亮；异常以 `error` 消息返回 |
| `js/model.js` | 折叠区域计算（连续相同行保留上下文 N 行）、可见项展开、变更跳转 |
| `js/view.js` | 固定行高虚拟滚动（DOM 窗口化）、双栏同步滚动（防回环）、Canvas 缩略图 |
| `js/db.js` | IndexedDB KV 封装（会话恢复，失败仅提示不阻断） |
| `js/app.js` | 主控：输入校验、Worker 调度、折叠状态、跳转、持久化、toast 异常提示 |

## 验收标准对照

- **diff 准确**：Myers 最小编辑脚本，2000 组随机用例与朴素 DP 编辑距离逐一比对通过；ops 可重放还原目标文本。
- **同步滚动正确**：两栏共享同一行模型与固定行高，scrollTop/scrollLeft 1:1 双向同步，带防回环。
- **折叠正确**：连续相同行超过上下文×2 时折叠中间部分，折叠条显示隐藏行数、点击展开；支持全部折叠/展开与上下文行数切换。
- **性能可接受**：10 万行 diff < 2s（Worker 内不阻塞 UI）；固定行高虚拟滚动，DOM 中仅保留视口±overscan 行；行内高亮设行数/长度上限，超限自动跳过并提示。
- **异常有提示**：Worker 错误、diff 降级、文件读取失败/超限（20MB）、IndexedDB 不可用、空输入、无更多变更等均以 toast 提示。

## 功能

- 左右文件选择 / 粘贴文本 / 内置示例
- 并排 diff 视图：删除（红）、新增（绿）、修改（黄）+ 行内字符级高亮
- 相同区域自动折叠，折叠条点击展开
- 上一处/下一处变更跳转、Canvas 变更分布缩略图（点击跳转）
- 会话自动保存（IndexedDB），刷新后恢复
