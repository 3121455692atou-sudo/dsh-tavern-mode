# DSH 酒馆模式

在 DeepSeek Harness 中导入 SillyTavern 角色卡、预设和世界书，使用原生聊天界面进行互动写作。

支持普通模式与多 agent 模式、HTML 前端组件、独立角色记忆、表格更新、台词框和跨会话共享头像。

## 安装

需要 Node.js 26.4 或更新版本；本版本在 DeepSeek Harness 0.1.5-rc.1 上验证。

dsh 安装插件需要系统 PATH 中有 pnpm。没有安装时先执行：

```bash
npm install -g pnpm@11.21.0
pnpm --version
```

然后复制下面完整的一行命令（包括网址）安装插件：

```bash
dsh plugin --profile web add --allow-build=esbuild https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz
```

安装后重启 `dsh web`，在输入框上方的模式菜单选择「酒馆模式」，再导入自己的角色卡。发布包已经包含前端构建产物。安装参数 `--allow-build=esbuild` 用于安装脚本编译器，供 HTML 模块加载和酒馆助手更新使用。

使用 npx 启动 dsh 时，对应安装命令为：

```bash
npx @deepseek-ai/dsh plugin --profile web add --allow-build=esbuild https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz
npx @deepseek-ai/dsh web
```

模型使用 dsh「设置 → 模型」中已经配置的提供方。插件的模型选项留空时跟随输入框中的模型。

## 使用

- **普通模式**直接读取历史原文。最大输入默认为 200,000 个估算 token，应用不设置数值上限；超出预算时从最早的历史开始截断。入口为输入框上方的「最大输入与模型」。
- **多 agent 模式**执行角色召回、场景组合、剧情推进、写作和状态更新。写作读取上一条正文原文、本轮输入，以及已有摘要、记忆和状态。各阶段模型和并发数可以单独配置。
- **台词框**支持角色、玩家、情绪差分、格式和图片设置。头像全局共享、按内容去重，切换或删除对话后继续保留，手动删除后才从头像列表移除。
- **资源导入**支持 PNG/JSON 角色卡、世界书、酒馆预设、正则和 ZIP 资源包。推进预设和表格模板可选。
- **消息操作**支持编辑、删除、重新生成和分支，关联的表格与角色记忆随剧情版本更新。

固定提示词和稳定工具 schema 优先复用前缀。普通模式的输入预算使用本地估算，实际分词和缓存命中率由所选模型与提供方决定。

酒馆助手接口随包提供，并可在设置中检查上游更新。直接依赖 SillyTavern 后端或其他扩展私有接口的脚本可能仍需适配。

## 数据位置

默认数据目录为 `~/.dsh/tavern/`，设置 `DSH_HOME` 时使用对应目录。

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
