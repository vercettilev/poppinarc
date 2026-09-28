import { brandViaBackground, loadBrandFont } from "~/helpers/brandAssets"
import {
  drawFlexCard,
  FLEX_H,
  FLEX_W,
  type FlexPortraitModel,
} from "~/helpers/flexCardPortrait"
import { iconViaBackground } from "~/helpers/iconBridge"
import { decodeImage, deliverCard } from "~/helpers/tradeCard"

/**
 * EVERYTHING THE PORTRAIT CARD NEEDS, WITHIN THE CLICK'S LIFETIME.
 *
 * A share is only allowed to open a composer or a tab while the click that
 * asked for it still counts as recent, and Chrome forgets it after a few
 * seconds. Waiting on a slow avatar past that point does not produce a
 * better card; it produces a popup-blocked composer while the button
 * reports success. So the font, the mark and the photo each race ONE shared
 * deadline, and whatever has not arrived is drawn without: the system
 * typeface, the mark in place of the face. The chip's own Share already
 * races its token icon the same way.
 */
export async function gatherFlexAssets(
  photoUrl: string | null | undefined,
  budgetMs = 1500,
): Promise<{ markUri: string | null; avatarUri: string | null }> {
  const deadline = new Promise<null>((r) => setTimeout(() => r(null), budgetMs))
  const within = <T,>(p: Promise<T>) => Promise.race([p, deadline])
  const photo = !photoUrl
    ? Promise.resolve<string | null>(null)
    : photoUrl.startsWith("data:image/")
      ? Promise.resolve(photoUrl)
      : iconViaBackground(photoUrl)
  const [, markUri, avatarUri] = await Promise.all([
    within(loadBrandFont()),
    within(brandViaBackground("mark")),
    within(photo),
  ])
  return { markUri: markUri ?? null, avatarUri: avatarUri ?? null }
}

/**
 * Warm the brand assets before anybody presses Flex, so the press itself
 * spends none of its few seconds on them. Safe to call often: each ask is
 * one in-flight promise for the whole content script.
 */
export function warmFlexAssets(): void {
  void loadBrandFont()
  void brandViaBackground("mark")
}

export async function shareFlexCard(
  model: FlexPortraitModel,
  opts: {
    tweetText: string
    handle?: string | null
    avatarUri?: string | null
    markUri?: string | null
  },
): Promise<"composed" | "copied" | "text-only"> {
  let card: Blob | null = null
  try {
    const canvas = document.createElement("canvas")
    canvas.width = FLEX_W
    canvas.height = FLEX_H
    const ctx = canvas.getContext("2d")
    if (ctx) {
      const [avatar, mark] = await Promise.all([
        decodeImage(opts.avatarUri),
        decodeImage(opts.markUri),
      ])
      drawFlexCard(ctx, model, { avatar, mark, handle: opts.handle ?? null })
      card = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"))
    }
  } catch {
    // A card that could not be drawn still leaves the sentence to share.
  }
  return deliverCard(card, opts.tweetText)
}

/**
 * The sentence that rides with the card. The cashtag is load-bearing: it
 * is what puts a live chip under the shared tweet for every reader who has
 * the extension, which is the loop.
 */
export function flexTweetText(
  model: FlexPortraitModel,
  ticker: string,
  credit: string | null,
): string {
  const bare = ticker.replace(/^\$/, "")
  return `${model.hero} on $${bare}${credit ? ` ${credit}` : ""} · Poppin`
}
