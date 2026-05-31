import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { visit } from "unist-util-visit"
import type { Code, Parent, Root } from "mdast"
import type { VFile } from "vfile"
import type { QuartzTransformerPlugin } from "../types"

/** Matches Obsidian ```tikz fences (optional space after backticks). */
const TIKZ_FENCE_RE = /```\s*tikz\n([\s\S]*?)```/g

const COMPILE_SCRIPT = path.join(process.cwd(), "quartz/tikz/tikz-compile-dvisvgm.mjs")

declare module "vfile" {
  interface DataMap {
    quartzTikzBlocks?: string[]
  }
}

/**
 * Replace ```tikz bodies with lightweight stubs before Markdown parsing.
 * The original TikZ source is restored by the TikZ transformer after parsing.
 */
export function isolateTikzFences(file: VFile): string {
  const blocks: string[] = []
  const value = file.value.toString()
  const replaced = value.replace(TIKZ_FENCE_RE, (_match, body: string) => {
    const id = blocks.length
    blocks.push(body.trim())
    return `\n\n\`\`\`quartz-tikz\n${id}\n\`\`\`\n\n`
  })
  file.data.quartzTikzBlocks = blocks
  return replaced
}

const CACHE_DIR = path.join(process.cwd(), ".quartz", "tikz-cache")

/** Bump when SVG post-processing changes (invalidates .quartz/tikz-cache). */
const TIKZ_SVG_CACHE_VERSION = "strip-clip-v1"

interface Options {
  enableTikZ: boolean
  texPackages?: Record<string, string>
  tikzLibraries?: string
  addToPreamble?: string
}

interface CompileOptions {
  texPackages: Record<string, string>
  tikzLibraries: string
  addToPreamble: string
  /** Passed to dvisvgm; default converts glyphs to paths (no web fonts). */
  dvisvgmArgs?: string[]
  showConsole?: boolean
}

const DEFAULT_TIKZ_LIBRARIES =
  "arrows.meta,automata,backgrounds,bending,calc,chains,decorations.markings,decorations.pathmorphing,decorations.pathreplacing,fit,matrix,positioning,quotes,shapes.arrows,shapes.geometric,shapes.misc,trees"

const DEFAULT_DVISVGM_ARGS = ["--no-fonts", "--clipjoin", "--bbox=papersize", "--page=1"]

const DEFAULT_ADD_TO_PREAMBLE = ""
const MAX_ERROR_LENGTH = 8000
const MAX_SOURCE_LENGTH = 50_000
const TEX_LOG_MARKERS =
  /^!\s|^l\.\d+|^Emergency stop|^Undefined control sequence|^LaTeX Error|^Missing \$|^Runaway argument|^TeX capacity exceeded/m

function cacheKey(source: string, opts: CompileOptions): string {
  return createHash("sha256")
    .update(TIKZ_SVG_CACHE_VERSION)
    .update(source)
    .update(JSON.stringify(opts))
    .digest("hex")
}

function readCache(key: string): string | null {
  const file = path.join(CACHE_DIR, `${key}.svg`)
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, "utf-8")
}

function writeCache(key: string, svg: string) {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.svg`), svg, "utf-8")
}

function collapseBlankLines(text: string): string {
  return text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n")
}

/** Align with obsidian-tikzjax: body is usually already wrapped in \\begin{document}...\\end{document}. */
function wrapTikzBody(body: string): string {
  const trimmed = body.trim()
  if (trimmed.includes("\\begin{document}")) return trimmed
  return `\\begin{document}\n${trimmed}\n\\end{document}`
}

function normaliseTikzSource(source: string): string {
  return collapseBlankLines(
    source
      .replace(/\r\n?/g, "\n")
      // tikz-cd: extra blank lines inside/at the end of a diagram break TeX.
      .replace(/\\begin\{tikzcd\}(\[[^\]]*\])?\s*\n\s*\n/g, "\\begin{tikzcd}$1\n")
      .replace(/\n[ \t]*\n(\\end\{tikzcd\})/g, "\n$1")
      .replace(/(\\usepackage(?:\[[^\]]*\])?\{[^}]+\})\s*\n\s*\n(\\begin\{document\})/g, "$1\n$2")
      // Remove invisible characters that commonly sneak into copied Markdown/TikZ.
      .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ")
      // Normalize tab characters only; do not rewrite TeX commands or math semantics.
      .replace(/\t/g, " ")
  )
}

function packagesAlreadyInSource(source: string, packageName: string): boolean {
  return new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${packageName}\\}`).test(source)
}

