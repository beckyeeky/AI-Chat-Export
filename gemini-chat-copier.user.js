// ==UserScript==
// @name         Gemini Chat Copier
// @name:zh-CN   Gemini 对话一键复制助手
// @namespace    https://github.com/beckyeeky/AI-Chat-Export
// @version      3.0.0
// @author       AI-Chat-Export
// @description  Export Gemini conversations as Markdown/HTML/JSON/TXT/PNG
// @description:zh-CN 一键导出 Gemini 对话为 Markdown/HTML/JSON/TXT/截图
// @license      MIT
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @match        https://gemini.google.com/app/*
// @match        https://gemini.google.com/app
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @require      https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// ==/UserScript==

// This userscript adds a button bar to the top of Google Gemini chat pages.
// Click "Copy" to copy the full conversation as formatted Markdown (or other formats).
// Click "Save" to download as a file. Click the gear icon for settings.
//
// Features: Auto-scroll to load full history, LaTeX math preservation, code block language detection,
// citation stripping, YAML front matter, preview, screenshot (PNG), keyboard shortcuts (Ctrl+Shift+C/S).
//
// Full source: https://github.com/beckyeeky/AI-Chat-Export