import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";

const app = new Hono();

app.use('*', logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.get("/make-server-dfb18bbe/health", (c) => {
  return c.json({ status: "ok" });
});

// GET all annotations
app.get("/make-server-dfb18bbe/annotations", async (c) => {
  const data = await kv.get("agenda-2026-annotations");
  return c.json(data ?? {});
});

// POST (replace) all annotations
app.post("/make-server-dfb18bbe/annotations", async (c) => {
  const body = await c.req.json();
  await kv.set("agenda-2026-annotations", body);
  return c.json({ ok: true });
});

// Add a single annotation to a date
app.post("/make-server-dfb18bbe/annotations/:date", async (c) => {
  const date = c.req.param("date");
  const annotation = await c.req.json();
  const all = (await kv.get("agenda-2026-annotations")) ?? {};
  all[date] = [...(all[date] ?? []), annotation];
  await kv.set("agenda-2026-annotations", all);
  return c.json({ ok: true });
});

// Delete a single annotation
app.delete("/make-server-dfb18bbe/annotations/:date/:id", async (c) => {
  const date = c.req.param("date");
  const id   = c.req.param("id");
  const all  = (await kv.get("agenda-2026-annotations")) ?? {};
  if (all[date]) all[date] = all[date].filter((a: any) => a.id !== id);
  await kv.set("agenda-2026-annotations", all);
  return c.json({ ok: true });
});

Deno.serve(app.fetch);
