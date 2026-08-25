#!/usr/bin/env node
import { main } from './cli.js'

void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ error: { code: 'command-failed', message: error instanceof Error ? error.message : String(error) } })}\n`)
  process.exitCode = 1
})
