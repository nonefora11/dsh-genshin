#!/usr/bin/env node
/**
 * README 语言切换条生成器。
 *
 * GitHub 一个仓库首页只会渲染一份 README，没有内建的语言切换器；社区做法是在
 * README 顶部/底部放一行互链（English · 简体中文），点一下就跳到另一份文件。
 * 这个脚本把那一行写进 README.md / README.zh.md，可重复执行（幂等）。
 *
 *   node scripts/readme-lang.mjs          写入
 *   node scripts/readme-lang.mjs --check  只检查是否需要更新（有差异则退出码 1）
 *
 * 语言增删：改下面的 LANGUAGES 数组即可（新增语言记得同时建 README.<code>.md）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 渲染顺序即显示顺序；label 是给人看的名字，file 是仓库里的文件名。 */
const LANGUAGES = [
  { label: 'English', file: 'README.md' },
  { label: '简体中文', file: 'README.zh.md' },
]

const START = '<!-- lang-switch:start -->'
const END = '<!-- lang-switch:end -->'

/** 当前语言加粗，其余给链接；`&nbsp;·&nbsp;` 在 GitHub 上渲染成细圆点分隔。 */
function block(active, { divider = false } = {}) {
  const links = LANGUAGES.map(({ label, file }) =>
    file === active ? `<b>${label}</b>` : `<a href="${file}">${label}</a>`,
  ).join('\n  &nbsp;·&nbsp;\n  ')
  const bar = ['<p align="center">', `  ${links}`, '</p>'].join('\n')
  return [START, divider ? `---\n\n${bar}` : bar, END].join('\n')
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 去掉上一轮写入的切换条（顶部与底部各一份，底部那份连同分隔线一起删）。 */
function stripSwitcher(text) {
  const pattern = new RegExp(`\\n*${escape(START)}[\\s\\S]*?${escape(END)}\\n*`, 'g')
  return text.replace(pattern, '\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 顶部插在第一个标题之前，底部插在文末。 */
function render(original, active) {
  const body = stripSwitcher(original)
  const firstHeading = body.search(/^#\s/m)
  const preamble = firstHeading > 0 ? body.slice(0, firstHeading).trim() : ''
  const main = firstHeading > 0 ? body.slice(firstHeading).trim() : body
  return `${[preamble, block(active), main, block(active, { divider: true })].filter(Boolean).join('\n\n')}\n`
}

const checkOnly = process.argv.includes('--check')
let dirty = 0

for (const { file } of LANGUAGES) {
  const target = path.join(ROOT, file)
  if (!fs.existsSync(target)) {
    process.stdout.write(`跳过（不存在）：${file}\n`)
    continue
  }
  const original = fs.readFileSync(target, 'utf8')
  const next = render(original, file)
  if (next === original) {
    process.stdout.write(`已是最新：${file}\n`)
    continue
  }
  dirty += 1
  if (checkOnly) {
    process.stdout.write(`需要更新：${file}\n`)
    continue
  }
  fs.writeFileSync(target, next, 'utf8')
  process.stdout.write(`已写入切换条：${file}\n`)
}

if (checkOnly && dirty > 0) process.exitCode = 1
