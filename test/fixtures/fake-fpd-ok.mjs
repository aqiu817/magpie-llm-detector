// fake fpd：立即打印录制好的成功检测 JSON（fixture）。argv 全部忽略。
import fs from "node:fs"
const j = JSON.parse(fs.readFileSync(new URL("./fpd-json-sample.json", import.meta.url), "utf8"))
console.log(JSON.stringify(j))
