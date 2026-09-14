# 0.4.2-rc.7：移除自动输出额度，正文长度只作提示

## 修复原因

只省略插件的 `maxTokens` 参数仍不足以取消输出额度。DSH 的 pi-ai 适配器会在出站前替自定义模型填入默认 32,768 token，思考与最终结果共同消耗这个额度。模型可能仍在输出思考，就收到上游 `length`。

## 现在的行为

- 写作和工具 agent 均不再使用旧配置中的 `maxTokens` 截断输出。Chat Completions / Responses 出站请求会去掉 SDK 自动补入的 `max_tokens`、`max_completion_tokens` 和 `max_output_tokens`。
- 兼容处理使用异步调用作用域，只作用于本插件请求；同时运行的普通 DSH 请求、非模型请求以及代理配置保持原样。
- 「模型与输入」增加正文目标字数区间，默认 2000–4000 字。它只作为固定提示词排在动态内容前，不包含思考、HTML 和协议数据；超过目标也不会截断、重写或重新调用模型。
- 持续收到正文、思考或工具参数时不限总时长与累计 token 数。连续 60 秒无新内容才触发插件超时；手动停止仍有效。
- 记录保留出站时去掉了哪些额度参数，便于区分插件设置、SDK 默认值与上游停止。上游返回 `length` 时保留原始回复，提示从失败步骤继续，不自动重发成功步骤。

## 接口边界

不发送额度不代表服务商提供无限输出。DeepSeek 官方接口未指定 `max_tokens` 时，思考模式默认 64K，`max` 强度默认 128K，并存在 384K 的硬上限；代理服务可能另有规则。原生 Anthropic Messages 等必填输出额度的协议不支持省略该字段。本修复不伪造“无限”数值，也不自动续接已被服务商终止的请求。

参考：[DeepSeek Chat Completions 参数说明](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)。

## 验证

- 回归覆盖：超过旧额度的思考、正文和工具参数完整保留；持续输出 15 分钟、静默超时、手动停止、失败续跑、并发请求隔离与代理参数保留。
- 使用已配置的 DeepSeek V4.1 Flash 做中性图书馆场景的真实推进与写作请求；两次均成功，实际出站请求均无输出上限字段。写作请求包含 80–140 字提示，最终正文为 137 字符，思考独立保留。

## 安装或更新

先停止 `dsh web`，执行后重新启动并刷新页面：

```bash
dsh plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.2-rc.7/dsh-tavern-mode-0.4.2-rc.7.tgz"
```
