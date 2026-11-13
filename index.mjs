// magpie-llm-detector：模型指纹检测工具插件。
// 原理与算法来自 Ikaleio/lm-detector（MIT，npm 包 lmfpd）；本项目只做 magpie 集成层：
// 把「让模型凭第一反应写 ~300 个 1–355 整数 → 与参考库比对分布」的检测，
// 以子进程无头模式（fpd detect --json）暴露成 magpie 的 MCP 工具。
//
// 导出纪律：入口只导出 default 插件对象与 _internal（测试用）；
// magpie 会把入口导出的每个函数都当插件调用，辅助函数必须留在 lib/。
import { findFpd, lmfpdVersion, runDetection } from "./lib/runner.mjs"
import { formatReport, verdictOf, hostOf, normalizeModelId } from "./lib/report.mjs"
import { appendHistory, readHistory, formatHistory } from "./lib/store.mjs"

// 工具用零依赖的普通对象形态：magpie 的 args 支持 JSON Schema 对象，
// 宿主自己按 schema 校验参数。不要 import("@opencode-ai/plugin")——
// 文件夹安装没有 node_modules 时，Bun 会尝试在线自动安装依赖，把加载卡到 20 秒超时。
const defineTool = (def) => def

const DEADLINE_MS = 50_000 // 工具上限 55s，留余量给宿主收尾

function buildRow(data, { claimed, protocol, baseUrl }, verdict, lmfpdVer) {
  const a = data?.analysis ?? {}
  return {
    ts: new Date().toISOString(),
    claimed: normalizeModelId(claimed),
    protocol: protocol || "chat",
    host: hostOf(baseUrl),
    completed: data?.completed_rounds,
    scored: data?.scored_rounds,
    used: a.used_outputs,
    verdict: verdict.kind,
    prediction: a.prediction || "",
    probability: typeof a.probability === "number" ? a.probability : null,
    top: (Array.isArray(a.results) ? a.results.slice(0, 3) : []).map((r) => ({
      model: r.model, score: r.score, probability: r.probability,
    })),
    bank: data?.bank?.models,
    timedOut: data?.__timedOut === true,
    lmfpd: lmfpdVer || "",
  }
}

export default {
  id: "magpie-llm-detector",
  server: async (input = {}, options = {}) => {
    const dir = input?.directory || input?.worktree || ""
    const fpdPath = findFpd(import.meta.dirname)
    const lmfpdVer = fpdPath ? lmfpdVersion(fpdPath) : ""
    return {
      tool: {
        check: defineTool({
          description:
            "模型指纹检测：查验一个端点背后真正的语言模型。向目标端点发送生成请求（默认 1 轮 × 3 题并行，" +
            "每题要求模型凭第一反应写约 300 个 1–355 的整数），把取值分布与 70 个模型的参考库比对，" +
            "给出最像的候选、排名与置信度。apiKey 必须向用户索取，不要猜测或自行搜索。" +
            "单次调用有 50 秒预算：慢模型可能只完成部分样本，此时仍会给出无置信度的排名；" +
            "要更高置信度可以固定参数连跑几次，再用 history 工具聚合。" +
            "测 magpie 自己的供应商时，baseUrl 填网关地址（如 http://127.0.0.1:<端口>/v1）、" +
            "apiKey 填网关密钥、model 填 <供应商>/<模型>。" +
            "结果是参考库内的封闭集合排序，仅供参考，不是身份证明。",
          // 完整 JSON Schema：显式 required 控制可选性（属性表形态会被宿主全标成必填）
          args: {
            type: "object",
            properties: {
              baseUrl: { type: "string", description: "目标端点基地址，如 https://api.example.com/v1" },
              apiKey: { type: "string", description: "该端点的 API key（向用户索取；经环境变量传给检测进程，不写入结果或日志）" },
              model: { type: "string", description: "要查验的模型 id（API 请求里的 model 名）" },
              protocol: {
                type: "string",
                enum: ["chat", "anthropic", "responses"],
                description: "API 协议：chat=OpenAI Chat Completions（默认）、anthropic=Anthropic Messages、responses=OpenAI Responses",
              },
              rounds: { type: "integer", minimum: 1, maximum: 3, description: "检测轮数，默认 1。轮数越多越准也越久，50 秒预算内可能完不成多轮" },
            },
            required: ["baseUrl", "apiKey", "model"],
          },
          async execute(args) {
            const a = args || {}
            const baseUrl = typeof a.baseUrl === "string" ? a.baseUrl.trim() : ""
            const apiKey = typeof a.apiKey === "string" ? a.apiKey : ""
            const model = typeof a.model === "string" ? a.model.trim() : ""
            const protocol = typeof a.protocol === "string" && ["chat", "anthropic", "responses"].includes(a.protocol) ? a.protocol : "chat"
            const rounds = Number.isInteger(a.rounds) ? a.rounds : 1
            if (!baseUrl || !apiKey || !model) return "错误：baseUrl、apiKey、model 三个参数都必填（apiKey 请向用户索取）。"
            if (!/^https?:\/\//i.test(baseUrl)) return "错误：baseUrl 要以 http:// 或 https:// 开头。"
            if (!fpdPath) {
              return "错误：找不到检测器依赖 lmfpd（node_modules/lmfpd）。" +
                "请用 npm 包名安装本插件（magpie plugin add magpie-llm-detector），" +
                "或在插件目录执行 bun add lmfpd 后重开插件。"
            }
            const res = await runDetection({ baseUrl, apiKey, model, protocol, rounds, fpdPath, deadlineMs: DEADLINE_MS })
            if (!res.ok) {
              return "错误：检测未完成 —— " + (res.error || "未知原因") +
                (res.timedOut ? "。可减少 rounds、检查网络，或换更快的端点重试。" : "")
            }
            const data = { ...res.data, __timedOut: res.timedOut === true }
            const verdict = verdictOf(model, data.analysis)
            const report = formatReport({ ...res, data }, { claimed: model, baseUrl, protocol, bankModels: data.bank?.models })
            const stored = appendHistory(dir, buildRow(data, { claimed: model, protocol, baseUrl }, verdict, lmfpdVer))
            return report + (stored ? "\n（本条结果已写入检测历史，可用 history 工具查看。）" : "")
          },
        }),

        history: defineTool({
          description:
            "读取模型指纹检测的历史记录（最近 N 条，新→旧），用于把多次 check 的结果聚合判断。" +
            "行内不含任何密钥；baseUrl 只存主机名。",
          args: {
            type: "object",
            properties: {
              limit: { type: "integer", minimum: 1, maximum: 50, description: "返回最近多少条，默认 10" },
            },
            required: [],
          },
          async execute(args) {
            const limitRaw = args && Number.isInteger(args.limit) ? args.limit : 10
            const rows = readHistory(dir, limitRaw)
            return formatHistory(rows)
          },
        }),
      },
    }
  },
}

// 测试专用出口；magpie 不使用。
export const _internal = {
  DEADLINE_MS,
  buildRow,
  findFpd,
  lmfpdVersion,
  runDetection,
  formatReport,
  verdictOf,
  normalizeModelId,
  hostOf,
  appendHistory,
  readHistory,
  formatHistory,
}
