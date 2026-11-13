// 本地 OpenAI 兼容 mock 端点：给 fpd 无头验证用，零外部请求。
// 用法：node scripts/mock-endpoint.mjs [--port 3799] [--key sk-mock]
// 行为：POST /v1/chat/completions（SSE）轮换返回三段真实模型回复（整数序列）。
// 种子来源：Ikaleio/lm-detector（MIT）仓库 data/collections/
// claude-haiku-5.5-openrouter-anthropic-low-20261008/attempts.jsonl 的三个有效尝试原文，
// 存于 test/fixtures/mock-seed-texts.json（仅本地开发用，不随 npm 发布）。
// fpd 的 sequence-shape 检查会拒绝程序生成的均匀伪随机与随机游走
// （实测 autocorr 0.04 或 0.94 都被判 "Not a model reply"），只有真实回复能通过，
// 因此 mock 必须回放真实原文——这也让检测有了可解释的预期结果：top=claude-haiku-5.5。
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argOf = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const PORT = Number(argOf("--port", 3799))
const KEY = argOf("--key", "sk-mock")

const seedPath = path.join(here, "..", "test", "fixtures", "mock-seed-texts.json")
const SEEDS = JSON.parse(fs.readFileSync(seedPath, "utf8")).map((s) => s.text)
if (!SEEDS.length) {
  console.error("no seed texts in " + seedPath)
  process.exit(1)
}

let reqNo = 0

function sseChunk(id, model, text, finish) {
  const payload = {
    id, object: "chat.completion.chunk", created: 0, model,
    choices: [{ index: 0, delta: text === null ? {} : { content: text }, finish_reason: finish ?? null }],
  }
  return `data: ${JSON.stringify(payload)}\n\n`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }))
    return
  }
  if (req.method === "POST" && (url.pathname.endsWith("/chat/completions") || url.pathname.endsWith("/responses"))) {
    const auth = req.headers.authorization || ""
    if (KEY && auth !== `Bearer ${KEY}`) {
      res.writeHead(401, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "bad key" } }))
      return
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    })
    const id = "chatcmpl-mock"
    const model = "mock-model"
    // 轮换三段真实原文；原文按 2 行/chunk 流出
    const full = SEEDS[reqNo++ % SEEDS.length]
    const lines = full.split("\n")
    const chunks = []
    for (let i = 0; i < lines.length; i += 2) {
      chunks.push(lines.slice(i, i + 2).join("\n") + (i + 2 < lines.length ? "\n" : ""))
    }
    let n = 0
    const tick = () => {
      if (res.writableEnded) return
      if (n < chunks.length) {
        res.write(sseChunk(id, model, chunks[n++]))
        setTimeout(tick, 4)
      } else {
        res.write(sseChunk(id, model, null, "stop"))
        res.write("data: [DONE]\n\n")
        res.end()
      }
    }
    tick()
    return
  }
  res.writeHead(404, { "content-type": "application/json" })
  res.end(JSON.stringify({ error: { message: `no route: ${req.method} ${url.pathname}` } }))
})

server.listen(PORT, "127.0.0.1", () => {
  const actual = server.address()?.port ?? PORT
  console.log(`mock endpoint on http://127.0.0.1:${actual}/v1 (seeds=${SEEDS.length})`)
})
