// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import {
  CARD_H,
  CARD_W,
  compactUsd,
  composeShareText,
  drawTradeCard,
} from "./tradeCard"

/**
 * The share card, held by its interesting half: what gets DRAWN. The
 * recording context captures every text and stroke so the specs can say
 * "the ticker is on the card" without a pixel in sight.
 */

function recordingCtx() {
  const texts: string[] = []
  const textXs: number[] = []
  const strokes: string[] = []
  const fills: string[] = []
  const images: Array<[number, number, number, number]> = []
  let currentStroke = ""
  return {
    ctx: {
      fillStyle: "" as string,
      strokeStyle: "" as string,
      lineWidth: 0,
      font: "",
      textAlign: "left" as CanvasTextAlign,
      fillRect: () => {},
      fillText(this: { fillStyle: string }, t: string, x: number) {
        texts.push(t)
        textXs.push(x)
        fills.push(String(this.fillStyle))
      },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke() {
        currentStroke = String(this.strokeStyle)
        strokes.push(currentStroke)
      },
      save: () => {},
      restore: () => {},
      arc: () => {},
      clip: () => {},
      closePath: () => {},
      // Cast because canvas drawImage is a 3/5/9-arg overload set and the
      // recorder only ever sees the 5-arg call drawTradeCard makes.
      drawImage: ((_img: CanvasImageSource, x: number, y: number, w: number, h: number) => {
        images.push([x, y, w, h])
      }) as CanvasRenderingContext2D["drawImage"],
      // Width scaled to glyph count — enough for "is the logo left of the
      // address" geometry without a real text engine.
      measureText: ((t: string) => ({
        width: t.length * 14,
      })) as CanvasRenderingContext2D["measureText"],
    },
    texts,
    textXs,
    strokes,
    fills,
    images,
  }
}

/** A stand-in for a decoded bitmap; drawTradeCard never inspects it. */
const FACE = {} as CanvasImageSource

import { POPPIN_LOGO_URI } from "~/assets/poppinLogoDataUri"

it("ships the mark as bytes, not as a build-time promise", () => {
  // The first version imported logo.png?inline — a vite 6 feature this
  // repo's vite 5.4 silently ignores, so every real build shipped a
  // hashed URL that decodeImage refused, and the mark never drew while
  // this suite stayed green on a stub. The constant is the contract.
  expect(POPPIN_LOGO_URI.startsWith("data:image/png;base64,")).toBe(true)
  expect(POPPIN_LOGO_URI.length).toBeGreaterThan(10_000)
})

describe("drawTradeCard", () => {
  it("puts the asset, the action, and the brand on the card", () => {
    const { ctx, texts } = recordingCtx()
    drawTradeCard(ctx, {
      ticker: "WIF",
      action: "Bought $25",
      series: [1, 2, 3],
      mcap: 3_400_000,
      priceUsd: 0.2031,
    })
    expect(texts).toContain("$WIF")
    expect(texts).toContain("Bought $25")
    expect(texts).toContain("poppin.so")
    // The facts line speaks trader units: sub-dollar price, compact MC.
    expect(texts.some((t) => t.includes("MC $3.4M"))).toBe(true)
    expect(texts.some((t) => t.includes("$0.2031"))).toBe(true)
  })

  it("signs the card with the sharer's own address when the handle is known", () => {
    // poppin.so/@handle IS the referral: the address rides the picture,
    // where X's ranking cannot see a link and a reader still can.
    const { ctx, texts } = recordingCtx()
    drawTradeCard(ctx, {
      ticker: "WIF",
      action: "Bought $25",
      series: null,
      mcap: null,
      priceUsd: null,
      handle: "lev",
    })
    expect(texts).toContain("poppin.so/@lev")
    expect(texts).not.toContain("poppin.so")
  })

  it("colors the flex headline by result and draws subline + caller credit", () => {
    const down = recordingCtx()
    drawTradeCard(down.ctx, {
      ticker: "WIF",
      action: "Down \u2212$5.00",
      series: null,
      mcap: null,
      priceUsd: null,
      tone: "down",
      subline: "-50.0% on $WIF \u00b7 holding",
      credit: "via @memecaller",
    })
    expect(down.texts).toContain("Down \u2212$5.00")
    expect(down.texts).toContain("-50.0% on $WIF \u00b7 holding")
    expect(down.texts).toContain("via @memecaller")
    // A loss must read RED, never the buy card's green.
    expect(down.fills).toContain("#FF453A")

    const up = recordingCtx()
    drawTradeCard(up.ctx, {
      ticker: "WIF",
      action: "Up +$150.00",
      series: null,
      mcap: null,
      priceUsd: null,
      tone: "up",
      subline: "+150.0% on $WIF \u00b7 holding",
    })
    expect(up.fills).toContain("#30D158")
  })

  it("strokes the line in the direction\'s color", () => {
    const up = recordingCtx()
    drawTradeCard(up.ctx, {
      ticker: "A",
      action: "Bought $10",
      series: [1, 2],
      mcap: null,
      priceUsd: null,
    })
    expect(up.strokes).toEqual(["#30D158"])

    const down = recordingCtx()
    drawTradeCard(down.ctx, {
      ticker: "A",
      action: "Bought $10",
      series: [2, 1],
      mcap: null,
      priceUsd: null,
    })
    expect(down.strokes).toEqual(["#FF453A"])
  })

  it("draws a whole card without a series, and strokes nothing", () => {
    const { ctx, texts, strokes } = recordingCtx()
    drawTradeCard(ctx, {
      ticker: "FRESH",
      action: "Bought $5",
      series: null,
      mcap: null,
      priceUsd: null,
    })
    expect(strokes).toHaveLength(0)
    expect(texts).toContain("$FRESH")
  })

  it("keeps the geometry constants at X's card ratio", () => {
    // 800×450 is 16:9 — what X renders large without cropping.
    expect(CARD_W / CARD_H).toBeCloseTo(16 / 9, 2)
  })

  it("wears the coin's face beside the ticker, and steps aside without it", () => {
    // A coin is recognised by its picture before its letters. With a face
    // the ticker moves right to make room; without one the card is
    // exactly yesterday's card — no gap where a picture should be.
    const withFace = recordingCtx()
    drawTradeCard(withFace.ctx, {
      ticker: "WIF",
      action: "Bought $25",
      series: null,
      mcap: null,
      priceUsd: null,
      icon: FACE,
    })
    expect(withFace.images).toHaveLength(1)
    expect(withFace.images[0]).toEqual([48, 44, 56, 56])
    expect(withFace.textXs[withFace.texts.indexOf("$WIF")]).toBe(120)

    const bare = recordingCtx()
    drawTradeCard(bare.ctx, {
      ticker: "WIF",
      action: "Bought $25",
      series: null,
      mcap: null,
      priceUsd: null,
    })
    expect(bare.images).toHaveLength(0)
    expect(bare.textXs[bare.texts.indexOf("$WIF")]).toBe(48)
  })

  it("signs with the mark just left of the address", () => {
    const { ctx, images } = recordingCtx()
    drawTradeCard(ctx, {
      ticker: "WIF",
      action: "Bought $25",
      series: null,
      mcap: null,
      priceUsd: null,
      handle: "lev",
      logo: FACE,
    })
    expect(images).toHaveLength(1)
    const [x, y, w, h] = images[0]
    // Left of the right-aligned address ("poppin.so/@lev" at CARD_W-48,
    // measured 14px/glyph by the recording context), above the brand bar.
    expect(x).toBe(CARD_W - 48 - "poppin.so/@lev".length * 14 - 40)
    expect(y).toBeLessThan(CARD_H - 8)
    expect([w, h]).toEqual([30, 30])
  })
})

