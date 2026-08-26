import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { TikZ } from "./quartz/plugins/transformers/tikz"
import { PageTypeDispatcher } from "./quartz/plugins/pageTypes"
import HomeDock from "./quartz/components/HomeDock"
import type { FullPageLayout } from "./quartz/cfg"

const config = await loadQuartzConfig()
const transformers = config.plugins.transformers
const tikz = TikZ({ enableTikZ: true })
// TikZ must run before OFM/LaTeX markdown transforms so ```tikz fences stay intact.
transformers.unshift(tikz)

const homeDock = HomeDock()
const layout = await loadQuartzLayout()

function appendHomeDock(partial: Partial<FullPageLayout>) {
  const existing = partial.afterBody ?? []
  if (existing.some((c) => c.displayName === "HomeDock")) return
  partial.afterBody = [...existing, homeDock]
}

appendHomeDock(layout.defaults)
for (const pageLayout of Object.values(layout.byPageType)) {
  appendHomeDock(pageLayout)
}

// loadQuartzConfig() already registered a PageTypeDispatcher without HomeDock.
// Replace it so emit uses the layout that includes the dock.
config.plugins.emitters = config.plugins.emitters.filter((e) => e.name !== "PageTypeDispatcher")
config.plugins.emitters.push(
  PageTypeDispatcher({
    defaults: layout.defaults,
    byPageType: layout.byPageType,
  }),
)

export default config
export { layout }
