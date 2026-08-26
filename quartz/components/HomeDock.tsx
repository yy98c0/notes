import { FullSlug, joinSegments, pathToRoot } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import style from "./styles/home-dock.scss"

export interface HomeDockOptions {
  /** Target URL for the splash homepage */
  href?: string
  /** Accessible label */
  label?: string
}

const DEFAULT_HREF = "https://bigy.cc/home/"
const DEFAULT_LABEL = "返回首页"

export default ((opts?: HomeDockOptions) => {
  const href = opts?.href ?? DEFAULT_HREF
  const label = opts?.label ?? DEFAULT_LABEL

  const HomeDock: QuartzComponent = ({ cfg, fileData }: QuartzComponentProps) => {
    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const iconPath = joinSegments(baseDir, "static/home-icon.svg")

    return (
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
    )
  }

  HomeDock.css = style
  HomeDock.displayName = "HomeDock"
  return HomeDock
}) satisfies QuartzComponentConstructor<HomeDockOptions | undefined>
