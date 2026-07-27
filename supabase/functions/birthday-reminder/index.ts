// ============================================================================
// Arete Care — Greetings :: Edge Function (Deno)
//
// Sends a personal 🎂 Happy Birthday greeting TO each employee, ON their birthday.
// Optionally BCCs a "copies" list (e.g. HR) on every greeting.
//
// Jobs:
//   1. CRON       — POST { source:"cron" } + Authorization: Bearer <CRON_SECRET|service_role>
//   2. WRITE      — POST { mode:"write", op, accessCode, payload }        (web UI, gated)
//   3. TEST       — POST { mode:"test", accessCode }                       (preview a greeting)
//   RECIPIENTS    — POST { mode:"recipients", op, accessCode, payload }    (manage BCC copies)
//   verify        — POST { mode:"verify", accessCode } → 200/401           (login gate)
//
// Deploy: supabase functions deploy birthday-reminder --no-verify-jwt
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Login gate — validated against the Task Board `members` table (shared pepper).
const PEPPER = Deno.env.get("ACCESS_CODE_PEPPER") ?? "";
const REQUIRE_ADMIN = (Deno.env.get("BIRTHDAY_REQUIRE_ADMIN") ?? "false").toLowerCase() === "true";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// Microsoft Graph (OAuth client-credentials).
const GRAPH_TENANT_ID = Deno.env.get("GRAPH_TENANT_ID") ?? "";
const GRAPH_CLIENT_ID = Deno.env.get("GRAPH_CLIENT_ID") ?? "";
const GRAPH_CLIENT_SECRET = Deno.env.get("GRAPH_CLIENT_SECRET") ?? "";
const GRAPH_SENDER = Deno.env.get("GRAPH_SENDER") ?? Deno.env.get("SMTP_USER") ?? "";
// Optional BCC copies (e.g. HR) on every greeting; falls back to the TEAM_RECIPIENTS secret.
const TEAM_RECIPIENTS = (Deno.env.get("TEAM_RECIPIENTS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const LOCAL_TZ = Deno.env.get("LOCAL_TZ") ?? "Australia/Melbourne";
const OBSERVE_FEB29_ON = Deno.env.get("OBSERVE_FEB29_ON") ?? "02-28"; // or "03-01"
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Bump this whenever this file changes. A plain GET on the function URL returns
// it, so you can confirm which build is actually deployed instead of guessing.
const FN_VERSION = "2026-07-27-no-hire";

const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const te = new TextEncoder();

// ── Helpers ───────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dupKey = (name: string, date: string) => `${name.trim().toLowerCase()}|${date}`;
const firstNameOf = (full: string) => full.trim().split(/\s+/)[0] || "there";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(message: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", te.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, te.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Member = { id: string; name: string; role: string };
async function checkAccessCode(code: string): Promise<{ ok: boolean; member?: Member }> {
  if (!code) return { ok: false };
  const hash = await hmacHex(code, PEPPER);
  const { data, error } = await supa.from("members").select("id, name, role, active")
    .eq("accessCodeHash", hash).eq("active", true).maybeSingle();
  if (error || !data) return { ok: false };
  if (REQUIRE_ADMIN && data.role !== "admin") return { ok: false };
  return { ok: true, member: { id: data.id, name: data.name, role: data.role } };
}

function corsHeaders(origin: string): Record<string, string> {
  let allow = "*";
  if (ALLOWED_ORIGINS.length) allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  else if (origin) allow = origin;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (obj: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });

function localNow(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), min: g("minute") };
}

// The local time greetings go out — editable from the app's Settings panel.
async function getSendTime(): Promise<{ hour: number; minute: number }> {
  const { data } = await supa.from("app_settings").select("send_hour, send_minute").eq("id", 1).maybeSingle();
  return {
    hour: typeof data?.send_hour === "number" ? data.send_hour : 7,
    minute: typeof data?.send_minute === "number" ? data.send_minute : 0,
  };
}

// Optional copies (BCC), e.g. HR. Falls back to the TEAM_RECIPIENTS secret.
async function copyRecipients(): Promise<string[]> {
  const { data } = await supa.from("recipients").select("email").eq("is_active", true);
  const fromTable = (data ?? []).map((r) => r.email as string).filter(Boolean);
  return fromTable.length ? fromTable : TEAM_RECIPIENTS;
}

// ── Who has a birthday on a given day ────────────────────────────────────────
type Person = {
  id: string; full_name: string; person_email: string | null;
  birth_date: string | null; department: string | null;
};
const PERSON_COLS = "id, full_name, person_email, birth_date, department";

async function peopleBornOn(month: number, day: number, year: number): Promise<Person[]> {
  const { data, error } = await supa.from("birthdays").select(PERSON_COLS).eq("is_active", true).eq("birth_month", month).eq("birth_day", day);
  // Surface DB errors instead of silently reporting "nobody due" (e.g. a missing
  // column because a migration hasn't been run).
  if (error) throw new Error(`birthday lookup failed: ${error.message}. Have you run 01_schema.sql?`);
  let people: Person[] = data ?? [];
  // Feb-29 people are observed on the configured day in a non-leap year.
  const observeFeb29 =
    (OBSERVE_FEB29_ON === "02-28" && month === 2 && day === 28 && !isLeap(year)) ||
    (OBSERVE_FEB29_ON === "03-01" && month === 3 && day === 1 && !isLeap(year));
  if (observeFeb29) {
    const r = await supa.from("birthdays").select(PERSON_COLS).eq("is_active", true).eq("birth_month", 2).eq("birth_day", 29);
    if (r.error) throw new Error(`birthday Feb-29 lookup failed: ${r.error.message}`);
    if (r.data) people = [...people, ...r.data];
  }
  return people;
}

// ── Email (Microsoft Graph) ──────────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

async function graphToken(): Promise<string> {
  const form = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID, client_secret: GRAPH_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
  });
  const res = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Graph auth failed: ${j.error_description || j.error || res.status}`);
  return j.access_token as string;
}

async function sendGreeting(
  p: Person,
  opts: { toOverride?: string; testMode?: boolean } = {},
) {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    throw new Error("GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET not configured");
  }
  if (!GRAPH_SENDER) throw new Error("GRAPH_SENDER not configured");
  const to = opts.toOverride ?? p.person_email;
  if (!to) throw new Error("no recipient email");
  const name = firstNameOf(p.full_name);

  // ── HR-APPROVED COPY (birthday) ─────────────────────────────────────────────
  // This wording comes from HR. Please keep it in sync with them before editing.
  const accent = "#7a5c8e";
  const subject = `Happy Birthday, ${name}`;
  const heading = "🎂 Happy Birthday 🎂";
  const opening = `Happy Birthday, ${name}! 🎉`;
  const paras = [
    `Wishing you a wonderful birthday filled with happiness, good health, and special moments with your loved ones.`,
    `Thank you for your dedication, compassion, and hard work at Arete Care. We truly value your commitment to making a positive difference in the lives of the people we support. Your contributions are greatly appreciated, and we are grateful to have you as part of our team.`,
    `Have a fantastic birthday and a wonderful year ahead!`,
  ];
  const closing = `From your Arete Care Family.`;

  const bodyParas = [
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.7"><strong>${esc(opening)}</strong></p>`,
    ...paras.map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#2c2740">${esc(t)}</p>`),
    `<p style="margin:22px 0 0;font-size:15px;line-height:1.7">${esc(closing)}</p>`,
  ].join("");

  const html = `
    <div style="margin:0;padding:0;background:#f3f6f7">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f7;padding:24px 12px">
        <tr><td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;font-family:'Segoe UI',Inter,system-ui,Arial,sans-serif;color:#2c2740">
            <tr><td style="background:${accent};padding:30px 28px;border-radius:14px 14px 0 0;text-align:center;font-family:'Segoe UI',Inter,system-ui,Arial,sans-serif">
              <div style="font-size:23px;font-weight:800;color:#ffffff;line-height:1.25">${heading}</div>
              <div style="font-size:12px;letter-spacing:.5px;color:#ffffff;opacity:.9;margin-top:8px">ARETE CARE · EMPOWERING SOULS</div>
            </td></tr>
            <tr><td style="background:#ffffff;padding:32px 32px 28px;border:1px solid #e4e6ee;border-top:0;border-radius:0 0 14px 14px">
              ${bodyParas}
            </td></tr>
          </table>
        </td></tr>
      </table>
    </div>`;

  const message: Record<string, unknown> = {
    subject: (opts.testMode ? "[TEST] " : "") + subject,
    from: { emailAddress: { name: "Arete Care", address: GRAPH_SENDER } },
    body: { contentType: "HTML", content: html },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  // Never BCC someone their own greeting: if the copies list contains the
  // recipient, Exchange merges the two and it looks like BCC did nothing.
  const bcc = opts.testMode
    ? []
    : (await copyRecipients()).filter((a) => a.toLowerCase() !== String(to).toLowerCase());
  if (bcc.length) message.bccRecipients = bcc.map((address) => ({ emailAddress: { address } }));

  const token = await graphToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_SENDER)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
}

