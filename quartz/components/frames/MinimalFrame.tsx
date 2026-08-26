import { PageFrame, PageFrameProps } from "./types"

/**
 * Minimal page frame — no sidebars, no header/footer chrome. Only the
 * page body is rendered with a thin wrapper, plus afterBody (e.g. fixed
 * chrome like Home Dock) and the footer for legal/link obligations.
 *
 * Useful for immersive page types like full-screen canvases, kiosks,
 * or custom landing pages that want complete control of the viewport.
 */
export const MinimalFrame: PageFrame = {
  name: "minimal",
  render({
    componentData,
    pageBody: Content,
    afterBody,
    footer: Footer,
  }: PageFrameProps) {
    return (
      <>
        <div class="center minimal">
          <Content {...componentData} />
        </div>
        {afterBody.map((BodyComponent) => (
          <BodyComponent {...componentData} />
        ))}
        <Footer {...componentData} />
      </>
    )
  },
}
