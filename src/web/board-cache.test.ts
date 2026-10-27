import { describe, expect, test } from "vitest"
import { type Board, moveCard } from "./board-cache.ts"

const card = (ref: string) => ({
  ref,
  number: 0,
  title: ref,
  position: "",
  criteriaTotal: 1,
  criteriaChecked: 0,
})
const board = (): Board =>
  ({
    project: {},
    columns: { idea: [card("A")], ready: [card("B"), card("C")], in_progress: [], review: [], done: [] },
  }) as unknown as Board
const refs = (b: Board) =>
  Object.fromEntries(Object.entries(b.columns).map(([k, v]) => [k, v.map((c) => c.ref)]))

describe("moveCard", () => {
  test("appends to the target column by default and leaves the input untouched", () => {
    const before = board()
    const after = moveCard(before, "A", "ready")
    expect(refs(after)).toMatchObject({ idea: [], ready: ["B", "C", "A"] })
    expect(refs(before)).toMatchObject({ idea: ["A"], ready: ["B", "C"] })
  })

  test("honours after/before neighbours, including reordering inside a column", () => {
    expect(refs(moveCard(board(), "A", "ready", { before: "B" })).ready).toEqual(["A", "B", "C"])
    expect(refs(moveCard(board(), "A", "ready", { after: "B" })).ready).toEqual(["B", "A", "C"])
    expect(refs(moveCard(board(), "C", "ready", { before: "B" })).ready).toEqual(["C", "B"])
  })

  test("discarding removes the card from the board", () => {
    expect(Object.values(refs(moveCard(board(), "A", "discarded"))).flat()).toEqual(["B", "C"])
  })
})
