// 入口冒烟：导出形状、钩子结构、schema 必填字段、参数校验分支。
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin, { _internal } from "../index.mjs"

test("入口只导出 default 插件对象与 _internal", () => {
  assert.equal(typeof plugin.server, "function")
  assert.equal(plugin.id, "magpie-llm-detector")
  assert.equal(typeof _internal.findFpd, "function")
  assert.equal(typeof _internal.runDetection, "function")
  assert.equal(typeof _internal.verdictOf, "function")
})

test("server 返回 tool 钩子：check + history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llmd-smoke-"))
  const hooks = await plugin.server({ directory: dir })
  assert.ok(hooks.tool)
  assert.equal(typeof hooks.tool.check.execute, "function")
  assert.equal(typeof hooks.tool.history.execute, "function")
  // 完整 JSON Schema：显式 required
  assert.deepEqual(hooks.tool.check.args.required, ["baseUrl", "apiKey", "model"])
  assert.deepEqual(hooks.tool.check.args.properties.protocol.enum, ["chat", "anthropic", "responses"])
  assert.deepEqual(hooks.tool.history.args.required, [])
})

test("check：缺参数返回错误文本，不抛异常", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llmd-smoke-"))
  const hooks = await plugin.server({ directory: dir })
  const out = await hooks.tool.check.execute({})
  assert.match(out, /^错误：/)
  const out2 = await hooks.tool.check.execute({ baseUrl: "ftp://x", apiKey: "k", model: "m" })
  assert.match(out2, /^错误：/)
})

test("check：找不到 lmfpd 时给出安装指引（隔离目录模拟）", async () => {
  // findFpd 从 import.meta.dirname 向上走；把查找起点换掉不可行（闭包），
  // 所以这里只验证 findFpd 对空目录链返回 null，指引分支在 e2e 环境外人工验证。
  assert.equal(_internal.findFpd(fs.mkdtempSync(path.join(os.tmpdir(), "llmd-empty-"))), null)
})

test("history：空历史返回引导文案", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llmd-smoke-"))
  const hooks = await plugin.server({ directory: dir })
  const out = await hooks.tool.history.execute({})
  assert.match(out, /还没有检测历史/)
})
