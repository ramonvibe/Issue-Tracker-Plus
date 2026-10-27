import DOMPurify from "dompurify"
import { marked } from "marked"
import { useMemo } from "react"

// Links open in a new tab and never get access to this window.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank")
    node.setAttribute("rel", "noopener noreferrer")
  }
})

// Default export so it can be lazy-loaded: marked + DOMPurify only load when a panel opens.
export default function Markdown({ source }: { source: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: true })),
    [source],
  )
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}
