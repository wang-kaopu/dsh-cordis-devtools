import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'

const roots = ['README.md', 'AGENTS.md', '.agents', 'docs']
const markdownFiles = []
for (const root of roots) {
  try {
    const statFiles = await collect(root)
    markdownFiles.push(...statFiles.filter(file => file.endsWith('.md')))
  } catch {
    // Optional trees may not exist yet.
  }
}

const errors = []
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g
for (const file of [...new Set(markdownFiles)]) {
  const content = await readFile(file, 'utf8')
  for (const match of content.matchAll(linkPattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, '')
    if (!raw || raw.startsWith('#') || /^(https?:|mailto:|skills:)/.test(raw)) continue

    const withoutTitle = raw.split(/\s+["']/)[0]
    const target = decodeURIComponent(withoutTitle.split('#')[0].split('?')[0])
    if (!target) continue

    const absolute = resolve(dirname(file), normalize(target))
    try {
      await access(absolute)
    } catch {
      errors.push(`${file}: broken relative link '${raw}'`)
    }
  }
}

if (errors.length) {
  console.error(`Relative-link verification failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Verified relative links in ${new Set(markdownFiles).size} Markdown file${new Set(markdownFiles).size === 1 ? '' : 's'}.`)

async function collect(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOTDIR') return null
    throw error
  })
  if (entries === null) return [path]

  const out = []
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) out.push(...await collect(child))
    else out.push(child)
  }
  return out
}
