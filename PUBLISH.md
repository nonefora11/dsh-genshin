# 发布到 GitHub + 在插件市场看到自己的插件

一句话答案：**能。而且有两种「看到」，快的那条是自己加索引源，几十秒后就出现；慢的那条是提 PR 进社区市场，合并后所有人（包括你）都能搜到。**

| 路线 | 你在哪里看到 | 别人能看到吗 | 生效时间 |
| --- | --- | --- | --- |
| ① 自己加索引源（本仓库的 `market/index.json`） | 设置 → 插件 → 发现 | 只有加了这个索引的人 | 加完立刻 |
| ② 提 PR 进社区市场 `awesome-dsh-plugin` | 设置 → 插件 → 发现，搜「原神」 | **所有人** | 合并后 1 天内（CI 要跑格式校验 + 站点构建） |
| ③ 都不做，只装 tarball | 插件列表里已有，但「发现」页搜不到 | 只有你自己 | 立刻 |

---

## 第 0 步：先确认网络（这步会决定后面顺不顺）

国内到 GitHub 的连通性是抽的，本机实测（2026-10-26 晚）：

| 目标 | 结果 |
| --- | --- |
| `api.github.com` | ✅ 200，0.6 s —— 建仓库、发 Release、开 PR 全走它 |
| `github.com:443` | ❌ 连不上（`Failed to connect to github.com:443 after 21070 ms`）——**`git push` 会卡在这里** |
| `raw.githubusercontent.com` / `cdn.jsdelivr.net` / `raw.githack.com` | ❌ 被墙 |
| `codeload.github.com` / `objects.githubusercontent.com` / `*.github.io` | ✅ 通 |
| `awesome-dsh-plugin.com` | ✅ 200（慢，约 25 s） |

所以：**API 那条路现在就通，卡的是 `git push`**。开个代理，或者开着你可能已经装了的 Steam++ / Watt Toolkit 的「GitHub 加速」，再跑脚本即可；脚本对 push 失败会自动重试 3 次。

## 第 1 步：拿一个 token（1 分钟）

打开 <https://github.com/settings/tokens> → *Generate new token (classic)* → 勾 **`repo`** → 生成后复制。

> fine-grained token 也行：Repository permissions 里给 **Contents: Read and write** + **Administration: Read and write**（建仓库要用）+ **Pages: Read and write**（要开 Pages 才需要）。

token 只在本机环境变量里待着，脚本不会写进 `.git/config`。

## 第 2 步：一条命令推上去

```powershell
$env:GITHUB_TOKEN = "ghp_xxx"
cd C:\Users\wwb26\Documents\deepseek-harness\default-workspace\dsh-genshin-autolaunch
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-github.ps1 -EnablePages
```

脚本按顺序做这些事，每步都会打印结果：

1. `GET /user` 校验 token，并把 `-Owner` 纠正成 token 真正的归属账号
2. 仓库不存在就 `POST /user/repos` 建（描述、issues 开、wiki 关），存在就跳过
3. `git push` 到 `main`，**临时 URL 里塞 token**，推完把 `origin` 改回不带 token 的干净地址；失败重试 3 次
4. `npm pack` 出 `dsh-genshin-autolaunch-0.1.0.tgz`
5. `POST /releases` 建 `v0.1.0`，再用 `upload_url` 把 tgz 传成 Release 资产
6. `-EnablePages` 时 `POST /pages` 开 Pages（源 `main` 根目录）

跑完你会拿到：

- 仓库 `https://github.com/headacheee/dsh-genshin-autolaunch`
- Release 资产 `https://github.com/headacheee/dsh-genshin-autolaunch/releases/download/v0.1.0/dsh-genshin-autolaunch-0.1.0.tgz`
- 索引 `https://headacheee.github.io/dsh-genshin-autolaunch/market/index.json`

## 第 3 步：索引钉到最后那个 commit，再推一次

索引里的 git source 必须指向**已经推上去的 40 位 commit**。脚本跑完会提示你做一次：

```powershell
node scripts/make-index.mjs        # 读当前 HEAD，写进 market/index.json，并用官方校验器自检
git add market/index.json
git commit -m "chore: point market index at <短 sha>"
git push
```

`make-index.mjs` 会打印 `校验器：通过`；想只校验不改文件就 `node scripts/make-index.mjs --check`。

