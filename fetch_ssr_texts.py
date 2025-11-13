#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
单文件爬虫：抓取页面中 var bitable_ssr_commands 的 texts 并输出
仅使用 Python 标准库（urllib、re），可直接运行
"""

import sys
import re
import json
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

DEFAULT_URL = "https://ops68hj2uj.feishu.cn/wiki/SuaxwJ7idiCHm9krelKcEUxWn1e?table=tbl3uV85fUbn4WJ0&view=vewNhBX7cO"


def fetch_html(url: str, timeout: int = 20) -> str:
    """
    以常见浏览器 UA 抓取 HTML，自动跟随重定向
    """
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://ops68hj2uj.feishu.cn/wiki/",
        },
    )
    with urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def scan_balanced(s: str, start: int, open_ch: str, close_ch: str) -> int:
    """
    从 s[start]（必须是 open_ch）开始，找到与之平衡的 close_ch 的下标。
    支持 ' " ` 字符串与 // /**/ 注释的跳过。
    返回匹配位置（包含 close_ch），若失败返回 -1。
    """
    assert s[start] == open_ch
    i = start
    depth = 0
    in_str = False
    str_ch = ""
    while i < len(s):
        ch = s[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == str_ch:
                in_str = False
            i += 1
            continue

        # 处理注释
        if ch == "/":
            if i + 1 < len(s) and s[i + 1] == "/":
                # 行注释
                i += 2
                while i < len(s) and s[i] not in ("\n", "\r"):
                    i += 1
                continue
            if i + 1 < len(s) and s[i + 1] == "*":
                # 块注释
                i += 2
                while i + 1 < len(s) and not (s[i] == "*" and s[i + 1] == "/"):
                    i += 1
                i += 2
                continue

        # 进入字符串
        if ch in ("'", '"', "`"):
            in_str = True
            str_ch = ch
            i += 1
            continue

        # 计数括号
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def extract_array_literal(html: str) -> str:
    """
    在整页文本中找 var bitable_ssr_commands = [ ... ];
    返回数组字面量（含方括号），找不到则返回空字符串
    """
    # 找到变量声明位置
    m = re.search(r"var\s+bitable_ssr_commands\s*=", html)
    if not m:
        return ""
    idx = m.end()
    # 找到第一个 '['
    while idx < len(html) and html[idx] != "[":
        idx += 1
    if idx >= len(html) or html[idx] != "[":
        return ""
    end = scan_balanced(html, idx, "[", "]")
    if end == -1:
        return ""
    return html[idx : end + 1]


def extract_texts_from_array(arr: str) -> list[str]:
    """
    从数组字面量中逐个对象提取 texts 的对象文本
    保留原始 JS 片段，不尝试完全解析为 Python 对象
    """
    res = []
    i = 0
    while i < len(arr):
        if arr[i] == "{":
            j = scan_balanced(arr, i, "{", "}")
            if j == -1:
                break
            obj = arr[i : j + 1]
            # 在对象里找 texts: { ... }
            # 先定位 texts 键（尽量避免匹配到字符串内部）
            k = 0
            while k < len(obj):
                ch = obj[k]
                # 跳过字符串
                if ch in ("'", '"', "`"):
                    kk = k + 1
                    while kk < len(obj):
                        if obj[kk] == "\\":
                            kk += 2
                            continue
                        if obj[kk] == ch:
                            break
                        kk += 1
                    k = kk + 1
                    continue
                # 找到 t
                if obj.startswith("texts", k) or obj.startswith('"texts"', k) or obj.startswith("'texts'", k):
                    # 定位到冒号后面的第一个 '{'
                    colon = obj.find(":", k)
                    if colon != -1:
                        brace = obj.find("{", colon)
                        if brace != -1:
                            endb = scan_balanced(obj, brace, "{", "}")
                            if endb != -1:
                                texts_obj = obj[brace : endb + 1]
                                res.append(texts_obj.strip())
                                k = endb + 1
                                continue
                k += 1
            i = j + 1
        else:
            i += 1
    return res


def maybe_parse_json(js_obj_text: str):
    """
    尝试把 JS 对象文本粗略转换为 JSON 并解析。
    若失败则返回 None。此转换不保证覆盖所有 JS 语法，仅做尽力处理。
    """
    s = js_obj_text.strip()
    # 给未加引号的 key 加引号（简单场景）
    s = re.sub(r"(?P<prefix>[\{\s,])\s*(?P<key>[A-Za-z_][\w\-]*)\s*:", r'\g<prefix>"\g<key>":', s)
    # 将单引号字符串替换为双引号（不处理模板字符串）
    s = re.sub(r"'([^'\\]*(?:\\.[^'\\]*)*)'", r'"\1"', s)
    # 删除对象/数组结尾的多余逗号
    s = re.sub(r",\s*([}\]])", r"\1", s)
    # true/false/null 本身是 JSON 关键字，无需替换
    try:
        return json.loads(s)
    except Exception:
        return None


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    try:
        html = fetch_html(url)
    except (HTTPError, URLError) as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        return

    arr = extract_array_literal(html)
    if not arr:
        print(json.dumps({"ok": False, "error": "未找到 bitable_ssr_commands 数组字面量"}))
        return

    texts_raw = extract_texts_from_array(arr)
    parsed = [maybe_parse_json(t) for t in texts_raw]
    parsed_ok = [p for p in parsed if p is not None]

    print(json.dumps({
        "ok": True,
        "url": url,
        "count": len(texts_raw),
        "texts_raw": texts_raw,          # 原始 JS 片段
        "texts_parsed": parsed_ok        # 尽力转成 JSON 的结果（可能为空）
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()