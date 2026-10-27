import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { InferResponseType } from "hono/client"
import { api, unwrap } from "./api.ts"
import { type Board, type Card, moveCard, updateCard } from "./board-cache.ts"

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

type Issue = InferResponseType<(typeof api.issues)[":ref"]["$get"], 200>
type Snapshot = { board?: Board; issue?: Issue }

// Every mutation applies its effect to the cache first (well under 100 ms), rolls back if the server
// refuses, and refetches afterwards so the cache converges on the server's truth.
export function useIssueMutations(key: string) {
  const queryClient = useQueryClient()
  const boardKey = ["board", key]

  const optimistic = async (
    ref: string | undefined,
    apply: { board?: (b: Board) => Board; issue?: (i: Issue) => Issue },
  ) => {
    await queryClient.cancelQueries({ queryKey: boardKey })
    if (ref) await queryClient.cancelQueries({ queryKey: ["issue", ref] })
    const snapshot: Snapshot = {
      board: queryClient.getQueryData<Board>(boardKey),
      issue: ref ? queryClient.getQueryData<Issue>(["issue", ref]) : undefined,
    }
    if (apply.board && snapshot.board) queryClient.setQueryData(boardKey, apply.board(snapshot.board))
    if (ref && apply.issue && snapshot.issue)
      queryClient.setQueryData(["issue", ref], apply.issue(snapshot.issue))
    return snapshot
  }
  const rollback = (ref: string | undefined, snapshot: Snapshot | undefined) => {
    if (snapshot?.board) queryClient.setQueryData(boardKey, snapshot.board)
    if (ref && snapshot?.issue) queryClient.setQueryData(["issue", ref], snapshot.issue)
  }
  const refresh = (ref?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: boardKey }),
      ref && queryClient.invalidateQueries({ queryKey: ["issue", ref] }),
    ])
  const counts = (delta: { total?: number; checked?: number }) => (c: Card) => ({
    ...c,
    criteriaTotal: c.criteriaTotal + (delta.total ?? 0),
    criteriaChecked: c.criteriaChecked + (delta.checked ?? 0),
  })
  let tempId = -1

  return {
    create: useMutation({
      mutationFn: (title: string) =>
        unwrap(api.projects[":key"].issues.$post({ param: { key }, json: { title } })),
      onMutate: (title) =>
        optimistic(undefined, {
          board: (b) => ({
            ...b,
            columns: {
              ...b.columns,
              idea: [
                {
                  ref: `tmp${tempId--}`,
                  number: 0,
                  title,
                  position: "",
                  criteriaTotal: 0,
                  criteriaChecked: 0,
                  pending: true,
                },
                ...b.columns.idea,
              ],
            },
          }),
        }),
      onError: (_e, _v, snapshot) => rollback(undefined, snapshot),
      onSettled: () => refresh(),
    }),
    move: useMutation({
      mutationFn: ({ ref, ...json }: MoveBody & { ref: string }) =>
        unwrap(api.issues[":ref"].move.$post({ param: { ref }, json })),
      onMutate: ({ ref, status, after, before }) =>
        optimistic(ref, {
          board: (b) => moveCard(b, ref, status, { after, before }),
          issue: (i) => ({ ...i, status }),
        }),
      onError: (_e, { ref }, snapshot) => rollback(ref, snapshot),
      onSettled: (_d, _e, { ref }) => refresh(ref),
    }),
    addCriterion: useMutation({
      mutationFn: ({ ref, text }: { ref: string; text: string }) =>
        unwrap(api.issues[":ref"].criteria.$post({ param: { ref }, json: { text } })),
      onMutate: ({ ref, text }) =>
        optimistic(ref, {
          board: (b) => updateCard(b, ref, counts({ total: 1 })),
          issue: (i) => ({
            ...i,
            criteria: [...i.criteria, { id: tempId--, issueId: i.id, text, testRef: null, checked: false }],
          }),
        }),
      onError: (_e, { ref }, snapshot) => rollback(ref, snapshot),
      onSettled: (_d, _e, { ref }) => refresh(ref),
    }),
    setChecked: useMutation({
      mutationFn: ({ ref, id, checked }: { ref: string; id: number; checked: boolean }) =>
        unwrap(
          api.issues[":ref"].criteria[":id"].$patch({ param: { ref, id: String(id) }, json: { checked } }),
        ),
      onMutate: ({ ref, id, checked }) =>
        optimistic(ref, {
          board: (b) => updateCard(b, ref, counts({ checked: checked ? 1 : -1 })),
          issue: (i) => ({ ...i, criteria: i.criteria.map((c) => (c.id === id ? { ...c, checked } : c)) }),
        }),
      onError: (_e, { ref }, snapshot) => rollback(ref, snapshot),
      onSettled: (_d, _e, { ref }) => refresh(ref),
    }),
    removeCriterion: useMutation({
      mutationFn: ({ ref, id }: { ref: string; id: number }) =>
        unwrap(api.issues[":ref"].criteria[":id"].$delete({ param: { ref, id: String(id) } })),
      onMutate: ({ ref, id }) => {
        const removed = queryClient.getQueryData<Issue>(["issue", ref])?.criteria.find((c) => c.id === id)
        return optimistic(ref, {
          board: (b) => updateCard(b, ref, counts({ total: -1, checked: removed?.checked ? -1 : 0 })),
          issue: (i) => ({ ...i, criteria: i.criteria.filter((c) => c.id !== id) }),
        })
      },
      onError: (_e, { ref }, snapshot) => rollback(ref, snapshot),
      onSettled: (_d, _e, { ref }) => refresh(ref),
    }),
    update: useMutation({
      mutationFn: ({
        ref,
        ...json
      }: {
        ref: string
        title?: string
        description?: string
        contextFiles?: string[]
      }) => unwrap(api.issues[":ref"].$patch({ param: { ref }, json })),
      onMutate: ({ ref, ...patch }) =>
        optimistic(ref, {
          board: (b) => updateCard(b, ref, (c) => ({ ...c, title: patch.title ?? c.title })),
          issue: (i) => ({ ...i, ...patch }),
        }),
      onError: (_e, { ref }, snapshot) => rollback(ref, snapshot),
      onSettled: (_d, _e, { ref }) => refresh(ref),
    }),
    comment: useMutation({
      mutationFn: ({ ref, body }: { ref: string; body: string }) =>
        unwrap(api.issues[":ref"].comments.$post({ param: { ref }, json: { body } })),
      onMutate: ({ ref, body }) => {
        const me = queryClient.getQueryData<{ id: number; name: string }>(["me"])
        return optimistic(ref, {
          issue: (i) => ({
            ...i,
            comments: [
              ...i.comments,
              {
                id: tempId--,
                issueId: i.id,
                authorId: me?.id ?? null,
                tokenId: null,
                token: null,
                body,
                createdAt: new Date().toISOString(),
                author: me ? { id: me.id, name: me.name } : null,
              },
            ],
          }),
        })
      },
      onError: (_e, { ref }, snapshot) => rollback(ref, snapshot),
      onSettled: (_d, _e, { ref }) => refresh(ref),
    }),
    linkPr: useMutation({
      mutationFn: ({ ref, ...json }: { ref: string; branch?: string; prUrl?: string }) =>
        unwrap(api.issues[":ref"].pr.$put({ param: { ref }, json })),
      onMutate: ({ ref, branch, prUrl }) =>
        optimistic(ref, {
          issue: (i) => ({ ...i, branch: branch ?? i.branch, prUrl: prUrl ?? i.prUrl }),
        }),
      onError: (_e, { ref }, snapshot) => rollback(ref, snapshot),
      onSettled: (_d, _e, { ref }) => refresh(ref),
    }),
    setWipLimits: useMutation({
      mutationFn: (wipLimits: { in_progress?: number | null; review?: number | null }) =>
        unwrap(api.projects[":key"].$patch({ param: { key }, json: { wipLimits } })),
      onSettled: () => refresh(),
    }),
  }
}
