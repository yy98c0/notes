/**
 * Shared TikZ → standalone LaTeX document builder for the dvisvgm pipeline.
 *
 * Used by quartz/plugins/transformers/tikz.ts (via compile subprocess).
 * Keeps preamble/body splitting in one place.
 */

import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"

/** @typedef {{ texPackages?: Record<string, string>, tikzLibraries?: string, addToPreamble?: string }} BuildOpts */

export const PACKAGE_HINTS = [
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

export const DEFAULT_TIKZ_LIBRARIES =
  "arrows.meta,calc,decorations.markings,decorations.pathreplacing,decorations.pathmorphing,fit,matrix,positioning,quotes,shapes.geometric,shapes.misc"

export const DEFAULT_DVISVGM_ARGS = ["--no-fonts", "--clipjoin", "--bbox=papersize", "--page=1"]

const LIBGS_CANDIDATES = [
  "/opt/homebrew/lib/libgs.dylib",
  "/usr/local/lib/libgs.dylib",
  "/usr/lib/x86_64-linux-gnu/libgs.so.10",
  "/usr/lib/x86_64-linux-gnu/libgs.so",
  "/usr/lib/aarch64-linux-gnu/libgs.so.10",
  "/usr/lib/aarch64-linux-gnu/libgs.so",
  "/usr/lib/libgs.so",
]

let libgsSupportCache

/** @returns {string | null} */
export function resolveLibgsPath() {
  if (process.env.QUARTZ_LIBGS) {
    const custom = process.env.QUARTZ_LIBGS
    return existsSync(custom) ? custom : null
  }
  for (const candidate of LIBGS_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Probe once whether this dvisvgm build accepts `--libgs`. */
export function dvisvgmSupportsLibgs() {
  if (libgsSupportCache !== undefined) return libgsSupportCache
  const lib = resolveLibgsPath()
  if (!lib) {
    libgsSupportCache = false
    return false
  }
  const probe = spawnSync(process.env.QUARTZ_DVISVGM_BIN ?? "dvisvgm", [`--libgs=${lib}`, "--version"], {
    encoding: "utf8",
    env: { ...process.env, PATH: augmentToolPath() },
  })
  const combined = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`
  libgsSupportCache = probe.status === 0 && !/unknown option|unrecognized/i.test(combined)
  return libgsSupportCache
}

/**
 * Final dvisvgm CLI args. Adds `--libgs` when Ghostscript is available and supported.
 * @param {string[]} [base]
 * @param {{ is3d?: boolean }} [opts]
 */
export function resolveDvisvgmArgs(base = DEFAULT_DVISVGM_ARGS, opts = {}) {
  const args = [...base]
  const libgs = resolveLibgsPath()
  const libgsSupported = libgs ? dvisvgmSupportsLibgs() : false
  if (libgsSupported && libgs) {
    args.push(`--libgs=${libgs}`)
  }
  if (opts.is3d) {
    args.push("-O")
  }
  return args
}

/** Ensure latex/dvisvgm resolve on macOS TeX paths and Linux CI (/usr/bin). */
export function augmentToolPath() {
  const extra = ["/usr/bin", "/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin"]
  const parts = (process.env.PATH ?? "").split(":").filter(Boolean)
  return [...extra.filter((p) => !parts.includes(p)), ...parts].join(":")
}

export const TEX_LOG_MARKERS =
  /^!\s|^l\.\d+|^Emergency stop|^Undefined control sequence|^LaTeX Error|^Missing \$|^Runaway argument|^TeX capacity exceeded|^! LaTeX Error/m

export function collapseBlankLines(text) {
  return text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n")
}

export function wrapTikzBody(body) {
  const trimmed = body.trim()
  if (trimmed.includes("\\begin{document}")) return trimmed
  return `\\begin{document}\n${trimmed}\n\\end{document}`
}

export function normaliseTikzSource(source) {
  return collapseBlankLines(
    source
      .replace(/\r\n?/g, "\n")
      .replace(/\\begin\{tikzcd\}(\[[^\]]*\])?\s*\n\s*\n/g, "\\begin{tikzcd}$1\n")
      .replace(/\n[ \t]*\n(\\end\{tikzcd\})/g, "\n$1")
      .replace(/(\\usepackage(?:\[[^\]]*\])?\{[^}]+\})\s*\n\s*\n(\\begin\{document\})/g, "$1\n$2")
      .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ")
      .replace(/\t/g, " "),
  )
}

export function packagesAlreadyInSource(source, packageName) {
  return new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${packageName}\\}`).test(source)
}

export function hasPackageDirective(source, packageName) {
  return new RegExp(`\\\\(?:usepackage|RequirePackage)(?:\\[[^\\]]*\\])?\\{${packageName}\\}`).test(
    source,
  )
}

export function buildTexPackages(source, extra = {}) {
  const out = { ...extra }
  for (const [pkg, pattern] of PACKAGE_HINTS) {
    if (pattern.test(source) && !packagesAlreadyInSource(source, pkg) && !hasPackageDirective(source, pkg)) {
      out[pkg] ??= ""
    }
  }
  return out
}

const PGF_PLOTS_COMPAT = String.raw`\pgfplotsset{compat=1.16}`

/** Auto compat line when pgfplots is used and the snippet does not already set it. */
export function pgfplotsCompatLine(texPackages, source) {
  if (!("pgfplots" in texPackages)) return ""
  if (source.includes(PGF_PLOTS_COMPAT) || /\\pgfplotsset\b/.test(source)) return ""
  return PGF_PLOTS_COMPAT
}

/** Site/block preamble only — compat is appended later in buildStandaloneTex. */
export function preambleForPackages(texPackages, source, base = "") {
  return base.trim()
}

function splitDocument(source) {
  const docBegin = source.indexOf("\\begin{document}")
  if (docBegin === -1) {
    return { preamble: "", body: source.trim() }
  }
  const docEnd = source.lastIndexOf("\\end{document}")
  const preamble = source.slice(0, docBegin).trim()
  const bodyStart = docBegin + "\\begin{document}".length
  const body =
    docEnd > docBegin ? source.slice(bodyStart, docEnd).trim() : source.slice(bodyStart).trim()
  return { preamble, body }
}

function injectDvisvgmDocumentClass(source) {
  return source.replace(/\\documentclass(\[[^\]]*\])?\{([^}]+)\}/, (match, opts, cls) => {
    const options = opts ? opts.slice(1, -1) : ""
    const parts = options
      ? options
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    if (!parts.includes("dvisvgm")) parts.unshift("dvisvgm")
    if (!parts.includes("tikz") && cls === "standalone") parts.push("tikz")
    return `\\documentclass[${parts.join(",")}]{${cls}}`
  })
}

