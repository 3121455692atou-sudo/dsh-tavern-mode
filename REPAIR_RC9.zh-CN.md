# 0.4.2-rc.9：固定链接的安装与更新命令修复

> **更正（0.4.2-rc.10）**：本版建议的 `--config.prefer-frozen-lockfile=false` 经多次重复验证并不可靠：pnpm 对固定链接的已装包按锁文件校验值锁定，是否重新下载还会受缓存状态影响，结果不稳定。正确且稳定的更新方式是先 `remove` 再 `add`，见 [REPAIR_RC10.zh-CN.md](REPAIR_RC10.zh-CN.md)。以下保留 rc.9 发布时的记录。

本版运行代码与 0.4.2-rc.8 相同，只修正固定链接的安装与更新方式，并同步包内文档。

## 问题

pnpm 默认 `prefer-frozen-lockfile=true`。已有安装记录时，再次执行原来的 add 命令会直接复用锁文件中的旧包：固定链接指向的安装包虽然已经替换，pnpm 不会重新下载，界面显示安装成功，实际版本没有变化。

## 修复（已被 rc.10 取代）

安装与更新命令增加 `--config.prefer-frozen-lockfile=false`，让 pnpm 重新解析并下载固定链接指向的最新包。该参数在后续的多次重复测试中未能稳定生效，请使用 [REPAIR_RC10.zh-CN.md](REPAIR_RC10.zh-CN.md) 中的 remove + add 方式。

## 当时验证

- 在隔离的数据目录中，从已安装 0.4.0 的状态执行上述命令，升级到 0.4.2-rc.9。
- 全新数据目录执行同一命令，直接安装 0.4.2-rc.9。
- 核对 GitHub 固定链接下载内容与发布包逐字节一致（SHA-256）。
- 320 项自动化测试通过；语法检查及前端构建通过。

后续重复测试发现同一命令存在成功与不成功交替出现的情况，因此 rc.10 改用确定性的更新方式。

## 安装或更新

停止 `dsh web` 后执行，完成后重新启动并刷新页面。固定链接的路径和文件名保留 `0.4.0`：

```bash
dsh plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz"
```

本版也提供独立下载地址：

```bash
dsh plugin --profile web add --allow-build=esbuild "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.2-rc.9/dsh-tavern-mode-0.4.2-rc.9.tgz"
```