function hasPackageDirective(source: string, packageName: string): boolean {
  return new RegExp(`\\\\(?:usepackage|RequirePackage)(?:\\[[^\\]]*\\])?\\{${packageName}\\}`).test(source)
}

/** Load only packages the snippet needs — keep preambles minimal for faster compiles. */
const PACKAGE_HINTS: ReadonlyArray<readonly [string, RegExp]> = [
  ["tikz-cd", /\\begin\{tikzcd\}/],
  ["chemfig", /\\chemfig\b/],
  ["pgfplots", /\\begin\{axis\}|\\addplot\d*/],
  ["circuitikz", /\\begin\{circuitikz\}/],
  ["tikz-3dplot", /\\tdplot\w+/],
  ["amsmath", /\\begin\{(?:align|equation|gather|multline)\*?\}|\\operatorname\b|\\boldsymbol\b/],
  ["amssymb", /\\mathbb\b|\\varnothing\b/],
  ["amsfonts", /\\mathfrak\b/],
  ["xcolor", /\\definecolor\b|\\color\b|\\textcolor\b/],
  ["array", /\\begin\{array\}/],
]

function buildTexPackages(source: string, extra?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...(extra ?? {}) }
  for (const [pkg, pattern] of PACKAGE_HINTS) {
    if (pattern.test(source) && !packagesAlreadyInSource(source, pkg) && !hasPackageDirective(source, pkg)) {
      out[pkg] ??= ""
    }
  }
  return out
}

/** Site preamble only; `\pgfplotsset` is added in the compile subprocess (tikz-tex.mjs). */
function preambleForPackages(_texPackages: Record<string, string>, _source: string, base: string): string {
  return base.trim()
}

function extractTexLog(stdout: string, stderr: string): string {
  const combined = `${stdout}\n${stderr}`.trim()
  const errorLines = combined
    .split("\n")
    .filter((line) => TEX_LOG_MARKERS.test(line.trim()))
  if (errorLines.length > 0) return errorLines.join("\n")

  const lines = combined.split("\n")
  const texStart = lines.findIndex(
    (line) =>
      line.includes("This is pdfTeX") ||
      line.includes("This is e-TeX") ||
      line.includes("This is LuaTeX"),
  )
  if (texStart >= 0) return lines.slice(texStart).join("\n")

  return combined
}

function svgLooksBroken(svg: string): boolean {
  const trimmed = svg.trimStart()
  // dvisvgm may prefix SVG with <?xml ...?> and a generator comment
  if (!/<svg[\s>]/.test(trimmed)) return true
  return /TeX capacity exceeded|! (?:LaTeX Error|Package|Undefined control sequence|Missing \$|Emergency stop|Runaway argument)/.test(
    svg,
  )
}

function isTikzCodeBlock(lang: string | null | undefined): boolean {
  const normalized = (lang ?? "").trim().toLowerCase()
  return normalized === "tikz" || normalized === "quartz-tikz"
}

function resolveTikzSource(node: Code, file: VFile): string {
  const lang = (node.lang ?? "").trim().toLowerCase()
  if (lang === "quartz-tikz") {
    const id = Number.parseInt(node.value.trim(), 10)
    const blocks = file.data.quartzTikzBlocks
    if (blocks && Number.isFinite(id) && blocks[id] !== undefined) {
      return blocks[id]
    }
    throw new Error(`Missing TikZ block #${node.value.trim()}`)
  }
  return node.value
}

