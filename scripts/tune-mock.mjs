// 本地调参回路：用 fpd --input 离线分析候选序列（零 API 请求）。
// 模式一（默认）：从 unified_bank.json 的某模型经验分布采样，加粘性参数搜索，
//   找到能通过 sequence-shape 检查的 mock 参数，回写 mock-endpoint.mjs。
// 用法：node scripts/tune-mock.mjs
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, "..")
const fpd = path.join(root, "node_modules/lmfpd/bin/fpd.js")
const fixturePath = path.join(root, "test/fixtures/fpd-json-notmodel-sample.json")
const bankPath = path.join(root, "node_modules/lmfpd/data/unified_bank.json")

function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// 从模型的 355 值经验分布采样；stickiness = 重复上一个值的概率（制造轻度自相关）
function sampleFromBank(counts, stickiness, seed, n = 300) {
  const total = counts.reduce((a, b) => a + b, 0)
  const rnd = mulberry32(seed)
  // 前缀和查表
  const cum = []
  let acc = 0
  for (const c of counts) { acc += c; cum.push(acc) }
  const draw = () => {
    const r = rnd() * total
    let lo = 0, hi = cum.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid }
    return lo + 1 // 值域 1..355
  }
  const out = []
  let last = draw()
  out.push(last)
  for (let i = 1; i < n; i++) {
    let v
    if (rnd() < stickiness) v = last
    else v = draw()
    out.push(v); last = v
  }
  return out
}

function analyze(text) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"))
  const cand = JSON.parse(JSON.stringify(fixture))
  cand.outputs = cand.outputs.map((o) => ({ ...o, text }))
  for (const rd of cand.rounds ?? []) {
    if (rd.outputs) rd.outputs = rd.outputs.map((o) => ({ ...o, text }))
    for (const s of rd.samples ?? []) { s.text = text; s.rawText = text }
  }
  const tmp = path.join(root, "test/fixtures/.tune-candidate.json")
  fs.writeFileSync(tmp, JSON.stringify(cand))
  let analysis
  try {
    const stdout = execFileSync("node", [fpd, "detect", "--input", tmp, "--json", "--no-update-check"], { encoding: "utf8", timeout: 60000 })
    analysis = JSON.parse(stdout).analysis
  } catch (e) {
    try { analysis = JSON.parse(e.stdout).analysis } catch { analysis = null }
  }
  return analysis
}

const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"))
const modelId = process.argv[2] ?? "claude-haiku-4.5"
const model = bank.models.find((m) => m.id === modelId) ?? bank.models[0]
console.log(`bank model: ${model.id} (responses=${model.response_count}, numbers=${model.valid_number_count})`)

const combos = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4].map((s) => ({ stickiness: s, seed: 20261113 }))
let best = null
for (const c of combos) {
  const seq = sampleFromBank(model.counts, c.stickiness, c.seed)
  const a = analyze(seq.join(", "))
  const seqShape = a?.sequence ?? {}
  const ok = a?.decision !== "not_model"
  const row = { ...c, ok, ac: seqShape.autocorrelation?.toFixed(3), small: seqShape.small_step_share?.toFixed(3), decision: a?.decision, n: a?.results?.length ?? 0, top: a?.results?.[0], probability: a?.probability, status: a?.probability_status }
  console.log(`sticky=${c.stickiness} → ${ok ? "PASS" : "fail"} ac=${row.ac} small=${row.small} decision=${row.decision} results=${row.n} prob=${row.probability}(${row.status})${row.top ? " top=" + JSON.stringify(row.top).slice(0, 140) : ""}`)
  if (ok && !best) best = row
}
fs.rmSync(path.join(root, "test/fixtures/.tune-candidate.json"), { force: true })
if (best) console.log("\nWINNER:", JSON.stringify(best, null, 1).slice(0, 600))