// ── Dedup (claim before sending; unclaim on failure so it retries) ───────────
async function claim(id: string, year: number, kind: string, observed: string): Promise<boolean> {
  const { data, error } = await supa.from("reminder_log")
    .insert({ birthday_id: id, observed_date: observed, reminder_year: year, kind }).select("id");
  return !error && !!data && data.length > 0;
}
async function unclaim(id: string, year: number, kind: string) {
  await supa.from("reminder_log").delete().eq("birthday_id", id).eq("reminder_year", year).eq("kind", kind);
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
async function runGreetings(opts: { force?: boolean } = {}) {
  const t = localNow(LOCAL_TZ);
  const month = t.m, day = t.d, year = t.y;

  // Cron checks in every 5 minutes; we send once the local time has reached the
  // configured time (the per-person/per-year dedup stops it repeating). Working
  // in local time keeps it correct through daylight saving. "Run now" from the
  // app passes force:true to bypass this.
  const send = await getSendTime();
  const nowMins = t.h * 60 + t.min;
  const sendMins = send.hour * 60 + send.minute;
  if (!opts.force && nowMins < sendMins) {
    return {
      sent: false, reason: "before the scheduled time",
      localTime: `${pad(t.h)}:${pad(t.min)}`, sendTime: `${pad(send.hour)}:${pad(send.minute)}`,
      timezone: LOCAL_TZ, date: `${pad(month)}-${pad(day)}`,
    };
  }

  const observed = `${year}-${pad(month)}-${pad(day)}`;

  let birthdays = 0;
  const skipped: string[] = [];

  for (const p of await peopleBornOn(month, day, year)) {
    if (!p.person_email) { skipped.push(`${p.full_name} (no email)`); continue; }
    if (!(await claim(p.id, year, "birthday", observed))) continue; // already greeted this year
    try { await sendGreeting(p); birthdays++; }
    catch (e) { await unclaim(p.id, year, "birthday"); throw e; }
  }

  return { sent: birthdays > 0, birthdays, skipped, date: `${pad(month)}-${pad(day)}` };
}

async function runTestSend() {
  // Preview a sample birthday greeting to the first copy-recipient (or the sender).
  const copies = await copyRecipients();
  const to = copies[0] ?? GRAPH_SENDER;
  const sample: Person = { id: "sample", full_name: "Alex Rivera", person_email: to, birth_date: null, department: null };
  await sendGreeting(sample, { toOverride: to, testMode: true });
  return { sent: true, testMode: true, to };
}

// ── Writes (web UI, gated) ────────────────────────────────────────────────────
function sanitize(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (p.full_name !== undefined) out.full_name = String(p.full_name).trim();
  if (p.birth_date !== undefined) out.birth_date = p.birth_date || null;
  if (p.person_email !== undefined) out.person_email = p.person_email ? String(p.person_email).trim().toLowerCase() : null;
  if (p.department !== undefined) out.department = p.department || null;
  if (p.is_active !== undefined) out.is_active = !!p.is_active;
  return out;
}

// One person = one email address. Turn the unique-violation into plain English.
function friendlyDbError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("Someone with that email address is already on the list.");
  return new Error(error.message);
}

