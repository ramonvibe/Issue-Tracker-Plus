import { relations, sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core"

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity()
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export const ROLES = ["admin", "member"] as const

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_uidx").on(sql`lower(${t.email})`),
    check("users_role_check", sql`${t.role} in ('admin', 'member')`),
  ],
)

export const sessions = pgTable("sessions", {
  // SHA-256 hex of the cookie token; the raw token is never stored.
  tokenHash: text("token_hash").primaryKey(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
})

export const apiTokens = pgTable("api_tokens", {
  id: id(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // SHA-256 hex of the bearer token; the token itself is shown once and never stored.
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
})

const tokenRef = () =>
  bigint("token_id", { mode: "number" }).references(() => apiTokens.id, { onDelete: "set null" })

export type WipLimits = Partial<Record<"in_progress" | "review", number>>

export const projects = pgTable(
  "projects",
  {
    id: id(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    repoFullName: text("repo_full_name"),
    wipLimits: jsonb("wip_limits").$type<WipLimits>().notNull().default({ in_progress: 3, review: 2 }),
    nextIssueNumber: integer("next_issue_number").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [check("projects_key_check", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`)],
)

export const STATUSES = ["idea", "ready", "in_progress", "review", "done", "discarded"] as const
export type Status = (typeof STATUSES)[number]

// Fractional-indexing keys compare by byte order; the default collation would sort "a" and "B" wrongly.
const byteText = customType<{ data: string }>({ dataType: () => 'text collate "C"' })
const timestampOrNull = (name: string) => timestamp(name, { withTimezone: true })

export const issues = pgTable(
  "issues",
  {
    id: id(),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    contextFiles: text("context_files").array().notNull().default([]),
    status: text("status", { enum: STATUSES }).notNull().default("idea"),
    position: byteText("position").notNull(),
    branch: text("branch"),
    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
    prState: text("pr_state"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestampOrNull("ready_at"),
    startedAt: timestampOrNull("started_at"),
    reviewAt: timestampOrNull("review_at"),
    doneAt: timestampOrNull("done_at"),
  },
  (t) => [
    unique("issues_project_number_unique").on(t.projectId, t.number),
    index("issues_board_idx").on(t.projectId, t.status, t.position),
    check("issues_title_check", sql`length(trim(${t.title})) between 1 and 240`),
    check(
      "issues_status_check",
      sql`${t.status} in ('idea', 'ready', 'in_progress', 'review', 'done', 'discarded')`,
    ),
  ],
)

export const acceptanceCriteria = pgTable(
  "acceptance_criteria",
  {
    id: id(),
    issueId: bigint("issue_id", { mode: "number" })
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    testRef: text("test_ref"),
    checked: boolean("checked").notNull().default(false),
  },
  (t) => [
    index("acceptance_criteria_issue_idx").on(t.issueId),
    check("acceptance_criteria_text_check", sql`length(trim(${t.text})) between 1 and 500`),
  ],
)

export const comments = pgTable(
  "comments",
  {
    id: id(),
    issueId: bigint("issue_id", { mode: "number" })
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    // Null when an agent wrote it through an API token; then tokenId says which one.
    authorId: bigint("author_id", { mode: "number" }).references(() => users.id, { onDelete: "set null" }),
    tokenId: tokenRef(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("comments_issue_idx").on(t.issueId, t.createdAt),
    check("comments_body_check", sql`length(trim(${t.body})) between 1 and 10000`),
  ],
)

export const issueEvents = pgTable(
  "issue_events",
  {
    id: id(),
    issueId: bigint("issue_id", { mode: "number" })
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    actorId: bigint("actor_id", { mode: "number" }).references(() => users.id, { onDelete: "set null" }),
    tokenId: tokenRef(),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("issue_events_issue_idx").on(t.issueId, t.createdAt)],
)

export const issueRelations = relations(issues, ({ many }) => ({
  criteria: many(acceptanceCriteria),
  comments: many(comments),
  events: many(issueEvents),
}))
export const criteriaRelations = relations(acceptanceCriteria, ({ one }) => ({
  issue: one(issues, { fields: [acceptanceCriteria.issueId], references: [issues.id] }),
}))
export const commentRelations = relations(comments, ({ one }) => ({
  issue: one(issues, { fields: [comments.issueId], references: [issues.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  token: one(apiTokens, { fields: [comments.tokenId], references: [apiTokens.id] }),
}))
export const eventRelations = relations(issueEvents, ({ one }) => ({
  issue: one(issues, { fields: [issueEvents.issueId], references: [issues.id] }),
  actor: one(users, { fields: [issueEvents.actorId], references: [users.id] }),
  token: one(apiTokens, { fields: [issueEvents.tokenId], references: [apiTokens.id] }),
}))
