// runner：定位、JSON 容错解析、子进程成功/超时/退出码失败三条路径。
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { findFpd, lmfpdVersion, parseDetectionJson, runDetection } from "../lib/runner.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, "..")
const sample = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "fpd-json-sample.json"), "utf8"))

test("findFpd：项目内能定位真实 lmfpd", () => {
  const p = findFpd(root)
  assert.ok(p, "应找到 node_modules/lmfpd/bin/fpd.js")
  assert.match(p, /node_modules[\\/]lmfpd[\\/]bin[\\/]fpd\.js$/)
  assert.ok(fs.existsSync(p))
  assert.match(lmfpdVersion(p), /^\d/)
})

test("parseDetectionJson：纯 JSON / 带噪音前缀 / 垃圾", () => {
  const s = JSON.stringify({ a: 1 })
  assert.deepEqual(parseDetectionJson(s), { a: 1 })
  assert.deepEqual(parseDetectionJson("warn: ignore\n" + s), { a: 1 })
  assert.equal(parseDetectionJson("no json here"), null)
  assert.equal(parseDetectionJson(""), null)
})

test("runDetection：fake fpd 立即输出成功 JSON", async () => {
  const res = await runDetection({
    baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-x", model: "m",
    fpdPath: path.join(here, "fixtures", "fake-fpd-ok.mjs"),
    deadlineMs: 10_000,
  })
  assert.equal(res.ok, true)
  assert.equal(res.data.schema, sample.schema)
  assert.equal(res.data.analysis.prediction, sample.analysis.prediction)
})

test("runDetection：deadline 到点 kill，返回超时错误", async () => {
  const res = await runDetection({
    baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-x", model: "m",
    fpdPath: path.join(here, "fixtures", "fake-fpd-slow.mjs"),
    deadlineMs: 400,
  })
  assert.equal(res.ok, false)
  assert.equal(res.timedOut, true)
  assert.match(res.error, /超时/)
})

test("runDetection：孙进程占住管道时仍能在 deadline+宽限内返回", async () => {
  const t0 = Date.now()
  const res = await runDetection({
    baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-x", model: "m",
    fpdPath: path.join(here, "fixtures", "fake-fpd-tree.mjs"),
    deadlineMs: 400,
  })
  const wall = Date.now() - t0
  assert.equal(res.ok, false)
  assert.equal(res.timedOut, true)
  assert.match(res.error, /超时/)
  assert.ok(wall < 8000, `应在 ${wall}ms 内返回（硬兜底 2s 宽限）`)
})

test("runDetection：退出码非零且无 JSON → 失败并带原因", async () => {
  const res = await runDetection({
    baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-x", model: "m",
    fpdPath: path.join(here, "fixtures", "fake-fpd-bad.mjs"),
    deadlineMs: 10_000,
  })
  assert.equal(res.ok, false)
  assert.equal(res.timedOut, false)
  assert.match(res.error, /退出码/)
})
