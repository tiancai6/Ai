// Cloudflare Pages Functions 版本：部署到 Cloudflare Pages 即可使用
// 路由：/ssr-texts?url=<目标地址>
export async function onRequestGet(context) {
  const DEFAULT_URL = 'https://ops68hj2uj.feishu.cn/wiki/SuaxwJ7idiCHm9krelKcEUxWn1e?table=tbl3uV85fUbn4WJ0&view=vewNhBX7cO';
  const reqUrl = new URL(context.request.url);
  const target = reqUrl.searchParams.get('url') || DEFAULT_URL;

  try {
    const resp = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://ops68hj2uj.feishu.cn/wiki/'
      }
    });
    if (!resp.ok) {
      return json({ ok: false, error: `HTTP ${resp.status}` }, 502);
    }

    const html = await resp.text();
    const arr = extractArrayLiteral(html);
    if (!arr) {
      return json({ ok: false, error: '未找到 bitable_ssr_commands 数组字面量' }, 404);
    }

    const { textsRaw, textsParsed } = extractTexts(arr);
    return json({
      ok: true,
      url: target,
      count: textsRaw.length,
      texts_raw: textsRaw,
      texts_parsed: textsParsed
    });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

// 提取 var bitable_ssr_commands = [ ... ];
function extractArrayLiteral(html) {
  const m = html.match(/var\s+bitable_ssr_commands\s*=/);
  if (!m) return '';
  let i = m.index + m[0].length;
  while (i < html.length && html[i] !== '[') i++;
  if (i >= html.length || html[i] !== '[') return '';
  const end = scanBalanced(html, i, '[', ']');
  if (end < 0) return '';
  return html.slice(i, end + 1);
}

// 从数组字面量中提取每个对象的 texts
function extractTexts(arr) {
  const textsRaw = [];
  const textsParsed = [];
  let i = 0;
  while (i < arr.length) {
    if (arr[i] === '{') {
      const j = scanBalanced(arr, i, '{', '}');
      if (j < 0) break;
      const obj = arr.slice(i, j + 1);

      // 寻找 texts: { ... }
      let k = 0;
      while (k < obj.length) {
        const ch = obj[k];
        // 跳过字符串
        if (ch === '\'' || ch === '"' || ch === '`') {
          k = skipString(obj, k);
          continue;
        }
        // 跳过注释
        if (ch === '/') {
          const next = skipComment(obj, k);
          if (next !== k) { k = next; continue; }
        }
        if (obj.startsWith('texts', k) || obj.startsWith('"texts"', k) || obj.startsWith("'texts'", k)) {
          const colon = obj.indexOf(':', k);
          const brace = obj.indexOf('{', colon);
          if (colon !== -1 && brace !== -1) {
            const endb = scanBalanced(obj, brace, '{', '}');
            if (endb !== -1) {
              const raw = obj.slice(brace, endb + 1).trim();
              textsRaw.push(raw);
              const parsed = tryParseJson(raw);
              if (parsed) textsParsed.push(parsed);
              k = endb + 1;
              continue;
            }
          }
        }
        k++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return { textsRaw, textsParsed };
}

// 辅助：括号配对扫描（处理字符串与注释）
function scanBalanced(s, start, openCh, closeCh) {
  let i = start, depth = 0, inStr = false, strCh = '';
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === strCh) inStr = false;
      i++; continue;
    }
    if (ch === '/' && i + 1 < s.length) {
      if (s[i + 1] === '/') {
        i += 2;
        while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
        continue;
      } else if (s[i + 1] === '*') {
        i += 2;
        while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
        i += 2; continue;
      }
    }
    if (ch === '\'' || ch === '"' || ch === '`') { inStr = true; strCh = ch; i++; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}
function skipString(s, i) {
  const quote = s[i]; i++;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === quote) { i++; break; }
    i++;
  }
  return i;
}
function skipComment(s, i) {
  if (s[i] === '/' && i + 1 < s.length && s[i + 1] === '/') {
    i += 2; while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; return i;
  }
  if (s[i] === '/' && i + 1 < s.length && s[i + 1] === '*') {
    i += 2; while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; return i + 2;
  }
  return i;
}
function tryParseJson(js) {
  let s = js.trim();
  s = s.replace(/([{\s,])([A-Za-z_][\w-]*)\s*:/g, '$1"$2":');      // key 加引号
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');            // 单引号转双引号
  s = s.replace(/,\s*([}\]])/g, '$1');                             // 去尾逗号
  try { return JSON.parse(s); } catch { return null; }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}