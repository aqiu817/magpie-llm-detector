// report：判定分支与格式化红线（免责行、无密钥泄露）。
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { verdictOf, formatReport, normalizeModelId, hostOf } from "../lib/report.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const okSample = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "fpd-json-sample.json"), "utf8"))
const notModel = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "fpd-json-notmodel-sample.json"), "utf8"))

test("normalizeModelId：剥供应商前缀 + 小写", () => {
  assert.equal(normalizeModelId("OpenRouter/Claude-Haiku-5.5"), "claude-haiku-5.5")
  assert.equal(normalizeModelId(" gpt-6 "), "gpt-6")
  assert.equal(normalizeModelId(""), "")
})

test("verdictOf：match / family / mismatch / inconclusive", () => {
  const a = okSample.analysis
  assert.equal(verdictOf("claude-haiku-5.5", a).kind, "match")
  assert.equal(verdictOf("openrouter/claude-haiku-5.5", a).kind, "match")
  assert.equal(verdictOf("claude-opus-5", a).kind, "family")
  assert.equal(verdictOf("gpt-6-astra", a).kind, "mismatch")
  assert.equal(verdictOf("anything", notModel.analysis).kind, "inconclusive")
  assert.equal(verdictOf("anything", null).kind, "inconclusive")
})

test("verdictOf：所填模型在 top3 → likely", () => {
  const a = {
    ...okSample.analysis,
    prediction: "claude-haiku-5.5",
    results: [
      { model: "claude-haiku-5.5", display_name: "claude-haiku-5.5", family: "claude", score: 5, probability: 0.9 },
      { model: "gpt-6-astra", display_name: "gpt-6-astra", family: "gpt", score: 2, probability: 0.05 },
      { model: "deepseek-v4", display_name: "deepseek-v4", family: "deepseek", score: 1, probability: 0.03 },
    ],
  }
  assert.equal(verdictOf("gpt-6-astra", a).kind, "likely")
  // deepseek-v4 在第 3 名（idx 2 < 3），也算 likely
  assert.equal(verdictOf("deepseek-v4", a).kind, "likely")
})

test("formatReport：成功报告含免责行与判定，且无密钥痕迹", () => {
  const text = formatReport(
    { data: okSample, elapsedMs: 1360, timedOut: false },
    { claimed: "gpt-6-astra", baseUrl: "https://api.example.com/v1?key=sk-secret123", protocol: "chat" },
  )
  assert.match(text, /模型指纹检测报告/)
  assert.match(text, /api\.example\.com/)          // host 可见
  assert.doesNotMatch(text, /sk-secret123/)        // query 不落报告
  assert.doesNotMatch(text, /sk-mock/)             // fixture 里的 mock key 不出现
  assert.match(text, /claude-haiku-5\.5/)
  assert.match(text, /与所填模型不一致/)
  assert.match(text, /封闭集合排序，仅供参考，不是身份证明/)
})

test("formatReport：not_model → 引导性原因", () => {
  const text = formatReport(
    { data: notModel, elapsedMs: 1000, timedOut: false },
    { claimed: "mock-model", baseUrl: "http://127.0.0.1:3799/v1", protocol: "chat" },
  )
  assert.match(text, /未能形成有效排名/)
  assert.match(text, /不像语言模型写的整数|Program-generated|程序/)
})

test("hostOf：坏 URL → unknown", () => {
  assert.equal(hostOf("https://api.example.com/v1"), "api.example.com")
  assert.equal(hostOf("not a url"), "unknown")
})
