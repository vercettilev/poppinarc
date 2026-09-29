import { Box, CircularProgress, Typography } from "@mui/material"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { openAuthTab } from "~/helpers/openAuthTab"
import { sendApiRequest } from "~/lib/fetchService"

/**
 * CONNECT THE WALLET YOU WILL TRADE FROM, for an account that has none.
 *
 * On a deploy where people trade from their own wallets (arc-api
 * ARC_WALLET_ACCOUNTS=own) and Circle Wallets is not set up, a Google account
 * has no wallet until it connects one: arc-api's wallet page, in connect
 * mode, has the wallet sign a message, and the account trades from that
 * wallet from then on (every buy and sell approved in it).
 *
 * The link is fetched before the press, because the press is the gesture the
 * browser needs to open the tab and grant the page to the relay
 * (helpers/openAuthTab.ts); an await in between would spend it.
 */
export function ConnectWalletCard({ font = "inherit" }: { font?: string }) {
  const qc = useQueryClient()
  const [waiting, setWaiting] = useState(false)
  const link = useQuery({
    queryKey: ["arc", "wallet-link"],
    queryFn: () =>
      sendApiRequest<{ url: string }>({ url: "/auth/wallet/link-token", method: "POST", apiType: "backend" }),
    // The link lives ten minutes on arc-api; it is fetched again well before.
    staleTime: 8 * 60_000,
    refetchInterval: 8 * 60_000,
    retry: 1,
  })

  // While the wallet page is open, read the account again until it has its wallet.
  useEffect(() => {
    if (!waiting) return
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["current-user"] })
      void qc.invalidateQueries({ queryKey: ["arc", "deposit-addresses"] })
    }
    const timer = window.setInterval(refresh, 3000)
    const stop = window.setTimeout(() => setWaiting(false), 3 * 60_000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
    }
  }, [waiting, qc])

  const connect = () => {
    const url = link.data?.url
    if (!url) return
    setWaiting(true)
    void openAuthTab(url, `${new URL(url).origin}/*`).catch(() => setWaiting(false))
  }

  return (
    <Box
      sx={{
        width: "100%",
        p: 2,
        borderRadius: "16px",
        textAlign: "center",
        backgroundColor: "rgba(255,255,255,.04)",
        boxShadow: "inset 0 0 0 1px rgba(122,201,255,.16)",
      }}
    >
      <Typography sx={{ fontFamily: font, fontSize: 15, fontWeight: 600, color: "#EAF2FB" }}>
        Trade from your own wallet
      </Typography>
      <Typography sx={{ fontFamily: font, fontSize: 13, color: "#8CA3BD", mt: 0.75, lineHeight: 1.5 }}>
        Connect the wallet you keep USDC in. You approve every trade in it, and Poppin never holds your money.
      </Typography>
      <Box
        component="button"
        type="button"
        onClick={connect}
        disabled={!link.data?.url || waiting}
        sx={{
          mt: 1.75,
          width: "100%",
          height: 44,
          border: 0,
          borderRadius: "12px",
          cursor: link.data?.url && !waiting ? "pointer" : "default",
          fontFamily: font,
          fontSize: 14.5,
          fontWeight: 700,
          color: "#06202E",
          backgroundColor: "#68C6FF",
          opacity: link.data?.url ? 1 : 0.6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          "&:hover": { backgroundColor: "#8AD4FF" },
        }}
      >
        {waiting && <CircularProgress size={16} sx={{ color: "#06202E" }} />}
        {waiting ? "Finish in the new tab" : "Connect your wallet"}
      </Box>
      {link.isError && (
        <Typography sx={{ fontFamily: font, fontSize: 12.5, color: "#FF8A80", mt: 1 }}>
          Connecting a wallet is not available right now. Try again in a moment.
        </Typography>
      )}
    </Box>
  )
}
