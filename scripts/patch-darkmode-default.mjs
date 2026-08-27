#!/usr/bin/env node
/**
 * Force Quartz darkmode default to "dark" when localStorage has no theme.
 * Official plugin follows prefers-color-scheme; patch after `quartz plugin install`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const pluginRoot = join(root, ".quartz/plugins/darkmode")

const targets = [
  {
    path: join(pluginRoot, "src/components/scripts/darkmode.inline.ts"),
    from: 'const currentTheme = localStorage.getItem("theme") ?? userPref;',
    to: 'const currentTheme = localStorage.getItem("theme") ?? "dark";',
  },
  {
    path: join(pluginRoot, "dist/components/index.js"),
    from: 'localStorage.getItem("theme")??r',
    to: 'localStorage.getItem("theme")??"dark"',
  },
  {
    path: join(pluginRoot, "dist/index.js"),
    from: 'localStorage.getItem("theme")??r',
    to: 'localStorage.getItem("theme")??"dark"',
  },
]

if (!existsSync(pluginRoot)) {
  console.error("darkmode plugin not found at", pluginRoot)
  console.error("Run: npx quartz plugin install --from-config")
  process.exit(1)
}

let changed = 0
let already = 0
for (const { path, from, to } of targets) {
  if (!existsSync(path)) {
    console.warn("skip (missing):", path)
    continue
  }
  const before = readFileSync(path, "utf8")
  if (before.includes(to) && !before.includes(from)) {
    already++
    console.log("already patched:", path)
    continue
  }
  if (!before.includes(from)) {
    console.error("pattern not found in", path)
    process.exit(1)
  }
  writeFileSync(path, before.replaceAll(from, to))
  changed++
  console.log("patched:", path)
}

console.log(`done: ${changed} changed, ${already} already ok`)
