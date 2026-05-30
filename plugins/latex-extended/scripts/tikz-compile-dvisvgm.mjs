#!/usr/bin/env node
/**
 * Compile one TikZ .tex file to SVG (latex + dvisvgm).
 *
 * usage: tikz-compile-dvisvgm.mjs <file.tex> [dvisvgm|inkscape] [latexArgs...]
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import {
  augmentToolPath,
  DEFAULT_DVISVGM_ARGS,
  resolveDvisvgmArgs,
} from "../../../quartz/tikz/tikz-tex.mjs"

const [texFile, converter = "dvisvgm", ...latexArgs] = process.argv.slice(2)

if (!texFile) {
  console.error("usage: tikz-compile-dvisvgm.mjs <file.tex> [dvisvgm|inkscape] [latexArgs...]")
  process.exit(2)
}

const cwd = path.dirname(texFile)
const base = path.basename(texFile, ".tex")
const env = { ...process.env, PATH: augmentToolPath() }

function fail(message, detail) {
  console.error(message)
  if (detail) console.error(detail)
  process.exit(1)
}

function readTexSource() {
  return fs.readFileSync(texFile, "utf8")
}

try {
  if (converter === "dvisvgm") {
    execFileSync(
      "latex",
      ["-interaction=nonstopmode", "-halt-on-error", ...latexArgs, `${base}.tex`],
      { cwd, encoding: "utf8", env },
    )
    const source = readTexSource()
    const is3d = /\\addplot3|surf|\\tdplot/i.test(source)
    const dvisvgmArgs = [
      ...resolveDvisvgmArgs(DEFAULT_DVISVGM_ARGS, { is3d }),
      `${base}.dvi`,
    ]
    const result = spawnSync("dvisvgm", dvisvgmArgs, { cwd, encoding: "utf8", env })
    if (result.status !== 0) {
      fail("dvisvgm failed", `${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    }
  } else {
    execFileSync(
      "pdflatex",
      ["-interaction=nonstopmode", "-halt-on-error", ...latexArgs, `${base}.tex`],
      { cwd, encoding: "utf8", env },
    )
    execFileSync(
      "inkscape",
      ["--export-type=svg", "--export-filename", `${base}.svg`, `${base}.pdf`],
      { cwd, encoding: "utf8", env },
    )
  }

  const svg = path.join(cwd, `${base}.svg`)
  if (!fs.existsSync(svg)) {
    fail(`${converter} did not produce an SVG output`)
  }

  process.stdout.write(svg)
} catch (error) {
  const detail =
    error && typeof error === "object" && "stdout" in error
      ? String(error.stdout || "") + String(error.stderr || "")
      : error instanceof Error
        ? error.message
        : String(error)
  fail("TikZ compile subprocess failed", detail)
}