function formatUsepackage(name, opts) {
  return opts ? `\\usepackage[${opts}]{${name}}` : `\\usepackage{${name}}`
}

/**
 * Build a complete standalone .tex file from a normalized ```tikz block body.
 */
export function buildStandaloneTex(normalizedSource, opts = {}) {
  const texPackages = opts.texPackages ?? {}
  const tikzLibraries = opts.tikzLibraries ?? DEFAULT_TIKZ_LIBRARIES
  const addToPreamble = opts.addToPreamble ?? ""

  if (/\\documentclass\b/.test(normalizedSource)) {
    return injectDvisvgmDocumentClass(normalizedSource.trim()) + "\n"
  }

  const { preamble, body } = splitDocument(normalizedSource)
  const context = `${preamble}\n${normalizedSource}`

  const inferredLines = Object.entries(texPackages)
    .filter(([pkg]) => !packagesAlreadyInSource(context, pkg) && !hasPackageDirective(context, pkg))
    .map(([pkg, options]) => formatUsepackage(pkg, options))

  const libraryLine =
    tikzLibraries && !/\\usetikzlibrary\{/.test(context)
      ? `\\usetikzlibrary{${tikzLibraries}}`
      : ""

  const userPreamble = addToPreamble.trim()
  const compatLine = pgfplotsCompatLine(texPackages, `${preamble}\n${normalizedSource}\n${userPreamble}`)
  const header = [
    "\\documentclass[dvisvgm,tikz,border=2pt]{standalone}",
    ...inferredLines,
    libraryLine,
    preamble,
    userPreamble && !preamble.includes(userPreamble) ? userPreamble : "",
    compatLine,
  ]
    .filter(Boolean)
    .join("\n")

  return `${header}\n\\begin{document}\n${body}\n\\end{document}\n`
}

export function extractTexLog(stdout, stderr, logFileContent = "") {
  const combined = [stdout, stderr, logFileContent].filter(Boolean).join("\n").trim()
  const errorLines = combined.split("\n").filter((line) => TEX_LOG_MARKERS.test(line.trim()))
  if (errorLines.length > 0) return errorLines.join("\n")

  const lines = combined.split("\n")
  const texStart = lines.findIndex(
    (line) => line.includes("This is pdfTeX") || line.includes("This is e-TeX") || line.includes("This is LuaTeX"),
  )
  if (texStart >= 0) return lines.slice(texStart).join("\n")

  return combined.slice(-4000)
}

/** dvisvgm may prefix SVG with `<?xml ...?>` and a generator comment. */
export function svgLooksValid(svg) {
  if (typeof svg !== "string") return false
  const trimmed = svg.trimStart()
  if (!/<svg[\s>]/.test(trimmed)) return false
  if (/<pre[^>]*>/.test(svg)) return false
  return true
}

function readSvgAttr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(["'])([^"']*)\\1`, "i"))
  return match?.[2]
}

function patchPathTag(tag, stack) {
  if (/\bfill=/i.test(tag) || /\bstyle=["'][^"']*fill/i.test(tag)) return tag

  const fill = [...stack].reverse().find((frame) => frame.fill)?.fill
  const stroke = [...stack].reverse().find((frame) => frame.stroke)?.stroke
  if (!fill && !stroke) return tag

  const styleParts = []
  if (fill) styleParts.push(`fill:${fill}`)
  if (stroke) styleParts.push(`stroke:${stroke}`)
  const styleDecl = styleParts.join(";")

  let patched = tag
  if (fill && !/\bfill=/i.test(patched)) {
    patched = patched.replace(/^<path\b/i, `<path fill="${fill}"`)
  }
  if (stroke && !/\bstroke=/i.test(patched)) {
    patched = patched.replace(/^<path\b/i, `<path stroke="${stroke}"`)
  }

  if (/\bstyle=(["'])/i.test(patched)) {
    return patched.replace(/\bstyle=(["'])([^"']*)\1/i, (_, quote, existing) => {
      const merged = existing ? `${existing};${styleDecl}` : styleDecl
      return `style=${quote}${merged}${quote}`
    })
  }

  return patched.replace(/^<path\b/i, `<path style="${styleDecl}"`)
}

/**
 * Copy fill/stroke from ancestor &lt;g&gt; onto &lt;path&gt; elements.
 * Chrome mishandles deeply nested group inheritance; inline styles beat site CSS.
 */
const NON_RENDERING_OPEN = /<(defs|clipPath|mask|marker|pattern|symbol)\b/i
const NON_RENDERING_CLOSE = /<\/(defs|clipPath|mask|marker|pattern|symbol)>/i

export function materializeSvgGroupFills(svg) {
  const tagRe = /<\/?(?:g\b[^>]*|path\b[^>]*|defs\b[^>]*|clipPath\b[^>]*|mask\b[^>]*|marker\b[^>]*|pattern\b[^>]*|symbol\b[^>]*|\/(?:defs|clipPath|mask|marker|pattern|symbol))>/gi
  const stack = []
  let nonRenderingDepth = 0
  let out = ""
  let lastIndex = 0

  for (const match of svg.matchAll(tagRe)) {
    const index = match.index ?? 0
    out += svg.slice(lastIndex, index)
    const tag = match[0]

    if (NON_RENDERING_OPEN.test(tag)) {
      nonRenderingDepth += 1
      out += tag
    } else if (NON_RENDERING_CLOSE.test(tag)) {
      nonRenderingDepth = Math.max(0, nonRenderingDepth - 1)
      out += tag
    } else if (/^<\/g>/i.test(tag)) {
      stack.pop()
      out += tag
    } else if (/^<g\b/i.test(tag)) {
      stack.push({
        fill: readSvgAttr(tag, "fill"),
        stroke: readSvgAttr(tag, "stroke"),
      })
      out += tag
    } else if (/^<path\b/i.test(tag)) {
      out += nonRenderingDepth > 0 ? tag : patchPathTag(tag, stack)
    } else {
      out += tag
    }

    lastIndex = index + tag.length
  }

  return out + svg.slice(lastIndex)
}

const CLIP_PATH_ON_G = /\bclip-path\s*=\s*["']url\(#/i

/**
 * Flatten dvisvgm surf output: one &lt;path&gt; per nested &lt;g&gt; chain under clip-path.
 * Chrome skips rendering when clip-path wraps ~300 levels of nested groups (Safari does not).
 */
export function flattenClipPathNestedGroups(svg) {
  const tagRe = /<\/?(?:g\b[^>]*|path\b[^>]*|defs\b[^>]*|clipPath\b[^>]*|mask\b[^>]*|marker\b[^>]*|pattern\b[^>]*|symbol\b[^>]*|\/(?:defs|clipPath|mask|marker|pattern|symbol))>/gi
  let out = ""
  let lastIndex = 0
  let clipDepth = 0
  let clipOpenTag = ""
  const clipPaths = []

  for (const match of svg.matchAll(tagRe)) {
    const index = match.index ?? 0
    const before = svg.slice(lastIndex, index)
    const tag = match[0]

    if (clipDepth === 0) {
      if (/^<g\b/i.test(tag) && CLIP_PATH_ON_G.test(tag)) {
        out += before
        clipOpenTag = tag
        clipDepth = 1
        clipPaths.length = 0
      } else {
        out += before + tag
      }
    } else if (/^<\/g>/i.test(tag)) {
      clipDepth -= 1
      if (clipDepth === 0) {
        out += clipOpenTag + clipPaths.join("") + "</g>"
        clipOpenTag = ""
        clipPaths.length = 0
      }
    } else if (/^<g\b/i.test(tag)) {
      clipDepth += 1
    } else if (/^<path\b/i.test(tag)) {
      clipPaths.push(tag)
    } else {
      clipPaths.push(tag)
    }

    lastIndex = index + tag.length
  }

  if (clipDepth > 0 && clipOpenTag) {
    out += clipOpenTag + clipPaths.join("") + "</g>"
  }

  return out + svg.slice(lastIndex)
}

/**
 * Remove clip-path wrappers after flatten — Chrome still skips large clipped path lists
 * even at depth 1 (Safari renders fine). Surf plots only need axis bounds cosmetically.
 */
export function stripClipPathForChrome(svg) {
  const clipIds = []
  const out = svg.replace(/<g\b([^>]*)>/gi, (full, attrs) => {
    const clipMatch = attrs.match(/\bclip-path\s*=\s*(["'])url\(#([^)]+)\)\1/i)
    if (!clipMatch) return full
    clipIds.push(clipMatch[2])
    const stripped = attrs.replace(/\s*clip-path\s*=\s*(["'])url\(#([^)]+)\)\1/i, "").trim()
    return stripped ? `<g ${stripped}>` : "<g>"
  })
  let cleaned = out
  for (const id of [...new Set(clipIds)]) {
    cleaned = cleaned.replace(
      new RegExp(`<clipPath\\s+id="${id}"[^>]*>[\\s\\S]*?</clipPath>\\s*`, "gi"),
      "",
    )
  }
  return cleaned
}
