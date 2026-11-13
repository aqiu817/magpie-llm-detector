# magpie-llm-detector

[English](README.md) | 简体中文

一个 [magpie](https://usemagpie.ai) 工具插件，用来查验一个端点背后真正的语言模型：让端点的模型"凭第一反应"写出几百个整数，把取值分布与 70 个模型的参考库比对，给出最像的候选与置信度。

模型指纹检测由 [Ikaleio/lm-detector](https://github.com/Ikaleio/lm-detector)（npm 包 `lmfpd`，MIT）驱动。本插件只把它包装成 magpie 的 MCP 工具——所有检测请求都从你的机器直连你指定的端点，凭据不出本机。

## 工具

经 magpie 内置的工具 MCP 服务器（`/mcp/magpie/tools`）提供给每个智能体：

| 工具 | 用途 |
| --- | --- |
| `magpie-llm-detector_check` | 对 `baseUrl` + `apiKey` + `model` 跑一轮检测（`protocol`：`chat` / `anthropic` / `responses`，默认 `chat`；`rounds` 1–3，默认 1）。返回排名报告并写入历史。 |
| `magpie-llm-detector_history` | 读回历史检测（不存任何密钥，baseUrl 只存主机名），用于多轮检测的聚合判断。 |

## 安装

```sh
magpie plugin add magpie-llm-detector        # npm 包
magpie plugin add /path/to/magpie-llm-detector   # 或本地文件夹
```

插件以子进程方式调用自带的 `lmfpd` CLI；它跑在 Bun（magpie 插件宿主自带）或 Node.js ≥ 22 上。

## 用法

直接对智能体说："检测一下 https://api.example.com/v1 的 gpt-6-astra，key 是 sk-…"，或让它调用工具。

- **第三方中转站 / API**：填该站的 `baseUrl`、`apiKey` 和它声称的 `model`。
- **magpie 自家的供应商**：先建一把网关密钥，然后 `baseUrl: http://127.0.0.1:<端口>/v1`、`apiKey: 网关密钥`、`model: <供应商>/<模型>`——检测便穿透 magpie 全链路。

apiKey 经环境变量传给检测子进程；它不会出现在报告、历史或日志里。

## 成本与限制

- 一轮 = 3 个生成请求（每题约 300 个整数，合计约 1–3k 输出 token）。工具有 50 秒预算；慢模型可能只给出无置信度的部分排名。
- 1–2 份有效回答也能排名；校准过的置信度需要 3 份。
- 结果是**参考库内的封闭集合排序**——不是身份证明。判断渠道是否可信，请固定参数、多轮重复（用 `history` 聚合），并结合其他证据。

## 开发

```sh
bun add lmfpd
npm test        # node --test；21 个测试，全封闭（真实 lmfpd + 本地 mock 端点，零外部请求）
bun test        # 同一套测试跑在 Bun 上
```

## 致谢

- 检测算法、参考库与 CLI：[Ikaleio/lm-detector](https://github.com/Ikaleio/lm-detector)（MIT），其本身致谢 [xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace) 提供的原始思路与数据。
- 本集成层：MIT，© aqiu817。见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

## 许可证

MIT
