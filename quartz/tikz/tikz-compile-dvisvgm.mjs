#!/usr/bin/env node
/**
 * Compile one TikZ/LaTeX snippet to SVG via real LaTeX + dvisvgm.
 *
 * stdin JSON: { source, options }
 * stdout: SVG string
 *
 * Requires `latex` and `dvisvgm` on PATH (TeX Live).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  augmentToolPath,
  buildStandaloneTex,
  DEFAULT_DVISVGM_ARGS,
  extractTexLog,
  materializeSvgGroupFills,
  resolveDvisvgmArgs,
  svgLooksValid,
} from "./tikz-tex.mjs"

const TEX_JOB = "qztikz"
const LATEX_BIN = process.env.QUARTZ_LATEX_BIN ?? "latex"
const DVISVGM_BIN = process.env.QUARTZ_DVISVGM_BIN ?? "dvisvgm"

/** dvisvgm uses Ghostscript for PostScript specials (pgfplots surf, etc.). */
function toolPath() {
  return augmentToolPath()
}

function requireBinary(name, bin) {
  const probe = spawnSync(bin, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, PATH: toolPath() },
  })
  if (probe.error?.code === "ENOENT" || probe.status === 127) {
    throw new Error(
      `${bin} not found. Install TeX Live (latex + dvisvgm). ` +
        "See docs/TIKZ-DVISVGM-PLAN.md § 本地环境.",
    )
  }
}

function runStep(label, bin, args, { cwd, timeout = 120_000 } = {}) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout,
    env: { ...process.env, PATH: toolPath() },
  })
  if (process.env.TIKZ_DEBUG === "1") {
    console.error(`\n=== ${label} ===`)
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
  }
  return result
}

function compileToSvg(source, options = {}) {
  requireBinary("latex", LATEX_BIN)
  requireBinary("dvisvgm", DVISVGM_BIN)

  const fullTex = buildStandaloneTex(source, options)
  const workDir = mkdtempSync(path.join(tmpdir(), "qztikz-"))
  const texPath = path.join(workDir, `${TEX_JOB}.tex`)
  const dviPath = path.join(workDir, `${TEX_JOB}.dvi`)
  const svgPath = path.join(workDir, `${TEX_JOB}.svg`)
  const logPath = path.join(workDir, `${TEX_JOB}.log`)

  try {
    writeFileSync(texPath, fullTex, "utf8")

    const latex = runStep("latex", LATEX_BIN, [
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      `${TEX_JOB}.tex`,
    ], { cwd: workDir })

    const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
    if (latex.status !== 0 || !existsSync(dviPath)) {
      throw new Error(extractTexLog(latex.stdout, latex.stderr, logText))
    }

    const is3d = /\\addplot3|surf|\\tdplot/i.test(source)
    const dvisvgmArgs = [
      ...resolveDvisvgmArgs(options.dvisvgmArgs ?? DEFAULT_DVISVGM_ARGS, { is3d }),
      "-o",
      svgPath,
      dviPath,
    ]
    const dvisvgm = runStep("dvisvgm", DVISVGM_BIN, dvisvgmArgs, { cwd: workDir, timeout: 60_000 })

    if (dvisvgm.status !== 0 || !existsSync(svgPath)) {
      throw new Error(extractTexLog(dvisvgm.stdout, dvisvgm.stderr, logText))
    }

    const rawSvg = readFileSync(svgPath, "utf8")
    const svg = materializeSvgGroupFills(rawSvg)
    if (!svgLooksValid(svg)) {
      throw new Error(`dvisvgm produced invalid SVG output\n${extractTexLog("", dvisvgm.stderr, logText)}`)
    }
    return svg
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function main() {
  const payload = JSON.parse(readFileSync(0, "utf8"))
  const options = payload.options ?? {}
  if (options.showConsole) process.env.TIKZ_DEBUG = "1"

  const svg = compileToSvg(payload.source, options)
  process.stdout.write(svg)
}

try {
  main()
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(message)
  process.exit(1)
}
