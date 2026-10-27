# 把 dsh-genshin 推到你自己的 GitHub，并顺带发一个 Release
#
# 用法（在仓库根目录执行）：
#   $env:GITHUB_TOKEN = "ghp_xxx"      # 只需要 repo 权限的 classic PAT，或 fine-grained 的 Contents+Metadata 权限
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-github.ps1
#   （装了 PowerShell 7 也可以：pwsh -File scripts/publish-github.ps1）
#
#   可选参数：
#     -Owner   GitHub 用户名（默认 nonefora11）
#     -Repo    仓库名（默认 dsh-genshin）
#     -Private 建成私有仓库
#     -SkipRelease  只推代码，不建 Release
#     -EnablePages  顺手开 GitHub Pages（市场索引就有个国内能访问的 https 地址）
#     不带 token 时会从 git credential 里再找一次
#
# 脚本做的事：校验 token → 建仓库（已存在就跳过）→ 推送 main → npm pack → 建 Release 并上传 tgz →（可选）开 Pages。
# token 不会写进 .git/config，推送用的是临时 URL。
# 网络提醒：github.com 的 443 在国内经常抽风，脚本对 push 失败会自动重试 3 次；
# 一直失败就挂上代理 / 开 Steam++ 的 GitHub 加速再跑。

[CmdletBinding()]
param(
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$Owner = "nonefora11",
  [string]$Repo = "dsh-genshin",
  [switch]$Private,
  [switch]$SkipRelease,
  [switch]$EnablePages
)

$ErrorActionPreference = "Stop"
$api = "https://api.github.com"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "   $text" -ForegroundColor Green }

function Invoke-GitHub {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Uri,
    $Body,
    [hashtable]$Headers = @{}
  )
  $base = @{
    Authorization          = "token $Token"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent"           = "dsh-genshin-publish"
  }
  foreach ($key in $Headers.Keys) { $base[$key] = $Headers[$key] }
  $params = @{ Method = $Method; Uri = $Uri; Headers = $base }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 8)
    $params.ContentType = "application/json"
  }
  return Invoke-RestMethod @params
}

Step "0/5 检查环境"
if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = (git config --get github.token) 2>$null
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  throw "缺 token：先设置 `$env:GITHUB_TOKEN = 'ghp_...' 再跑一次。"
}
if (-not (Test-Path ".git")) { throw "当前目录不是 git 仓库：$root" }
$version = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$commit = (git rev-parse HEAD).Trim()
Ok "仓库：$root"
Ok "版本：$version  提交：$($commit.Substring(0,7))"

Step "1/5 校验 token"
$me = Invoke-GitHub -Method GET -Uri "$api/user"
Ok "已登录：$($me.login)"
if ($me.login -ne $Owner) {
  Write-Host "   注意：token 属于 $($me.login)，与 -Owner $Owner 不同；建仓库时会归到 $($me.login) 名下。" -ForegroundColor Yellow
  $Owner = $me.login
}

Step "2/5 建仓库"
$repoFull = "$Owner/$Repo"
$exists = $true
try { Invoke-GitHub -Method GET -Uri "$api/repos/$repoFull" | Out-Null } catch { $exists = $false }
if ($exists) {
  Ok "已存在，跳过创建"
} else {
  $payload = @{
    name        = $Repo
    description = "DeepSeek Harness plugin: opens the official Genshin Impact site and downloads the official launcher on startup."
    private     = [bool]$Private
    has_issues  = $true
    has_wiki    = $false
  }
  try {
    Invoke-GitHub -Method POST -Uri "$api/user/repos" -Body $payload | Out-Null
    Ok "已创建 https://github.com/$repoFull"
  } catch {
    $msg = $_.Exception.Message
    Write-Host "   建仓库失败：$msg" -ForegroundColor Yellow
    Write-Host "   fine-grained token 少 Administration:write（或 classic token 少 repo）时会走到这里。两条出路：" -ForegroundColor Yellow
    Write-Host "   ① 换成勾了 repo 的 classic token，重跑本脚本；" -ForegroundColor Yellow
    Write-Host "   ② 浏览器打开 https://github.com/new?name=$Repo 建一个空仓库（README / .gitignore / license 一个都别勾），再原样重跑本脚本。" -ForegroundColor Yellow
    throw "仓库还没建起来，先按上面 ① 或 ② 处理"
  }
}

