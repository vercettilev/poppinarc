/**
 * CPU-PROFILE THE SERVICE WORKER, headlessly and repeatably.
 *
 * Kürşat's renderer trace (2026-08-25) had a blind spot he named himself:
 * the worker runs in its own process and his recording had no view of it.
 * This script is that view. It loads the REAL dist into Chrome for
 * Testing, drives it over CDP, and measures three phases:
 *
 *   1. idle       — nothing open. Expect: asleep, or ~0% CPU.
 *   2. one card   — a page that matches an asset mounts the strip and
 *                   watches prices; the /ticks socket flows. Expect:
 *                   fractions of a percent, a tabs.query per tick, a
 *                   sendMessage per tick per tab.
 *   3. release    — the page closes. Expect: the worker ASLEEP within
 *                   ~30s (ref-count drops, socket closes, MV3 idles out).
 *
 * First run's verdict (2026-08-25, this machine): idle 7.2ms busy over
 * 30s (0.02%), one card 27.6ms over 60s (0.05%, top item the GC at
 * 7.3ms), 20 tabs.query + 60 sendMessage per minute, asleep 10s after
 * release. Nothing worth optimizing; the number's job is to stay boring.
 *
 *   node tools/profile-sw.mjs [--dist ~/v2tests/dist] [--port 9333]
 *
 * Chrome for Testing comes from Playwright's cache (regular Chrome 137+
 * dropped --load-extension). The profile browser is its own throwaway
 * user-data-dir; your real Chrome is untouched.
 */
import WebSocket from "ws"
import { execSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}
const DIST = arg("dist", join(homedir(), "v2tests/dist"))
const PORT = Number(arg("port", "9333"))
const DEBUG = `http://127.0.0.1:${PORT}`
const SW_MATCH = "/serviceWorker.js"
const MATCH_URL = "https://www.coingecko.com/en/coins/dogwifhat"

const cft = execSync(
  `ls -d "${homedir()}"/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" 2>/dev/null | tail -1`,
  { encoding: "utf8" },
).trim()
if (!cft || !existsSync(cft)) {
  console.error("Chrome for Testing yok. Kur: npx playwright install chromium")
  process.exit(1)
}

const profileDir = mkdtempSync(join(tmpdir(), "poppin-sw-prof-"))
const chrome = spawn(
  cft,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    `--load-extension=${DIST}`,
    "--no-first-run",
    "--window-position=-3000,-3000",
    "--window-size=1000,800",
    "about:blank",
  ],
  { stdio: "ignore" },
)
const cleanup = () => {
  try { chrome.kill() } catch { /* already gone */ }
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* busy */ }
}
process.on("exit", cleanup)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = async () => (await fetch(`${DEBUG}/json/list`)).json()

function connect(url) {
  const ws = new WebSocket(url, { perMessageDeflate: false })
  let id = 0
  const waits = new Map()
  ws.on("message", (raw) => {
    const m = JSON.parse(raw)
    if (m.id && waits.has(m.id)) {
      const { res, rej } = waits.get(m.id)
      waits.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    }
  })
  const call = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id
      waits.set(i, { res, rej })
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  return new Promise((res) => ws.on("open", () => res({ call, ws })))
}

function summarize(profile, label, wallMs) {
  const total = new Map()
  const hits = profile.samples?.length ?? 0
  const interval = profile.timeDeltas?.length
    ? profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000
    : 0
  for (const n of profile.nodes ?? []) {
    if (!n.hitCount) continue
    const f = n.callFrame
    const key = `${f.functionName || "(anonymous)"} @ ${(f.url || "").split("/").pop()}:${f.lineNumber}`
    total.set(key, (total.get(key) ?? 0) + n.hitCount)
  }
  const sampleMs = hits ? interval / hits : 0
  const idleMs = (total.get("(idle) @ :-1") ?? 0) * sampleMs
  const busy = Math.max(0, interval - idleMs)
  console.log(`\n── ${label} (${(wallMs / 1000).toFixed(0)}s) ──`)
  console.log(`   CPU meşgul ~${busy.toFixed(1)}ms  (%${((busy / wallMs) * 100).toFixed(2)})`)
  for (const [k, c] of [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const ms = c * sampleMs
    if (ms >= 0.5 && !k.startsWith("(idle)")) console.log(`   ${ms.toFixed(1).padStart(7)}ms  ${k.slice(0, 90)}`)
  }
}

await sleep(8000)
const sw = (await list()).find((t) => (t.url || "").includes(SW_MATCH) && t.url.includes("chrome-extension"))
if (!sw) { console.error("worker bulunamadı"); process.exit(1) }
console.log("worker:", sw.url)
const swc = await connect(sw.webSocketDebuggerUrl)
await swc.call("Runtime.enable")
await swc.call("Profiler.enable")
await swc.call("Profiler.setSamplingInterval", { interval: 200 })
await swc.call("Runtime.evaluate", {
  expression: `globalThis.__prof = { tabsQueries: 0, sends: 0 };
    (() => {
      const q = chrome.tabs.query.bind(chrome.tabs)
      chrome.tabs.query = (...a) => { __prof.tabsQueries++; return q(...a) }
      const s = chrome.tabs.sendMessage.bind(chrome.tabs)
      chrome.tabs.sendMessage = (...a) => { __prof.sends++; return s(...a) }
    })(); "ok"`,
})

await swc.call("Profiler.start")
await sleep(30_000)
summarize((await swc.call("Profiler.stop")).profile, "FAZ 1 · boşta", 30_000)

const page = await (await fetch(`${DEBUG}/json/new?url=about:blank`, { method: "PUT" })).json()
const pc = await connect(page.webSocketDebuggerUrl)
await pc.call("Page.enable")
await pc.call("Page.navigate", { url: MATCH_URL })
await sleep(12_000)

const before = JSON.parse(
  (await swc.call("Runtime.evaluate", { expression: "JSON.stringify(__prof)" })).result.value,
)
await swc.call("Profiler.start")
await sleep(60_000)
summarize((await swc.call("Profiler.stop")).profile, `FAZ 2 · bir kart izliyor (${new URL(MATCH_URL).hostname})`, 60_000)
const after = JSON.parse(
  (await swc.call("Runtime.evaluate", { expression: "JSON.stringify(__prof)" })).result.value,
)
console.log(`   60s'de: tabs.query ${after.tabsQueries - before.tabsQueries}, sendMessage ${after.sends - before.sends}`)

for (const t of await list()) {
  if (t.type === "page") await fetch(`${DEBUG}/json/close/${t.id}`)
}
console.log("\n── FAZ 3 · sayfa kapandı, worker uyuyor mu ──")
const t0 = Date.now()
let verdict = "90s sonunda hâlâ AYAKTA — ref-count ya da socket kapanışı incele"
while (Date.now() - t0 < 90_000) {
  await sleep(10_000)
  const alive = (await list()).some((t) => (t.url || "").includes(SW_MATCH) && t.url.includes("chrome-extension"))
  console.log(`   t+${Math.round((Date.now() - t0) / 1000)}s: ${alive ? "ayakta" : "UYUDU"}`)
  if (!alive) { verdict = `UYUDU (t+${Math.round((Date.now() - t0) / 1000)}s)`; break }
}
console.log("   sonuç:", verdict)
process.exit(0)
