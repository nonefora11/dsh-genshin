/**
 * 离线冒烟测试：不联网、不打开浏览器、不下载任何外部文件。
 *
 *   node test/smoke.mjs
 *
 * 覆盖：
 *   1. resolveConfig 默认值 / 类型转换 / 枚举校验
 *   2. filenameFor 从 URL 取文件名
 *   3. resolveLauncherUrl 跟随 302 拿到 .exe 直链（用本地 HTTP 服务模拟官方接口）
 *   4. downloadFile 首次下载 + .part 断点续传 + once 跳过
 *   5. apply 用 stub ctx 挂载，不抛异常，且 ctx.effect 收到清理函数
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  DEFAULT_LAUNCHER_ENDPOINT,
  DEFAULT_SITE_URL,
  GLOBAL_SITE_URL,
  apply,
  defaultDownloadDir,
  defaultStateDir,
  downloadFile,
  filenameFor,
  formatBytes,
  name,
  resolveConfig,
  resolveLauncherUrl,
  runOnce,
} from '../lib/index.js'

const quiet = { info() {}, warn() {}, error() {}, debug() {} }
const results = []
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(`  ok   ${label}`))
    .catch((error) => {
      results.push(`  FAIL ${label}\n       ${error?.message ?? error}`)
      process.exitCode = 1
    })
}

// ---- 起始断言 ----
await check('插件名与导出', () => {
  assert.equal(name, 'genshin-autolaunch')
  assert.equal(typeof apply, 'function')
})

await check('resolveConfig 默认值', () => {
  const config = resolveConfig(undefined)
  assert.equal(config.enabled, true)
  assert.equal(config.openSite, true)
  assert.equal(config.download, true)
  assert.equal(config.launchInstaller, false)
  assert.equal(config.region, 'cn')
  assert.equal(config.siteUrl, DEFAULT_SITE_URL)
  assert.equal(config.launcherUrl, DEFAULT_LAUNCHER_ENDPOINT)
  assert.equal(config.downloadDir, defaultDownloadDir())
  assert.equal(config.stateDir, defaultStateDir())
  assert.equal(config.delayMs, 2500)
  assert.equal(config.retries, 3)
})

await check('resolveConfig 归一化（字符串布尔 / 枚举 / 非法整数）', () => {
  const config = resolveConfig({
    enabled: 'false',
    openSite: '0',
    download: 'yes',
    region: 'GLOBAL',
    delayMs: '-5',
    retries: 0,
    downloadDir: '~/genshin-test',
  })
  assert.equal(config.enabled, false)
  assert.equal(config.openSite, false)
  assert.equal(config.download, true)
  assert.equal(config.region, 'global')
  assert.equal(config.siteUrl, GLOBAL_SITE_URL)
  assert.equal(config.delayMs, 2500, '非法 delayMs 应回落默认')
  assert.equal(config.retries, 0)
  assert.ok(!config.downloadDir.includes('~'), '~ 应被展开')
})

await check('filenameFor', () => {
  assert.equal(filenameFor('https://a.com/x/yuanshen_setup_20260924.exe'), 'yuanshen_setup_20260924.exe')
  assert.equal(filenameFor('https://a.com/dl/?name=GenshinInstaller.exe'), 'GenshinInstaller.exe')
  assert.ok(filenameFor('https://a.com/').length > 0, '无文件名时应有兜底名')
})

await check('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1536), '1.5 KiB')
})

// ---- 本地 HTTP 服务：模拟 302 接口 + 支持 Range 的文件下载 ----
const PAYLOAD = Buffer.alloc(64 * 1024)
for (let i = 0; i < PAYLOAD.length; i += 1) PAYLOAD[i] = i % 251

const server = createServer((req, res) => {
  if (req.url === '/resolve') {
    res.writeHead(302, { location: `${base}/files/yuanshen_setup_test.exe` })
    res.end()
    return
  }
  if (req.url === '/files/yuanshen_setup_test.exe') {
    const range = req.headers.range
    if (range) {
      const match = /^bytes=(\d+)-$/.exec(range)
      const start = Number(match?.[1] ?? 0)
      if (start >= PAYLOAD.length) {
        res.writeHead(416, { 'content-range': `bytes */${PAYLOAD.length}` })
        res.end()
        return
      }
      const slice = PAYLOAD.subarray(start)
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-length': String(slice.length),
        'content-range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
        'accept-ranges': 'bytes',
      })
      res.end(slice)
      return
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(PAYLOAD.length),
      'accept-ranges': 'bytes',
    })
    res.end(PAYLOAD)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const sandbox = await mkdtemp(path.join(tmpdir(), 'genshin-autolaunch-'))
const config = resolveConfig({
  downloadDir: path.join(sandbox, 'downloads'),
  stateDir: path.join(sandbox, 'state'),
  requestTimeoutMs: 10_000,
  downloadTimeoutMs: 30_000,
  retries: 1,
  progressStepBytes: 1024 * 1024,
  once: true,
})

await check('resolveLauncherUrl 跟随 302', async () => {
  const resolved = await resolveLauncherUrl({ ...config, launcherUrl: `${base}/resolve` }, quiet)
  assert.equal(resolved.url, `${base}/files/yuanshen_setup_test.exe`)
})

await check('downloadFile 首次下载并落盘', async () => {
  const result = await downloadFile(`${base}/files/yuanshen_setup_test.exe`, config, quiet)
  assert.equal(result.skipped, false)
  assert.equal(result.bytes, PAYLOAD.length)
  const written = await readFile(result.path)
  assert.equal(written.length, PAYLOAD.length)
  assert.ok(written.equals(PAYLOAD), '内容应一致')
  const state = JSON.parse(await readFile(path.join(config.stateDir, 'state.json'), 'utf8'))
  assert.equal(state.bytes, PAYLOAD.length)
})

await check('downloadFile once=true 跳过重复下载', async () => {
  const result = await downloadFile(`${base}/files/yuanshen_setup_test.exe`, config, quiet)
  assert.equal(result.skipped, true)
  assert.equal(result.bytes, PAYLOAD.length)
})

await check('downloadFile 断点续传（从 .part 恢复）', async () => {
  const resumeConfig = { ...config, downloadDir: path.join(sandbox, 'resume'), stateDir: path.join(sandbox, 'state2') }
  const { mkdir } = await import('node:fs/promises')
  await mkdir(resumeConfig.downloadDir, { recursive: true })
  const partPath = path.join(resumeConfig.downloadDir, 'yuanshen_setup_test.exe.part')
  await writeFile(partPath, PAYLOAD.subarray(0, 20_000))
  const result = await downloadFile(`${base}/files/yuanshen_setup_test.exe`, resumeConfig, quiet)
  assert.equal(result.skipped, false)
  const written = await readFile(result.path)
  assert.ok(written.equals(PAYLOAD), '续传后内容应恢复完整')
  await assert.rejects(stat(partPath), '续传完成后 .part 应被 rename 掉')
})

await check('runOnce dryRun 不落地任何字节', async () => {
  const summary = await runOnce({
    config: { ...config, dryRun: true, launcherUrl: `${base}/resolve`, downloadDir: path.join(sandbox, 'dry') },
    log: quiet,
  })
  assert.equal(summary.dryRun, true)
  assert.equal(summary.siteOpened, false)
  assert.equal(summary.launcherUrl, `${base}/files/yuanshen_setup_test.exe`)
  assert.equal(summary.file, null)
  await assert.rejects(stat(path.join(sandbox, 'dry')), 'dryRun 不应创建下载目录')
})

await check('apply 挂载不抛异常、注册清理函数', async () => {
  let disposer = null
  const calls = []
  const ctx = {
    logger: { info: (m) => calls.push(['info', m]), warn: (m) => calls.push(['warn', m]), error: (m) => calls.push(['error', m]) },
    effect(fn, label) {
      calls.push(['effect', label])
      disposer = fn()
      return () => {}
    },
  }
  apply(ctx, { delayMs: 5, openSite: false, download: false })
  assert.equal(typeof disposer, 'function', 'ctx.effect 的返回值应是清理函数')
  assert.ok(calls.some(([k]) => k === 'effect'))
  assert.ok(calls.some(([k, m]) => k === 'info' && String(m).includes('已挂载')))
  await new Promise((resolve) => setTimeout(resolve, 60))
  disposer() // 幂等清理
})

server.close()
await rm(sandbox, { recursive: true, force: true })

process.stdout.write(`\n${results.join('\n')}\n`)
process.stdout.write(process.exitCode ? '\n有用例失败\n' : `\n全部 ${results.length} 项通过\n`)
