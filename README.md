# Gemini Chat Copier

> 一键导出 Google Gemini 对话为 Markdown / HTML / JSON / Text / PNG 的油猴脚本

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](https://github.com/beckyeeky/AI-Chat-Export)

一个 Tampermonkey 用户脚本，用于将 Google Gemini 网页端对话一键导出为结构化、干净的 Markdown（及其他格式），自动处理：

- 全量滚动加载（无需手动翻页）
- 代码块提取与语言标注
- LaTeX / KaTeX 数学公式转成 `$...$` / `$$...$$`
- 列表、表格、链接、图片等 Markdown 化
- 引用标记清理（`[cite_start]` 等残留）
- 自动时间戳与安全文件名生成
- Q / A 分节排版

无需后端，不上传数据，所有处理都在本地浏览器内完成。

---

## 安装

### 1. 安装脚本管理器

任选其一：

- **[Tampermonkey](https://www.tampermonkey.net/)**（推荐）
- [Violentmonkey](https://violentmonkey.github.io/)
- [Greasemonkey](https://www.greasespot.net/)

### 2. 安装脚本

**方式 A — 直接安装（推荐）**

点击下方链接，脚本管理器会自动弹出安装提示：

→ [安装脚本](https://raw.githubusercontent.com/beckyeeky/AI-Chat-Export/main/gemini-chat-copier.user.js)

**方式 B — 手动安装**

1. 打开仓库文件 [`gemini-chat-copier.user.js`](https://github.com/beckyeeky/AI-Chat-Export/blob/main/gemini-chat-copier.user.js)
2. 全选复制内容
3. 在脚本管理器中新建脚本并粘贴保存

### 3. 使用

1. 进入 [Gemini](https://gemini.google.com/app) 任意对话页面
2. 页面顶部中央会出现按钮栏：

   ```
   [Markdown ▼] [📋 Copy] [💾 Save] [📷] [👁] [⚙️]
   ```

3. 选择导出格式，点击 **Copy** 或 **Save** 即可

---

## 功能一览

### 导出格式

| 格式 | 说明 | 扩展名 |
|------|------|--------|
| **Markdown** | 干净的 Markdown，支持 YAML front matter | `.md` |
| **HTML** | 独立 HTML 文件，内联 CSS，暗色模式自适应 | `.html` |
| **JSON** | 结构化数据，每条消息含 `index` / `role` / `content` | `.json` |
| **Text** | 纯文本，`User:` / `Gemini:` 分隔 | `.txt` |
| **PNG** | 截图保存完整对话（基于 html2canvas） | `.png` |

### 核心特性

- **自动滚动加载** — 点击导出时自动向上滚动，确保加载完整对话历史
- **LaTeX 公式保留** — 从 Gemini 的 KaTeX `annotation` 中提取原始 LaTeX，转成 `$...$` / `$$...$$`
- **代码块语言标注** — 自动检测语言并添加到 ```` ```lang ```` 围栏
- **引用标记清理** — 移除 `[cite_start]`、`[cite:1,2,3]` 等引用残留
- **YAML Front Matter** — 可选在 Markdown 头部添加元数据
- **预览功能** — 导出前可预览内容，确认后再复制或下载
- **设置持久化** — 所有偏好通过 `GM_setValue` 持久保存
- **暗色模式** — 按钮和对话框自动适配系统主题

### 设置面板

点击按钮栏的 ⚙️ 图标打开设置：

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 导出格式 | Markdown / HTML / JSON / Text | Markdown |
| 文件名格式 | 支持 `{title}` `{date}` `{timestamp}` 变量 | `{date}_{title}` |
| Q 标签 | 用户消息的标题标签 | `## 🧑 Q:` |
| A 标签 | AI 回复的标题标签 | `## 🤖 A:` |
| YAML Front Matter | Markdown 头部元数据块 | 开 |
| 清理引用标记 | 移除引用残留 | 开 |
| 自动滚动加载 | 导出前自动滚动加载完整历史 | 开 |
| 包含元数据 | 导出内容中包含时间/URL/消息数 | 开 |
| 导出前预览 | 点击导出时先弹出预览 | 关 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + Shift + C` | 复制对话到剪贴板 |
| `Ctrl + Shift + S` | 下载对话文件 |

> macOS 用户使用 `Cmd` 替代 `Ctrl`

---

## 导出内容示例

### Markdown

```markdown
---
title: "快速排序实现"
source: https://gemini.google.com/app/xxxx
exported: 2026-06-23 15:30:00
messages: 2
---

# 快速排序实现

> **导出时间**: 2026/6/23 15:30:00
> **来源**: https://gemini.google.com/app/xxxx
> **消息数**: 1 组对话

---

## 🧑 Q:

如何用 Python 写一个快速排序？

## 🤖 A:

下面是一个简单示例：

```python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left  = [x for x in arr if x < pivot]
    mid   = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + mid + quicksort(right)
```

时间复杂度为 $O(n \log n)$，最坏情况下为 $O(n^2)$。

---
```

### JSON

```json
{
  "title": "快速排序实现",
  "url": "https://gemini.google.com/app/xxxx",
  "exportedAt": "2026-06-23T07:30:00.000Z",
  "messageCount": 2,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "content": "如何用 Python 写一个快速排序？"
    },
    {
      "index": 2,
      "role": "assistant",
      "content": "下面是一个简单示例：\n\n```python\ndef quicksort(arr): ...\n```\n\n时间复杂度为 $O(n \\log n)$..."
    }
  ]
}
```

### Text

```text
快速排序实现
导出时间: 2026/6/23 15:30:00
来源: https://gemini.google.com/app/xxxx
==================================================

User:
如何用 Python 写一个快速排序？

Gemini:
下面是一个简单示例：

def quicksort(arr):
    if len(arr) <= 1:
        return arr
    ...

--------------------------------------------------
```

---

## 技术细节

### 依赖

| 库 | 用途 | 加载方式 |
|----|------|----------|
| [Turndown](https://github.com/mixmark-io/turndown) 7.2.0 | HTML → Markdown 转换 | `@require` CDN |
| [turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) 1.0.2 | GFM 表格/删除线/任务列表 | `@require` CDN |
| [html2canvas](https://github.com/niklasvh/html2canvas) 1.4.1 | PNG 截图 | `@require` CDN |

### Gemini DOM 结构

脚本适配 2025-2026 年 Gemini 网页端 DOM 结构：

```
.conversation-container
  ├─ user-query
  │    └─ div.query-text          ← 用户消息文本
  └─ model-response
       └─ div.response-content
            └─ message-content
                 └─ div.markdown.markdown-main-panel  ← AI 回复的 Markdown HTML
```

### 浏览器兼容性

已在以下环境测试：

- Chrome / Edge + Tampermonkey
- Firefox + Tampermonkey / Violentmonkey

其他现代浏览器 + 脚本管理器大概率兼容。

---

## 限制 / 已知问题

- **Canvas 内容**：Gemini Canvas 是独立组件，暂不支持导出
- **图片/附件**：保留为 `![image](url)` 引用，不内联 base64
- **音频/视频**：不处理
- **DOM 变更**：若 Gemini 更新页面结构，选择器可能需要适配

---

## 开发与调试

克隆仓库：

```bash
git clone https://github.com/beckyeeky/AI-Chat-Export.git
```

修改 `gemini-chat-copier.user.js` 后，在脚本管理器中重新载入即可。纯前端脚本，不需要构建工具。

---

## Roadmap

- [ ] 支持选择性导出（checkbox 勾选消息）
- [ ] 对话大纲面板（搜索 + 导航）
- [ ] YAML front matter 自定义字段
- [ ] 图片内联 base64
- [ ] 支持更多平台（ChatGPT、Claude 等）

---

## License

[MIT](https://opensource.org/licenses/MIT)

---

如果这个脚本对你有帮助，欢迎 Star 支持！⭐
