# 0.4.2-rc.9：固定链接的安装与更新命令修复

本版运行代码与 0.4.2-rc.8 相同，只修正固定链接的安装与更新方式，并同步包内文档。

## 问题

pnpm 默认 `prefer-frozen-lockfile=true`。已有安装记录时，再次执行原来的 add 命令会直接复用锁文件中的旧包：固定链接指向的安装包虽然已经替换，pnpm 不会重新下载，界面显示安装成功，实际版本没有变化。

## 修复

安装与更新命令增加 `--config.prefer-frozen-lockfile=false`，让 pnpm 每次重新解析并下载固定链接指向的最新包。下载地址、路径和文件名保持不变，无需卸载，初次安装和更新仍是同一条命令：

```bash
dsh plugin --profile web add --allow-build=esbuild --config.prefer-frozen-lockfile=false "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.0/dsh-tavern-mode-0.4.0.tgz"
```

`--allow-build=esbuild` 允许安装脚本编译器；`--config.prefer-frozen-lockfile=false` 只影响本次安装的锁文件策略，不改变 dsh 的其他设置。

## 验证

- 在隔离的数据目录中，从已安装 0.4.0 的状态执行上述命令，成功升级到 0.4.2-rc.9。
- 全新数据目录执行同一命令，直接安装 0.4.2-rc.9。
- 核对 GitHub 固定链接下载内容与发布包逐字节一致（SHA-256）。
- 320 项自动化测试通过。

## 版本专属下载

```bash
dsh plugin --profile web add --allow-build=esbuild --config.prefer-frozen-lockfile=false "https://github.com/3121455692atou-sudo/dsh-tavern-mode/releases/download/v0.4.2-rc.9/dsh-tavern-mode-0.4.2-rc.9.tgz"
```
