import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api, unwrap } from "./api.ts"

export const COLUMNS = [
  { status: "idea", title: "Ideia" },
  { status: "ready", title: "Pronta" },
  { status: "in_progress", title: "Em execução" },
  { status: "review", title: "Revisão" },
  { status: "done", title: "Concluída" },
] as const

export type BoardStatus = (typeof COLUMNS)[number]["status"]
export type Status = BoardStatus | "discarded"

export const STATUS_LABEL: Record<Status, string> = {
  ...(Object.fromEntries(COLUMNS.map((c) => [c.status, c.title])) as Record<BoardStatus, string>),
  discarded: "Descartada",
}

// Splits a URL segment into the project key and, for "PLAT-142", the issue ref.
export function parseRef(segment: string) {
  const match = /^([A-Z][A-Z0-9]{1,9})-[1-9][0-9]*$/.exec(segment)
  return match ? { key: match[1] as string, issueRef: segment } : { key: segment, issueRef: undefined }
}

export type MoveBody = { status: Status; after?: string; before?: string; note?: string }

export function useIssueMutations(key: string) {
  const queryClient = useQueryClient()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["board", key] }),
      queryClient.invalidateQueries({ queryKey: ["issue"] }),
    ])
  const opts = { onSettled: refresh }
  return {
    create: useMutation({
      mutationFn: (title: string) =>
        unwrap(api.projects[":key"].issues.$post({ param: { key }, json: { title } })),
      ...opts,
    }),
    move: useMutation({
      mutationFn: ({ ref, ...json }: MoveBody & { ref: string }) =>
        unwrap(api.issues[":ref"].move.$post({ param: { ref }, json })),
      ...opts,
    }),
    addCriterion: useMutation({
      mutationFn: ({ ref, text }: { ref: string; text: string }) =>
        unwrap(api.issues[":ref"].criteria.$post({ param: { ref }, json: { text } })),
      ...opts,
    }),
    setChecked: useMutation({
      mutationFn: ({ ref, id, checked }: { ref: string; id: number; checked: boolean }) =>
        unwrap(
          api.issues[":ref"].criteria[":id"].$patch({ param: { ref, id: String(id) }, json: { checked } }),
        ),
      ...opts,
    }),
    removeCriterion: useMutation({
      mutationFn: ({ ref, id }: { ref: string; id: number }) =>
        unwrap(api.issues[":ref"].criteria[":id"].$delete({ param: { ref, id: String(id) } })),
      ...opts,
    }),
  }
}
