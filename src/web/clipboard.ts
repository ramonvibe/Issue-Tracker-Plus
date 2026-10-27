import { ApiError, api } from "./api.ts"

async function fetchContext(ref: string) {
  const res = await api.issues[":ref"].context.$get({ param: { ref } })
  if (!res.ok) throw new ApiError(res.status, "context", "Não foi possível gerar o contexto")
  return res.text()
}

// Hands the clipboard a promise so the copy keeps the user's keypress activation while the text loads
// (Safari and Chrome require that). Inside the hub iframe the parent must allow `clipboard-write`.
export async function copyContext(ref: string) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const blob = fetchContext(ref).then((text) => new Blob([text], { type: "text/plain" }))
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })])
  } else {
    await navigator.clipboard.writeText(await fetchContext(ref))
  }
}
