// store：检测历史 JSONL。落在 magpie 配置目录（插件 input.directory）下。
// 红线：历史行内绝不包含 apiKey；baseUrl 只存 host。
import fs from "node:fs"
import path from "node:path"

export function historyPath(dir) {
  return path.join(dir, "llm-detector", "history.jsonl")
}

// row 由 index.mjs 组装；这里只管落盘与读取。
export function appendHistory(dir, row) {
  if (!dir) return false
  const file = historyPath(dir)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8")
    return true
  } catch {
    return false
  }
}

// 读最近 limit 条（坏的行跳过）
export function readHistory(dir, limit = 10) {
  if (!dir) return []
  let raw = ""
  try {
    raw = fs.readFileSync(historyPath(dir), "utf8")
  } catch {
    return []
  }
  const rows = []
  for (const line of raw.split("\n")) {
    const s = line.trim()
    if (!s) continue
    try {
      const j = JSON.parse(s)
      if (j && typeof j === "object") rows.push(j)
    } catch {}
  }
  return rows.slice(-Math.max(1, limit))
}

// 历史行 → 文本摘要（给 history 工具返回）
export function formatHistory(rows) {
  if (!rows.length) return "还没有检测历史。先用 check 工具跑一次检测。"
  const lines = [`共 ${rows.length} 条记录（新→旧）:`]
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    const top = Array.isArray(r.top) && r.top.length ? ` 最像 ${r.top[0].model}` : ""
    lines.push(`  [${i + 1}] ${r.ts || "?"} · ${r.host || "?"} · 所填 ${r.claimed || "?"} · ${r.protocol || "chat"} · 有效 ${r.used ?? "?"} 份 · 判定 ${r.verdict || "?"}${top}`)
  }
  return lines.join("\n")
}
