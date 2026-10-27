# Makeit-Fast

Issue tracker para desenvolvimento com agentes de IA: o humano define critérios e revisa, agentes implementam.
Sucessor do 1984. Stack: React + Vite, Hono (Node 24), PostgreSQL + Drizzle.

## Rodar

```bash
docker compose up --build
```

Abra http://localhost:8080. No primeiro acesso, crie a conta de administrador. As migrações rodam na inicialização.
Para HTTPS (necessário para o iframe em `https://hub.cds.com.br`), defina `BASE_URL=https://...`.

## Desenvolver

```bash
pnpm install
docker compose up -d db   # Postgres em 127.0.0.1:5433
pnpm dev                  # API em :8080 (node --watch) e Vite em :5173
```

| Comando | O quê |
| --- | --- |
| `pnpm lint` | Biome + `tsc` |
| `pnpm test` | Vitest: domínio e API contra Postgres real (banco `makeit_test`, recriado a cada execução) |
| `pnpm e2e` | Playwright contra o build de produção (banco `makeit_e2e`) |
| `pnpm db:generate` | gera migração SQL a partir de `src/server/schema.ts` |

O servidor roda TypeScript direto no Node (type stripping): não há build do backend.
