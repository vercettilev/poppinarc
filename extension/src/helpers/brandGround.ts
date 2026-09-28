/**
 * The brand's ground — the card's exact surface, as one importable object.
 *
 * ── THE SOURCE IS THE CARD ──────────────────────────────────────────────────
 * These three layers are copied verbatim from SpotCard/style.ts `.wrap`:
 * a deep blue-cast sweep (#101B2C → #0A0D14 → #0C1626, 150deg) with two
 * accent auroras riding it, top-right and bottom-left. The owner put the
 * card and the panel side by side and the panel read FLAT — it had weaker
 * auroras on opposite corners and no blue cast at all, so the card sat in a
 * lit room and the panel sat in front of a black wall.
 *
 * THE CARD CANNOT IMPORT THIS FILE. It renders in a closed shadow root with
 * its own stylesheet, so its copy stays in style.ts — the same hard boundary
 * chipActStyle documents. THESE VALUES MUST MATCH `.wrap`. Change one,
 * change the other, in the same commit.
 *
 * One painter per surface: whoever is the outermost shell spreads this;
 * everything inside stays transparent or uses white-alpha tints. Two nested
 * elements both painting the gradient restart it mid-screen — the seam is
 * exactly the kind of "almost the same" this file exists to end.
 */
export const BRAND_GROUND = {
  backgroundColor: "#0A0D14",
  backgroundImage: `
    radial-gradient(130% 90% at 100% 0%, rgba(104,198,255,.18) 0%, rgba(104,198,255,0) 52%),
    radial-gradient(110% 80% at 0% 100%, rgba(104,198,255,.10) 0%, rgba(104,198,255,0) 48%),
    linear-gradient(150deg, #101B2C 0%, #0A0D14 46%, #0C1626 100%)
  `,
  backgroundRepeat: "no-repeat",
  backgroundAttachment: "local",
} as const
