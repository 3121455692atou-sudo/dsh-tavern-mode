# 0.4.2-rc.10：固定链接的可靠更新方式

本版运行代码与 0.4.2-rc.8 相同，只修正并验证固定链接的更新方式，同步包内文档。

## 问题

固定链接的安装包被替换后，直接重新执行 add 命令经常不会重新下载：

- pnpm 会为固定链接的下载包记录校验值（integrity），已安装时直接从本地存储复用旧包；界面显示安装成功，版本却停在旧版。
- `--force`、`pnpm update` 按 pnpm 11.4 起的设计不会绕过该校验值；`--config.prefer-frozen-lockfile=false` 经重复验证结果不稳定，不可依赖。
- `pnpm add` 只有在依赖对锁文件来说是“新的”时候才会重新解析并下载。

## 解决

更新时先把插件从配置里移除，再执行原来的 add 命令。移除后该依赖对 pnpm 是全新的，会重新下载固定链接当前指向的安装包：

```bash
dsh plugin --profile web remove dsh-tavern-mode
dsh plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz"
```

下载地址和文件名保持不变，初次安装仍使用上面第二条 add 命令，无需 remove。

## 验证

- 从已安装 0.4.0 的隔离数据目录执行 remove + add，4/4 次全部升级到 0.4.2-rc.10。
- 通过 `dsh plugin` 命令在全新、旧版和已是最新的三类数据目录中重复执行同一流程，结果一致。
- 全新数据目录执行 add，直接安装 0.4.2-rc.10。
- GitHub 固定链接下载内容与发布包逐字节一致（SHA-256）。
- 320 项自动化测试通过；语法检查及前端构建通过。

## 安装或更新

停止 `dsh web` 后执行，完成后重新启动并刷新页面。固定链接的路径和文件名保留 `0.4.0`，包内版本为 `0.4.2-rc.10`。

本版独立下载地址：

```bash
dsh plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.2-rc.10/dsh-tavern-mode-0.4.2-rc.10.tgz"
```
