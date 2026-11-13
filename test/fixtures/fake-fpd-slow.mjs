// fake fpd：3 秒后才打印（用于 deadline kill 测试）。
import fs from "node:fs"
const j = JSON.parse(fs.readFileSync(new URL("./fpd-json-sample.json", import.meta.url), "utf8"))
setTimeout(() => console.log(JSON.stringify(j)), 3000)
