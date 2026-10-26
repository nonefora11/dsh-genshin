# 向 awesome-dsh-plugin 提 PR 收录本插件（fork → 写文件 → 开 PR，一条龙）
#
#   $env:GITHUB_TOKEN = "ghp_xxx"
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\open-market-pr.ps1
#   （装了 PowerShell 7 也可以：pwsh -File scripts/open-market-pr.ps1）
#
#   -Owner    fork 到哪个账号下（默认取 token 对应的登录名）
#   -Category fun | tools | ...（默认 fun）
#   -DryRun   只打印将要提交的内容，不调 API
#
# 只写一个文件：data/plugins/<owner>__<repo>.yml，与市场 CI 的要求一致。

[CmdletBinding()]
param(
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$Owner,
  [string]$Category = "fun",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$api = "https://api.github.com"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$upstream = "awesome-dsh-plugin/awesome-dsh-plugin"
$repoName = "dsh-genshin"
$pkg = Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "   $t" -ForegroundColor Green }

function Invoke-GitHub {
  param([Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][string]$Uri, $Body)
  $headers = @{
    Authorization          = "token $Token"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent"           = "dsh-genshin-submit"
  }
  $params = @{ Method = $Method; Uri = $Uri; Headers = $headers }
  if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 8); $params.ContentType = "application/json" }
  return Invoke-RestMethod @params
}

if ($DryRun) { $Token = if ($Token) { $Token } else { "dry-run" } }
if ([string]::IsNullOrWhiteSpace($Token)) { throw "缺 token：先设置 `$env:GITHUB_TOKEN = 'ghp_...'" }

Step "0/4 准备条目"
if ([string]::IsNullOrWhiteSpace($Owner) -and -not $DryRun) {
  $Owner = (Invoke-GitHub -Method GET -Uri "$api/user").login
}
if ([string]::IsNullOrWhiteSpace($Owner)) { $Owner = "headacheee" }

$entry = @"
url: https://github.com/$Owner/$repoName
name: $Owner/$repoName
category: $Category
description:
  en: Opens the official Genshin Impact site and downloads the official launcher when DeepSeek Harness starts.
  zh: DSH 启动后自动打开《原神》官网并下载官方安装器。
tarball: https://github.com/$Owner/$repoName/releases/download/v$version/$repoName-$version.tgz
"@
$fileName = "$($Owner)__$repoName.yml"
Ok "文件：data/plugins/$fileName"
Write-Host $entry

if ($DryRun) {
  Step "DryRun：到此为止"
  exit 0
}

Step "1/4 fork 上游仓库"
$upstreamName = $upstream.Split('/')[1]
$forkFull = "$Owner/$upstreamName"
try { Invoke-GitHub -Method GET -Uri "$api/repos/$forkFull" | Out-Null; Ok "fork 已存在" }
catch { Invoke-GitHub -Method POST -Uri "$api/repos/$upstream/forks" | Out-Null; Ok "已发起 fork（等待就绪）" }
$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 3
  try { $forkReady = Invoke-GitHub -Method GET -Uri "$api/repos/$forkFull"; Write-Host "   " }
  catch { $forkReady = $null }
} until ($forkReady -or (Get-Date) -gt $deadline)
if (-not $forkReady) { throw "fork 90 秒内没就绪，稍后重跑本脚本" }
Ok "fork：https://github.com/$forkFull"

Step "2/4 同步 main"
try {
  Invoke-GitHub -Method POST -Uri "$api/repos/$forkFull/merge-upstream" -Body @{ branch = "main" } | Out-Null
  Ok "已同步上游 main"
} catch { Write-Host "   同步跳过（可能已是最新）：$($_.Exception.Message)" -ForegroundColor Yellow }

Step "3/4 写入条目文件"
$target = "data/plugins/$fileName"
$content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($entry))
$existing = $null
try { $existing = Invoke-GitHub -Method GET -Uri "$api/repos/$forkFull/contents/$target" } catch { $existing = $null }
if ($existing) {
  $body = @{ message = "chore: update $fileName"; content = $content; sha = $existing.sha; branch = "main" }
  Ok "文件已存在，更新"
} else {
  $body = @{ message = "feat: add $fileName"; content = $content; branch = "main" }
  Ok "新增文件"
}
Invoke-GitHub -Method PUT -Uri "$api/repos/$forkFull/contents/$target" -Body $body | Out-Null

Step "4/4 开 PR"
$pr = Invoke-GitHub -Method POST -Uri "$api/repos/$upstream/pulls" -Body @{
  title = "feat: add $repoName ($Category)"
  head  = "$($Owner):main"
  base  = "main"
  body  = @"
Adds ``$repoName`` to the plugin list.

- Repo: https://github.com/$Owner/$repoName
- Category: ``$Category``
- What it does: opens the official Genshin Impact site and downloads the official launcher when DeepSeek Harness starts.
- Bundle: root ``package.json`` declares ``dsh.bundle.patch`` (``cordis.patch.yml``), no build step, zero runtime dependencies.
- Release asset: https://github.com/$Owner/$repoName/releases/download/v$version/$repoName-$version.tgz

Entry file: ``$target``
"@
}
Ok "PR：$($pr.html_url)"
