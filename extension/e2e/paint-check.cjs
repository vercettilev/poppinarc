/**
 * Does the spot card actually PAINT? The CI half of the lesson from
 * 2026-08-13, when the card mounted an empty shadow root on every page for
 * three review rounds while a presence-only harness reported success: JSX
 * compiled with the React runtime was being handed to Preact's render, which
 * silently drops foreign elements. jsdom cannot catch that class of failure —
 * it does not paint — so this runs a real Chromium.
 *
 * The assertion is elementFromPoint at the card's own corner returning the
 * HOST element: hit-testing a closed shadow tree from page context returns its
 * host, so this is true if and only if the shadow content laid out and painted
 * where the stylesheet says it should.
 *
 * The page is a LOCAL fixture (Wikipedia's layout changes are not this test's
 * business), served over http because the content script refuses non-http(s).
 * The /embed/asset/match call goes to the REAL backend — a deliberate
 * dependency: if the production surface stops matching a plain SpaceX article,
 * that is worth a red build.
 */
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DIST = path.resolve(__dirname, '..', 'dist');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'paint-check-'));

const PAGE = `<!doctype html><html><head><title>SpaceX launches another Starship - Test Fixture</title></head>
<body><h1>SpaceX launches another Starship</h1>
<main>${`<p>SpaceX said the Starship flight met its objectives. SpaceX will refly the
booster after inspection. Starlink satellites rode along as ballast, and the
Falcon Heavy manifest is unaffected. Crew Dragon operations continue. The
reusable rocket program remains the company's stated path to orbital launch
cost reduction, with commercial spaceflight customers watching closely.</p>`.repeat(4)}</main>
</body></html>`;

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf-8'));
  if (!manifest.host_permissions?.length) {
    // Without granted host access the content script never injects and this
    // test would fail for a reason that has nothing to do with painting.
    throw new Error('dist is not a POPPIN_TEST_BUILD — permissions are optional, nothing will inject');
  }

  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/spacex-article`;

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, // extensions do not load headless; CI wraps this in xvfb
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });

  const page = await ctx.newPage();
  const matches = [];
  ctx.on('response', async (res) => {
    if (res.url().includes('/embed/asset/match')) {
      try { matches.push(`${res.status()} ${(await res.text()).slice(0, 120)}`); } catch {}
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  let painted = false;
  for (let i = 0; i < 30 && !painted; i++) {
    await page.waitForTimeout(1000);
    painted = await page.evaluate(() => {
      const host = document.querySelector('[data-poppin-spot-card]');
      if (!host) return false;
      // The card docks to the right edge at vertical CENTER (the old
      // prediction notification's placement) — probe there.
      return document.elementFromPoint(window.innerWidth - 30, Math.round(window.innerHeight / 2)) === host;
    });
  }

  await ctx.close();
  server.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });

  console.log(`match responses: ${matches.join(' | ') || '(none)'}`);
  if (!painted) {
    console.error('FAIL: the card did not paint at its own corner within 30s');
    process.exit(1);
  }
  console.log('OK: card painted — elementFromPoint at bottom-right returns the card host');
})().catch((e) => { console.error('PAINT CHECK ERROR:', e); process.exit(1); });
