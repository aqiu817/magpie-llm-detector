// store：JSONL 落盘与读取、坏行容忍、无密钥红线。
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { appendHistory, readHistory, formatHistory, historyPath } from "../lib/store.mjs"
import { _internal } from "../index.mjs"

test("appendHistory / readHistory 往返", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llmd-store-"))
  const row = { ts: "2026-11-13T00:00:00Z", claimed: "gpt-6-astra", host: "api.example.com", verdict: "mismatch", top: [{ model: "claude-haiku-5.5" }] }
  assert.equal(appendHistory(dir, row), true)
  assert.equal(appendHistory(dir, { ...row, claimed: "kimi-k3" }), true)
  const rows = readHistory(dir, 10)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].claimed, "gpt-6-astra")
  assert.equal(rows[1].claimed, "kimi-k3")
  assert.match(fs.readFileSync(historyPath(dir), "utf8"), /^\{.*\}\n\{.*\}\n$/s)
})

test("readHistory：跳过坏行、limit 生效", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llmd-store-"))
  appendHistory(dir, { ts: "t1", claimed: "a" })
  fs.appendFileSync(historyPath(dir), "this is not json\n", "utf8")
  appendHistory(dir, { ts: "t2", claimed: "b" })
  assert.equal(readHistory(dir, 10).length, 2)
  assert.equal(readHistory(dir, 1)[0].claimed, "b")
  assert.deepEqual(readHistory(fs.mkdtempSync(path.join(os.tmpdir(), "llmd-none-")), 5), [])
})

test("buildRow：绝不含 apiKey，baseUrl 只存 host", () => {
  const sample = JSON.parse(fs.readFileSync(new URL("./fixtures/fpd-json-sample.json", import.meta.url), "utf8"))
  const verdict = _internal.verdictOf("mock-model", sample.analysis)
  const row = _internal.buildRow(sample, { claimed: "mock-model", protocol: "chat", baseUrl: "https://api.example.com/v1?token=abc" }, verdict, "0.1.0")
  const flat = JSON.stringify(row)
  assert.doesNotMatch(flat, /apiKey|token=abc|\/v1/)
  assert.equal(row.host, "api.example.com")
  assert.ok(row.top.length <= 3)
  assert.equal(row.claimed, "mock-model")
})

test("formatHistory：空与非空两种形态", () => {
  assert.match(formatHistory([]), /还没有检测历史/)
  const text = formatHistory([{ ts: "2026-11-13T00:00:00Z", claimed: "gpt-6-astra", host: "api.example.com", protocol: "chat", used: 3, verdict: "mismatch", top: [{ model: "claude-haiku-5.5" }] }])
  assert.match(text, /gpt-6-astra/)
  assert.match(text, /claude-haiku-5\.5/)
})
