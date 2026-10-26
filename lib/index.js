/**
 * dsh-genshin — 启动 DSH 后自动打开《原神》官网并下载官方安装器的 DSH 插件。
 *
 * 设计要点：
 * - 只依赖 Node 内置模块，没有构建步骤，`lib/index.js` 就是可执行产物。
 * - 任何网络/磁盘失败都不会拖垮 DSH 启动：全部在 try/catch 里，只写日志。
 * - 官方下载地址不写死：请求 miHoYo 官方 download_porter 链接接口，读它 302 出的真实安装器地址。
 * - 支持断点续传（.part 文件 + Range）、重试、进度日志、once 去重、dryRun 演练。
 *
 * @module dsh-genshin
 */

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Cordis 插件名。 */
export const name = 'dsh-genshin'

/** 不依赖任何 ctx 服务，因此在 profile 根部就能挂载。 */
export const inject = []

/** 《原神》中国大陆官网。 */
export const DEFAULT_SITE_URL = 'https://ys.mihoyo.com/'

/** 国际服官网。 */
export const GLOBAL_SITE_URL = 'https://genshin.hoyoverse.com/'

/**
 * miHoYo 官方下载链接接口：请求它会 302 到当前版本的 PC 启动器安装包
 * （例如 https://autopatchcn.yuanshen.com/client_app/download/launcher/<build>/mihoyo/yuanshen_setup_<date>.exe）。
 */
export const DEFAULT_LAUNCHER_ENDPOINT =
  'https://ys-api.mihoyo.com/event/download_porter/link/ys_cn/official/pc_default'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36 dsh-genshin'

const MIB = 1024 * 1024

/** 默认配置。所有字段都可以在 profile 的 cordis.patch.yml 行 config 里覆盖。 */
export const DEFAULTS = {
  /** 总开关。false 时插件挂载但什么都不做。 */
  enabled: true,
  /** 打不开就演练：只解析下载地址、打印目标路径，不落地任何字节。 */
  dryRun: false,
  /** 用系统默认浏览器打开官网。 */
  openSite: true,
  /** 下载官方安装器。 */
  download: true,
  /** 下载完成后是否直接拉起安装器。默认 false，交给用户自己双击。 */
  launchInstaller: false,
  /** cn = 国服，global = 国际服。只影响 openSite 的默认地址。 */
  region: 'cn',
  /** 官网地址；留空则按 region 取默认值。 */
  siteUrl: '',
  /** 下载链接接口或直接的 .exe 直链；留空则用官方接口。 */
  launcherUrl: '',
  /** 下载目录；留空则用 <用户目录>/Downloads/GenshinImpact。 */
  downloadDir: '',
  /** 挂载后延迟多久开始，等应用启动完毕、浏览器可用。 */
  delayMs: 2500,
  /** true：同一份目标文件已完整存在时跳过下载（避免每次启动重复下载）。 */
  once: true,
  /** 单次 HTTP 请求的超时。 */
  requestTimeoutMs: 120000,
  /** 整个下载流程的总超时。 */
  downloadTimeoutMs: 6 * 60 * 60 * 1000,
  /** 失败重试次数（不含首次）。 */
  retries: 3,
  /** 进度日志的字节间隔。 */
  progressStepBytes: 8 * MIB,
  /** 进度日志的时间间隔。 */
  progressStepMs: 5000,
}

/** 插件状态目录：$DSH_HOME/dsh-genshin，未设置 DSH_HOME 时退回 ~/.dsh。 */
export function defaultStateDir() {
  const home = process.env.DSH_HOME?.trim()
  const root = home && home !== '' ? home : path.join(homedir(), '.dsh')
  return path.join(root, 'dsh-genshin')
}

/** 默认下载目录。 */
export function defaultDownloadDir() {
  return path.join(homedir(), 'Downloads', 'GenshinImpact')
}

function expandHome(input) {
  const text = String(input ?? '').trim()
  if (text === '') return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(homedir(), text.slice(2))
  return text
}

