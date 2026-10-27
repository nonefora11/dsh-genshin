<!-- lang-switch:start -->
<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <b>简体中文</b>
</p>
<!-- lang-switch:end -->

# dsh-genshin（原神自动启动）

DeepSeek Harness 插件：**启动 DSH 之后，自动打开《原神》官网，并把官方安装器下载好。**

零依赖、无埋点、不走第三方镜像——直接从米哈游官方下载接口解析安装包，支持断点续传，下完不打扰你。

## 它会做什么

每次启动 DSH（延迟一小会儿，等应用起来、浏览器可用）后：

1. 用默认浏览器打开 <https://ys.mihoyo.com/>（`region: global` 时打开 `genshin.hoyoverse.com`）。
2. 从 `ys-api.mihoyo.com` 解析官方安装器地址（302 → `autopatchcn.yuanshen.com/.../yuanshen_setup_*.exe`）。
3. 下载到 `~/Downloads/GenshinImpact`，带 `.part` + HTTP `Range` 断点续传。
4. 需要的话下载完成后自动拉起安装器（`launchInstaller: true`）。

同一个版本只下一次：目标文件已完整存在且与状态文件记录一致时，后续启动直接跳过，不会每次重复下载几百 MB。

## 安装

### 从 DSH 插件市场

在 *设置 → 插件 → 发现* 里搜 **原神自动启动** / **Genshin Auto Launch**，或者把本仓库加为索引源（`market/index.json`）。

### 从 tarball / git

```bash
# 在你的 DSH profile 目录里执行，例如 C:\Users\<你>\.dsh\profiles\desktop
pnpm add file:./dsh-genshin-0.1.0.tgz    # Release 里的资产
pnpm add "git+https://github.com/nonefora11/dsh-genshin.git#<commit>"
```

然后把包名加进 profile `package.json` 的 `dsh.profile.bundles`，或者直接依赖随包的 `cordis.patch.yml` 自动插入这一行：

```yaml
- insert:
    - id: dsh-genshin
      name: 'dsh-genshin'
      config:
        enabled: true
        openSite: true
        download: true
        launchInstaller: false
        region: cn
        delayMs: 2500
```

也可以手动写进 `C:\Users\<你>\.dsh\profiles\desktop\cordis.patch.yml`，改完重启 DSH 生效。

## 配置项

全部可选，不写就用默认值。布尔值也接受 `1/0`、`yes/no`、`on/off` 字符串。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 设 `false` 时插件照常挂载但不做任何事。 |
| `openSite` | `true` | 启动时打开官网。 |
| `download` | `true` | 下载安装器。 |
| `launchInstaller` | `false` | 下载完成后运行安装器。 |
| `region` | `cn` | `cn` → `ys.mihoyo.com`；`global` → `genshin.hoyoverse.com`。 |
| `siteUrl` | 按 region | 自定义官网地址。 |
| `launcherUrl` | 官方接口 | 自定义下载接口，或直接给 `.exe` 直链。 |
| `downloadDir` | `~/Downloads/GenshinImpact` | 保存目录，支持 `~`。 |
| `delayMs` | `2500` | 启动后延迟多久开始。 |
| `once` | `true` | 文件已完整存在时跳过。 |
| `requestTimeoutMs` | `120000` | 单次请求超时。 |
| `downloadTimeoutMs` | `21600000` | 整个下载流程超时（6 小时）。 |
| `retries` | `3` | 失败重试次数，指数退避。 |
| `stateDir` | `$DSH_HOME/dsh-genshin` | `state.json` 位置。 |

## 命令行（不重启 DSH 也能跑一次）

```bash
node lib/cli.js --dry-run        # 只解析地址，一个字节都不下
node lib/cli.js --json           # 完整流程 + JSON 汇总
node lib/cli.js --no-site        # 只下载
node lib/cli.js --no-download    # 只开官网
node lib/cli.js --launch         # 下载完拉起安装器
node lib/cli.js --dir=D:/Games/Genshin --region=global
```

## 测试

```bash
node test/smoke.mjs
```

11 个离线用例：配置归一化、文件名推断、302 跟随、首次下载、`once` 跳过、`.part` 续传、`dryRun` 不落地、stub cordis 上下文挂载。全部跑在本地 HTTP 服务上，不访问外网、不下载真实安装包。

## 说明

- 只从米哈游 / HoYoverse 官方接口取文件，与米哈游无关联，也不代表官方立场。
- 不打算装游戏的话，把 `download: false`（或 `dryRun: true`）设上，就只开官网。
- Linux / macOS：`openSite` 走 `xdg-open` / `open`；安装器是 Windows `.exe`，那边建议只下载不拉起。

## 许可证

MIT © nonefora11

---

---

<!-- lang-switch:start -->
---

<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <b>简体中文</b>
</p>
<!-- lang-switch:end -->