Step "3/5 推送 main"
$cleanUrl = "https://github.com/$repoFull.git"
$authUrl = "https://x-access-token:$Token@github.com/$repoFull.git"
$branches = git branch --format="%(refname:short)"
if ($branches -notcontains "main") { git branch -M main }
# 用临时 URL 推，避免 token 落进 .git/config。github.com 的 443 在国内常抽风，失败重试 3 次。
$pushed = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  git -c http.schannelCheckRevoke=false -c http.postBuffer=524288000 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=300 push --quiet $authUrl "HEAD:refs/heads/main" 2>&1 | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -eq 0) { $pushed = $true; break }
  Write-Host "   push 第 $attempt 次失败，5 秒后重试（若一直失败：挂代理或开 Steam++ 的 GitHub 加速）" -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
if (-not $pushed) { throw "三次 push 都失败：先解决 github.com 连通性，再重跑本脚本（API 侧都已就绪）" }
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
if ((git remote) -contains 'origin') { git remote remove origin | Out-Null }
git remote add origin $cleanUrl
git branch --set-upstream-to=origin/main main | Out-Null
$ErrorActionPreference = $prevEap
Ok "已推送：$cleanUrl（origin 已改回不带 token 的地址）"

if ($SkipRelease) {
  Step "5/5 跳过 Release（-SkipRelease）"
} else {
  Step "4/5 打包"
  $tgz = (npm pack --silent).Trim().Split("`n")[-1].Trim()
  if (-not (Test-Path $tgz)) { throw "npm pack 没有产出 tgz" }
  Ok "tarball：$tgz"

  Step "5/5 建 Release 并上传"
  $tag = "v$version"
  $existing = $null
  try { $existing = Invoke-GitHub -Method GET -Uri "$api/repos/$repoFull/releases/tags/$tag" } catch { $existing = $null }
  if ($existing) {
    Ok "Release $tag 已存在，直接上传资产"
    $release = $existing
  } else {
    $release = Invoke-GitHub -Method POST -Uri "$api/repos/$repoFull/releases" -Body @{
      tag_name         = $tag
      target_commitish = "main"
      name             = "dsh-genshin $tag"
      body             = "启动 DeepSeek Harness 后自动打开《原神》官网并下载官方安装器。`n`n安装：在 DSH profile 目录执行 ``pnpm add $tgz 对应的 file: 路径``，或直接 ``pnpm add $repoFull``（市场收录后可用）。"
      draft            = $false
      prerelease       = $false
    }
    Ok "已创建 Release $tag"
  }
  $uploadUrl = ($release.upload_url -replace "\{.*\}", "")
  Invoke-RestMethod -Method POST -Uri "$uploadUrl?name=$tgz" `
    -Headers @{
      Authorization          = "token $Token"
      "Content-Type"         = "application/gzip"
      "User-Agent"           = "dsh-genshin-publish"
      "X-GitHub-Api-Version" = "2022-11-28"
    } -InFile $tgz -TimeoutSec 300 | Out-Null
  Ok "资产已上传：https://github.com/$repoFull/releases/download/$tag/$tgz"
}

Step "完成"
$short = $commit.Substring(0, 7)

if ($EnablePages) {
  Step "附带：开 GitHub Pages"
  $pagesUrl = "https://$Owner.github.io/$Repo/market/index.json"
  try {
    Invoke-GitHub -Method POST -Uri "$api/repos/$repoFull/pages" -Body @{
      source = @{ branch = "main"; path = "/" }
    } | Out-Null
    Ok "Pages 已开启（首次构建约 1 分钟）"
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match "409|already") { Ok "Pages 本来就在跑，跳过" }
    else { Write-Host "   Pages 没开成（私有仓库或权限不足？）：$msg" -ForegroundColor Yellow }
  }
  Ok "索引地址：$pagesUrl"
}

$lines = @(
  "   仓库：https://github.com/$repoFull",
  "   Release：https://github.com/$repoFull/releases",
  "   下一步（索引要钉到最后那个 commit）：",
  "     node scripts/make-index.mjs",
  "     git add market/index.json",
  "     git commit -m ""chore: point market index at $short""",
  "     git push",
  "   然后去 awesome-dsh-plugin 提 PR：把 submission/awesome-dsh-plugin/data/plugins/ 下的",
  "   nonefora11__dsh-genshin.yml 放进对方的 data/plugins/ 同名路径。",
  "   把索引加进 DSH：设置 → 插件 → 发现 → 索引源，填",
  "     https://$Owner.github.io/$Repo/market/index.json",
  "   （国内 raw.githubusercontent.com 被墙，所以别用 raw 地址）"
)
Write-Host -ForegroundColor Cyan ($lines -join [Environment]::NewLine)