function bool(value, fallback) {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(text)) return true
    if (['0', 'false', 'no', 'off', ''].includes(text)) return false
  }
  return fallback
}

function positiveInt(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/**
 * 把原始（可能来自 YAML 的）配置规范化：补默认值、做类型转换、校验枚举。
 * @param {unknown} raw - profile 行里的 config。
 * @returns {typeof DEFAULTS & { stateDir: string }}
 */
export function resolveConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const region = String(input.region ?? DEFAULTS.region).trim().toLowerCase() === 'global' ? 'global' : 'cn'
  const siteUrl = expandHome(input.siteUrl) || (region === 'global' ? GLOBAL_SITE_URL : DEFAULT_SITE_URL)
  const launcherUrl = expandHome(input.launcherUrl) || DEFAULT_LAUNCHER_ENDPOINT
  const downloadDir = expandHome(input.downloadDir) || defaultDownloadDir()
  const stateDir = expandHome(input.stateDir) || defaultStateDir()
  return {
    enabled: bool(input.enabled, DEFAULTS.enabled),
    dryRun: bool(input.dryRun, DEFAULTS.dryRun),
    openSite: bool(input.openSite, DEFAULTS.openSite),
    download: bool(input.download, DEFAULTS.download),
    launchInstaller: bool(input.launchInstaller, DEFAULTS.launchInstaller),
    region,
    siteUrl,
    launcherUrl,
    downloadDir,
    stateDir,
    delayMs: positiveInt(input.delayMs, DEFAULTS.delayMs),
    once: bool(input.once, DEFAULTS.once),
    requestTimeoutMs: positiveInt(input.requestTimeoutMs, DEFAULTS.requestTimeoutMs),
    downloadTimeoutMs: positiveInt(input.downloadTimeoutMs, DEFAULTS.downloadTimeoutMs),
    retries: Number.isFinite(Number(input.retries)) && Number(input.retries) >= 0 ? Math.floor(Number(input.retries)) : DEFAULTS.retries,
    progressStepBytes: positiveInt(input.progressStepBytes, DEFAULTS.progressStepBytes),
    progressStepMs: positiveInt(input.progressStepMs, DEFAULTS.progressStepMs),
  }
}