describe("the words around the card", () => {
  it("compacts dollars the way a trader says them", () => {
    expect(compactUsd(3_400_000)).toBe("$3.4M")
    expect(compactUsd(1_200_000_000)).toBe("$1.2B")
    expect(compactUsd(841_000)).toBe("$841K")
    expect(compactUsd(2_500)).toBe("$2,500")
  })

  it("composes a link-free tweet: the cashtag, and no domain to autolink", () => {
    const t = composeShareText("WIF", "Bought $25")
    // The cashtag is the point: it gives OTHER extension users a chip
    // under the very tweet this card rides in. The domain is NOT here on
    // purpose — bare poppin.so autolinks into a t.co URL and X's ranking
    // punishes it; the address travels on the PNG instead.
    expect(t).toContain("$WIF")
    expect(t).toContain("Bought $25")
    expect(t).not.toContain("poppin.so")
  })
})

describe("the composer's sentence", () => {
  it("adds the cashtag when the action does not carry one", () => {
    expect(composeShareText("ANSEM", "Popped $1")).toContain("Popped $1 of $ANSEM")
  })

  it("names the account, not the word", () => {
    // A mention is a door; "Poppin" as plain text is not.
    expect(composeShareText("ANSEM", "Popped $1")).toContain("@poppin_so")
  })

  it("says WHERE the trade happened, which is the only new thing about it", () => {
    const t = composeShareText("ANSEM", "Popped $1")
    expect(t).toMatch(/tweet|timeline|feed|scroll/i)
  })

  it("is stable for the same trade and varied across trades", () => {
    // Identical sentences from thousands of accounts is the shape of
    // coordinated behaviour; the same pop re-shared must still read the same.
    expect(composeShareText("ANSEM", "Popped $1")).toBe(composeShareText("ANSEM", "Popped $1"))
    const many = new Set(
      ["$1", "$5", "$10", "$25", "$50", "$100", "$250"].map((u) =>
        composeShareText("WIF", `Popped ${u}`),
      ),
    )
    expect(many.size).toBeGreaterThan(1)
  })

  it("does NOT add a second one when the action already says it", () => {
    // Shipped bug: the sell path passes its own sentence, and this appended
    // the ticker anyway — "Sold 5.7 of $ANSEM of $ANSEM on Poppin" went to
    // the composer on every sell share.
    expect(composeShareText("ANSEM", "Sold 5.7 $ANSEM")).not.toMatch(/\$ANSEM.*\$ANSEM/)
    expect(composeShareText("ANSEM", "Sold 5.7 of $ANSEM")).not.toMatch(/\$ANSEM.*\$ANSEM/)
  })

  it("keeps the cashtag, which is the whole point", () => {
    // It is what puts a live chip under the shared tweet for every other
    // reader running the extension.
    for (const action of ["Popped $1", "Sold 2 $WIF"]) {
      expect(composeShareText("WIF", action)).toContain("$WIF")
    }
  })
})
