/**
 * PUT THE CARD IN THE COMPOSER, instead of asking somebody to paste it.
 *
 * The share used to open `x.com/intent/post?text=…` in a new tab. That URL
 * is a platform dead end for this purpose: the intent API takes text, url,
 * hashtags and via, and CANNOT carry media. So the card was copied to the
 * clipboard and the reader was told to paste it — on the chip, behind the
 * new tab they were now looking at. Reported from the field as a tweet that
 * went out as bare text: the instruction was in the right words and the
 * wrong place.
 *
 * We are already a content script on x.com, so the composer is a DOM node
 * we can reach. Opening it IN PAGE keeps the reader where they were (a
 * modal over the timeline, not a second tab), keeps the blob in memory, and
 * lets us attach the image ourselves.
 *
 * THE FALLBACK IS THE POINT. Every step below depends on X's own markup,
 * which is not ours and will move. Each one is time-boxed and any failure
 * returns false, which puts the caller back on the old intent-plus-paste
 * path with the clipboard already loaded. A brittle improvement is fine; a
 * brittle improvement that can strand somebody is not.
 *
 * The selectors are X's own testids, which is what the rest of this
 * codebase already reads the timeline with (see xStrip's field notes).
 */

/** X's compose entry point in the left rail. Clicking it routes client-side,
 *  so the page never reloads and our blob survives. */
const COMPOSE_BUTTON = 'a[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]';
/** The composer's editable body once the modal is up. */
const EDITOR = 'div[data-testid="tweetTextarea_0"]';
/**
 * The hidden input behind the image button.
 *
 * TWO SELECTORS, because the first one is a guess about somebody else's
 * markup and it did not hold: the composer came up with the sentence in it
 * and no picture, which means this lookup timed out. A bare
 * `input[type=file]` is the shape X cannot change without changing how its
 * own image button works.
 */
const FILE_INPUTS = ['input[data-testid="fileInput"]', 'input[type="file"]'];

/** How the modal is dismissed when we give up, so a failed attempt does not
 *  leave the reader with two composers open. */
const CLOSE_BUTTON = 'div[data-testid="app-bar-close"], button[data-testid="app-bar-close"]';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll for a node rather than guess at a delay: the modal's mount time
 *  depends on the machine, and a fixed wait is either slow or wrong. */
async function waitFor<T extends Element>(
  selector: string,
  timeoutMs: number,
  root: ParentNode = document,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
    if (Date.now() > deadline) return null;
    await sleep(60);
  }
}

/**
 * Type into a React-controlled contenteditable.
 *
 * Setting textContent is invisible to React: its own state never changes,
 * and the first keystroke afterwards wipes what we wrote. `insertText` goes
 * through the browser's editing pipeline and fires the input events React
 * listens for, which is why it is used here despite being deprecated.
 */
function typeInto(editor: HTMLElement, text: string): boolean {
  editor.focus();
  const ok = document.execCommand('insertText', false, text);
  if (ok && editor.textContent?.includes(text.slice(0, 12))) return true;

  // Second attempt: a paste event carrying text/plain, which X also handles.
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    editor.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    return Boolean(editor.textContent?.includes(text.slice(0, 12)));
  } catch {
    return false;
  }
}

/**
 * Hand the file to the composer's own input.
 *
 * Assigning `input.files` needs a DataTransfer; there is no other way to
 * build a FileList. React reads the change event, not the property, so both
 * happen.
 */
function attachFile(input: HTMLInputElement, file: File): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Open X's composer in this page with the text typed and the card attached.
 *
 * @returns true only when BOTH the text and the image are in. A partial
 *   result returns false so the caller can fall back rather than leave
 *   somebody looking at a half-built post they did not ask for.
 */
export async function composeWithCard(
  text: string,
  card: Blob | null,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const budget = opts.timeoutMs ?? 4000;
  const started = Date.now();
  const left = () => Math.max(0, budget - (Date.now() - started));

  const open = document.querySelector<HTMLElement>(COMPOSE_BUTTON);
  if (!open) return false;
  open.click();

  const editor = await waitFor<HTMLElement>(EDITOR, left());
  if (!editor) return false;
  if (!typeInto(editor, text)) return false;

  // No card is a legitimate outcome, not a failure: a refused canvas still
  // deserves a composer with the sentence in it.
  if (!card) return true;

  const file = new File([card], 'popped.png', { type: 'image/png' });

  /* EVERY MECHANISM IS CHECKED, NEVER ASSUMED.
     
     Both of these can succeed at the DOM level and do nothing: assigning
     `input.files` without X noticing, or dispatching a paste its editor
     ignores. The first version returned true on "did not throw", which is
     how the receipt came to say "Composer ready with your card" over a
     composer with no card in it. The only acceptable evidence is X's own
     attachment preview appearing. */
  for (const sel of FILE_INPUTS) {
    const input = document.querySelector<HTMLInputElement>(sel);
    if (input && attachFile(input, file) && (await attached(left()))) return true;
  }

  // X's editor accepts an image paste, which is the road a person takes by
  // hand and needs no hidden input at all.
  if (pasteImage(editor, file) && (await attached(left()))) return true;

  /* NOTHING WORKED, so leave no mess. The caller is about to open the
     intent URL, and a reader staring at two composers — one empty modal we
     opened and one new tab — is worse off than before any of this existed. */
  document.querySelector<HTMLElement>(CLOSE_BUTTON)?.click();
  return false;
}

/** X's own preview of an attached image. Its appearance is the only proof
 *  that the composer took the file; everything before it is a hopeful
 *  gesture at somebody else's React tree. */
async function attached(timeoutMs: number): Promise<boolean> {
  const found = await waitFor(
    '[data-testid="attachments"] img, [data-testid="attachments"] video, [aria-label="Media"] img',
    Math.max(600, Math.min(1500, timeoutMs)),
  );
  return Boolean(found);
}

/** A synthetic paste carrying the file. Returns whether it was DISPATCHED,
 *  not whether it worked; the caller checks for the preview. */
function pasteImage(editor: HTMLElement, file: File): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    editor.focus();
    editor.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    return true;
  } catch {
    return false;
  }
}
