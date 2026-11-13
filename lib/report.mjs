// report：把 fpd 的 detection JSON 变成给智能体/用户看的判定与报告文本。
// 措辞红线：参考库内封闭集合排序 ≠ 身份证明，报告必须始终带免责行。

// 归一化所填模型 id：剥掉 "供应商/" 前缀、转小写、去空白
export function normalizeModelId(model) {
  const s = String(model || "").trim().toLowerCase()
  const i = s.indexOf("/")
  return i >= 0 ? s.slice(i + 1) : s
}

// 从所填模型 id 猜家族（启发式：第一段连字符前缀）
function guessedFamily(claimed) {
  const s = normalizeModelId(claimed)
  const m = s.match(/^[a-z][a-z0-9]*/)
  return m ? m[0] : ""
}

// 判定：
//   match        top1 与所填模型一致
//   likely       所填模型出现在 top3
//   family       top1 与所填模型同家族（不同型号）
//   mismatch     top1 与所填模型不同家族
//   inconclusive 无有效排名
// 返回 {kind, topIndex, detail}
export function verdictOf(claimed, analysis) {
  if (!analysis || analysis.decision === "not_model") {
    return { kind: "inconclusive", topIndex: 0, detail: analysis?.evidence?.reason || "没有形成有效排名" }
  }
  const results = Array.isArray(analysis.results) ? analysis.results : []
  if (!results.length || !analysis.prediction) {
    return { kind: "inconclusive", topIndex: 0, detail: "没有形成有效排名" }
  }
  const claimedNorm = normalizeModelId(claimed)
  const idx = results.findIndex((r) => normalizeModelId(r.model) === claimedNorm)
  if (idx === 0) return { kind: "match", topIndex: 0, detail: `参考库中最接近的候选就是所填模型（${results[0].display_name || results[0].model}）` }
  if (idx > 0 && idx < 3) return { kind: "likely", topIndex: idx, detail: `所填模型排在第 ${idx + 1} 名（${results[idx].model}），大概率一致但与第 1 名（${results[0].model}）接近` }
  const fam = guessedFamily(claimed)
  const topFamily = String(results[0].family || "").toLowerCase()
  if (fam && topFamily && fam === topFamily) {
    return { kind: "family", topIndex: 0, detail: `最像的是同家族的其它型号（${results[0].model}），注意核对具体版本` }
  }
  return { kind: "mismatch", topIndex: 0, detail: `最像的候选是 ${results[0].model}，与所填模型（${claimedNorm}）不同` }
}

function fmtProbability(p) {
  if (typeof p !== "number" || !isFinite(p)) return "—"
  if (p >= 0.999999) return "≈100%"
  if (p >= 0.01) return (p * 100).toFixed(1) + "%"
  if (p >= 0.0001) return (p * 100).toFixed(4) + "%"
  return "<0.01%"
}

const VERDICT_LABEL = {
  match: "与所填模型一致",
  likely: "大概率一致（所填模型在候选前列）",
  family: "同家族不同型号",
  mismatch: "与所填模型不一致",
  inconclusive: "未能形成有效排名",
}

// 生成报告文本。res: runDetection 的 ok 结果（{data, elapsedMs, timedOut}）
export function formatReport(res, { claimed, baseUrl, protocol, bankModels, maxRows = 5 } = {}) {
  const data = res?.data
  const a = data?.analysis
  const lines = []
  const host = hostOf(baseUrl)
  const used = a?.used_outputs
  const roundsInfo = data ? `完成轮 ${data.completed_rounds ?? "?"}/${data.requested_rounds ?? "?"}` : ""
  lines.push("模型指纹检测报告")
  lines.push(`目标: ${host} · 所填模型: ${claimed} · 协议: ${protocol || "chat"} · 用时: ${((res?.elapsedMs || 0) / 1000).toFixed(1)}s${res?.timedOut ? "（达到预算被中止，部分结果）" : ""}`)
  lines.push(`有效回答: ${typeof used === "number" ? used : "?"} 份 · ${roundsInfo}${res?.data?.bank?.models ? ` · 参考库 ${data.bank.models} 个模型` : ""}`)

  const v = verdictOf(claimed, a)
  if (v.kind === "inconclusive") {
    lines.push("")
    lines.push(`判定: ${VERDICT_LABEL.inconclusive}`)
    lines.push(`原因: ${v.detail}`)
    if (a?.sequence && a.sequence.model_like === false) {
      lines.push("提示: 端点返回的内容不像语言模型写的整数（可能被程序接管、缓存或重定向）。")
    }
  } else {
    const rows = (a.results || []).slice(0, maxRows)
    lines.push("")
    lines.push("排名（参考库内的封闭集合排序）:")
    rows.forEach((r, i) => {
      const mark = normalizeModelId(r.model) === normalizeModelId(claimed) ? " ← 所填模型" : ""
      lines.push(`  ${i + 1}. ${r.model}  score ${Number(r.score)?.toFixed?.(2) ?? r.score}  概率 ${fmtProbability(r.probability)}${mark}`)
    })
    lines.push("")
    lines.push(`判定: ${VERDICT_LABEL[v.kind]} —— ${v.detail}`)
    if (a?.probability_status === "reference_calibrated" && typeof a.probability === "number") {
      lines.push(`最像候选置信度: ${fmtProbability(a.probability)}（${a.probability_status}）`)
    } else {
      lines.push("置信度: 不可用（有效样本不足 3 份时只排名不校准）")
    }
  }
  lines.push("")
  lines.push("注意: 这是参考库内的封闭集合排序，仅供参考，不是身份证明。判断渠道是否可信请固定参数、重复多轮并结合其他证据。")
  return lines.join("\n")
}

// baseUrl → host（不落 path/query，避免泄密）；解析失败返回 unknown
export function hostOf(baseUrl) {
  try {
    const u = new URL(String(baseUrl))
    return u.host || "unknown"
  } catch {
    return "unknown"
  }
}
