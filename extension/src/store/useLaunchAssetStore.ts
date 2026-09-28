import { create } from "zustand"

/**
 * "OPEN THIS COIN" from somewhere that is not the strip: a post, a chip on
 * the page, a notification tap. The strip takes it once and opens the
 * sheet. `usd` is the amount to arrive with: a deposit toast that returns
 * the reader to the Buy they were making brings the dollars they typed.
 */
export interface LaunchAsset {
  mint: string
  side?: "buy" | "sell"
  usd?: number
}

interface LaunchAssetStore {
  launchMint: string | null
  launchSide: "buy" | "sell" | null
  launchUsd: number | null
  launchSeq: number
  setLaunchMint: (mint: string | null, side?: "buy" | "sell", usd?: number) => void
  takeLaunchMint: () => LaunchAsset | null
}

export const useLaunchAssetStore = create<LaunchAssetStore>()((set, get) => ({
  launchMint: null,
  launchSide: null,
  launchUsd: null,
  launchSeq: 0,
  setLaunchMint: (launchMint, side, usd) =>
    set((s) => ({
      launchMint,
      launchSide: side ?? null,
      launchUsd: typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : null,
      launchSeq: s.launchSeq + 1,
    })),
  takeLaunchMint: () => {
    const { launchMint, launchSide, launchUsd } = get()
    if (!launchMint) return null
    set({ launchMint: null, launchSide: null, launchUsd: null })
    return { mint: launchMint, side: launchSide ?? undefined, usd: launchUsd ?? undefined }
  },
}))