/** 统一日志：写 stderr（不污染 stdout），并在宿主提供 ctx.logger 时镜像过去。 */
export function createLogger(ctx, sink = console) {
  const tag = '[dsh-genshin]'
  const host = ctx?.logger
  const forward = (level, message) => {
    try {
      if (host && typeof host[level] === 'function') host[level](`${tag} ${message}`)
    } catch {
      /* 宿主 logger 的异常绝不能影响插件本体 */
    }
  }
  const emit = (level, message) => {
    const text = `${tag} ${message}`
    forward(level, message)
    try {
      if (level === 'error') sink.error(text)
      else if (level === 'warn') sink.warn(text)
      else sink.log(text)
    } catch {
      /* 忽略 */
    }
  }
  return {
    info: (message) => emit('info', message),
    warn: (message) => emit('warn', message),
    error: (message) => emit('error', message),
    debug: (message) => emit('info', message),
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('已取消'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function withDeadline(ms, signal) {
  const timeout = AbortSignal.timeout(Math.max(1, ms))
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

async function fileSize(file) {
  try {
    const info = await stat(file)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MIB) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * MIB) return `${(bytes / MIB).toFixed(1)} MiB`
  return `${(bytes / (1024 * MIB)).toFixed(2)} GiB`
}

const FILE_EXT_RE = /\.(exe|msi|zip|7z|rar|dmg|pkg|tar|gz)$/i
const FILE_QUERY_KEYS = ['name', 'file', 'filename', 'download', 'f']

/**
 * 从下载 URL 推断落地文件名，保留归档/安装包后缀。
 * 先看 ?name= / ?file= 这类查询参数，再看路径最后一段。
 */
export function filenameFor(url) {
  const candidates = []
  try {
    const parsed = new URL(url)
    for (const key of FILE_QUERY_KEYS) {
      const value = parsed.searchParams.get(key)
      if (value && value.trim() !== '') candidates.push(value.trim())
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    const last = segments.pop()
    if (last) candidates.push(decodeURIComponent(last))
    const secondLast = segments.pop()
    if (secondLast) candidates.push(decodeURIComponent(secondLast))
  } catch {
    /* 落到默认名 */
  }
  const cleaned = (text) => {
    const safe = String(text).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '')
    return safe === '' ? '' : safe
  }
  const withExt = candidates.map(cleaned).find((text) => text !== '' && FILE_EXT_RE.test(text))
  if (withExt) return withExt
  const named = candidates.map(cleaned).find((text) => text !== '')
  if (!named) return 'genshin_setup.exe'
  return `${named.replace(/\.+$/, '')}.exe`
}

async function readState(stateFile) {
  try {
    const text = await readFile(stateFile, 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeState(stateFile, state) {
  try {
    await mkdir(path.dirname(stateFile), { recursive: true })
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    /* 状态文件写不了不影响主流程 */
  }
}

/**
 * 用系统默认处理程序打开一个 URL。
 * @param {string} url - 绝对 URL。
 * @param {ReturnType<typeof createLogger>} log - 日志器。
 * @returns {Promise<boolean>} 是否成功把请求交给系统。
 */
export async function openInBrowser(url, log) {
  const platform = process.platform
  let command
  let args
  if (platform === 'win32') {
    command = process.env.COMSPEC || 'cmd.exe'
    args = ['/c', 'start', '', url]
  } else if (platform === 'darwin') {
    command = 'open'
    args = [url]
  } else {
    command = 'xdg-open'
    args = [url]
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (error) => log.warn(`打开浏览器失败：${error.message}`))
    child.unref()
    log.info(`已在默认浏览器打开：${url}`)
    return true
  } catch (error) {
    log.warn(`打开浏览器失败：${error?.message ?? error}`)
    return false
  }
}

/** 下载完成后拉起安装器（不等待它退出）。 */
export function launchInstaller(file, log) {
  try {
    const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', (error) => log.warn(`拉起安装器失败：${error.message}`))
    child.unref()
    log.info(`已拉起安装器：${file}`)
    return true
  } catch (error) {
    log.warn(`拉起安装器失败：${error?.message ?? error}`)
    return false
  }
}

function totalBytesOf(response, offset) {
  const range = response.headers.get('content-range')
  if (range) {
    const total = Number(range.split('/').pop())
    if (Number.isFinite(total)) return total
  }
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length)) return length + offset
  return null
}

/**
 * 解析官方安装器的真实下载地址。
 *
 * 官方接口是一次 302 跳转；这里先用 HEAD 跟随重定向拿最终 URL（不消耗流量），
 * 接口不支持 HEAD 时退回 GET + redirect:manual 读 Location。
 *
 * @param {{ launcherUrl: string, requestTimeoutMs: number }} config
 * @param {ReturnType<typeof createLogger>} log
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ url: string, total: number | null }>}
 */
export async function resolveLauncherUrl(config, log, signal) {
  const entry = config.launcherUrl
  // 用户直接给了安装包直链，不再解析。
  if (/\.(exe|msi)(?:$|\?)/i.test(entry)) {
    log.info(`使用直链：${entry}`)
    return { url: entry, total: null }
  }
  const headers = { 'user-agent': USER_AGENT, accept: '*/*' }
  const attempts = [
    { method: 'HEAD', redirect: 'follow' },
    { method: 'GET', redirect: 'manual' },
  ]
  let lastError = null
  for (const attempt of attempts) {
    try {
      const response = await fetch(entry, {
        method: attempt.method,
        redirect: attempt.redirect,
        headers,
        signal: withDeadline(config.requestTimeoutMs, signal),
      })
      if (attempt.redirect === 'follow') {
        await response.body?.cancel?.().catch?.(() => {})
        if (response.ok) {
          const url = response.url || entry
          if (url !== entry) log.info(`官方接口解析到：${url}`)
          return { url, total: totalBytesOf(response, 0) }
        }
        lastError = new Error(`解析下载地址失败：HTTP ${response.status}`)
      } else {
        const location = response.headers.get('location')
        if ([301, 302, 303, 307, 308].includes(response.status) && location) {
          const url = new URL(location, entry).href
          log.info(`官方接口解析到：${url}`)
          return { url, total: null }
        }
        await response.body?.cancel?.().catch?.(() => {})
        if (response.ok) {
          const url = response.url || entry
          log.info(`官方接口解析到：${url}`)
          return { url, total: totalBytesOf(response, 0) }
        }
        lastError = new Error(`解析下载地址失败：HTTP ${response.status}`)
      }
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
    }
  }
  throw lastError ?? new Error('解析下载地址失败')
}

/**
 * 把安装包流式下载到磁盘，支持断点续传、进度日志和重试。
 *
 * @param {string} url - 安装包直链。
 * @param {ReturnType<typeof resolveConfig>} config
 * @param {ReturnType<typeof createLogger>} log
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ path: string, bytes: number, skipped: boolean }>}
 */
export async function downloadFile(url, config, log, signal) {
  const dir = config.downloadDir
  await mkdir(dir, { recursive: true })
  const fileName = filenameFor(url)
  const finalPath = path.join(dir, fileName)
  const partPath = `${finalPath}.part`
  const stateFile = path.join(config.stateDir, 'state.json')
  const state = await readState(stateFile)

  const existing = await fileSize(finalPath)
  if (config.once && existing && existing > 0 && state.file === finalPath) {
    log.info(`已下载过，跳过：${finalPath}（${formatBytes(existing)}）`)
    return { path: finalPath, bytes: existing, skipped: true }
  }

  const deadline = Date.now() + config.downloadTimeoutMs
  let attempt = 0
  for (;;) {
    attempt += 1
    try {
      const result = await attemptDownload()
      await writeState(stateFile, {
        version: 1,
        file: finalPath,
        bytes: result,
        url,
        completedAt: new Date().toISOString(),
        attempts: attempt,
      })
      return { path: finalPath, bytes: result, skipped: false }
    } catch (error) {
      if (signal?.aborted) throw error
      if (Date.now() > deadline) throw new Error(`下载超过总超时（${config.downloadTimeoutMs} ms）：${error?.message ?? error}`)
      if (attempt > config.retries) throw error
      const waitMs = Math.min(30_000, 1000 * 2 ** (attempt - 1))
      log.warn(`下载失败（第 ${attempt} 次）：${error?.message ?? error}；${Math.round(waitMs / 1000)} 秒后重试`)
      await sleep(waitMs, signal)
    }
  }

  async function attemptDownload() {
    let offset = (await fileSize(partPath)) ?? 0
    const headers = { 'user-agent': USER_AGENT, accept: '*/*' }
    if (offset > 0) headers.range = `bytes=${offset}-`
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: withDeadline(config.requestTimeoutMs, signal),
    })
    if (response.status === 416) {
      await rm(partPath, { force: true })
      throw new Error('服务器拒绝续传范围（416），已清空临时文件')
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText ?? ''}`.trim())
    if (offset > 0 && response.status !== 206) {
      log.warn('服务器没有接受续传，从头开始')
      offset = 0
      await rm(partPath, { force: true })
    }
    const total = totalBytesOf(response, offset)
    if (offset > 0) log.info(`续传：已有 ${formatBytes(offset)}${total ? ` / ${formatBytes(total)}` : ''}`)
    else log.info(`开始下载：${url}${total ? `（${formatBytes(total)}）` : ''}`)
    log.info(`保存到：${finalPath}`)

    const started = Date.now()
    let received = offset
    let lastMark = offset
    let lastAt = started
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        const now = Date.now()
        if (received - lastMark >= config.progressStepBytes || now - lastAt >= config.progressStepMs) {
          lastMark = received
          lastAt = now
          const elapsed = Math.max(1, now - started) / 1000
          const speed = (received - offset) / elapsed
          const percent = total ? ` ${((received / total) * 100).toFixed(1)}%` : ''
          const overall = total ? ` / ${formatBytes(total)}` : ''
          log.info(`进度 ${formatBytes(received)}${overall}${percent} · ${formatBytes(speed)}/s`)
        }
        callback(null, chunk)
      },
    })

    const sink = createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' })
    await pipeline(Readable.fromWeb(response.body), meter, sink, { signal })

    const written = (await fileSize(partPath)) ?? 0
    if (total !== null && written < total) {
      throw new Error(`下载不完整：${formatBytes(written)} / ${formatBytes(total)}`)
    }
    await rename(partPath, finalPath)
    log.info(`下载完成：${finalPath}（${formatBytes(written)}）`)
    return written
  }
}

/**
 * 执行一次完整流程：开官网 → 解析下载地址 → 下载 →（可选）拉起安装器。
 *
 * @param {object} options
 * @param {ReturnType<typeof resolveConfig>} options.config
 * @param {ReturnType<typeof createLogger>} options.log
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ dryRun: boolean, siteOpened: boolean, launcherUrl: string | null, file: string | null, bytes: number, skipped: boolean, launched: boolean }>}
 */
export async function runOnce({ config, log, signal }) {
  const summary = {
    dryRun: config.dryRun,
    siteOpened: false,
    launcherUrl: null,
    file: null,
    bytes: 0,
    skipped: false,
    launched: false,
  }
  if (config.dryRun) {
    log.info('dryRun 已开启：只解析地址，不打开浏览器、不下载任何字节')
  } else if (config.openSite) {
    summary.siteOpened = await openInBrowser(config.siteUrl, log)
  } else {
    log.info('openSite=false，跳过打开官网')
  }

  if (!config.download) {
    log.info('download=false，跳过下载')
    return summary
  }

  const resolved = await resolveLauncherUrl(config, log, signal)
  summary.launcherUrl = resolved.url
  if (config.dryRun) {
    const target = path.join(config.downloadDir, filenameFor(resolved.url))
    log.info(`dryRun 目标文件：${target}${resolved.total ? `（${formatBytes(resolved.total)}）` : ''}`)
    return summary
  }

  const result = await downloadFile(resolved.url, config, log, signal)
  summary.file = result.path
  summary.bytes = result.bytes
  summary.skipped = result.skipped

  if (config.launchInstaller && !result.skipped) {
    summary.launched = launchInstaller(result.path, log)
  }
  log.info(
    result.skipped
      ? '流程结束：安装包已存在，未重复下载'
      : `流程结束：安装包已就绪（${formatBytes(result.bytes)}），双击安装即可`,
  )
  return summary
}

/**
 * Cordis 入口：挂载后延迟一小会儿启动一次性流程。
 * 用 ctx.effect 注册清理函数，插件热重载/卸载时中止进行中的下载。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} rawConfig - profile 行里的 config。
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const log = createLogger(ctx)
  if (!config.enabled) {
    log.info('enabled=false，插件挂载但不执行任何动作')
    return
  }
  log.info(`已挂载：region=${config.region} openSite=${config.openSite} download=${config.download} dryRun=${config.dryRun}`)

  ctx.effect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void runOnce({ config, log, signal: controller.signal }).catch((error) => {
        if (controller.signal.aborted) return
        log.error(`流程中断：${error?.message ?? error}`)
        if (error?.stack) log.debug(String(error.stack).split('\n').slice(0, 4).join(' | '))
      })
    }, config.delayMs)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, 'dsh-genshin: startup')
}

export default { name, inject, apply }
