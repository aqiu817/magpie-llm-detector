// fake fpd：打印垃圾并退出码 1（用于无 JSON 失败路径测试）。
console.log("fpd: something went terribly wrong (no json here)")
process.exit(1)
