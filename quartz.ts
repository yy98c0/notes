import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { TikZ } from "./quartz/plugins/transformers/tikz"

const config = await loadQuartzConfig()
const transformers = config.plugins.transformers
const tikz = TikZ({ enableTikZ: true })
// TikZ must run before OFM/LaTeX markdown transforms so ```tikz fences stay intact.
transformers.unshift(tikz)
export default config
export const layout = await loadQuartzLayout()
