import { fileURLToPath } from 'node:url'
import { buildApp } from './app.ts'
import { createPool, migrate } from './db.ts'
import { createMailer } from './mail.ts'

const pool = createPool()
await migrate(pool)

const app = buildApp({
  pool,
  sendCode: createMailer(),
  staticDir: fileURLToPath(new URL('../dist', import.meta.url)),
  logger: true,
})

await app.listen({ port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '127.0.0.1' })
