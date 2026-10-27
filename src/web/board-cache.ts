import type { InferResponseType } from "hono/client"
import type { api } from "./api.ts"
import type { BoardStatus, Status } from "./issues.ts"

export type Board = InferResponseType<(typeof api.projects)[":key"]["board"]["$get"], 200>
export type Card = Board["columns"][BoardStatus][number] & { pending?: boolean }

// Pure, optimistic version of the server's move: same neighbour semantics as POST /move.
export function moveCard(
  board: Board,
  ref: string,
  status: Status,
  at: { after?: string; before?: string } = {},
) {
  let moving: Card | undefined
  const columns = Object.fromEntries(
    Object.entries(board.columns).map(([s, cards]) => [
      s,
      cards.filter((c) => {
        if (c.ref !== ref) return true
        moving = c
        return false
      }),
    ]),
  ) as Board["columns"]
  if (moving && status !== "discarded") {
    const target = columns[status]
    const anchor = target.findIndex((c) => c.ref === (at.after ?? at.before))
    const index = anchor < 0 ? target.length : at.after ? anchor + 1 : anchor
    target.splice(index, 0, moving)
  }
  return { ...board, columns }
}

export function updateCard(board: Board, ref: string, change: (card: Card) => Card) {
  const columns = Object.fromEntries(
    Object.entries(board.columns).map(([s, cards]) => [s, cards.map((c) => (c.ref === ref ? change(c) : c))]),
  ) as Board["columns"]
  return { ...board, columns }
}
