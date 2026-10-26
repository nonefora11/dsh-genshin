#!/usr/bin/env node
/**
 * 手动执行器：不重启 DSH 也能跑一次完整流程。
 *
 *   node lib/cli.js --dry-run
 *   node lib/cli.js --no-site --dir D:/Games/Genshin
 *   node lib/cli.js --json
 *
 * 与插件共用 lib/index.js 的实现，行为完全一致。
 */

import path from 'node:path'
import { createLogger, formatBytes, resolveConfig, runOnce } from './index.js'

const HELP = `dsh-genshin-autolaunch CLI

用法：node lib/cli.js [选项]

  --dry-run              只解析官方下载地址，不打开浏览器、不下载
  --no-site              不打开官网
  --no-download          不下载（只开官网）
  --launch               下载完成后拉起安装器
  --region=cn|global     选择官网（默认 cn）
  --dir=<路径>           下载目录（默认 <用户目录>/Downloads/GenshinImpact）
  --launcher=<URL>       改用指定下载接口或 .exe 直链
  --no-once              即使目标文件已存在也重新下载
  --json                 输出 JSON 汇总
  -h, --help             显示本帮助
`

function parseArgs(argv) {
  const flags = {}
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') flags.help = true
    else if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--no-site') flags.openSite = false
    else if (arg === '--no-download') flags.download = false
    else if (arg === '--launch') flags.launchInstaller = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--no-once') flags.once = false
    else if (arg.startsWith('--region=')) flags.region = arg.slice('--region='.length)
    else if (arg.startsWith('--dir=')) flags.downloadDir = arg.slice('--dir='.length)
    else if (arg.startsWith('--launcher=')) flags.launcherUrl = arg.slice('--launcher='.length)
    else if (arg.startsWith('--')) throw new Error(`未知选项：${arg}`)
    else throw new Error(`无法识别的参数：${arg}`)
  }
  return flags
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.help) {
    process.stdout.write(HELP)
    return
  }
  const config = resolveConfig(flags)
  const log = {
    info: (message) => process.stderr.write(`[genshin-autolaunch] ${message}\n`),
    warn: (message) => process.stderr.write(`[genshin-autolaunch] WARN ${message}\n`),
    error: (message) => process.stderr.write(`[genshin-autolaunch] ERROR ${message}\n`),
    debug: (message) => process.stderr.write(`[genshin-autolaunch] ${message}\n`),
  }
  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const summary = await runOnce({ config, log: log ?? createLogger(undefined), signal: controller.signal })
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ...summary, bytesHuman: formatBytes(summary.bytes), downloadDir: path.resolve(config.downloadDir) }, null, 2)}\n`)
  } else {
    process.stdout.write(
      [
        `dryRun       : ${summary.dryRun}`,
        `官网已打开   : ${summary.siteOpened}`,
        `下载地址     : ${summary.launcherUrl ?? '-'}`,
        `落地文件     : ${summary.file ?? '-'}`,
        `大小         : ${formatBytes(summary.bytes)}`,
        `已存在跳过   : ${summary.skipped}`,
        `已拉起安装器 : ${summary.launched}`,
      ].join('\n') + '\n',
    )
  }
}

main().catch((error) => {
  process.stderr.write(`[genshin-autolaunch] 失败：${error?.message ?? error}\n`)
  process.exitCode = 1
})
