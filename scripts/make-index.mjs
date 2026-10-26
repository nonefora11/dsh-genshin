#!/usr/bin/env node
/**
 * 生成 dsh 插件市场 format-1 索引：market/index.json
 *
 *   node scripts/make-index.mjs                # 用当前 HEAD 的 commit
 *   node scripts/make-index.mjs <40位commit>   # 指定 commit（push 之后再生成一次）
 *   node scripts/make-index.mjs --check        # 只校验已有索引，不重写
 *
 * 索引里的 git source 必须钉死到 40 位 commit，所以流程是：
 *   提交 → push → 用 push 出去的 commit 生成索引 → 再提交索引 → push
 * 这个脚本把「生成」和「自校验」两件事一起做了，校验器直接借用
 * dsh 运行时自带的 @deepseek-ai/dsh-plugin-market-index，规则不会漂。
 */

import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

const repoUrl = 'https://github.com/headacheee/dsh-genshin'
const indexFile = path.join(root, 'market', 'index.json')
const checkOnly = process.argv.includes('--check')
const explicitCommit = process.argv.slice(2).find((arg) => /^[0-9a-f]{40}$/.test(arg))

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    throw new Error('无法读取 git HEAD：先在仓库里提交一次')
  }
}

async function iconDataUrl() {
  const svg = await readFile(path.join(root, pkg.icon ?? 'icon.svg'))
  return `data:image/svg+xml;base64,${svg.toString('base64')}`
}

async function loadValidator() {
  const candidates = [
    'C:/Users/wwb26/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
    '@deepseek-ai/dsh-plugin-market-index',
  ]
  for (const spec of candidates) {
    try {
      return await import(spec.startsWith('C:') ? `file:///${spec.replaceAll('\\', '/')}` : spec)
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

const commit = explicitCommit ?? headCommit()
const publishTimestamp = Math.floor(Date.now() / 1000)

const index = {
  format: 1,
  title: { en: 'Genshin Auto Launch', zh: '原神自动启动' },
  description: {
    en: 'A curated index of DeepSeek Harness plugins by headacheee.',
    zh: 'headacheee 维护的 DeepSeek Harness 插件索引。',
  },
  metadata: {
    categories: {
      fun: { title: { en: 'Fun', zh: '趣味' } },
      tools: { title: { en: 'Tools', zh: '工具' } },
    },
    labels: {
      official: { title: { en: 'Official source', zh: '官方源' } },
      'no-telemetry': { title: { en: 'No telemetry', zh: '无埋点' } },
      'zero-dependency': { title: { en: 'Zero dependency', zh: '零依赖' } },
    },
    sortKeys: {
      publish: { title: { en: 'Published', zh: '发布时间' }, order: 'desc' },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'Genshin Auto Launch', zh: '原神自动启动' },
      description: {
        en: 'Opens the official Genshin Impact site and downloads the official launcher when DSH starts.',
        zh: 'DSH 启动后自动打开《原神》官网并下载官方安装器。',
      },
      icon: await iconDataUrl(),
      author: pkg.author ?? 'headacheee',
      homepage: repoUrl,
      repository: { url: repoUrl },
      metadata: {
        category: 'fun',
        keywords: ['genshin', 'autolaunch', 'downloader', 'mihoyo', 'startup'],
        labels: ['official', 'no-telemetry', 'zero-dependency'],
        sortKeys: { publish: publishTimestamp },
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: 'git', url: repoUrl, commit },
          engines: { dsh: '>=0.1.0' },
        },
      ],
    },
  ],
}

const validator = await loadValidator()
if (checkOnly) {
  if (!validator) {
    process.stderr.write('校验器不可用，跳过校验\n')
    process.exit(0)
  }
  const parsed = validator.parseMarketIndex(JSON.parse(await readFile(indexFile, 'utf8')), `${repoUrl}/raw/main/market/index.json`)
  process.stdout.write(`索引校验通过：${parsed.plugins.length} 个插件 · ${parsed.plugins[0].name}@${parsed.plugins[0].versions[0].version}\n`)
  process.exit(0)
}

if (validator) {
  validator.parseMarketIndex(index, `${repoUrl}/raw/main/market/index.json`)
}
await mkdir(path.dirname(indexFile), { recursive: true })
await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
process.stdout.write(`已写入 ${path.relative(root, indexFile)}（${pkg.name}@${pkg.version} @ ${commit.slice(0, 7)}）\n`)
process.stdout.write(validator ? '校验器：通过\n' : '校验器：不可用，已跳过\n')
