import { execFileSync } from 'node:child_process'

const baseBranch = process.env.GITHUB_BASE_REF || process.env.VERIFY_BASE

if (!baseBranch) {
  console.log('Skipping same-PR Agent Note requirement outside a PR; set VERIFY_BASE to enforce locally.')
  process.exit(0)
}

const baseRef = resolveBase(baseBranch)
const changed = git(['diff', '--name-only', '--diff-filter=AMR', `${baseRef}...HEAD`])
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)

const significant = changed.filter(isSignificant)
if (significant.length === 0) {
  console.log('No mechanically non-trivial files changed; Agent Note gate does not apply.')
  process.exit(0)
}

const noteChanged = changed.some(path => /^\.agents\/notes\/(proposed|implemented|rejected)\/(feature|bug-fix|simplification|architecture|process|testing)\/\d{4}-\d{2}-\d{2}-.+\.md$/.test(path))

if (!noteChanged) {
  console.error('A non-trivial change requires an active Agent Note in the same PR.')
  console.error('Mechanically significant files:')
  for (const path of significant) console.error(`- ${path}`)
  console.error('Add or update a note under .agents/notes/{proposed,implemented,rejected}/<class>/.')
  process.exit(1)
}

console.log(`Agent Note requirement satisfied for ${significant.length} significant changed file${significant.length === 1 ? '' : 's'}.`)

function isSignificant(path) {
  return path.startsWith('src/')
    || path.startsWith('tests/')
    || path.startsWith('scripts/')
    || path.startsWith('.github/workflows/')
    || path === 'package.json'
    || path === 'cordis.patch.yml'
    || path === 'tsconfig.json'
    || path === 'tsdown.config.ts'
}

function resolveBase(branch) {
  const candidates = branch.startsWith('refs/') ? [branch] : [`origin/${branch}`, branch]
  for (const candidate of candidates) {
    try {
      git(['rev-parse', '--verify', candidate])
      return candidate
    } catch {
      // Try the next explicit candidate. A shallow checkout should be fixed by CI, not hidden here.
    }
  }
  console.error(`Cannot resolve base branch '${branch}'. Fetch the base branch or set VERIFY_BASE to a resolvable ref.`)
  process.exit(1)
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