function sanitizeCompileSource(source: string): string {
  const wrapped = source.includes("\\begin{document}") ? source : wrapTikzBody(source)
  const normalized = normaliseTikzSource(wrapped)
  return normalized.slice(0, MAX_SOURCE_LENGTH)
}

/** Each diagram in its own process — same idea as Obsidian's isolated TikZJax runs. */
function compileTikzToSvg(source: string, options: CompileOptions): string {
  const payload = JSON.stringify({ source, options })
  const pathExtra = ["/usr/bin", "/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin"]
  const pathParts = (process.env.PATH ?? "").split(":").filter(Boolean)
  const pathEnv = [...pathExtra.filter((p) => !pathParts.includes(p)), ...pathParts].join(":")

  const result = spawnSync(process.execPath, [COMPILE_SCRIPT], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
    env: { ...process.env, PATH: pathEnv },
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = extractTexLog(result.stdout ?? "", result.stderr ?? "unknown error")
    throw new Error(detail.slice(0, MAX_ERROR_LENGTH))
  }

  const svg = result.stdout ?? ""
  if (svgLooksBroken(svg)) {
    throw new Error(extractTexLog(svg, result.stderr ?? "").slice(0, MAX_ERROR_LENGTH))
  }
  return svg
}

function compileErrorMessage(message: string): string {
  return message.replace(/</g, "&lt;").slice(0, MAX_ERROR_LENGTH)
}

export const TikZ: QuartzTransformerPlugin<Options> = (opts) => {
  const enableTikZ = opts?.enableTikZ ?? true
  const extraPackages = opts?.texPackages ?? {}
  const tikzLibraries = opts?.tikzLibraries ?? DEFAULT_TIKZ_LIBRARIES
  const addToPreamble = opts?.addToPreamble ?? DEFAULT_ADD_TO_PREAMBLE

  return {
    name: "TikZ",
    markdownPlugins() {
      return [
        () => {
          return async (tree: Root, file: VFile) => {
            if (!enableTikZ) return

            const jobs: { node: Code; index: number; parent: Parent }[] = []

            visit(tree, "code", (node: Code, index, parent) => {
              if (!isTikzCodeBlock(node.lang) || !parent || index === undefined) return
              jobs.push({ node, index, parent })
            })

            for (const { node, index, parent } of jobs) {
              const raw = resolveTikzSource(node, file)
              const source = sanitizeCompileSource(raw)
              const texPackages = buildTexPackages(source, extraPackages)
              const compileOpts: CompileOptions = {
                texPackages,
                tikzLibraries,
                addToPreamble: preambleForPackages(texPackages, source, addToPreamble),
                dvisvgmArgs: DEFAULT_DVISVGM_ARGS,
                showConsole: process.env.TIKZ_DEBUG === "1",
              }
              const key = cacheKey(source, compileOpts)

              try {
                let svg = readCache(key)
                if (!svg || svgLooksBroken(svg)) {
                  svg = compileTikzToSvg(source, compileOpts)
                  if (svgLooksBroken(svg)) {
                    throw new Error("TeX reported errors in SVG output")
                  }
                  writeCache(key, svg)
                }
                parent.children[index] = {
                  type: "html",
                  value: `<figure class="tikz-output">${svg}</figure>`,
                }
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error)
                const slug = (file.data as { slug?: string }).slug ?? file.path ?? "?"
                const headline =
                  msg.split("\n").find((line) => /^!\s/.test(line.trim())) ?? msg.split("\n")[0]
                console.error(`[TikZ] ${slug} block ${index}: ${headline}`)
                if (process.env.TIKZ_DEBUG === "1" && msg.includes("\n")) {
                  console.error(msg)
                }
                parent.children[index] = {
                  type: "html",
                  value: `<!-- TikZ build error --><pre class="tikz-error">TikZ 渲染失败: ${compileErrorMessage(msg)}</pre>`,
                }
              }
            }
          }
        },
      ]
    },
  }
}
