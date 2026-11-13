// fake fpd：自己再派生一个持有 stdout 的孙进程，主进程 3 秒后才退出。
// 模拟 fpd 的 worker 孙进程占住管道：deadline kill 杀掉主进程后，
// close 事件迟迟不来，runner 必须靠 taskkill /T 或硬兜底 resolve 返回超时。
import { spawn } from "node:child_process"
import fs from "node:fs"
const j = JSON.parse(fs.readFileSync(new URL("./fpd-json-sample.json", import.meta.url), "utf8"))
// 孙进程继承 stdout 管道且长驻；若 runner 不灭树，close 会被它拖住
const grandchild = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: ["ignore", "inherit", "inherit"], windowsHide: true })
grandchild.unref()
setTimeout(() => {
  console.log(JSON.stringify(j))
  process.exit(0)
}, 3000)
