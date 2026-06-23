// ==UserScript==
// @name         Gemini Chat Copier - 一键复制对话
// @name:zh-CN   Gemini 对话一键复制助手
// @namespace    https://github.com/YunAsimov/AI-Chat-Export
// @version      3.0.0
// @author       AI-Chat-Export
// @description  Export Gemini conversations as Markdown/HTML/JSON/TXT/PNG. Auto-scroll, LaTeX, code blocks, tables, settings, preview.
// @description:zh-CN 一键导出 Gemini 对话为 Markdown/HTML/JSON/TXT/截图，支持设置/预览/自动滚动
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

(function () {
  'use strict';

  // ================================================================
  //  日志
  // ================================================================
  const LOG = '🧊 [GeminiCopier]';
  const log = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  // ================================================================
  //  常量
  // ================================================================
  const SCROLL_INTERVAL = 120;
  const SCROLL_SETTLE   = 500;
  const MAX_SCROLL      = 80;
  const STABLE_NEEDED   = 3;

  // ================================================================
  //  设置存储 (GM_getValue / GM_setValue)
  // ================================================================
  const DEFAULTS = {
    exportFormat:    'md',           // md | html | json | txt
    filenameFormat:  '{date}_{title}',
    qLabel:          '## 🧑 Q:',
    aLabel:          '## 🤖 A:',
    yamlFrontMatter: true,
    stripCitations:  true,
    autoScroll:      true,
    includeMeta:     true,
    showPreview:     false,          // 导出前是否预览
  };

  const getSetting = (key) => {
    try {
      const v = typeof GM_getValue !== 'undefined' ? GM_getValue('gcc_' + key) : localStorage.getItem('gcc_' + key);
      if (v === undefined || v === null) return DEFAULTS[key];
      return JSON.parse(v);
    } catch { return DEFAULTS[key]; }
  };
  const setSetting = (key, val) => {
    try {
      const s = JSON.stringify(val);
      if (typeof GM_setValue !== 'undefined') GM_setValue('gcc_' + key, s);
      else localStorage.setItem('gcc_' + key, s);
    } catch (e) { warn('setSetting failed:', e); }
  };
  const getAllSettings = () => {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = getSetting(k);
    return out;
  };

  // ================================================================
  //  Turndown 初始化
  // ================================================================
  let turndownService = null;

  const initTurndown = () => {
    if (typeof TurndownService === 'undefined') { warn('TurndownService not loaded!'); return null; }
    const td = new TurndownService({
      headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-',
      emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined',
    });
    if (typeof TurndownPluginGfm !== 'undefined') td.use(TurndownPluginGfm);

    // 代码块
    td.addRule('geminiCodeBlock', {
      filter: (n) => n.nodeName === 'CODE-BLOCK' || n.tagName === 'PRE',
      replacement: (_c, node) => {
        const codeEl = node.querySelector('code') || node;
        const lang = (codeEl.className || '').match(/language-(\w+)/)?.[1] || node.getAttribute('data-language') || '';
        return '\n\n```' + lang + '\n' + (codeEl.textContent || '').trim() + '\n```\n\n';
      }
    });
    // 块级公式
    td.addRule('geminiMathBlock', {
      filter: (n) => n.nodeName === 'MATH' && n.parentElement && (n.parentElement.classList.contains('katex-display') || n.parentElement.tagName === 'DIV'),
      replacement: (_c, node) => {
        const a = node.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="math/tex"]');
        return a ? '\n\n$$' + (a.textContent || '').trim() + '$$\n\n' : (node.textContent || '');
      }
    });
    // 行内公式
    td.addRule('geminiMathInline', {
      filter: (n) => n.nodeName === 'MATH' && (!n.parentElement || (!n.parentElement.classList.contains('katex-display') && n.parentElement.tagName !== 'DIV')),
      replacement: (_c, node) => {
        const a = node.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="math/tex"]');
        if (a) return '$' + (a.textContent || '').trim() + '$';
        const dm = node.getAttribute('data-math');
        return dm ? '$' + dm + '$' : (node.textContent || '');
      }
    });
    // KaTeX 容器
    td.addRule('katexContainer', {
      filter: (n) => n.classList && (n.classList.contains('katex') || n.classList.contains('katex-display')),
      replacement: (_c, node) => {
        const a = node.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="math/tex"]');
        if (a) { const f = (a.textContent || '').trim(); return node.classList.contains('katex-display') ? '\n\n$$' + f + '$$\n\n' : '$' + f + '$'; }
        return node.textContent || '';
      }
    });
    // 移除 UI 元素
    td.addRule('removeUI', {
      filter: (n) => { if (!n.classList) return false; const c = n.className; if (typeof c !== 'string') return false;
        return ['suggestions-container','action-bar','feedback-buttons','more-menu','sources-','grounding','citation','copy-button','edit-button','regenerate'].some(s => c.includes(s));
      },
      replacement: () => ''
    });
    // 图片
    td.addRule('images', { filter: 'img', replacement: (_c, n) => {
      const alt = n.getAttribute('alt') || 'image'; const src = n.getAttribute('src') || n.getAttribute('data-src') || '';
      return src ? `![${alt}](${src})` : '';
    }});
    // 按钮
    td.addRule('buttons', { filter: 'button', replacement: () => '' });
    return td;
  };

  // ================================================================
  //  文本清理
  // ================================================================
  const cleanNBSP = (t) => (t || '').replace(/[\u00A0\u2007\u202F\u2060]/g, ' ').replace(/\u00AD/g, '').replace(/\u200B/g, '').replace(/[\u200C\u200D]/g, '');
  const stripCites = (t) => (t || '').replace(/\[cite_start\]/gi, '').replace(/\[cite:\s*[\d,\s]+\]/gi, '').replace(/【\d+†[^】]*】/g, '').trim();
  const cleanupMD = (md) => (md || '').replace(/\n{4,}/g, '\n\n\n').replace(/\n\n+(?=- |\d+\. )/g, '\n').replace(/\n{2,}```/g, '\n\n```').replace(/```\n{2,}/g, '```\n').replace(/[ \t]+$/gm, '').trim();

  // ================================================================
  //  DOM 查找
  // ================================================================
  const findScrollContainer = () => {
    for (const sel of ['cdk-virtual-scroll-viewport', 'infinite-scroller', 'chat-window infinite-scroller']) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > 100) return el;
    }
    for (const el of document.querySelectorAll('main *')) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 200) return el;
    }
    return null;
  };

  const findTurns = () => {
    const turns = [];
    // 策略 1: conversation-container
    const containers = document.querySelectorAll('.conversation-container');
    if (containers.length > 0) {
      containers.forEach(c => {
        const u = c.querySelector('user-query'), m = c.querySelector('model-response');
        if (u || m) turns.push({ userEl: u, modelEl: m });
      });
      if (turns.length) return turns;
    }
    // 策略 2: 按 DOM 顺序配对
    const users = Array.from(document.querySelectorAll('user-query'));
    const models = Array.from(document.querySelectorAll('model-response'));
    if (!users.length && !models.length) return turns;
    const all = [...users.map(el => ({ t: 'u', el })), ...models.map(el => ({ t: 'm', el }))]
      .sort((a, b) => a.el === b.el ? 0 : (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    let cu = null, cm = null;
    for (const it of all) {
      if (it.t === 'u') { if (cu && (cm || turns.length)) turns.push({ userEl: cu, modelEl: cm }); cu = it.el; cm = null; }
      else { cm = it.el; if (cu) { turns.push({ userEl: cu, modelEl: cm }); cu = null; cm = null; } else { turns.push({ userEl: null, modelEl: cm }); cm = null; } }
    }
    if (cu || cm) turns.push({ userEl: cu, modelEl: cm });
    return turns;
  };

  const extractUserText = (el) => {
    if (!el) return '';
    const qt = el.querySelector('div.query-text') || el;
    const clone = qt.cloneNode(true);
    clone.querySelectorAll('[class*="visually-hidden"], [aria-hidden="true"]').forEach(e => e.remove());
    const html = qt.innerHTML;
    if (html && html.includes('<br')) {
      const d = document.createElement('div'); d.innerHTML = html;
      d.querySelectorAll('[class*="visually-hidden"], [aria-hidden="true"]').forEach(e => e.remove());
      d.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
      return cleanNBSP(d.textContent || '').replace(/[ \t]+$/gm, '').trim();
    }
    return cleanNBSP(clone.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const extractModelHTML = (el) => {
    if (!el) return '';
    const panel = el.querySelector('message-content div.markdown.markdown-main-panel')
      || el.querySelector('div.response-content div.markdown')
      || el.querySelector('div.markdown')
      || el.querySelector('div.response-content');
    if (!panel) { warn('Markdown panel not found'); const c = el.cloneNode(true); c.querySelectorAll('[class*="visually-hidden"], [aria-hidden="true"]').forEach(e => e.remove()); return cleanNBSP(c.textContent || '').trim(); }
    const clone = panel.cloneNode(true);
    clone.querySelectorAll('.suggestions-container, .action-bar, .feedback-buttons, .more-menu, .sources-attribution, .grounding, [class*="citation"], button, .copy-button, .edit-button, .regenerate, .thumbs-up, .thumbs-down').forEach(e => e.remove());
    return clone;
  };

  const extractModelText = (el, td) => {
    const clone = extractModelHTML(el);
    if (typeof clone === 'string') return clone;
    if (td) { try { let md = td.turndown(clone); if (getSetting('stripCitations')) md = stripCites(md); return md; } catch (e) { warn('Turndown failed:', e); } }
    return cleanNBSP(clone.textContent || '').trim();
  };

  // ================================================================
  //  格式生成器
  // ================================================================
  const getTitle = () => (document.title || 'Gemini Conversation').replace(/\s*[-—]\s*(Google\s*)?Gemini\s*$/i, '').trim() || 'Gemini Conversation';
  const getUrl = () => window.location.href;
  const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);
  const getLocalTime = () => new Date().toLocaleString();

  const buildFilename = (ext) => {
    const fmt = getSetting('filenameFormat');
    const title = getTitle();
    const now = new Date();
    const date = now.toISOString().substring(0, 10);
    const ts = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const name = fmt.replace(/\{title\}/g, title).replace(/\{date\}/g, date).replace(/\{timestamp\}/g, ts);
    return sanitizeFilename(name) + '.' + ext;
  };

  const sanitizeFilename = (n) => (n || 'gemini-chat').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').substring(0, 180);

  /** 提取所有对话内容 (原始数据) */
  const extractAllTurns = () => {
    const turns = findTurns();
    return turns.map(t => ({
      user: extractUserText(t.userEl),
      model: extractModelText(t.modelEl, turndownService),
      modelHTML: t.modelEl ? extractModelHTML(t.modelEl) : null,
    })).filter(t => t.user || t.model);
  };

  /** 生成 Markdown */
  const genMarkdown = (data) => {
    const S = getAllSettings();
    const lines = [];
    const title = getTitle();

    // YAML front matter
    if (S.yamlFrontMatter) {
      lines.push('---');
      lines.push(`title: "${title.replace(/"/g, '\\"')}"`);
      lines.push(`source: ${getUrl()}`);
      lines.push(`exported: ${getTimestamp()}`);
      lines.push(`messages: ${data.length}`);
      lines.push('---');
      lines.push('');
    }

    lines.push(`# ${title}`);
    if (S.includeMeta) {
      lines.push('');
      lines.push(`> **导出时间**: ${getLocalTime()}  `);
      lines.push(`> **来源**: ${getUrl()}  `);
      lines.push(`> **消息数**: ${data.length} 组对话`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    data.forEach(t => {
      if (t.user) { lines.push(S.qLabel); lines.push(''); lines.push(t.user); lines.push(''); }
      if (t.model) { lines.push(S.aLabel); lines.push(''); lines.push(t.model); lines.push(''); }
      lines.push('---');
      lines.push('');
    });

    return cleanupMD(lines.join('\n'));
  };

  /** 生成 HTML */
  const genHTML = (data) => {
    const title = getTitle();
    const S = getAllSettings();
    const escapeHTML = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let body = '';
    data.forEach(t => {
      if (t.user) body += `<div class="msg user"><div class="role">🧑 User</div><div class="content">${escapeHTML(t.user).replace(/\n/g, '<br>')}</div></div>\n`;
      if (t.model) {
        // 使用原始 HTML (已清理)
        let html = '';
        if (t.modelHTML && typeof t.modelHTML !== 'string') {
          html = t.modelHTML.innerHTML;
        } else {
          html = escapeHTML(t.model).replace(/\n/g, '<br>');
        }
        body += `<div class="msg assistant"><div class="role">🤖 Gemini</div><div class="content markdown-body">${html}</div></div>\n`;
      }
    });

    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
  :root { --bg:#fff; --fg:#1a1a1a; --user-bg:#f0f4ff; --ai-bg:#f8f9fa; --border:#e0e0e0; --accent:#1a73e8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1a1a1a; --fg:#e8e8e8; --user-bg:#1e2433; --ai-bg:#242424; --border:#3c4043; --accent:#8ab4f8; } }
  * { box-sizing: border-box; }
  body { font-family: 'Google Sans', Roboto, Arial, sans-serif; background:var(--bg); color:var(--fg); margin:0; padding:20px; line-height:1.6; }
  .header { max-width:800px; margin:0 auto 24px; }
  .header h1 { font-size:1.6em; margin:0 0 8px; }
  .header .meta { font-size:0.85em; color:#666; }
  .msg { max-width:800px; margin:0 auto 16px; border-radius:12px; padding:16px 20px; border:1px solid var(--border); }
  .msg.user { background:var(--user-bg); }
  .msg.assistant { background:var(--ai-bg); }
  .msg .role { font-weight:600; font-size:0.85em; margin-bottom:8px; color:var(--accent); }
  .msg .content { white-space:pre-wrap; word-wrap:break-word; }
  .msg .content markdown-body, .markdown-body { white-space:normal; }
  .markdown-body pre { background:#1e1e1e; color:#d4d4d4; border-radius:8px; padding:12px 16px; overflow-x:auto; }
  .markdown-body code { background:rgba(128,128,128,0.15); padding:2px 6px; border-radius:4px; font-family:monospace; }
  .markdown-body table { border-collapse:collapse; width:100%; margin:12px 0; }
  .markdown-body th, .markdown-body td { border:1px solid var(--border); padding:8px 12px; text-align:left; }
  .markdown-body blockquote { border-left:3px solid var(--accent); margin:12px 0; padding:8px 16px; opacity:0.8; }
</style>
</head>
<body>
<div class="header">
  <h1>${escapeHTML(title)}</h1>
  ${S.includeMeta ? `<div class="meta">导出时间: ${getLocalTime()} · 来源: <a href="${getUrl()}">${escapeHTML(getUrl())}</a> · ${data.length} 组对话</div>` : ''}
</div>
${body}
</body>
</html>`;
  };

  /** 生成 JSON */
  const genJSON = (data) => {
    const messages = [];
    let idx = 0;
    for (const t of data) {
      if (t.user)   messages.push({ index: ++idx, role: 'user',      content: t.user });
      if (t.model)  messages.push({ index: ++idx, role: 'assistant', content: t.model });
    }
    return JSON.stringify({
      title: getTitle(),
      url: getUrl(),
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages,
    }, null, 2);
  };

  /** 生成纯文本 */
  const genText = (data) => {
    const S = getAllSettings();
    const lines = [];
    lines.push(getTitle());
    if (S.includeMeta) { lines.push(`导出时间: ${getLocalTime()}`); lines.push(`来源: ${getUrl()}`); }
    lines.push('='.repeat(50));
    lines.push('');
    data.forEach(t => {
      if (t.user) { lines.push('User:'); lines.push(t.user); lines.push(''); }
      if (t.model) { lines.push('Gemini:'); lines.push(t.model); lines.push(''); }
      lines.push('-'.repeat(50));
      lines.push('');
    });
    return lines.join('\n').trim();
  };

  /** 根据设置生成内容 */
  const generateContent = (data) => {
    const fmt = getSetting('exportFormat');
    switch (fmt) {
      case 'html':  return { content: genHTML(data),  ext: 'html', mime: 'text/html' };
      case 'json':  return { content: genJSON(data),  ext: 'json', mime: 'application/json' };
      case 'txt':   return { content: genText(data),  ext: 'txt',  mime: 'text/plain' };
      default:      return { content: genMarkdown(data), ext: 'md',   mime: 'text/markdown' };
    }
  };

  // ================================================================
  //  截图 (PNG)
  // ================================================================
  const takeScreenshot = async () => {
    if (typeof html2canvas === 'undefined') { showToast('html2canvas 未加载，无法截图', 'error'); return; }
    showProgress('📷 正在截图...');
    try {
      // 找到对话区域
      let target = document.querySelector('chat-window') || document.querySelector('main');
      if (!target) { showToast('未找到对话区域', 'error'); hideProgress(); return; }

      // 临时移除滚动限制
      const scrollEl = findScrollContainer();
      const origOverflow = scrollEl ? scrollEl.style.overflow : '';
      const origHeight = scrollEl ? scrollEl.style.maxHeight : '';
      if (scrollEl) { scrollEl.style.overflow = 'visible'; scrollEl.style.maxHeight = 'none'; }

      await sleep(300);

      const canvas = await html2canvas(target, {
        scale: window.devicePixelRatio || 1,
        useCORS: true,
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#fff',
        scrollX: 0, scrollY: 0,
      });

      // 恢复
      if (scrollEl) { scrollEl.style.overflow = origOverflow; scrollEl.style.maxHeight = origHeight; }

      const dataUrl = canvas.toDataURL('image/png');
      const filename = buildFilename('png');
      const a = document.createElement('a');
      a.href = dataUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);

      hideProgress();
      showToast(`✓ 截图已保存: ${filename}`, 'success', 3000);
    } catch (e) {
      hideProgress();
      warn('Screenshot failed:', e);
      showToast('截图失败: ' + (e.message || ''), 'error');
    }
  };

  // ================================================================
  //  自动滚动
  // ================================================================
  const autoScroll = async (container) => {
    if (!container) return false;
    let prevH = 0, stable = 0, round = 0;
    showProgress('⏳ 正在加载对话历史...');
    while (round < MAX_SCROLL) {
      container.scrollTop = 0;
      await sleep(SCROLL_INTERVAL); await sleep(SCROLL_SETTLE);
      const h = container.scrollHeight;
      if (h === prevH) { stable++; if (stable >= STABLE_NEEDED) break; }
      else { stable = 0; prevH = h; }
      round++;
      if (round % 5 === 0) showProgress(`⏳ 正在加载对话历史... (${round} 轮)`);
    }
    hideProgress();
    return round < MAX_SCROLL;
  };

  // ================================================================
  //  工具函数
  // ================================================================
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const copyToClipboard = async (text) => {
    if (typeof GM_setClipboard !== 'undefined') { try { GM_setClipboard(text, 'text'); return true; } catch {} }
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok; } catch { return false; }
  };

  const downloadFile = (filename, content, mime) => {
    const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ================================================================
  //  UI: 样式
  // ================================================================
  const injectStyles = () => {
    const css = `
      .gcc-toast {
        position: fixed; top: 72px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; padding: 10px 24px; border-radius: 24px;
        font: 500 14px/1.4 'Google Sans', Roboto, Arial, sans-serif;
        color: #fff; box-shadow: 0 4px 24px rgba(0,0,0,0.18);
        animation: gccSlideDown 0.35s cubic-bezier(0.16,1,0.3,1);
        pointer-events: none; white-space: nowrap;
      }
      .gcc-toast.success { background: #1b8a3d; }
      .gcc-toast.error { background: #d93025; }
      .gcc-toast.info { background: #1a73e8; }

      .gcc-bar {
        position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
        z-index: 2147483646; display: flex; align-items: center; gap: 6px;
      }
      .gcc-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 16px; border: none; border-radius: 24px;
        font: 500 13px/1 'Google Sans', Roboto, Arial, sans-serif;
        cursor: pointer; transition: all 0.18s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
        white-space: nowrap; outline: none;
      }
      .gcc-btn:active { transform: scale(0.97); }
      .gcc-btn-primary { background: #1a73e8; color: #fff; }
      .gcc-btn-primary:hover { background: #1557b0; box-shadow: 0 4px 14px rgba(26,115,232,0.35); }
      .gcc-btn-primary:disabled { background: #93b8f0; cursor: not-allowed; box-shadow: none; }
      .gcc-btn-secondary { background: #fff; color: #1a73e8; border: 1px solid #dadce0; }
      .gcc-btn-secondary:hover { background: #f1f8ff; border-color: #1a73e8; }
      .gcc-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
      .gcc-btn-icon { background: #fff; color: #5f6368; border: 1px solid #dadce0; padding: 8px 10px; }
      .gcc-btn-icon:hover { background: #f1f3f4; }

      .gcc-select {
        padding: 7px 10px; border: 1px solid #dadce0; border-radius: 24px;
        font: 500 13px/1 'Google Sans', Roboto, Arial, sans-serif;
        background: #fff; color: #1a73e8; cursor: pointer; outline: none;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      }
      .gcc-select:focus { border-color: #1a73e8; }

      .gcc-spinner {
        display: inline-block; width: 15px; height: 15px;
        border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff;
        border-radius: 50%; animation: gccSpin 0.7s linear infinite;
      }
      .gcc-spinner.dark { border-color: rgba(26,115,232,0.2); border-top-color: #1a73e8; }

      .gcc-progress {
        position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
        z-index: 2147483646; font: 12px/1 'Google Sans', Roboto, Arial, sans-serif;
        color: #5f6368; background: rgba(255,255,255,0.94); padding: 5px 16px;
        border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08);
        pointer-events: none; animation: gccPulse 1.5s ease-in-out infinite;
      }

      /* ---- 模态对话框 ---- */
      .gcc-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        z-index: 2147483646; display: flex; align-items: center; justify-content: center;
        animation: gccFadeIn 0.2s ease;
      }
      .gcc-modal {
        background: #fff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        max-width: 560px; width: 90vw; max-height: 85vh; overflow: hidden;
        display: flex; flex-direction: column; animation: gccModalIn 0.25s cubic-bezier(0.16,1,0.3,1);
      }
      .gcc-modal-header {
        padding: 20px 24px 16px; font: 600 18px/1.3 'Google Sans', Roboto, Arial, sans-serif;
        border-bottom: 1px solid #e8eaed; display: flex; justify-content: space-between; align-items: center;
      }
      .gcc-modal-body { flex: 1; overflow-y: auto; padding: 20px 24px; }
      .gcc-modal-footer { padding: 16px 24px; border-top: 1px solid #e8eaed; display: flex; justify-content: flex-end; gap: 10px; }
      .gcc-modal-close {
        width: 32px; height: 32px; border: none; background: transparent; cursor: pointer;
        border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #5f6368;
      }
      .gcc-modal-close:hover { background: #f1f3f4; }

      .gcc-setting-row { margin-bottom: 18px; }
      .gcc-setting-label { font: 500 14px/1.3 'Google Sans', Roboto, Arial, sans-serif; color: #202124; margin-bottom: 4px; }
      .gcc-setting-desc { font: 400 12px/1.4 'Google Sans', Roboto, Arial, sans-serif; color: #5f6368; margin-bottom: 6px; }
      .gcc-input {
        width: 100%; padding: 8px 12px; border: 1px solid #dadce0; border-radius: 8px;
        font: 400 14px/1.4 'Google Sans', Roboto, Arial, sans-serif; outline: none; box-sizing: border-box;
      }
      .gcc-input:focus { border-color: #1a73e8; box-shadow: 0 0 0 2px rgba(26,115,232,0.15); }

      .gcc-radio-group { display: flex; gap: 16px; flex-wrap: wrap; }
      .gcc-radio { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font: 400 14px/1 'Google Sans', Roboto, Arial, sans-serif; }
      .gcc-radio input { cursor: pointer; }

      .gcc-toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
      .gcc-toggle input { opacity: 0; width: 0; height: 0; }
      .gcc-toggle-slider {
        position: absolute; cursor: pointer; inset: 0; background: #dadce0;
        border-radius: 22px; transition: 0.2s;
      }
      .gcc-toggle-slider::before {
        content: ''; position: absolute; height: 16px; width: 16px; left: 3px; bottom: 3px;
        background: #fff; border-radius: 50%; transition: 0.2s;
      }
      .gcc-toggle input:checked + .gcc-toggle-slider { background: #1a73e8; }
      .gcc-toggle input:checked + .gcc-toggle-slider::before { transform: translateX(18px); }
      .gcc-toggle-row { display: flex; justify-content: space-between; align-items: center; }

      .gcc-preview {
        background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 8px;
        padding: 16px; font: 400 13px/1.5 'Roboto Mono', monospace; white-space: pre-wrap;
        word-wrap: break-word; max-height: 50vh; overflow-y: auto;
      }

      .gcc-vars { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
      .gcc-var {
        display: inline-block; padding: 2px 8px; background: #e8f0fe; color: #1a73e8;
        border-radius: 4px; font: 400 12px/1.4 monospace; cursor: pointer; user-select: all;
      }
      .gcc-var:hover { background: #d2e3fc; }

      @keyframes gccSpin { to { transform: rotate(360deg); } }
      @keyframes gccSlideDown { from { opacity:0; transform: translateX(-50%) translateY(-10px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
      @keyframes gccPulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      @keyframes gccFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes gccModalIn { from { opacity: 0; transform: scale(0.95) translateY(-10px); } to { opacity: 1; transform: scale(1) translateY(0); } }

      @media (prefers-color-scheme: dark) {
        .gcc-btn-secondary, .gcc-btn-icon, .gcc-select { background: #2d2e30; color: #8ab4f8; border-color: #3c4043; }
        .gcc-btn-secondary:hover, .gcc-btn-icon:hover { background: #35373a; }
        .gcc-progress { color: #9aa0a6; background: rgba(32,33,36,0.94); }
        .gcc-modal { background: #1e1e1e; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
        .gcc-modal-header { border-bottom-color: #3c4043; color: #e8eaed; }
        .gcc-modal-footer { border-top-color: #3c4043; }
        .gcc-modal-close { color: #9aa0a6; }
        .gcc-modal-close:hover { background: #2d2e30; }
        .gcc-setting-label { color: #e8eaed; }
        .gcc-setting-desc { color: #9aa0a6; }
        .gcc-input { background: #2d2e30; border-color: #3c4043; color: #e8eaed; }
        .gcc-toggle-slider { background: #3c4043; }
        .gcc-preview { background: #2d2e30; border-color: #3c4043; color: #e8eaed; }
        .gcc-var { background: #1e3a5f; color: #8ab4f8; }
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    setInterval(() => { if (!style.isConnected) (document.head || document.documentElement).appendChild(style); }, 3000);
  };

  // ================================================================
  //  UI: Toast & Progress
  // ================================================================
  let toastTimer = null;
  const showToast = (msg, type = 'info', duration = 2600) => {
    if (toastTimer) clearTimeout(toastTimer);
    document.querySelector('.gcc-toast')?.remove();
    const t = document.createElement('div');
    t.className = `gcc-toast ${type}`; t.textContent = msg;
    document.body.appendChild(t);
    toastTimer = setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, duration);
  };

  let progressEl = null;
  const showProgress = (text) => {
    if (!progressEl) { progressEl = document.createElement('div'); progressEl.className = 'gcc-progress'; document.body.appendChild(progressEl); }
    progressEl.textContent = text; progressEl.style.display = 'block';
  };
  const hideProgress = () => { if (progressEl) progressEl.style.display = 'none'; };

  // ================================================================
  //  UI: 图标 SVG
  // ================================================================
  const ICONS = {
    copy:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    save:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    camera:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    gear:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    eye:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    close: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };

  // ================================================================
  //  UI: 按钮栏
  // ================================================================
  let btnBar = null, copyBtn = null, dlBtn = null, formatSelect = null;

  const createButtonBar = () => {
    if (btnBar && btnBar.isConnected) return;
    btnBar = document.createElement('div');
    btnBar.className = 'gcc-bar';

    // 格式选择
    formatSelect = document.createElement('select');
    formatSelect.className = 'gcc-select';
    formatSelect.title = '选择导出格式';
    const formats = [
      { v: 'md',   l: 'Markdown' },
      { v: 'html', l: 'HTML' },
      { v: 'json', l: 'JSON' },
      { v: 'txt',  l: 'Text' },
    ];
    formats.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.v; opt.textContent = f.l;
      if (f.v === getSetting('exportFormat')) opt.selected = true;
      formatSelect.appendChild(opt);
    });
    formatSelect.addEventListener('change', () => {
      setSetting('exportFormat', formatSelect.value);
      log('Format changed to:', formatSelect.value);
    });

    // 复制按钮
    copyBtn = document.createElement('button');
    copyBtn.className = 'gcc-btn gcc-btn-primary';
    copyBtn.innerHTML = ICONS.copy + '<span>Copy</span>';
    copyBtn.title = '一键复制对话 (Ctrl+Shift+C)';
    copyBtn.addEventListener('click', handleCopy);

    // 保存按钮
    dlBtn = document.createElement('button');
    dlBtn.className = 'gcc-btn gcc-btn-secondary';
    dlBtn.innerHTML = ICONS.save + '<span>Save</span>';
    dlBtn.title = '下载对话文件';
    dlBtn.addEventListener('click', handleDownload);

    // 截图按钮
    const ssBtn = document.createElement('button');
    ssBtn.className = 'gcc-btn gcc-btn-icon';
    ssBtn.innerHTML = ICONS.camera;
    ssBtn.title = '截图保存为 PNG';
    ssBtn.addEventListener('click', takeScreenshot);

    // 预览按钮
    const pvBtn = document.createElement('button');
    pvBtn.className = 'gcc-btn gcc-btn-icon';
    pvBtn.innerHTML = ICONS.eye;
    pvBtn.title = '预览导出内容';
    pvBtn.addEventListener('click', handlePreview);

    // 设置按钮
    const setBtn = document.createElement('button');
    setBtn.className = 'gcc-btn gcc-btn-icon';
    setBtn.innerHTML = ICONS.gear;
    setBtn.title = '设置';
    setBtn.addEventListener('click', openSettings);

    btnBar.appendChild(formatSelect);
    btnBar.appendChild(copyBtn);
    btnBar.appendChild(dlBtn);
    btnBar.appendChild(ssBtn);
    btnBar.appendChild(pvBtn);
    btnBar.appendChild(setBtn);
    document.body.appendChild(btnBar);
  };

  const setBtnLoading = (btn, loading, originalHTML) => {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      const dark = btn.classList.contains('gcc-btn-secondary') || btn.classList.contains('gcc-btn-icon');
      btn.innerHTML = `<span class="gcc-spinner${dark ? ' dark' : ''}"></span>`;
    } else {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  };

  // ================================================================
  //  UI: 设置对话框
  // ================================================================
  const openSettings = () => {
    const S = getAllSettings();

    const overlay = document.createElement('div');
    overlay.className = 'gcc-overlay';

    overlay.innerHTML = `
      <div class="gcc-modal">
        <div class="gcc-modal-header">
          <span>⚙️ 导出设置</span>
          <button class="gcc-modal-close">${ICONS.close}</button>
        </div>
        <div class="gcc-modal-body">
          <div class="gcc-setting-row">
            <div class="gcc-setting-label">导出格式</div>
            <div class="gcc-radio-group" id="gcc-fmt-group">
              <label class="gcc-radio"><input type="radio" name="gcc-fmt" value="md" ${S.exportFormat === 'md' ? 'checked' : ''}> Markdown</label>
              <label class="gcc-radio"><input type="radio" name="gcc-fmt" value="html" ${S.exportFormat === 'html' ? 'checked' : ''}> HTML</label>
              <label class="gcc-radio"><input type="radio" name="gcc-fmt" value="json" ${S.exportFormat === 'json' ? 'checked' : ''}> JSON</label>
              <label class="gcc-radio"><input type="radio" name="gcc-fmt" value="txt" ${S.exportFormat === 'txt' ? 'checked' : ''}> Text</label>
            </div>
          </div>

          <div class="gcc-setting-row">
            <div class="gcc-setting-label">文件名格式</div>
            <div class="gcc-setting-desc">可用变量: {title} {date} {timestamp}</div>
            <input class="gcc-input" id="gcc-filename" value="${S.filenameFormat.replace(/"/g, '&quot;')}">
            <div class="gcc-vars">
              <span class="gcc-var" data-insert="title">{title}</span>
              <span class="gcc-var" data-insert="date">{date}</span>
              <span class="gcc-var" data-insert="timestamp">{timestamp}</span>
            </div>
          </div>

          <div class="gcc-setting-row">
            <div class="gcc-setting-label">Q 标签 (用户消息标题)</div>
            <input class="gcc-input" id="gcc-qlabel" value="${S.qLabel.replace(/"/g, '&quot;')}">
          </div>

          <div class="gcc-setting-row">
            <div class="gcc-setting-label">A 标签 (AI 回复标题)</div>
            <input class="gcc-input" id="gcc-alabel" value="${S.aLabel.replace(/"/g, '&quot;')}">
          </div>

          <div class="gcc-setting-row gcc-toggle-row">
            <div>
              <div class="gcc-setting-label">YAML Front Matter</div>
              <div class="gcc-setting-desc">在 Markdown 文件头部添加元数据</div>
            </div>
            <label class="gcc-toggle"><input type="checkbox" id="gcc-yaml" ${S.yamlFrontMatter ? 'checked' : ''}><span class="gcc-toggle-slider"></span></label>
          </div>

          <div class="gcc-setting-row gcc-toggle-row">
            <div>
              <div class="gcc-setting-label">清理引用标记</div>
              <div class="gcc-setting-desc">移除 [cite_start] 等引用残留</div>
            </div>
            <label class="gcc-toggle"><input type="checkbox" id="gcc-cite" ${S.stripCitations ? 'checked' : ''}><span class="gcc-toggle-slider"></span></label>
          </div>

          <div class="gcc-setting-row gcc-toggle-row">
            <div>
              <div class="gcc-setting-label">自动滚动加载</div>
              <div class="gcc-setting-desc">导出前自动滚动加载完整对话历史</div>
            </div>
            <label class="gcc-toggle"><input type="checkbox" id="gcc-scroll" ${S.autoScroll ? 'checked' : ''}><span class="gcc-toggle-slider"></span></label>
          </div>

          <div class="gcc-setting-row gcc-toggle-row">
            <div>
              <div class="gcc-setting-label">包含元数据</div>
              <div class="gcc-setting-desc">在导出内容中包含导出时间、来源 URL、消息数</div>
            </div>
            <label class="gcc-toggle"><input type="checkbox" id="gcc-meta" ${S.includeMeta ? 'checked' : ''}><span class="gcc-toggle-slider"></span></label>
          </div>

          <div class="gcc-setting-row gcc-toggle-row">
            <div>
              <div class="gcc-setting-label">导出前预览</div>
              <div class="gcc-setting-desc">点击复制/下载时先弹出预览确认</div>
            </div>
            <label class="gcc-toggle"><input type="checkbox" id="gcc-preview" ${S.showPreview ? 'checked' : ''}><span class="gcc-toggle-slider"></span></label>
          </div>
        </div>
        <div class="gcc-modal-footer">
          <button class="gcc-btn gcc-btn-secondary" id="gcc-reset">恢复默认</button>
          <button class="gcc-btn gcc-btn-primary" id="gcc-save">保存设置</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 关闭
    const close = () => overlay.remove();
    overlay.querySelector('.gcc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // 变量插入
    overlay.querySelectorAll('.gcc-var').forEach(v => {
      v.addEventListener('click', () => {
        const input = overlay.querySelector('#gcc-filename');
        const insert = '{' + v.dataset.insert + '}';
        input.value += insert;
        input.focus();
      });
    });

    // 恢复默认
    overlay.querySelector('#gcc-reset').addEventListener('click', () => {
      for (const k of Object.keys(DEFAULTS)) setSetting(k, DEFAULTS[k]);
      close();
      showToast('✓ 已恢复默认设置', 'success');
      // 更新格式下拉
      if (formatSelect) formatSelect.value = DEFAULTS.exportFormat;
    });

    // 保存
    overlay.querySelector('#gcc-save').addEventListener('click', () => {
      const fmt = overlay.querySelector('input[name="gcc-fmt"]:checked')?.value || 'md';
      setSetting('exportFormat', fmt);
      setSetting('filenameFormat', overlay.querySelector('#gcc-filename').value || DEFAULTS.filenameFormat);
      setSetting('qLabel', overlay.querySelector('#gcc-qlabel').value || DEFAULTS.qLabel);
      setSetting('aLabel', overlay.querySelector('#gcc-alabel').value || DEFAULTS.aLabel);
      setSetting('yamlFrontMatter', overlay.querySelector('#gcc-yaml').checked);
      setSetting('stripCitations', overlay.querySelector('#gcc-cite').checked);
      setSetting('autoScroll', overlay.querySelector('#gcc-scroll').checked);
      setSetting('includeMeta', overlay.querySelector('#gcc-meta').checked);
      setSetting('showPreview', overlay.querySelector('#gcc-preview').checked);
      if (formatSelect) formatSelect.value = fmt;
      close();
      showToast('✓ 设置已保存', 'success');
    });
  };

  // ================================================================
  //  UI: 预览对话框
  // ================================================================
  const showPreviewModal = (content, ext, onCopy, onDownload) => {
    const overlay = document.createElement('div');
    overlay.className = 'gcc-overlay';

    overlay.innerHTML = `
      <div class="gcc-modal" style="max-width:720px;">
        <div class="gcc-modal-header">
          <span>👁 预览导出内容</span>
          <button class="gcc-modal-close">${ICONS.close}</button>
        </div>
        <div class="gcc-modal-body">
          <div class="gcc-preview">${content.substring(0, 20000).replace(/</g, '&lt;').replace(/>/g, '&gt;')}${content.length > 20000 ? '\n\n... (仅显示前 20000 字符)' : ''}</div>
        </div>
        <div class="gcc-modal-footer">
          <button class="gcc-btn gcc-btn-secondary" id="gcc-pv-dl">${ICONS.save} 下载 .${ext}</button>
          <button class="gcc-btn gcc-btn-primary" id="gcc-pv-copy">${ICONS.copy} 复制全部</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.gcc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#gcc-pv-copy').addEventListener('click', async () => {
      const ok = await copyToClipboard(content);
      if (ok) { showToast('✓ 已复制到剪贴板', 'success'); close(); if (onCopy) onCopy(); }
      else showToast('复制失败', 'error');
    });
    overlay.querySelector('#gcc-pv-dl').addEventListener('click', () => {
      downloadFile(buildFilename(ext), content);
      showToast(`✓ 已下载 .${ext} 文件`, 'success');
      close();
      if (onDownload) onDownload();
    });
  };

  // ================================================================
  //  核心: 导出流程
  // ================================================================
  const exportConversation = async () => {
    // 1. 自动滚动
    if (getSetting('autoScroll')) {
      const sc = findScrollContainer();
      if (sc) { log('Scroll container:', sc.tagName, sc.className); await autoScroll(sc); }
    }
    // 2. 提取
    const data = extractAllTurns();
    log(`Extracted ${data.length} turns`);
    if (data.length === 0) throw new Error('未找到对话内容，请确保在 Gemini 对话页面中');
    // 3. 生成
    const result = generateContent(data);
    if (!result.content || result.content.length < 10) throw new Error('提取的内容为空');
    return { ...result, turnCount: data.length };
  };

  // ================================================================
  //  事件处理
  // ================================================================
  const handleCopy = async () => {
    const orig = ICONS.copy + '<span>Copy</span>';
    setBtnLoading(copyBtn, true, orig);
    try {
      const { content, ext, turnCount } = await exportConversation();

      if (getSetting('showPreview')) {
        setBtnLoading(copyBtn, false, orig);
        showPreviewModal(content, ext, null, null);
        return;
      }

      showProgress('📋 正在复制...');
      const ok = await copyToClipboard(content);
      hideProgress();
      if (ok) showToast(`✓ 已复制 ${turnCount} 组对话 (${(content.length / 1000).toFixed(1)}k 字符)`, 'success', 3000);
      else showToast('复制失败，请重试', 'error');
    } catch (err) {
      hideProgress(); warn('Export failed:', err);
      showToast(err.message || '导出失败', 'error');
    } finally {
      setBtnLoading(copyBtn, false, orig);
    }
  };

  const handleDownload = async () => {
    const orig = ICONS.save + '<span>Save</span>';
    setBtnLoading(dlBtn, true, orig);
    try {
      const { content, ext, mime, turnCount } = await exportConversation();

      if (getSetting('showPreview')) {
        setBtnLoading(dlBtn, false, orig);
        showPreviewModal(content, ext, null, null);
        return;
      }

      const filename = buildFilename(ext);
      downloadFile(filename, content, mime);
      showToast(`✓ 已下载: ${filename} (${turnCount} 组对话)`, 'success', 3500);
    } catch (err) {
      warn('Download failed:', err);
      showToast(err.message || '下载失败', 'error');
    } finally {
      setBtnLoading(dlBtn, false, orig);
    }
  };

  const handlePreview = async () => {
    showToast('⏳ 正在生成预览...', 'info', 1500);
    try {
      const { content, ext } = await exportConversation();
      showPreviewModal(content, ext, null, null);
    } catch (err) {
      showToast(err.message || '预览失败', 'error');
    }
  };

  // ================================================================
  //  键盘快捷键
  // ================================================================
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      e.preventDefault(); handleCopy();
    }
    // Ctrl+Shift+S → 下载
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      e.preventDefault(); handleDownload();
    }
  };

  // ================================================================
  //  初始化
  // ================================================================
  const init = () => {
    log('Initializing v3.0.0...');
    injectStyles();
    turndownService = initTurndown();
    if (!turndownService) warn('Fallback mode (no Turndown)');
    else log('Turndown ready ✓');
    if (typeof html2canvas !== 'undefined') log('html2canvas ready ✓');
    else warn('html2canvas not loaded — screenshot disabled');
    createButtonBar();
    document.addEventListener('keydown', onKeyDown);
    log('Ready ✓ — Ctrl+Shift+C=Copy, Ctrl+Shift+S=Save');
  };

  // 启动
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(init, 500);
  else window.addEventListener('load', () => setTimeout(init, 500));

  // SPA 路由变化
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => { if (!btnBar || !btnBar.isConnected) { btnBar = null; copyBtn = null; dlBtn = null; formatSelect = null; createButtonBar(); } }, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