async function handleWrite(op: string, payload: Record<string, unknown>) {
  if (op === "create") {
    const row = sanitize(payload);
    if (!row.full_name) throw new Error("full_name is required");
    if (!row.birth_date) throw new Error("a birthday is required");
    const { data, error } = await supa.from("birthdays").insert(row).select().single();
    if (error) throw friendlyDbError(error);
    return data;
  }
  if (op === "update") {
    const { id, ...rest } = payload as { id?: string };
    if (!id) throw new Error("id required");
    const { data, error } = await supa.from("birthdays").update(sanitize(rest)).eq("id", id).select().single();
    if (error) throw friendlyDbError(error);
    return data;
  }
  if (op === "remove") {
    const id = (payload as { id?: string }).id;
    if (!id) throw new Error("id required");
    const { error } = await supa.from("birthdays").delete().eq("id", id);
    if (error) throw error;
    return { id };
  }
  if (op === "createMany") {
    const rawRows = Array.isArray(payload.rows) ? (payload.rows as Record<string, unknown>[]) : [];
    const clean = rawRows.map(sanitize).filter((r) => r.full_name && r.birth_date) as Record<string, unknown>[];
    if (!clean.length) return { imported: 0, skipped: 0, total: rawRows.length };
    // Dedup vs existing: by email when present, else by name + birthday.
    const { data: existing } = await supa.from("birthdays").select("full_name, birth_date, person_email");
    const seenEmail = new Set((existing ?? []).map((e) => (e.person_email || "").toLowerCase()).filter(Boolean));
    const seenNB = new Set((existing ?? []).map((e) => dupKey(String(e.full_name), String(e.birth_date ?? ""))));
    const toInsert: Record<string, unknown>[] = [];
    for (const r of clean) {
      const email = String(r.person_email ?? "").toLowerCase();
      const nb = dupKey(String(r.full_name), String(r.birth_date ?? ""));
      if (email ? seenEmail.has(email) : seenNB.has(nb)) continue;
      if (email) seenEmail.add(email); else seenNB.add(nb);
      toInsert.push({ ...r, is_active: true });
    }
    let imported = 0;
    if (toInsert.length) {
      const { data, error } = await supa.from("birthdays").insert(toInsert).select("id");
      if (error) throw friendlyDbError(error);
      imported = data?.length ?? 0;
    }
    return { imported, skipped: clean.length - imported, total: rawRows.length };
  }
  throw new Error(`unknown op: ${op}`);
}

