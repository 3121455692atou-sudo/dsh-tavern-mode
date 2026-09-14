# DSH 酒馆模式

> **当前预发布：0.4.2-rc.10**。运行代码与 rc.8 相同（自动纠错次数按设置执行）；本版修正更新方式：pnpm 默认把固定链接的已装包锁死，更新时先移除再安装。详见 [更新说明](REPAIR_RC10.zh-CN.md) 和 [发布页面](https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/tag/v0.4.2-rc.10)。

在 DeepSeek Harness 中导入 SillyTavern 角色卡、预设和世界书，使用原生聊天界面进行互动写作。

支持普通模式与多 agent 模式、HTML 前端组件、独立角色记忆、表格更新、台词框和跨会话共享头像。

## 安装

安装前需要：

| 项目 | 要求 |
|---|---|
| Node.js | 26.4 或更新版本，包含 npm |
| DeepSeek Harness 自身 | 已实测版本为 0.1.5-rc.1，命令 `dsh` 可用 |
| pnpm | 已验证版本为 11.21.0，命令 `pnpm` 可用 |
| 网络 | 能访问 GitHub Release 和 npm registry |
| 使用方式 | dsh Web 版及浏览器；生成内容需配置模型提供方 |

当前版本已在 macOS arm64（Node.js 26.8.2、DSH 0.1.5-rc.1）完成插件运行验证。早期版本另有 Linux x86_64 验证；Windows 尚未完成运行实测。

先查看现有版本：

```bash
node --version
dsh --version
pnpm --version
```

缺少 pnpm 时安装：

```bash
npm install -g pnpm@11.21.0
```

初次安装：

```bash
dsh plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz"
```

更新（固定链接不变，先移除旧安装再安装）：

```bash
dsh plugin --profile web remove dsh-tavern-mode
dsh plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz"
```

这个固定链接会更新为当前发布包；路径与文件名保留 `0.4.0`，包内版本当前为 `0.4.2-rc.10`。需要固定具体版本时，使用对应发布页面中的版本专属下载链接。

安装或升级前先停止正在运行的 `dsh web`。已有插件更新时必须先执行 remove：pnpm 会把固定链接的已装包连同校验值记入锁文件，直接重新 add 不会重新下载被替换的安装包（`--force` 和 update 按 pnpm 的设计也不会绕过），只有移除后重新安装才会获取最新包。安装/更新后重新启动 `dsh web` 并刷新已打开的页面，在输入框上方的模式菜单选择「酒馆模式」，再导入自己的角色卡。发布包已经包含前端构建产物。安装参数 `--allow-build=esbuild` 用于安装脚本编译器，供 HTML 模块加载和酒馆助手更新使用。

使用 npx 启动 dsh 时：

```bash
npx @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz"
npx @deepseek-ai/dsh@0.1.5-rc.1 web
```

模型使用 dsh「设置 → 模型」中已经配置的提供方。插件的模型选项留空时跟随输入框中的模型。

## 使用

- **普通模式**直接读取历史原文。最大输入默认为 200,000 个估算 token，应用不设置数值上限；超出预算时从最早的历史开始截断。入口为输入框上方的「最大输入与模型」。
- **多 agent 模式**执行角色召回、场景组合、剧情推进、写作和状态更新。写作读取上一条正文原文、本轮输入，以及已有摘要、记忆和状态。各阶段模型和并发数可以单独配置。
- **台词框**支持角色、玩家、情绪差分、格式和图片设置。头像全局共享、按内容去重，切换或删除对话后继续保留，手动删除后才从头像列表移除。
- **资源导入**支持 PNG/JSON 角色卡、世界书、酒馆预设、正则和 ZIP 资源包。推进预设和表格模板可选。
- **共同事件记忆**按知情范围保存一份事件正文，各角色保留引用与个人变化；私人信息仍隔离。表格或记忆失败后可仅重试未完成更新。
- **失败续跑**在输入框上方点击「从失败步骤继续」。成功步骤复用本地结果，继续失败步骤及必要后续任务；正文尚未生成时也有入口。持续收到正文、思考或工具参数时不限总时长，连续 60 秒无新内容才停止。
- **自动纠错**按设置的 0–3 次执行，每个工具或推进任务独立计数。设为 3 时，首次请求后最多额外纠错 3 次，成功即停止；只发送当前结果、错误和必要资料。拒答、没有可修复结果、输出截断、静默超时或取消时停止；网络重试遵循提供方设置。
- **正文篇幅**在「模型与输入」设置目标字数区间，默认 2000–4000 字。区间写进固定提示词，只计算正文，不含思考与协议数据；超出目标也不截断。旧配置中的 `maxTokens` 不再作为插件输出额度使用。
- **消息操作**支持编辑、删除、重新生成和分支，关联的表格与角色记忆随剧情版本更新。

酒馆的 Chat Completions / Responses 请求不发送输出 token 上限，并清除 SDK 自动填入的额度。服务商自身仍有默认额度和上下文硬上限；原生 Anthropic Messages 等要求必传额度的接口仍受其协议限制。收到上游 `length` 会保留原始回复，不自动重发整轮。

固定提示词和稳定工具 schema 优先复用前缀。普通模式的输入预算使用本地估算，实际分词和缓存命中率由所选模型与提供方决定。

酒馆助手接口随包提供，并可在设置中检查上游更新。直接依赖 SillyTavern 后端或其他扩展私有接口的脚本可能仍需适配。

## 数据位置

默认数据目录为 `~/.dsh/tavern/`，设置 `DSH_HOME` 时使用对应目录。

插件文件按安装位置定位，数据文件按数据目录定位。`dataDir` 的相对路径以 dsh 数据目录为基准；本地导入的相对路径以酒馆数据目录为基准。资源和头像使用标识引用，移动数据目录后继续有效。

| 内容 | 位置 |
|---|---|
| 会话及剧情版本 | `tavern/sessions/` |
| 导入资源目录 | `tavern/library/` |
| 共享头像索引 | `tavern/runtime/avatars.json` |
| 独立图片文件 | `tavern/assets/` |
| 酒馆模式注册 | `.agent-presets/tavern/` |

已有本地酒馆模式配置会保留，首次启动只创建缺少的模式注册文件。

## 开发

```bash
npm ci
npm test
npm run check
npm run build
npm pack
```

源码位于 `src/`，构建脚本位于 `scripts/build.mjs`。上游组件的来源和许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 卸载

```bash
dsh plugin --profile web remove dsh-tavern-mode
```

重启 dsh 后，在模式设置中删除「酒馆模式」的本地注册即可。剧情数据保留在数据目录中。

[DSH 官方插件安装文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish) · [发布版本](https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases)
