import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const ROOT = '.agents/notes'
const LIFECYCLES = new Set(['proposed', 'implemented', 'rejected', 'archived'])
const CLASSES = new Set(['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'])
const DATE_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/

const errors = []
const files = await walk(ROOT)
let checked = 0

for (const file of files) {
  if (!file.endsWith('.md') || file === join(ROOT, 'README.md')) continue
  const parts = relative(ROOT, file).split(sep)
  if (parts.length !== 3) {
    errors.push(`${file}: expected <lifecycle>/<class>/YYYY-MM-DD-topic.md`)
    continue
  }

  const [lifecycle, kind, name] = parts
  if (!LIFECYCLES.has(lifecycle)) errors.push(`${file}: unknown lifecycle '${lifecycle}'`)
  if (!CLASSES.has(kind)) errors.push(`${file}: unknown class '${kind}'`)
  if (!DATE_NAME.test(name)) errors.push(`${file}: filename must be YYYY-MM-DD-kebab-case.md`)

  const content = await readFile(file, 'utf8')
  checked += 1
  validateHeader(file, lifecycle, content)
  validateSections(file, lifecycle, content)
}

if (errors.length) {
  console.error(`Agent Note verification failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Verified ${checked} Agent Note${checked === 1 ? '' : 's'}.`)

function validateHeader(file, lifecycle, content) {
  if (!content.startsWith('# Agent Note: ')) {
    errors.push(`${file}: first line must start with '# Agent Note: '`) 
  }

  const lines = content.split('\n')
  if (lines[1] !== '') errors.push(`${file}: expected a blank line after the title`)
  const status = lines[2] ?? ''

  if (lifecycle === 'proposed' && status !== 'Status: proposed') {
    errors.push(`${file}: proposed note must use 'Status: proposed'`)
  } else if (lifecycle === 'implemented' && status !== 'Status: implemented') {
    errors.push(`${file}: implemented note must use 'Status: implemented'`)
  } else if (lifecycle === 'rejected' && !/^Status: rejected — .+/.test(status)) {
    errors.push(`${file}: rejected note must use 'Status: rejected — <reason>'`)
  } else if (lifecycle === 'archived') {
    if (status !== 'Status: implemented') errors.push(`${file}: archived note retains 'Status: implemented'`)
    if (!/^Archived: \d{4}-\d{2}-\d{2}$/m.test(content)) {
      errors.push(`${file}: archived note must contain 'Archived: YYYY-MM-DD'`)
    }
  }
}

function validateSections(file, lifecycle, content) {
  const has = heading => new RegExp(`^## ${escapeRegExp(heading)}$`, 'm').test(content)
  const require = headings => {
    for (const heading of headings) {
      if (!has(heading)) errors.push(`${file}: missing '## ${heading}'`)
    }
  }

  if (lifecycle === 'proposed') {
    require(['Problem', 'Proposal', 'Alternatives considered', 'Acceptance criteria', 'Risks'])
  } else if (lifecycle === 'implemented') {
    require(['Problem', 'Decision', 'Alternatives considered', 'Consequences'])
    for (const forbidden of ['Proposal', 'Acceptance criteria', 'Risks']) {
      if (has(forbidden)) errors.push(`${file}: implemented note must not contain '## ${forbidden}'`)
    }
  } else if (lifecycle === 'rejected') {
    require(['Problem', 'Proposal', 'Alternatives considered'])
  } else if (lifecycle === 'archived') {
    require(['Problem', 'Alternatives considered'])
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path))
    else out.push(path)
  }
  return out
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
