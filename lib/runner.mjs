// runner：定位 lmfpd、解析运行时、子进程无头调用 fpd detect --json。
// 纪律：
// - 绝不裸 import "lmfpd"（文件夹安装没有 node_modules 时，Bun 会在线自动安装依赖，
//   把插件加载卡到 20 秒超时——magpie-translate 实测教训），只用 fs 定位。
// - 密钥只经环境变量传给子进程，不上 argv，不进结果。
// - SSE 模式下 fpd 的 --timeout 只约束首字节，生成期无上限：必须自带整段 deadline。
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

const FPD_REL = path.join("node_modules", "lmfpd", "bin", "fpd.js")

// 从插件目录向上找 node_modules/lmfpd/bin/fpd.js（兼容 hoisting 与就地文件夹加载）
export function findFpd(startDir) {
  let dir = startDir
  for (let i = 0; dir && i < 12; i++) {
    const cand = path.join(dir, FPD_REL)
    try {
      if (fs.existsSync(cand)) return cand
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// 读取 lmfpd 的版本号（仅用于报告/历史标注）
export function lmfpdVersion(fpdPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(fpdPath)), "package.json"), "utf8"))
    return typeof pkg.version === "string" ? pkg.version : ""
  } catch {
    return ""
  }
}

// 运行时候选：宿主自带的解释器优先（bun 1.3.6 实测可跑 fpd，engines 只是 advisory），
// 失败再试 PATH 上的 node（engines node>=22）。
export function runtimeCandidates() {
  const list = [{ cmd: process.execPath, note: `${process.versions.bun ? "bun " + process.versions.bun : "node " + process.versions.node}` }]
  const selfIsNode = !process.versions.bun
  if (!selfIsNode) list.push({ cmd: "node", note: "node (PATH)" })
  return list
}

// 协议 → fpd 的 -a 取值
const API_MAP = { chat: "chatcompletion", anthropic: "message", responses: "responses" }

// 容错解析 stdout 里的 JSON（fpd --json 正常时 stdout 就是纯 JSON；防御性兼容前缀噪音）
export function parseDetectionJson(stdout) {
  if (typeof stdout !== "string") return null
  const start = stdout.indexOf("{")
  if (start < 0) return null
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    return null
  }
}

// 无头跑一轮检测。返回：
//   {ok:true, data, elapsedMs, timedOut, stderr}
//   {ok:false, error, elapsedMs, timedOut, stderr, exitCode}
// opts: {baseUrl, apiKey, model, protocol?, rounds?, count?, fpdPath, deadlineMs?, timeoutSec?, onSpawnError?}
export async function runDetection(opts) {
  const api = API_MAP[opts.protocol] || "chatcompletion"
  const count = Math.min(3, Math.max(1, opts.count ?? 3))
  const rounds = Math.min(3, Math.max(1, opts.rounds ?? 1))
  const timeoutSec = Math.min(110, Math.max(10, opts.timeoutSec ?? 40))
  const deadlineMs = opts.deadlineMs ?? 50_000
  const argv = [
    opts.fpdPath, "detect", "--json",
    "-b", String(opts.baseUrl),
    "-m", String(opts.model),
    "-a", api,
    "--count", String(count),
    "-p", "3",
    "-n", String(rounds),
    "--timeout", String(timeoutSec),
    "--no-update-check",
  ]
  const env = {
    ...process.env,
    API_KEY: String(opts.apiKey ?? ""),
    NO_UPDATE_NOTIFIER: "1",
    FPD_NO_UPDATE_CHECK: "1",
  }
  const started = Date.now()
  let lastErr = null
  for (const rt of runtimeCandidates()) {
    const attempt = await new Promise((resolve) => {
      let stdout = ""
      let stderr = ""
      let timedOut = false
      let settled = false
      let child
      let hardTimer = null
      try {
        child = spawn(rt.cmd, argv, { env, windowsHide: true })
      } catch (e) {
        resolve({ ok: false, error: `spawn ${rt.cmd} 失败: ${e?.message || e}`, elapsedMs: Date.now() - started, timedOut: false, stderr: "" })
        return
      }
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (hardTimer) clearTimeout(hardTimer)
        resolve(value)
      }
      const timer = setTimeout(() => {
        timedOut = true
        try { child.kill() } catch {}
        // Windows 上 child.kill() 只杀直接子进程：fpd 的 worker 孙进程仍握着 stdout 管道，
        // close 事件会一直不来，工具会挂到宿主的 55s 上限。灭全树，并兜底硬 resolve。
        try {
          if (process.platform === "win32" && child.pid) {
            spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true })
          }
        } catch {}
        hardTimer = setTimeout(() => {
          finish({
            ok: false,
            error: `检测超时（预算 ${Math.round(deadlineMs / 1000)}s）被中止，模型响应过慢或网络不通`,
            elapsedMs: Date.now() - started,
            timedOut: true,
            stderr,
          })
        }, 2000)
      }, deadlineMs)
      child.stdout?.on("data", (d) => { stdout += d })
      child.stderr?.on("data", (d) => { stderr += d })
      child.on("error", (e) => {
        finish({ ok: false, error: `spawn ${rt.cmd} 失败: ${e?.message || e}`, elapsedMs: Date.now() - started, timedOut, stderr })
      })
      child.on("close", (code) => {
        const data = parseDetectionJson(stdout)
        if (data) {
          finish({ ok: true, data, elapsedMs: Date.now() - started, timedOut, stderr })
        } else {
          const reason = timedOut
            ? `检测超时（预算 ${Math.round(deadlineMs / 1000)}s）被中止，模型响应过慢或网络不通`
            : `fpd 退出码 ${code}${stderr.trim() ? "：" + stderr.trim().slice(0, 300) : ""}`
          finish({ ok: false, error: reason, elapsedMs: Date.now() - started, timedOut, stderr, exitCode: code })
        }
      })
    })
    // spawn 本身失败（ENOENT 等）→ 换下一个运行时；其余结果直接返回
    const spawnBroken = !attempt.ok && /spawn .* 失败/.test(attempt.error || "")
    if (!spawnBroken || rt === runtimeCandidates()[runtimeCandidates().length - 1]) return attempt
    lastErr = attempt
  }
  return lastErr || { ok: false, error: "没有可用运行时", elapsedMs: Date.now() - started, timedOut: false, stderr: "" }
}
