// hermetic 端到端：真实 lmfpd + 本地 mock 端点，零外部请求。
// 流程：起 mock（随机端口）→ server({directory}) → check 工具 → 断言报告与历史 → history 工具 → 收尸。
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import plugin, { _internal } from "../index.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, "..")

test("端到端：check 工具走真实 lmfpd + 本地 mock 出排名并落历史", { timeout: 120_000 }, async (t) => {
  assert.ok(_internal.findFpd(root), "e2e 需要 node_modules/lmfpd（先 bun add lmfpd）")
  // 起 mock 端点（port 0 → 随机端口，从 stdout 解析实际端口）
  const child = spawn(process.execPath, [path.join(root, "scripts", "mock-endpoint.mjs"), "--port", "0", "--key", "sk-e2e"], { windowsHide: true })
  t.after(() => { try { child.kill() } catch {} })
  const port = await new Promise((resolve, reject) => {
    let out = ""
    const timer = setTimeout(() => reject(new Error("mock 启动超时: " + out)), 15_000)
    child.stdout.on("data", (d) => {
      out += d.toString()
      const m = out.match(/on http:\/\/127\.0\.0\.1:(\d+)\/v1/)
      if (m) { clearTimeout(timer); resolve(Number(m[1])) }
    })
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error("mock 提前退出 code=" + code + ": " + out)) })
  })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llmd-e2e-"))
  const hooks = await plugin.server({ directory: dir })
  const report = await hooks.tool.check.execute({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "sk-e2e",
    model: "mock-model",
  })
  // 排名应指向种子原文所属的真实模型
  assert.match(report, /模型指纹检测报告/)
  assert.match(report, /claude-haiku-5\.5/)
  assert.match(report, /封闭集合排序，仅供参考，不是身份证明/)
  assert.doesNotMatch(report, /sk-e2e/) // 密钥不落报告
  assert.match(report, /已写入检测历史/)

  // 历史可读，且不含密钥
  const hist = await hooks.tool.history.execute({ limit: 5 })
  assert.match(hist, /mock-model/)
  const raw = fs.readFileSync(path.join(dir, "llm-detector", "history.jsonl"), "utf8")
  assert.doesNotMatch(raw, /sk-e2e/)
})
