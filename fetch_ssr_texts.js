#!/usr/bin/env node
// 单文件爬虫：抓取页面中 var bitable_ssr_commands 的 texts 并输出为 JSON
// 仅使用 Node 内置模块，无需额外安装依赖

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');
const vm = require('vm');

const DEFAULT_URL = 'https://ops68hj2uj.feishu.cn/wiki/SuaxwJ7idiCHm9krelKcEUxWn1e?table=tbl3uV85fUbn4WJ0&view=vewNhBX7cO';

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err) }, null, 2));
  process.exitCode = 1;
});

async function main() {
  const target = process.argv[2] || DEFAULT_URL;
  const html = await fetchHtml(target);
  const { commands, snippet } = extractCommands(html);

  if (!commands) {
    console.error(JSON.stringify({ ok: false, error: '未找到 bitable_ssr_commands', snippet }, null, 2));
    process.exitCode = 2;
    return;
  }

  const { textsList, textsMerged } = extractTexts(commands);
  const out = {
    ok: true,
    url: target,
    count: textsList.length,
    texts_list: textsList,
    texts_merged: textsMerged
  };
  console.log(JSON.stringify(out, null, 2));
}

// 抓取 HTML，支持重定向
function fetchHtml(target, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const lib = u.protocol === 'https:' ? https : http;

    const req = lib.request({
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': `${u.origin}/`
      }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('重定向过多'));
        const nextUrl = new URL(res.headers.location, u).href;
        return resolve(fetchHtml(nextUrl, maxRedirects - 1));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    req.on('error', reject);
    req.end();
  });
}

// 提取并解析 var bitable_ssr_commands 的数组字面量
function extractCommands(html) {
  // 优先在 <script> 标签中寻找
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m, content = '';
  while ((m = scriptRegex.exec(html)) !== null) {
    const inner = m[1] || '';
    if (inner.includes('var bitable_ssr_commands')) {
      content = inner;
      break;
    }
  }

  // 兜底：全文正则直接找数组字面量
  const arrMatch =
    (content && content.match(/var\s+bitable_ssr_commands\s*=\s*(\[[\s\S]*?\]);/)) ||
    html.match(/var\s+bitable_ssr_commands[\s\S]*?=\s*(\[[\s\S]*?\]);/);

  if (!arrMatch) {
    return { commands: null, snippet: (content || html).slice(0, 500) };
  }

  const arrayLiteral = arrMatch[1];
  try {
    // 在沙箱中安全求值，仅解析数组字面量
    const commands = vm.runInNewContext(`(${arrayLiteral})`, {}, { timeout: 1000 });
    return { commands, snippet: content.slice(0, 500) };
  } catch {
    return { commands: null, snippet: arrayLiteral.slice(0, 500) };
  }
}

// 提取 texts 列表与合并结果
function extractTexts(commands) {
  const textsList = [];
  const textsMerged = {};
  if (Array.isArray(commands)) {
    for (const c of commands) {
      if (c && typeof c === 'object' && c.texts) {
        textsList.push(c.texts);
        Object.assign(textsMerged, c.texts);
      }
    }
  }
  return { textsList, textsMerged };
}