> 为什么不在脚本里自动跑完？因为「提交索引」本身会产生新 commit，索引里钉的必须是**代码那个** commit，这两件事天然差一步。commit 序列现在是：`ad39e42`（0.1.0）→ `d56ea6c`（工具链）→ `99f3e7c`（索引钉 d56ea6c）→ `04dfba2`（文档）。

## 第 4 步：让 DSH 里立刻出现（路线 ①）

DSH → 设置 → 插件 → 发现 → **索引源** → 添加：

```
https://headacheee.github.io/dsh-genshin-autolaunch/market/index.json
```

加完刷新，「原神自动启动 / Genshin Auto Launch」就出现在列表里，点安装即可。**别用 raw 地址**（`raw.githubusercontent.com` 国内被墙），也别用 GitHub API 的 contents 地址（返回的是 JSON 包装层，不是索引本体）。

这也是「自己的私有市场」：以后你写第二个插件，往同一个 `market/index.json` 的 `plugins[]` 里加一条就行。

## 第 5 步：进社区市场，让所有人搜到（路线 ②）

别人（包括你）在「发现」页看到的公开列表，来自仓库 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/*.yml`。

```powershell
$env:GITHUB_TOKEN = "ghp_xxx"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-market-pr.ps1
```

脚本会 fork 上游 → 用 contents API 写入 `data/plugins/headacheee__dsh-genshin-autolaunch.yml` → 直接从 fork 开 PR，并打印 PR 链接。想先看要提交什么、不碰网络：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-market-pr.ps1 -DryRun -Owner headacheee
```

提交的文件内容（就是 `submission/awesome-dsh-plugin/data/plugins/` 里那份）：

```yaml
url: https://github.com/headacheee/dsh-genshin-autolaunch
name: headacheee/dsh-genshin-autolaunch
category: fun
description:
  en: Opens the official Genshin Impact site and downloads the official launcher when DeepSeek Harness starts.
  zh: DSH 启动后自动打开《原神》官网并下载官方安装器。
tarball: https://github.com/headacheee/dsh-genshin-autolaunch/releases/download/v0.1.0/dsh-genshin-autolaunch-0.1.0.tgz
```

CI 卡点（都已经对齐了）：`url` 与仓库完全一致、`description.en` 一句话以句号结尾、每条 PR ≤3 个条目、仓库 `package.json` 有 `dsh.bundle`、仓库存在 ≥1 天。**图标**想加的话必须是仓库内的 png/jpg/webp（不接受 SVG 和第三方图床），所以这份条目没写 `icon`。

合并后 `dshmarket` 会按 `https://awesome-dsh-plugin.com/plugins.json` 自动收录，通常 1 天内出现；市场里缓存了旧数据就重启 DSH 或等下一次拉取。

## 第 6 步：验证（三条 curl 就够）

```bash
# 仓库在不在
curl -s -o /dev/null -w "%{http_code}\n" https://api.github.com/repos/headacheee/dsh-genshin-autolaunch
# Release 资产在不在（-L 跟随重定向）
curl -sIL -o /dev/null -w "%{http_code}\n" https://github.com/headacheee/dsh-genshin-autolaunch/releases/download/v0.1.0/dsh-genshin-autolaunch-0.1.0.tgz
# 索引是不是合法 JSON 且钉了 commit
curl -s https://headacheee.github.io/dsh-genshin-autolaunch/market/index.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const i=JSON.parse(s);console.log(i.plugins[0].name, i.plugins[0].versions[0].source.commit)})"
```

## 报错对照

| 现象 | 原因 / 处理 |
| --- | --- |
| `Failed to connect to github.com:443` | github.com 被墙或抖；挂代理 / 开 GitHub 加速后重跑，脚本会自动重试 |
| `remote: Permission to ... denied` | token 没 `repo` 权限，或 `-Owner` 与 token 归属不一致（脚本会自动纠正成 token 的登录名） |
| `npm pack` 报 `EPERM` | 目标 tgz 被占用（比如还开着资源管理器预览），删掉同目录旧 tgz 重跑 |
| Pages 404 | 首次构建要等 1 分钟左右；私有仓库需要付费计划 |
| 市场里搜不到 | ① 索引源地址填错（要用 `github.io`，不是 raw）；② 社区市场还没合并/还没到 1 天；③ 重启 DSH 刷新缓存 |