// ── Copy recipients (BCC) management ─────────────────────────────────────────
async function handleRecipients(op: string, payload: Record<string, unknown>) {
  if (op === "list") {
    const { data, error } = await supa.from("recipients").select("id, email, name, is_active").order("email");
    if (error) throw error;
    return data ?? [];
  }
  if (op === "add") {
    const email = String(payload.email ?? "").trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) throw new Error("A valid email is required");
    const name = payload.name ? String(payload.name).trim() : null;
    const { data, error } = await supa.from("recipients").upsert({ email, name, is_active: true }, { onConflict: "email" }).select().single();
    if (error) throw error;
    return data;
  }
  if (op === "remove") {
    const id = String(payload.id ?? "");
    if (!id) throw new Error("id required");
    const { error } = await supa.from("recipients").delete().eq("id", id);
    if (error) throw error;
    return { id };
  }
  if (op === "toggle") {
    const id = String(payload.id ?? "");
    if (!id) throw new Error("id required");
    const { data, error } = await supa.from("recipients").update({ is_active: !!payload.is_active }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  throw new Error(`unknown recipients op: ${op}`);
}

// ── Settings (send time) + testing helpers ───────────────────────────────────
async function handleSettings(op: string, payload: Record<string, unknown>) {
  const now = localNow(LOCAL_TZ);
  const local_time = `${pad(now.h)}:${pad(now.min)}`;
  // e.g. "Melbourne" + "AEST"/"AEDT", so the UI can state the timezone plainly.
  const tz_city = (LOCAL_TZ.split("/").pop() ?? LOCAL_TZ).replace(/_/g, " ");
  const tz_label = new Intl.DateTimeFormat("en-AU", { timeZone: LOCAL_TZ, timeZoneName: "short" })
    .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  if (op === "get") {
    const s = await getSendTime();
    return { send_hour: s.hour, send_minute: s.minute, timezone: LOCAL_TZ, tz_city, tz_label, local_time };
  }
  if (op === "set") {
    const h = Number(payload.send_hour);
    const mi = Number(payload.send_minute ?? 0);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error("Hour must be between 0 and 23");
    if (!Number.isInteger(mi) || mi < 0 || mi > 59) throw new Error("Minute must be between 0 and 59");
    const { data, error } = await supa.from("app_settings")
      .upsert({ id: 1, send_hour: h, send_minute: mi, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .select("send_hour, send_minute").single();
    if (error) throw new Error(`${error.message}. Have you run 07_settings.sql and 08_send_minute.sql?`);
    return { send_hour: data.send_hour, send_minute: data.send_minute, timezone: LOCAL_TZ, tz_city, tz_label, local_time };
  }
  throw new Error(`unknown settings op: ${op}`);
}

// "Is the robot alive?" — what's due today, what's already gone out, and when.
async function handleStatus() {
  const t = localNow(LOCAL_TZ);
  const send = await getSendTime();
  const observed = `${t.y}-${pad(t.m)}-${pad(t.d)}`;

  // Same rule the sender uses, so the count always matches reality.
  const bdays = (await peopleBornOn(t.m, t.d, t.y)).filter((p) => p.person_email);

  type SentRow = { sent_at: string };
  const { data: todayRows } = await supa.from("reminder_log").select("sent_at").eq("observed_date", observed);
  const sentTimes = ((todayRows ?? []) as SentRow[]).map((r) => r.sent_at).sort();
  const { data: lastRows } = await supa.from("reminder_log")
    .select("sent_at").order("sent_at", { ascending: false }).limit(1);
  const lastOverall = ((lastRows ?? []) as SentRow[])[0]?.sent_at ?? null;

  return {
    due_today: bdays.length,
    sent_today: sentTimes.length,
    last_sent_at: sentTimes.length ? sentTimes[sentTimes.length - 1] : lastOverall,
    send_time: `${pad(send.hour)}:${pad(send.minute)}`,
    local_time: `${pad(t.h)}:${pad(t.min)}`,
    timezone: LOCAL_TZ,
  };
}

// Clears the "already greeted" history so a send can be repeated. Testing only —
// in normal use this log is what stops anyone being greeted twice.
async function handleResetLog() {
  const { error } = await supa.from("reminder_log").delete().gte("id", 0);
  if (error) throw error;
  return { cleared: true };
}

// ── HTTP entrypoint ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  // Ungated version probe (no secrets) — confirms which build is live.
  if (req.method === "GET") return json({ ok: true, version: FN_VERSION }, 200, cors);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const isCron = !!bearer &&
    ((CRON_SECRET && timingSafeEqual(bearer, CRON_SECRET)) || (SERVICE_ROLE && timingSafeEqual(bearer, SERVICE_ROLE)));

  // 1) Cron
  if (isCron || body.source === "cron") {
    if (!isCron) return json({ error: "unauthorized" }, 401, cors);
    try { return json(await runGreetings(), 200, cors); }
    catch (e) { return json({ error: String((e as Error)?.message ?? e) }, 500, cors); }
  }

  // 2) Access-code gated
  const code = String(body.accessCode ?? body.code ?? "");
  const gate = await checkAccessCode(code);
  if (body.mode === "verify") return json({ ok: gate.ok, member: gate.member ?? null }, gate.ok ? 200 : 401, cors);
  if (!gate.ok) return json({ error: "invalid access code" }, 401, cors);

  try {
    if (body.mode === "test") return json(await runTestSend(), 200, cors);
    if (body.mode === "run") return json(await runGreetings({ force: true }), 200, cors);
    if (body.mode === "status") return json({ ok: true, data: await handleStatus() }, 200, cors);
    if (body.mode === "resetLog") return json(await handleResetLog(), 200, cors);
    if (body.mode === "settings") return json({ ok: true, data: await handleSettings(String(body.op ?? "get"), (body.payload as Record<string, unknown>) ?? {}) }, 200, cors);
    if (body.mode === "write") return json({ ok: true, data: await handleWrite(String(body.op ?? ""), (body.payload as Record<string, unknown>) ?? {}) }, 200, cors);
    if (body.mode === "recipients") return json({ ok: true, data: await handleRecipients(String(body.op ?? ""), (body.payload as Record<string, unknown>) ?? {}) }, 200, cors);
    return json({ error: "unknown mode" }, 400, cors);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500, cors);
  }
});
