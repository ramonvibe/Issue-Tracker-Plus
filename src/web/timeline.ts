import { STATUS_LABEL, type Status } from "./issues.ts"

const FIELD_LABEL: Record<string, string> = {
  title: "o título",
  description: "a descrição",
  contextFiles: "os arquivos relevantes",
}
const CRITERIA_ACTION: Record<string, string> = {
  added: "adicionou um critério",
  checked: "marcou um critério",
  unchecked: "desmarcou um critério",
  edited: "editou um critério",
  removed: "removeu um critério",
}

export function describeEvent(kind: string, data: Record<string, unknown>) {
  const label = (s: unknown) => STATUS_LABEL[s as Status] ?? String(s)
  switch (kind) {
    case "created":
      return "criou a issue"
    case "moved":
      return `moveu de ${label(data.from)} para ${label(data.to)}`
    case "rejected":
      return "devolveu para Em execução"
    case "criteria_changed":
      return CRITERIA_ACTION[String(data.action)] ?? "alterou os critérios"
    case "edited":
      return `editou ${((data.fields as string[] | undefined) ?? []).map((f) => FIELD_LABEL[f] ?? f).join(", ")}`
    default:
      return kind
  }
}

const relative = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })
const absolute = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
]

export function ago(iso: string, now = Date.now()) {
  const diff = Date.parse(iso) - now
  if (Math.abs(diff) > 7 * 86_400_000) return absolute.format(new Date(iso))
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relative.format(Math.round(diff / ms), unit)
  }
  return "agora"
}

export const fullDate = (iso: string) => absolute.format(new Date(iso))
