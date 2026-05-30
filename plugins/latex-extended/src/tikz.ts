import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export type SvgConverter = "dvisvgm" | "inkscape"

export interface TikzRenderOptions {
  svgConverter: SvgConverter
  latexArgs: string[]
  cacheDir?: string
}

type RenderTarget = SvgConverter

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const COMPILE_SCRIPT = path.join(PACKAGE_ROOT, "scripts", "tikz-compile-dvisvgm.mjs")
const DEFAULT_CACHE_DIR = path.join(process.cwd(), ".quartz", "tikz-cache")

const PGF_PLOTS_COMPAT = String.raw`\pgfplotsset{compat=1.18}`

const PACKAGE_RULES: Array<{ test: RegExp; line: string }> = [
  { test: /\\begin\{tikzcd\}/, line: "\\usepackage{tikz-cd}" },
  {
    test: /\\begin\{axis\}|\\addplot|\\pgfplotsset/,
    line: "\\usepackage{pgfplots}",
  },
  { test: /\\begin\{circuitikz\}/, line: "\\usepackage{circuitikz}" },
  { test: /\\begin\{pgfpicture\}/, line: "\\usepackage{pgf}" },
]

function debug(...args: unknown[]) {
  if (process.env.TIKZ_DEBUG) {
    console.log("[tikz]", ...args)
  }
}

function hasCommand(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function splitTikzSource(code: string): { preamble: string; body: string } {
  const trimmed = code.trim()
  const docStart = trimmed.indexOf("\\begin{document}")

  if (docStart !== -1) {
    const preamble = trimmed.slice(0, docStart).trim()
    const afterDoc = trimmed.slice(docStart + "\\begin{document}".length)
    const docEnd = afterDoc.lastIndexOf("\\end{document}")
    const body = (docEnd !== -1 ? afterDoc.slice(0, docEnd) : afterDoc).trim()
    return { preamble, body }
  }

  const preambleLines: string[] = []
  const bodyLines: string[] = []

  for (const line of trimmed.split("\n")) {
    const t = line.trim()
    if (
      t.startsWith("\\usepackage") ||
      t.startsWith("\\usetikzlibrary") ||
      t.startsWith("\\pgfplotsset") ||
      (t.startsWith("%") && bodyLines.length === 0)
    ) {
      preambleLines.push(line)
    } else {
      bodyLines.push(line)
    }
  }

  const body = bodyLines.join("\n").trim()
  return {
    preamble: preambleLines.join("\n").trim(),
    body: body || trimmed,
  }
}

export function inferPackages(preamble: string, body: string): string {
  const src = `${preamble}\n${body}`
  const existing = new Set(
    [...src.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].map((match) => match[1]),
  )
  const inferred: string[] = []

  for (const rule of PACKAGE_RULES) {
    if (!rule.test.test(src)) continue
    const pkg = rule.line.match(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/)?.[1]
    if (pkg && existing.has(pkg)) continue
    inferred.push(rule.line)
  }

  return inferred.join("\n")
}

function cleanTikzInput(code: string): string {
  return code
    .replace(/\u00a0/g, " ")
    .replace(/\u2002/g, " ")
    .replace(/\u2003/g, " ")
    .replace(/\u3000/g, " ")
    .replace(/\r\n/g, "\n")
}

export function normalizeTikzSource(code: string): { preamble: string; body: string } {
  const cleaned = cleanTikzInput(code)
  const { preamble, body } = splitTikzSource(cleaned)
  const inferred = inferPackages(preamble, body)
  const src = `${preamble}\n${body}\n${inferred}`
  const compat =
    /\\begin\{axis\}|\\addplot|\\addplot3|surf/i.test(src) && !/\\pgfplotsset\b/.test(src)
      ? PGF_PLOTS_COMPAT
      : ""
  const mergedPreamble = [preamble, inferred, compat].filter(Boolean).join("\n").trim()
  return { preamble: mergedPreamble, body }
}

function tikzDocument(preamble: string, body: string): string {
  return String.raw`\documentclass[tikz,border=2pt]{standalone}
\usepackage{tikz}
\usepackage{amsmath}
\usepackage{amssymb}
${preamble}
\begin{document}
${body}
\end{document}
`
}

function cacheKey(code: string, opts: TikzRenderOptions): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ code, svgConverter: opts.svgConverter, latexArgs: opts.latexArgs }))
    .digest("hex")
    .slice(0, 24)
}

function readCache(cacheDir: string, key: string): string | null {
  const file = path.join(cacheDir, `${key}.svg`)
  if (!fs.existsSync(file)) return null
  debug("cache hit", key)
  return fs.readFileSync(file, "utf8")
}

function writeCache(cacheDir: string, key: string, svg: string): void {
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(path.join(cacheDir, `${key}.svg`), svg, "utf8")
  debug("cache write", key)
}

function compileInSubprocess(
  texFile: string,
  converter: RenderTarget,
  latexArgs: string[],
): string {
  const result = spawnSync(process.execPath, [COMPILE_SCRIPT, texFile, converter, ...latexArgs], {
    encoding: "utf8",
    timeout: 120_000,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
    throw new Error(detail || "TikZ compile subprocess failed")
  }

  const svgPath = result.stdout.trim()
  if (!svgPath || !fs.existsSync(svgPath)) {
    throw new Error("TikZ compile subprocess did not return an SVG path")
  }

  return fs.readFileSync(svgPath, "utf8")
}

export function renderTikz(code: string, opts: TikzRenderOptions): string {
  const converter =
    opts.svgConverter === "inkscape" && hasCommand("inkscape") ? "inkscape" : "dvisvgm"

  if (converter === "dvisvgm") {
    if (!hasCommand("latex")) {
      throw new Error("TikZ rendering requires latex to be installed")
    }
    if (!hasCommand("dvisvgm")) {
      throw new Error("TikZ rendering requires dvisvgm or inkscape to be installed")
    }
  } else if (!hasCommand("pdflatex") || !hasCommand("inkscape")) {
    throw new Error("TikZ rendering requires pdflatex and inkscape to be installed")
  }

  const normalized = normalizeTikzSource(code)
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR
  const key = cacheKey(`${normalized.preamble}\n${normalized.body}`, opts)
  const cached = readCache(cacheDir, key)
  if (cached) return cached

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quartz-tikz-"))
  const texFile = path.join(tempDir, "diagram.tex")
  fs.writeFileSync(texFile, tikzDocument(normalized.preamble, normalized.body), "utf8")

  try {
    debug("compile", { converter, key })
    const svg = compileInSubprocess(texFile, converter, opts.latexArgs)
    writeCache(cacheDir, key, svg)
    return svg
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export function wrapTikzSvg(svg: string): string {
  return `<figure class="tikz-diagram">${svg}</figure>`
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
