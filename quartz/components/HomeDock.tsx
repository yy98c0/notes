import { FullSlug, joinSegments, pathToRoot } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/home-dock.scss"

export type TopBarSection = "notes" | "about" | "blog"

export interface TopBarItem {
  id: TopBarSection
  label: string
  href: string
}

export interface HomeDockOptions {
  /** Target URL for the splash homepage */
  href?: string
  /** Accessible label for the home icon */
  label?: string
  /** Which top-bar item is the current section. */
  current?: TopBarSection
  /** Override default Notes / About me / Blog entries. */
  nav?: TopBarItem[]
}

const DEFAULT_HREF = "https://bigy.cc/"
const DEFAULT_LABEL = "返回首页"

/** All sections are clickable; placeholders exist for about / blog connectivity tests. */
const DEFAULT_NAV: TopBarItem[] = [
  { id: "notes", label: "Notes", href: "/notes/" },
  { id: "about", label: "About me", href: "/about/" },
  { id: "blog", label: "Blog", href: "/blog/" },
]

/** Infer current section from a path (/notes/, /about/, /blog/). */
export function sectionFromPath(pathname: string): TopBarSection | null {
  const p = pathname.replace(/\/+$/, "") || "/"
  if (p === "/notes" || p.startsWith("/notes/")) return "notes"
  if (p === "/about" || p.startsWith("/about/") || p === "/about-me" || p.startsWith("/about-me/"))
    return "about"
  if (p === "/blog" || p.startsWith("/blog/")) return "blog"
  return null
}

export default ((opts?: HomeDockOptions) => {
  const href = opts?.href ?? DEFAULT_HREF
  const label = opts?.label ?? DEFAULT_LABEL
  const nav = opts?.nav ?? DEFAULT_NAV
  const forcedCurrent = opts?.current

  const HomeDock: QuartzComponent = ({ cfg, fileData }: QuartzComponentProps) => {
    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const iconPath = joinSegments(baseDir, "static/home-icon.svg")

    // Quartz is the Notes site; default current = notes unless overridden.
    const current: TopBarSection =
      forcedCurrent ?? sectionFromPath(url.pathname) ?? "notes"

    return (
      <header class="bigy-site-chrome" aria-label="站点导航">
        <a
          id="bigy-home-dock"
          class="bigy-home-dock"
          href={href}
          data-router-ignore
          aria-label={label}
          title={label}
        >
          <img
            class="bigy-home-dock__icon"
            src={iconPath}
            alt=""
            width={128}
            height={128}
            draggable={false}
            decoding="async"
          />
        </a>

        <nav class="bigy-top-bar" aria-label="栏目">
          {nav.map((item) => {
            const isCurrent = item.id === current
            const className = ["bigy-top-bar__link", isCurrent ? "is-current" : ""]
              .filter(Boolean)
              .join(" ")

            return (
              <a
                class={className}
                href={item.href}
                data-router-ignore
                aria-current={isCurrent ? "page" : undefined}
              >
                {item.label}
              </a>
            )
          })}
        </nav>
      </header>
    )
  }

  HomeDock.css = style
  HomeDock.displayName = "HomeDock"
  return HomeDock
}) satisfies QuartzComponentConstructor<HomeDockOptions | undefined>
