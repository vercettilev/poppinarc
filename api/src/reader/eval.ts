/**
 * THE READER, MEASURED: the chip's own rules alone, then the rules with the AI
 * reader behind them, on a labelled set of real pages (reader/corpus.json).
 *
 * Each item is scored on the text the chip actually sends: an article's
 * headline (the news surface reads the h1, nothing else), or a Reddit post's
 * title and the start of its body. The rules are the chip's Arc name tier
 * (catalog.rulesMatch); the reader is asked only where the rules found
 * nothing and the text shows a sign of money, exactly as in the product.
 *
 *   ANTHROPIC_API_KEY=... npx ts-node --transpile-only src/reader/eval.ts [--out EVAL.md]
 *
 * One run over ~44 items is a handful of model calls, well under ten cents.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARC_READER_KEYS, looksLikeMoney, rulesMatch } from './catalog';
import { askClaude, costMicroUsd, type ReaderUsage } from './claude';

interface Item {
  url: string;
  kind: 'article' | 'reddit';
  headline: string;
  expect: string | null;
  bucket: number;
  why: string;
}

interface Scored extends Item {
  text: string;
  rules: string | null;
  ai: string | null;
  asked: boolean;
  reason: string | null;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function redditText(item: Item): Promise<string> {
  const url = item.url.replace(/\/?(\?.*)?$/, '/.json');
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) });
    const j = (await r.json()) as Array<{ data?: { children?: Array<{ data?: { title?: string; selftext?: string } }> } }>;
    const post = j?.[0]?.data?.children?.[0]?.data;
    if (post?.title) return `${post.title}\n${(post.selftext ?? '').slice(0, 600)}`.trim();
  } catch {
    // The headline alone is still a fair test.
  }
  return item.headline;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ARC_READER_MODEL ?? 'claude-haiku-4-5-20251001';
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const outArg = process.argv.indexOf('--out');
  const out = outArg > 0 ? process.argv[outArg + 1] : null;

  const items = JSON.parse(readFileSync(join(__dirname, 'corpus.json'), 'utf8')) as Item[];
  const scored: Scored[] = [];
  for (const it of items) {
    const text = it.kind === 'reddit' ? await redditText(it) : it.headline;
    scored.push({ ...it, text, rules: rulesMatch(text, ARC_READER_KEYS)?.key ?? null, ai: null, asked: false, reason: null });
  }

  // The reader, where the rules found nothing and the text looks like money.
  const toAsk = scored.filter((s) => s.rules === null && looksLikeMoney(s.text));
  const usage: ReaderUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  for (let i = 0; i < toAsk.length; i += 8) {
    const batch = toAsk.slice(i, i + 8);
    const { verdicts, usage: u } = await askClaude({
      apiKey,
      model,
      items: batch.map((s, j) => ({ id: `t${i + j}`, text: s.text })),
      timeoutMs: 60_000,
      // The corpus is labelled for Arc's own assets; the reader answers in those terms here.
      keys: ARC_READER_KEYS,
    });
    usage.input += u.input;
    usage.output += u.output;
    usage.cacheWrite += u.cacheWrite;
    usage.cacheRead += u.cacheRead;
    batch.forEach((s, j) => {
      const v = verdicts.get(`t${i + j}`);
      s.asked = true;
      s.ai = v?.key ?? null;
      s.reason = v?.reason ?? null;
    });
  }

  const final = (s: Scored) => s.rules ?? s.ai;
  const positives = scored.filter((s) => s.expect !== null);
  const negatives = scored.filter((s) => s.expect === null);
  const report = (pick: (s: Scored) => string | null) => {
    const shown = scored.filter((s) => pick(s) !== null);
    const right = shown.filter((s) => pick(s) === s.expect);
    const found = positives.filter((s) => pick(s) === s.expect);
    const falseChips = negatives.filter((s) => pick(s) !== null);
    return {
      precision: pct(right.length, shown.length),
      recall: pct(found.length, positives.length),
      falseChips: `${falseChips.length} of ${negatives.length}`,
      right: right.length,
      shown: shown.length,
      found: found.length,
    };
  };
  const rulesOnly = report((s) => s.rules);
  const withAi = report(final);
  const cents = costMicroUsd(model, usage) / 10_000;

  const lines = [
    `# The AI reader, measured`,
    ``,
    `${items.length} real pages (${positives.length} about bitcoin or the euro, ${negatives.length} about neither), scored on the text the chip sends. Model: ${model}. Run: ${new Date().toISOString().slice(0, 10)}.`,
    ``,
    `| | Chips right (precision) | Pages found (recall) | Chips on pages about neither |`,
    `|---|---|---|---|`,
    `| Rules alone | ${rulesOnly.precision} (${rulesOnly.right}/${rulesOnly.shown}) | ${rulesOnly.recall} (${rulesOnly.found}/${positives.length}) | ${rulesOnly.falseChips} |`,
    `| Rules + AI reader | ${withAi.precision} (${withAi.right}/${withAi.shown}) | ${withAi.recall} (${withAi.found}/${positives.length}) | ${withAi.falseChips} |`,
    ``,
    `The reader was asked about ${toAsk.length} of ${items.length} texts (the rest had a rule answer or no sign of money). Cost of this run: ${cents.toFixed(2)} cents.`,
    ``,
    `| Bucket | Text | Expected | Rules | Reader | Reader's line |`,
    `|---|---|---|---|---|---|`,
    ...scored.map(
      (s) =>
        `| ${s.bucket} | ${s.text.split('\n')[0]!.replace(/\|/g, '/').slice(0, 90)} | ${s.expect ?? '-'} | ${s.rules ?? '-'} | ${s.asked ? s.ai ?? 'none' : ''} | ${(s.reason ?? '').replace(/\|/g, '/')} |`,
    ),
  ];
  const md = lines.join('\n');
  if (out) writeFileSync(out, `${md}\n`);
  console.log(md);
}

main().catch((e) => {
  console.error('eval failed:', (e as Error)?.message ?? e);
  process.exit(1);
});
