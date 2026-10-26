# Changelog

## 0.1.0 — 2026-10-26

首个版本。

- 启动 DSH 后延迟执行一次性流程：打开《原神》官网 → 解析官方安装器地址 → 下载 →（可选）拉起安装器。
- 官方地址解析：`ys-api.mihoyo.com` 的 `download_porter` 接口，跟随 302 得到 `autopatchcn.yuanshen.com/.../yuanshen_setup_*.exe`；也接受直接给 `.exe` 直链。
- 下载器：`.part` 临时文件 + HTTP `Range` 断点续传，416 自动重置，非 206 从头下载，按 `content-range` 校验总长，完成后 `rename` 落盘并写 `state.json`。
- `once` 语义：目标文件已完整存在且与状态文件一致时跳过，避免每次启动重复下载。
- 重试：指数退避，默认 3 次，可配；整体流程带总超时。
- 生命周期：`ctx.effect` 注册清理函数，卸载 / 热重载时 `clearTimeout` + `AbortController.abort()`。
- 配置：全部键可选、字符串布尔容错、`~` 展开、`region` 枚举校验。
- CLI：`lib/cli.js`，支持 `--dry-run --no-site --no-download --launch --region= --dir= --launcher= --no-once --json`。
- 测试：`test/smoke.mjs`，11 个离线用例覆盖配置、文件名、302、首次下载、`once`、续传、`dryRun`、挂载。
- 零运行时依赖，只使用 Node 内置模块。
