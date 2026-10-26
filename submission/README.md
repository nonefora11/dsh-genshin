# 申请录入插件市场

这份目录是提交物料，不参与 npm 打包。两个市场分别对应两套流程。

---

## 一、社区市场 dshmarket（awesome-dsh-plugin）

收录方式：往 [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR，**只加一个文件**。

已准备好的文件：

```
submission/awesome-dsh-plugin/data/plugins/headacheee__dsh-genshin-autolaunch.yml
```

内容（category 选的是 `fun`；想更偏工具向就改 `tools`）：

```yaml
url: https://github.com/headacheee/dsh-genshin-autolaunch
name: headacheee/dsh-genshin-autolaunch
category: fun
description:
  en: Opens the official Genshin Impact site and downloads the official launcher when DeepSeek Harness starts.
  zh: DSH 启动后自动打开《原神》官网并下载官方安装器。
tarball: https://github.com/headacheee/dsh-genshin-autolaunch/releases/download/v0.1.0/dsh-genshin-autolaunch-0.1.0.tgz
```

### 手工步骤

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`。
2. 把上面那个文件放到 fork 的 `data/plugins/headacheee__dsh-genshin-autolaunch.yml`。
3. 开 PR，标题建议：`feat: add dsh-genshin-autolaunch (fun)`。
4. 等 CI：条目格式 → 仓库根 `package.json` 里的 `dsh.bundle`（本仓库有 `dsh.bundle.patch`）→ 仓库存在 ≥1 天 → 站点构建。
5. 合并后 `dshmarket` 会按 `https://awesome-dsh-plugin.com/plugins.json` 自动收录，一般 1 天内能在市场里搜到。

### 或者用脚本自动提（需要同一个 PAT）

```powershell
$env:GITHUB_TOKEN = "ghp_xxx"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-market-pr.ps1
```

脚本会 fork → 用 contents API 写入那个 yml → 直接从 fork 开 PR，并把 PR 链接打出来。

### 注意事项（CI 会卡的点）

- `url` 必须和仓库地址完全一致，不能带 `.git`、不能带子目录（除非是 monorepo 子包，那种写法是 `owner/repo#subname`）。
- `description.en` 必须是**一句话、以句号结尾**。
- 每条 PR 最多 3 个条目；本仓库只有 1 条。
- 想加图标：必须放在自己仓库里、GitHub 托管的位图（png/jpg/webp），不接受 SVG 和第三方图床 —— 所以这份条目没写 `icon`，市场会回落到仓库图标/默认图标。
- 想加截图：在自己仓库放 `screenshots.json`，列 1–8 个相对路径（禁止 `..` 和绝对路径）。

---

## 二、宿主自带市场（index 源）

DSH 自带的市场读的是 format-1 索引 JSON，用户可以自己添加索引源（设置 → 插件 → 发现 → 索引源）。

已生成并校验过的索引：`market/index.json`（`node scripts/make-index.mjs --check` 可复验）。

添加方式，二选一：

1. **加索引源**：把索引地址填进索引源列表
   - `https://raw.githubusercontent.com/headacheee/dsh-genshin-autolaunch/main/market/index.json`
   - 国内 raw 被墙时用 API 形式：`https://api.github.com/repos/headacheee/dsh-genshin-autolaunch/contents/market/index.json`（需要 `Accept: application/vnd.github.raw`，市场里能不能直接用取决于版本）
2. **不走市场**：直接装 tarball（见 README 的安装段落），或把仓库名加进 profile 的 `dsh.profile.bundles`。

索引里的 `versions[0].source.commit` 钉死 40 位 commit，所以每次发版后要重跑一次：

```bash
node scripts/make-index.mjs          # 读当前 HEAD 写进索引
git add market/index.json && git commit -m "chore: bump market index" && git push
```

`scripts/make-index.mjs` 会用 dsh 运行时自带的 `@deepseek-ai/dsh-plugin-market-index` 校验器自检，格式错了当场报错。
