import { useNavigate } from "react-router"
import { JUICE } from "~/theme/juice"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import ContentCopyIcon from "@mui/icons-material/ContentCopy"
import ExpandMore from "@mui/icons-material/ExpandMore"
import FileDownloadIcon from "@mui/icons-material/FileDownload"
import SearchIcon from "@mui/icons-material/Search"
import SwapHorizIcon from "@mui/icons-material/SwapHoriz"
import SwapVert from "@mui/icons-material/SwapVert"
import WalletIcon from "@mui/icons-material/Wallet"
import RefreshIcon from "@mui/icons-material/Refresh"
import Visibility from "@mui/icons-material/Visibility"
import VisibilityOff from "@mui/icons-material/VisibilityOff"
import {
  alpha,
  Avatar,
  Box,
  Button,
  CircularProgress,
  darken,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  lighten,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import { useTheme } from "@mui/material/styles"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useLocation } from "react-router"
import { useToast } from "~/components/Toast/ToastProvider"
import { OpenOrders } from "~/components/OpenOrders"
import TradeHistory from "~/components/TradeHistory"
import { listOrdersAsset, positionsAsset, type SpotPositionsResponse } from "~/services/SpotAssetService"
import { PORTFOLIO_CAPTION, cashUsdOf, portfolioTotalUsd } from "~/helpers/portfolioTotal"
import { useCreateComment } from "~/hooks/useComments"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { hasUsableProfile } from "~/helpers/profileGate"
import { popCopy } from "~/helpers/popLanguage"
import { useUpdateProfile } from "~/hooks/useUpdateProfile"
import {
  useMyWallet,
  useProvisionWallets,
  useSOLPrice,
  useWalletBalance,
  useWalletTokens,
  useWalletTransactions,
} from "~/hooks/useWallet"
import { UserService } from "~/services/UserService"
import { WalletService } from "~/services/WalletService"

import { USDC_MINT } from "~/helpers/depositWatch"
import { explorerTxUrl } from "~/arc/chain"
import { CAP } from "~/config/edition"
import { activityRow } from "~/helpers/activityRow"

import type { Token } from "./wallet/types"
// ONE deposit screen. The wallet used to render its own copy, so the
// screen you got from the card and the screen you got from the wallet were
// different products: different title, different QR (that one had none),
// different warning, different back button.
import { Receive } from "./receive"
import { Send } from "./wallet/Send"
import { ExportPrivateKey } from "./wallet/ExportPrivateKey"


/**
 * GROUPED, like every other dollar figure in the product. This screen used
 * `$${n.toFixed(2)}` in four places, so a $1,234.56 holding read
 * "$1234.56" here and "$1,234.56" one tap away. helpers/youPanelView.ts
 * states the rule: "a person reads $1,234.56 without counting digits, and
 * the scoreboard's whole job is to be read at a glance."
 */
const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })

export default function WalletUI() {
  const navigate = useNavigate()
  const theme = useTheme()

  /**
   * ONE CHAIN. A ChainSelector stood here offering Solana and Arc, and
   * every read on this screen was gated on which one was picked. Arc's
   * backend left on 2026-08-12 — apps/backend has no @Controller('arc/…')
   * and no @Controller('bridge') — so the second choice led to a wallet
   * whose every request 404s. The picker, the store behind it, the Arc
   * balance hook and the three Arc views are gone with it; Arc comes back
   * backend-first, not by re-adding a dropdown (panel audit, 2026-09-20).
   */
  const { data: walletInfo, isLoading: isLoadingWallet } = useMyWallet()
  const { data: balanceData, isLoading: isLoadingBalance } = useWalletBalance()
  const { data: tokensData, isLoading: isLoadingTokens } = useWalletTokens()
  const { data: solanaTxData, isLoading: isLoadingSolanaTxs } = useWalletTransactions(15, 0)
  const { data: solPrice, isLoading: isLoadingPrice } = useSOLPrice()

  // User data for Make PFP feature
  const { data: currentUser } = useCurrentUser()
  const updateProfileMutation = useUpdateProfile()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const { mutate: provisionWallets, isPending: isProvisioning } = useProvisionWallets()

  // Get current SOL price (fallback to 0 if not loaded)
  const currentSOLPrice = solPrice?.usd || 0
  const sol24hChange = solPrice?.usd_24h_change || 0

  // SOL mint address constant
  const SOL_MINT = "So11111111111111111111111111111111111111112"

  // Process tokens data - now using aggregated data from backend
  const { tokens, hiddenSpam: hiddenSpamCount } = useMemo(() => {
    let hiddenSpam = 0
    const tokenList: Token[] = []

    // Try to find wrapped SOL in the tokens data to get its logoURI dynamically
    const wrappedSolToken = tokensData?.tokens?.find((t: any) => t.mint === SOL_MINT)
    const solLogoURI = wrappedSolToken?.logoURI || "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"

    /**
     * SOL ONLY WHEN THERE IS SOME. SPL rows are already dropped at zero
     * balance below, so SOL was the one asset guaranteed a row at zero — a
     * permanent "Solana / 0.0000 SOL / $0.00" line that quietly teaches a
     * USDC-only reader that SOL is something they hold, on a product where
     * they never need it and we cover the network fee.
     */
    if (balanceData?.balance && balanceData.balance.sol > 0 && currentSOLPrice > 0) {
      const solValue = balanceData.balance.sol * currentSOLPrice
      const sol24hChangePercent = sol24hChange
      const changeSign = sol24hChangePercent >= 0 ? "+" : ""

      tokenList.push({
        /**
         * NAMED AS WHAT IT IS, because the headline above does not count
         * it. The total is the server's positions fold, which excludes
         * native SOL on purpose — nothing spends it here, the product
         * covers the network fee, and a buy is funded from USDC alone
         * (SpotPositionsResponse.solUsd: "It is here to describe the
         * response, not to be summed with cashUsd"). So the row stays —
         * a reader who sent SOL to this address must be able to see it
         * arrive — and it says why it is not in the number above.
         */
        name: "Solana",
        symbol: "SOL",
        amount: balanceData.balance.sol.toFixed(4),
        // From LAMPORTS, not the float: lamports are an integer, so nine
        // decimal places reproduce the balance exactly. The display string
        // above ROUNDS (3.020272 → "3.0203" — more SOL than exists), and
        // Swap's Max once submitted it verbatim, refused by the backend.
        amountExact: (balanceData.balance.lamports / 1e9).toFixed(9),
        value: usd(solValue),
        change: `${changeSign}${sol24hChangePercent.toFixed(2)}%`,
        icon: "",
        iconBg: "#302164",
        mint: SOL_MINT,
        logoURI: solLogoURI,
        decimals: 9, // SOL uses 9 decimals
      })
    }

    // Add SPL tokens - now all data comes from backend aggregated response.
    // Drop zero-balance rows so a long tail of dust / abandoned mints doesn't
    // bury actual holdings. Wrapped SOL would be the one familiar mint to
    // exempt at zero, but its visible balance is sourced from balanceData.sol
    // (above), so a 0-uiAmount entry here is never useful to surface.
    if (tokensData?.tokens) {
      tokensData.tokens.forEach((token) => {
        if (!token.uiAmount || token.uiAmount <= 0) return
        /**
         * "Unknown" and "???" arrive as LITERAL STRINGS from the backend's
         * metadata resolver, so the fallbacks below never fired and the
         * wallet rendered them verbatim — next to scam-airdrop imagery, on
         * a money screen. A mint with no recognisable metadata AND no value
         * is airdrop spam by construction: it is hidden behind a counted
         * line rather than deleted, because the wallet does hold it and
         * silence about held things is how trust dies. One with VALUE but
         * no name shows its mint, which is at least true.
         */
        const junkName = !token.name || /^unknown$/i.test(token.name)
        const junkSymbol = !token.symbol || /^\?+$/.test(token.symbol)
        if (junkName && junkSymbol && !((token.usdValue ?? 0) > 0)) {
          hiddenSpam += 1
          return
        }
        const name = junkName
          ? `${token.mint.substring(0, 4)}…${token.mint.slice(-4)}`
          : token.name
        const symbol = junkSymbol ? "" : token.symbol
        const logoURI = token.logoURI
        const usdValue = token.usdValue || 0
        const priceChange24h = token.priceChange24h || 0

        tokenList.push({
          name,
          symbol,
          amount: token.uiAmount.toFixed(token.decimals),
          // Full-decimal already, so display and arithmetic agree here;
          // the field exists so consumers never have to know which rows
          // round and which do not.
          amountExact: token.uiAmount.toFixed(token.decimals),
          value: usdValue > 0 ? usd(usdValue) : "-",
          change:
            priceChange24h !== 0
              ? `${priceChange24h >= 0 ? "+" : ""}${priceChange24h.toFixed(2)}%`
              : "-",
          icon: logoURI ? "" : symbol.charAt(0).toUpperCase(),
          iconBg: "#2775CA",
          mint: token.mint,
          logoURI: logoURI || undefined,
          decimals: token.decimals,
        })
      })
    }

    /**
     * USDC LEADS, then everything by value. Cash is not just another row
     * whose turn depends on price — it is the money every Buy spends and
     * every Sell returns, so it sits where a wallet app puts it: first.
     * The chip's own Holdings list already does this.
     */
    tokenList.sort((a, b) => {
      if (a.mint === USDC_MINT) return -1
      if (b.mint === USDC_MINT) return 1
      const aValue = a.value === "-" ? 0 : parseFloat(a.value.replace("$", ""))
      const bValue = b.value === "-" ? 0 : parseFloat(b.value.replace("$", ""))
      return bValue - aValue
    })

    return { tokens: tokenList as Token[], hiddenSpam }
  }, [balanceData, tokensData, currentSOLPrice, sol24hChange])

  /**
   * THE HEADLINE IS NOT THIS SCREEN'S TO COMPUTE.
   *
   * It used to be: the total was a fold over the rows below (every
   * /wallet/tokens row plus native SOL at a second price source) under a
   * caption reading "TOTAL BALANCE", while the front door printed
   * "Portfolio value · positions + cash" over the server's positions fold.
   * Two headlines, two sets, two price sources, and no sentence anywhere
   * saying why they differed — the audit's first finding (2026-09-20).
   *
   * The rows stay local, because rows are what this screen is for. The
   * NUMBER now comes from the same place the front door and the chip read,
   * so the three surfaces can only disagree by the age of their answers.
   */
  const [book, setBook] = useState<SpotPositionsResponse | null>(null)
  const totalBalance = portfolioTotalUsd(book)
  const usdcCash = cashUsdOf(book) ?? 0

  /**
   * THE DAY'S CHANGE WENT WITH THE SECOND TOTAL. It was a weighted fold
   * over the rows below, so once the headline stopped being that fold the
   * chips were a third claim about the reader's money, on a different
   * window again. The one P&L the product states lives on the front door
   * ("on what you hold" and "banked"), from the ledger that can source it.
   */

  const [activeTab, setActiveTab] = useState<
    | "tokens"
    | "orders"
    | "trades"
    | "activity"
    | "receive"
    | "send"
    | "send-final"
  >(
    // A door elsewhere may ask for a specific tab (the Positions
    // headline opens straight into Trades); anything unrecognized is
    // the default, never a blank screen.
    (useLocation().state as { tab?: string } | null)?.tab === "trades"
      ? "trades"
      : "tokens",
  )
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [selectedTokenForSend, setSelectedTokenForSend] =
    useState<Token | null>(null)
  const [expandedTokenMint, setExpandedTokenMint] = useState<string | null>(
    null
  )
  const [showBalance, setShowBalance] = useState(true)

  /**
   * REFRESH, AND WHAT IS COMMITTED. Two halves of one report: the screen
   * did not move after a swap, and money in a standing order had nowhere
   * to be seen. The orders read is the same one the Orders tab makes;
   * failure leaves the committed line absent, never a wrong zero — "you
   * have no orders" and "we could not look" must not paint the same.
   */
  const [refreshing, setRefreshing] = useState(false)
  const [committedUsd, setCommittedUsd] = useState(0)
  const [ordersNonce, setOrdersNonce] = useState(0)

  useEffect(() => {
    let alive = true
    positionsAsset()
      .then((r) => {
        if (alive) setBook(r)
      })
      // A book we could not read stays null, and null renders as "—".
      // A wrong zero on a money screen is worse than an honest dash.
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [ordersNonce])

  useEffect(() => {
    let alive = true
    listOrdersAsset("active")
      .then((r) => {
        if (!alive) return
        // Buys escrow USDC; a sell escrows the asset, which the token
        // rows above already stop counting for the same reason. Only the
        // dollars belong on a dollar line.
        const usd = (r?.orders ?? [])
          .filter((o) => o.side === "buy")
          .reduce((sum, o) => sum + (o.amountUsd ?? 0), 0)
        setCommittedUsd(usd)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [ordersNonce])

  const refreshMoney = () => {
    if (refreshing) return
    setRefreshing(true)
    setOrdersNonce((n) => n + 1)
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wallet", "balance"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet", "tokens"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] }),
    ]).finally(() => {
      // The spin is a receipt, not a progress bar: it says the ask left,
      // and it must end even when a refetch does not.
      setTimeout(() => setRefreshing(false), 600)
    })
  }

  // Handle token click for expand/collapse
  function handleTokenClick(token: Token) {
    if (expandedTokenMint === token.mint) {
      setExpandedTokenMint(null)
    } else {
      setExpandedTokenMint(token.mint || null)
      setSelectedTokenForSend(token)
    }
  }

  // Show loading state
  if (isLoadingWallet || isLoadingBalance) {
    /**
     * A SKELETON WITH WORDS, not a naked spinner. The "where is my money"
     * room painted nothing alive on a cold start - no shape, no sentence -
     * while the panel's other rooms already learned the cached-first
     * lesson. The skeleton mirrors the header the answer will land in, so
     * the paint is a fill-in rather than a re-layout.
     */
    return (
      <Box sx={{ flex: 1, minHeight: 0, px: 2, pt: 3 }}>
        <Box
          sx={{
            height: 10,
            width: 120,
            borderRadius: "6px",
            backgroundColor: "rgba(255,255,255,.07)",
          }}
        />
        <Box
          sx={{
            mt: 1.5,
            height: 34,
            width: 180,
            borderRadius: "10px",
            backgroundColor: "rgba(255,255,255,.09)",
          }}
        />
        <Box
          sx={{
            mt: 3,
            display: "flex",
            alignItems: "center",
            gap: 1,
            color: JUICE.text3,
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <CircularProgress size={13} sx={{ color: JUICE.accent }} />
          Reading your wallet…
        </Box>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            sx={{
              mt: 1.5,
              height: 52,
              borderRadius: "14px",
              backgroundColor: "rgba(255,255,255,.045)",
            }}
          />
        ))}
      </Box>
    )
  }

  if (!walletInfo?.exists) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "transparent",
          color: "#FFFFFF",
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            p: 3,
            gap: 1,
          }}
        >
          <Typography variant="h6">No wallet yet</Typography>
          <Typography variant="body2" sx={{ color: "#B2B2B2", textAlign: "center" }}>
            Set one up once and it is yours from then on.
          </Typography>
          <Button
            variant="outlined"
            size="small"
            disabled={isProvisioning}
            sx={{ mt: 2, color: JUICE.accent, borderColor: JUICE.accent }}
            onClick={() => {
              provisionWallets(undefined, {
                onSuccess: () => {
                  showToast("Wallet ready!", "success")
                },
                onError: (err: any) => {
                  showToast(
                    err?.message ?? "Could not provision wallet. Try again.",
                    "error",
                  )
                },
              })
            }}
          >
            {isProvisioning ? "Setting up..." : "Set up wallet"}
          </Button>
        </Box>
      </Box>
    )
  }

  const walletAddress = walletInfo?.wallet?.public_key || ""
  const truncatedWalletAddress =
    walletAddress.length > 12
      ? `${walletAddress.substring(0, 5)}...${walletAddress.substring(walletAddress.length - 5)}`
      : walletAddress

  return (
    <>
      {activeTab === "receive" && (
        <Receive setActiveTab={setActiveTab} walletAddress={walletAddress} />
      )}
      {(activeTab === "send" || activeTab === "send-final") && (
        <Send
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          tokens={tokens}
          walletAddress={walletAddress}
          truncatedWalletAddress={truncatedWalletAddress}
          solPrice={currentSOLPrice}
          preselectedToken={selectedTokenForSend}
        />
      )}
      {showExportDialog && (
        <ExportPrivateKey
          onClose={() => setShowExportDialog(false)}
          walletAddress={walletAddress}
        />
      )}

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          // flex:1 + minHeight:0, not height:100% — see views/panel-shell.spec.
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingBottom: "10px",
          position: "relative", // Add relative positioning for absolute children
        }}
      >
        {/* Header */}
        <Box
          sx={{
            pt: "8px",
            px: "10px",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <Box
            sx={{
              backgroundColor: JUICE.well,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "999px",
              color: "rgba(255,255,255,.85)",
              display: "flex",
              alignItems: "center",
              fontFamily: "PoppinSans",
              lineHeight: 1.5,
              fontSize: "12px",
              fontWeight: 600,
              paddingLeft: "10px",
              paddingRight: "10px",
              paddingY: "4px",
            }}
          >
            <Box
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginRight: "4px",
              }}
            >
              {truncatedWalletAddress}
            </Box>
          </Box>

          <IconButton
            aria-label="Copy wallet address"
            onClick={() => {
              navigator.clipboard.writeText(walletAddress)
              showToast("Wallet address copied!", "success")
            }}
            sx={{
              padding: "6px",
              backgroundColor: JUICE.well,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "999px",
              "&:hover": { backgroundColor: "rgba(122,183,255,.10)" },
            }}
          >
            <ContentCopyIcon sx={{ fontSize: 15, color: JUICE.text2 }} />
          </IconButton>

          {CAP.keyExport && (
          <IconButton
            aria-label="Export private key"
            onClick={() => setShowExportDialog(true)}
            sx={{
              padding: "6px",
              backgroundColor: JUICE.well,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "999px",
              "&:hover": { backgroundColor: "rgba(122,183,255,.10)" },
            }}
          >
            <FileDownloadIcon sx={{ fontSize: 15, color: JUICE.text2 }} />
          </IconButton>
          )}
        </Box>

        <Box
          sx={{
            marginTop: "14px",
            paddingX: "10px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* THE SAME WORDS AS THE FRONT DOOR. "TOTAL BALANCE" named no
              scope, so the reader had no way to know this measured a
              different set from the headline they had just left. One
              caption, owned by helpers/portfolioTotal.ts. */}
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".04em",
              color: JUICE.text3,
            }}
          >
            {PORTFOLIO_CAPTION}
          </Typography>

          {/* One number in one voice: dollars white and bold, cents a step
              quieter, the eye a quiet inline control. The blue "$" and the
              floating eye at right:-40px were the old language. */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              marginTop: "12px",
              gap: "8px",
            }}
          >
            <Typography
              sx={{
                color: "#FFFFFF",
                fontWeight: 700,
                fontSize: "40px",
                lineHeight: 1.1,
                letterSpacing: "-1px",
                fontVariantNumeric: "tabular-nums",
                fontFamily: JUICE.mono,
                textShadow: JUICE.neonText,
              }}
            >
              {!showBalance ? (
                "••••••"
              ) : totalBalance === null ? (
                /* The book did not answer. A dash says so; a $0.00 would
                   claim the reader has nothing. */
                "—"
              ) : (
                <>
                  ${Math.floor(totalBalance).toLocaleString("en-US")}
                  <Typography
                    component="span"
                    sx={{
                      color: JUICE.text3,
                      fontSize: "40px",
                      fontWeight: 700,
                      letterSpacing: "-1px",
                      fontFamily: JUICE.mono,
                    }}
                  >
                    .{totalBalance.toFixed(2).split(".")[1]}
                  </Typography>
                </>
              )}
            </Typography>

            <IconButton
              aria-label={showBalance ? "Hide balance" : "Show balance"}
              onClick={() => setShowBalance(!showBalance)}
              sx={{
                padding: "6px",
                color: JUICE.text3,
                "&:hover": { color: JUICE.text2, backgroundColor: JUICE.well },
              }}
            >
              {showBalance ? <Visibility sx={{ fontSize: 18 }} /> : <VisibilityOff sx={{ fontSize: 18 }} />}
            </IconButton>

            {/* ASK AGAIN, BY HAND. Balances arrive from Jupiter and settle a
                beat after a swap does; the screen polls SOL every 30s and
                tokens not at all. Reported as "swap yapınca güncellenmiyor",
                and the honest fix is not a shorter poll — it is a control,
                so a reader who knows something changed can say so instead
                of waiting and wondering whether the product noticed. */}
            <IconButton
              onClick={refreshMoney}
              disabled={refreshing}
              aria-label="Refresh balances"
              sx={{
                padding: "6px",
                color: JUICE.text3,
                "&:hover": { color: JUICE.text2, backgroundColor: JUICE.well },
                "&.Mui-disabled": { color: JUICE.text3 },
                "& svg": {
                  transition: "transform 600ms cubic-bezier(.16,1,.3,1)",
                  transform: refreshing ? "rotate(360deg)" : "none",
                },
              }}
            >
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>

          {/* THE MONEY, NAMED. The total above is every token at its price —
              a number that moves with the market and cannot be spent. What
              a Buy actually spends is the USDC, and this header carried no
              USDC figure at all. Same grammar the chip's scoreboard uses
              one surface over ("USDC $12.40"). */}
          {showBalance && usdcCash > 0 && (
            <Typography
              sx={{ mt: 0.75, fontSize: 12.5, fontWeight: 600, color: JUICE.text3 }}
            >
              Cash&nbsp;
              <Box
                component="span"
                sx={{ color: "#FFFFFF", fontVariantNumeric: "tabular-nums" }}
              >
                {usd(usdcCash)}
              </Box>
              &nbsp;USDC
            </Typography>
          )}

          {/* MONEY THAT IS YOURS BUT NOT HERE. A standing buy escrows its
              USDC on chain the moment it is placed, so the wallet stops
              holding it and every balance on this screen correctly stops
              counting it. Correct, and unreadable: $300 committed to an
              order looked exactly like $300 that had vanished ("bakiyemin
              321 olması lazım 21 yerine" — 21.37 spendable plus a $300
              order, to the cent). The money says where it went now, and
              the line is a door to the orders themselves. */}
          {showBalance && committedUsd > 0 && (
            <Box
              onClick={() => setActiveTab("orders")}
              sx={{
                marginTop: "8px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                paddingY: "3px",
                paddingX: "10px",
                borderRadius: "999px",
                backgroundColor: JUICE.well,
                border: `1px solid ${JUICE.border}`,
                color: JUICE.text2,
                fontSize: "12px",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                fontFamily: JUICE.mono,
                "&:hover": { borderColor: JUICE.accent, color: JUICE.text },
              }}
            >
              {/* GROUPED, like every other dollar figure in the product.
                  toFixed(2) alone prints "$1234.57"; the front door's copy
                  of this exact sentence prints "$1,234.57", and one tap
                  turns one into the other. helpers/youPanelView.ts states
                  the rule: "a person reads $1,234.56 without counting
                  digits". */}
              +{usd(committedUsd)} in open orders →
            </Box>
          )}


          {/* The trade card's exact action grammar: accent with dark text
              for the primary, glass for the neighbour, both pills. 24px
              button type was shouting over the balance above it. */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              alignSelf: "stretch",
              px: "10px",
              marginTop: "16px",
              gap: "10px",
            }}
          >
            <Button
              variant="text"
              sx={{
                flex: 1,
                height: "44px",
                color: "#FFFFFF",
                backgroundColor: JUICE.well,
                border: `1px solid ${JUICE.border}`,
                fontSize: "15px",
                fontWeight: 700,
                textTransform: "none",
                borderRadius: "999px",
                "&:hover": { backgroundColor: "rgba(122,183,255,.10)" },
              }}
              onClick={() => setActiveTab("receive")}
            >
              {/* The same words as the screen it opens. "Receive" named a
                  direction; this names the money. */}
              Deposit USDC
            </Button>

            {/* Send is a Solana action. */}
            {(
              <Button
                variant="text"
                sx={{
                  flex: 1,
                  height: "44px",
                  color: JUICE.onAccent,
                  backgroundColor: JUICE.accent,
                  fontSize: "15px",
                  fontWeight: 700,
                  textTransform: "none",
                  borderRadius: "999px",
                  boxShadow: "0 8px 26px -8px rgba(104,198,255,.55)",
                  "&:hover": { backgroundColor: "#86D2FF" },
                }}
                onClick={() => setActiveTab("send")}
              >
                Send
              </Button>
            )}
          </Box>

          {/* THE TAB RAIL TAKES A SECOND LINE; IT DOES NOT SLIDE.
              Four pills do not fit one line of a 320px panel. Measured in
              the shipped face (public/fonts/Poppins-Bold.ttf is what weight
              700 of PoppinSans resolves to — helpers/brandFont.ts maps the
              two) at 12.5px and at NORMAL tracking: MUI's typography.button
              carries a 0.02857em letter-spacing only when the theme leaves
              fontFamily at its Roboto default, because createTypography
              emits the key inside `fontFamily === defaultFontFamily`, and
              helpers/themeHelper.ts sets fontFamily "PoppinSans" — so the
              object Button spreads has no letterSpacing at all. Tokens 46.2
              + Orders 43.7 + "Your pops" 64.7 + Activity 50.0 = 204.6px of
              label. Add 4x34px of pill chrome (2x16px of paddingX plus a 1px
              border either side) and 3x10px of gap and the row wants
              370.6px, against a ~298px content box — 320 less the theme's
              2px hairline scrollbar and this column's 10px gutters.

              With no wrap and no overflow the row paid that ~72.6px deficit
              the only way flexbox left it: by shrinking every pill below its
              own label. "Your pops" is the only two-word label, so it was
              the one that could break — two 12.5px lines are 43.75px of text
              inside a pill pinned at 32px, which is the reported spill. The
              one-word labels cannot break, so they bled sideways through
              their own borders instead. It was a rail-capacity failure;
              "Your pops" was just the loudest symptom of it.

              flexWrap is the valve, and it is the house's settled answer for
              a pill row that outgrows this panel. The written ruling is in
              components/profile/ProfileFeed.tsx: that row WAS overflowX:"auto"
              with the scrollbar styled invisible, and it was torn out
              because at 320px the last segment simply lived off-screen with
              nothing to hint that it existed. A hidden scrollbar does not
              make a row fit, it makes the shortfall invisible — and on a
              rail of TABS the cost is worse than on a feed filter: a clipped
              tab is a destination the reader cannot find and, when it is
              the active one, an accent pill nobody can see.

              Wrap alone buys the fit here, with no token, type, padding or
              label touched: flex line-breaking runs on each item's
              hypothetical main size, so line one takes the three pills that
              fit — 80.2 + 10 + 77.7 + 10 + 98.7 = 276.6px, 21.4px inside
              the 298px box — and Activity drops whole onto line two at
              84.0px, where gap:"10px" doubles as the row-gap. Past ~392.6px
              of panel (370.6 + the 20px gutters + the 2px bar) all four sit
              on one line again, which is where they were always meant to be.
              The arithmetic is pinned in wallet-tabs.spec.ts, which lays the
              pills out the way flex does and fails if any line runs past
              the box — so a padding or gap bump fails a test instead of
              re-clipping somebody's panel. */}
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              width: "100%",
              gap: "10px",
              marginTop: "40px",
            }}
          >
            <Button
              variant="text"
              sx={{
                paddingX: "16px",
                height: "32px",
                /* minWidth:0 defeats MUI's own minWidth:64 so a short pill
                   is sized by its own label and no wider. whiteSpace:"nowrap"
                   keeps that label on one line: MUI's Button declares no
                   white-space of its own, and a label breaking inside a 32px
                   pill is exactly how "Your pops" broke.

                   There is deliberately NO flexShrink:0 here. It used to be,
                   to force the rail to scroll; with the rail wrapping
                   (flexWrap above) a pill is never asked to shrink — a line
                   is only formed from pills that already fit it — so pinning
                   the shrink factor would buy nothing and would re-state the
                   scroll-instead-of-wrap decision this row just reversed.
                   The other three pills carry the same two lines. */
                minWidth: 0,
                whiteSpace: "nowrap",
                color: activeTab === "tokens" ? JUICE.onAccent : JUICE.text2,
                fontWeight: 700,
                fontSize: "12.5px",
                textTransform: "none",
                backgroundColor:
                  activeTab === "tokens" ? JUICE.accent : JUICE.well,
                border: `1px solid ${activeTab === "tokens" ? JUICE.accent : JUICE.border}`,
                borderRadius: "999px",
                "&:hover": {
                  backgroundColor:
                    activeTab === "tokens" ? JUICE.accent : JUICE.border,
                },
              }}
              onClick={() => setActiveTab("tokens")}
            >
              Tokens
            </Button>


            {/* ORDERS. A standing order is money that has been committed and
                not yet spent — the escrow is on chain and the balance above
                does not show it. It was listed on the profile, in the
                positions view and under the asset it belongs to, and NOT on
                the one screen whose whole job is "where is my money". Solana
                only: the trigger rails are Jupiter's. */}
            {(
              <Button
                variant="text"
                sx={{
                  paddingX: "16px",
                  height: "32px",
                  // Sized by its own label and kept on one line; the RAIL
                  // wraps rather than any pill squeezing. See the Tokens
                  // pill above.
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  color: activeTab === "orders" ? JUICE.onAccent : JUICE.text2,
                  fontWeight: 700,
                  fontSize: "12.5px",
                  textTransform: "none",
                  backgroundColor:
                    activeTab === "orders" ? JUICE.accent : JUICE.well,
                  border: `1px solid ${activeTab === "orders" ? JUICE.accent : JUICE.border}`,
                  borderRadius: "999px",
                  "&:hover": {
                    backgroundColor:
                      activeTab === "orders" ? JUICE.accent : JUICE.border,
                  },
                }}
                onClick={() => setActiveTab("orders")}
              >
                Orders
              </Button>
            )}

            {/* TRADES. The spot ledger itself — every buy and sell the
                product signed, newest first. Orders is money committed,
                Activity is transfers on chain; neither answers "what did I
                actually trade", which is the first question a trading
                product must answer about itself. Solana only, like Orders:
                the spot rail is Jupiter's. */}
            {(
              <Button
                variant="text"
                sx={{
                  paddingX: "16px",
                  height: "32px",
                  // Sized by its own label and kept on one line; the RAIL
                  // wraps rather than any pill squeezing. See the Tokens
                  // pill above. This is the pill the report was about: two
                  // words, one line.
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  color: activeTab === "trades" ? JUICE.onAccent : JUICE.text2,
                  fontWeight: 700,
                  fontSize: "12.5px",
                  textTransform: "none",
                  backgroundColor:
                    activeTab === "trades" ? JUICE.accent : JUICE.well,
                  border: `1px solid ${activeTab === "trades" ? JUICE.accent : JUICE.border}`,
                  borderRadius: "999px",
                  "&:hover": {
                    backgroundColor:
                      activeTab === "trades" ? JUICE.accent : JUICE.border,
                  },
                }}
                onClick={() => setActiveTab("trades")}
              >
                {/* "Your pops" and not "Trades": every other product has a
                    trades list, and none of them knows WHY you traded. This
                    one does, because each row carries the post it came from.
                    Naming the tab after that is the cheapest way to make the
                    difference visible before anybody opens it. That decision
                    is why the rail above takes a second line instead of this
                    label being shortened to fit — the name is the feature.

                    Read from popLanguage rather than typed here, because
                    that file exists to stop exactly this drift: it already
                    owns the word ("historyTitle"), and the history screen
                    it names must never end up called something else. Same
                    nine characters, same pixels. */}
                {popCopy.historyTitle}
              </Button>
            )}

            {/* Activity tab — shown for both chains. Recent Activity used to
                live at the bottom of the Tokens panel; promoting it to a
                first-class tab makes the Tokens view shorter and gives
                transaction history equal billing with the other panels. */}
            <Button
              variant="text"
              sx={{
                paddingX: "16px",
                height: "32px",
                // Sized by its own label and kept on one line; the RAIL
                // wraps rather than any pill squeezing. See the Tokens pill
                // above. At a 320px panel this is the pill that takes the
                // second line — whole, tappable and visibly the active one
                // when it is active, which a slid rail could not do.
                minWidth: 0,
                whiteSpace: "nowrap",
                color: activeTab === "activity" ? JUICE.onAccent : JUICE.text2,
                fontWeight: 700,
                fontSize: "12.5px",
                textTransform: "none",
                backgroundColor:
                  activeTab === "activity" ? JUICE.accent : JUICE.well,
                border: `1px solid ${activeTab === "activity" ? JUICE.accent : JUICE.border}`,
                borderRadius: "999px",
                "&:hover": {
                  backgroundColor:
                    activeTab === "activity" ? JUICE.accent : JUICE.border,
                },
              }}
              onClick={() => setActiveTab("activity")}
            >
              Activity
            </Button>

          </Box>

          {activeTab === "orders" && (
            <Box sx={{ marginTop: "10px", width: "100%", px: "10px" }}>
              {/* showEmpty: somebody who pressed Orders went looking. A
                  silent panel there cannot be told apart from "this product
                  does not do that", which is the report that put this list
                  on the profile in the first place. */}
              <OpenOrders showEmpty onCancelled={() => setOrdersNonce((n) => n + 1)} />
            </Box>
          )}

          {activeTab === "trades" && (
            <Box sx={{ marginTop: "10px", width: "100%", px: "10px" }}>
              <TradeHistory />
            </Box>
          )}

          {activeTab === "tokens" && (
            <Box
              sx={{
                marginTop: "10px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                width: "100%",
                // The one tab body that had no inset of its own, so token
                // tiles sat 10px wider than the Orders/Trades/Activity lists
                // beside them. Six tabs now agree. The tradeoff, stated
                // rather than hidden: the tiles are inset from the tab rail
                // above (which is the parent's full width) instead of flush
                // with it — the same relationship every other tab body has.
                px: "10px",
              }}
            >
              {isLoadingTokens ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress size={24} sx={{ color: JUICE.accent }} />
                </Box>
              ) : tokens.length > 0 ? (
                tokens.map((token, index) => {
                  const isExpanded = expandedTokenMint === token.mint
                  return (
                    <Box
                      key={token.mint || token.symbol + index}
                      onClick={() => handleTokenClick(token)}
                      sx={{
                        width: "100%",
                        padding: "10px",
                        // The same tile the feed and the Trades list wear:
                        // a real surface on the lit ground, 16px corners, an
                        // accent edge when open. The slate slab with a
                        // gradient border and a scale-on-hover belonged to
                        // the old visual language — and a money row that
                        // grows when you point at it is exactly the kind of
                        // motion this product does not do.
                        borderRadius: "16px",
                        border: `1px solid ${
                          isExpanded
                            ? "rgba(104,198,255,0.45)"
                            : "rgba(255,255,255,0.07)"
                        }`,
                        backgroundColor: isExpanded ? "#13131B" : "#0F0F16",
                        display: "flex",
                        flexDirection: "column",
                        cursor: "pointer",
                        transition:
                          "background-color .16s ease-out, border-color .16s ease-out",
                        "&:hover": {
                          backgroundColor: "#13131B",
                          borderColor: "rgba(104,198,255,0.28)",
                        },
                      }}
                    >
                      {/* Token Header Row */}
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          width: "100%",
                        }}
                      >
                        <Avatar
                          src={token.logoURI}
                          sx={{
                            backgroundColor: token.logoURI
                              ? "transparent"
                              : token.iconBg,
                            borderRadius: "50%",
                            width: "38px",
                            height: "38px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "20px",
                            fontWeight: 700,
                          }}
                        >
                          {!token.logoURI && token.icon}
                        </Avatar>

                        {/* THE IDENTITY COLUMN YIELDS; THE MONEY DOES NOT.
                            This column had no flex and no minWidth, so a long
                            token name could not ellipsize — a flex item floors
                            at min-content — and wrapped instead, leaving rows
                            in one list at different heights. flex:1 + minWidth:0
                            is the same shape every other list in the panel uses
                            (views/Discover.tsx, components/ActionBar.tsx), and
                            it replaces the flexGrow spacer that used to sit
                            between the two columns. */}
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            marginLeft: "10px",
                            justifyContent: "center",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Typography
                            noWrap
                            sx={{
                              color: "#FFFFFF",
                              fontWeight: 700,
                              fontSize: "14px",
                              lineHeight: 1.25,
                            }}
                          >
                            {token.name}
                          </Typography>

                          <Typography
                            noWrap
                            sx={{
                              color: JUICE.text3,
                              fontWeight: 600,
                              fontSize: "11.5px",
                            }}
                          >
                            {token.amount} {token.symbol}
                            {token.mint === SOL_MINT && " · not counted above"}
                          </Typography>
                        </Box>

                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginLeft: "10px",
                          }}
                        >
                          <Typography
                            sx={{
                              color: "#FFFFFF",
                              fontWeight: 700,
                              fontSize: "14px",
                              lineHeight: 1.25,
                              fontVariantNumeric: "tabular-nums",
                              fontFamily: JUICE.mono,
                            }}
                          >
                            {showBalance ? token.value : "••••"}
                          </Typography>

                          <Box
                            sx={{
                              paddingX: "7px",
                              borderRadius: "999px",
                              backgroundColor: showBalance
                                ? token.change.startsWith("+")
                                  ? "rgba(48,209,88,.12)"
                                  : token.change === "-"
                                    ? JUICE.well
                                    : "rgba(255,69,58,.12)"
                                : JUICE.well,
                              color: showBalance
                                ? token.change.startsWith("+")
                                  ? "#30D158"
                                  : token.change === "-"
                                    ? JUICE.text3
                                    : "#FF453A"
                                : JUICE.text3,
                              fontSize: "11px",
                              fontWeight: 700,
                              fontVariantNumeric: "tabular-nums",
                              marginTop: "1px",
                            }}
                          >
                            {showBalance ? token.change : "••••"}
                          </Box>
                        </Box>
                      </Box>

                      {/* Expanded Actions */}
                      {isExpanded && (
                        <Box
                          sx={{
                            marginTop: "12px",
                            padding: "12px",
                            borderRadius: "12px",
                            border: "1px solid #68C6FF33",
                            background: "linear-gradient(#0D1116, #0D1116)",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Box sx={{ display: "flex", gap: "8px" }}>
                            <Button
                              variant="contained"
                              onClick={() => {
                                setSelectedTokenForSend(token)
                                setActiveTab("send")
                              }}
                              sx={{
                                flex: 1,
                                height: "40px",
                                backgroundColor: JUICE.accent,
                                color: "black",
                                fontSize: "14px",
                                fontWeight: 600,
                                borderRadius: "12px",
                                textTransform: "none",
                                "&:hover": {
                                  backgroundColor: lighten(JUICE.accent, 0.1),
                                },
                              }}
                            >
                              Send
                            </Button>
                            {/* THE TRADE ROOM IS THE TRADE ROOM. This
                                opened the wallet's OWN swap terminal —
                                1,211 lines of a second buy/sell UI beside
                                the TradeSheet every other surface uses,
                                with its own quote, its own slippage and no
                                chart, no position, no orders. The row now
                                opens the asset's room, where the product
                                actually trades. */}
                            <Button
                              variant="contained"
                              onClick={() => navigate(`/token/${token.mint}`)}
                              sx={{
                                flex: 1,
                                height: "40px",
                                backgroundColor: lighten(
                                  theme.palette.secondary.main,
                                  0.02
                                ),
                                color: "#FFFFFF",
                                fontSize: "14px",
                                fontWeight: 600,
                                borderRadius: "12px",
                                textTransform: "none",
                                border: `1px solid ${lighten(theme.palette.secondary.main, 0.1)}`,
                                "&:hover": {
                                  backgroundColor: lighten(
                                    theme.palette.secondary.main,
                                    0.08
                                  ),
                                },
                              }}
                            >
                              Buy / Sell
                            </Button>
                            {/*
                              THE DOOR INTO THE ASSET, not just three ways
                              to move it. A held row already shows a live
                              24h chip - a number that invites a decision -
                              and every control beside it was plumbing:
                              Send, Swap, Receive. The room with the chart,
                              the position and the trade sheet was one tap
                              away and nothing here pointed at it.
                            */}
                            <Button
                              variant="contained"
                              onClick={() => navigate(`/token/${token.mint}`)}
                              sx={{
                                flex: 1,
                                height: "40px",
                                backgroundColor: "transparent",
                                color: JUICE.accent,
                                fontSize: "14px",
                                fontWeight: 600,
                                borderRadius: "12px",
                                textTransform: "none",
                                border: `1px solid ${alpha(JUICE.accent, 0.4)}`,
                                "&:hover": {
                                  backgroundColor: alpha(JUICE.accent, 0.12),
                                },
                              }}
                            >
                              Open
                            </Button>
                          </Box>
                        </Box>
                      )}
                    </Box>
                  )
                })
              ) : (
                <Box sx={{ py: 4, textAlign: "center" }}>
                  <Typography sx={{ color: "#8B92A0", fontSize: "14px" }}>
                    Nothing yet. Deposit USDC to start.
                  </Typography>
                </Box>
              )}
              {/* UNDER THE LIST THAT HIDES THEM. This line used to render
                  inside the Activity tab - the reader asking "where is the
                  airdrop Solscan shows?" is looking HERE, and the count's
                  own comment names the stakes: silence about held things. */}
              {hiddenSpamCount > 0 && (
                <Typography
                  sx={{
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    color: JUICE.text3,
                    pt: "10px",
                  }}
                >
                  {hiddenSpamCount} unrecognized token{hiddenSpamCount > 1 ? "s" : ""} hidden
                </Typography>
              )}
            </Box>
          )}

          {/* Solana Activity. The backend merges DB-recorded swaps with
              on-chain SOL/SPL transfers; rows from the retired EVM era
              carry a non-Solana chain in their metadata and are filtered
              out below so this view stays what its label says. */}
          {activeTab === "activity" && (
            <Box sx={{ marginTop: "10px", width: "100%", px: "10px" }}>
              {isLoadingSolanaTxs ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress size={24} sx={{ color: JUICE.accent }} />
                </Box>
              ) : (() => {
                const solanaTxs = (solanaTxData?.transactions ?? []).filter((tx) => {
                  if (!tx.metadata) return true
                  try {
                    const meta = typeof tx.metadata === "string" ? JSON.parse(tx.metadata) : tx.metadata
                    return meta?.chain !== "polygon"
                  } catch {
                    return true
                  }
                })
                if (solanaTxs.length === 0) {
                  return (
                    <Box sx={{ py: 4, textAlign: "center" }}>
                      <Typography sx={{ color: "#8B92A0", fontSize: "14px" }}>
                        No transactions yet
                      </Typography>
                    </Box>
                  )
                }
                return (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {solanaTxs.map((tx) => {
                      const row = activityRow(tx, (mint) =>
                        tokensData?.tokens?.find((t) => t.mint === mint)?.symbol ?? null,
                      )
                      const counterparty = tx.transaction_type.startsWith("send")
                        ? tx.to_address
                        : tx.from_address
                      const date = new Date(tx.created_at)
                      const ink =
                        row.direction === "in"
                          ? JUICE.buyInk
                          : row.direction === "out"
                            ? JUICE.sellInk
                            : JUICE.accent
                      const ground =
                        row.direction === "in"
                          ? JUICE.buyGround
                          : row.direction === "out"
                            ? JUICE.sellGround
                            : "rgba(104,198,255,0.2)"
                      return (
                        <Box
                          key={tx.id}
                          onClick={() => {
                            // The edition's explorer; on Arc only a real 0x hash links.
                            const url = tx.signature ? explorerTxUrl(tx.signature) : null
                            if (url) window.open(url, "_blank")
                          }}
                          sx={{
                            p: "10px",
                            borderRadius: "12px",
                            backgroundColor: JUICE.well,
                            border: "1px solid rgba(255,255,255,0.05)",
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            cursor: tx.signature ? "pointer" : "default",
                            "&:hover": tx.signature ? { backgroundColor: "rgba(255,255,255,0.09)" } : {},
                          }}
                        >
                          <Box sx={{
                            width: 28, height: 28, borderRadius: "50%",
                            backgroundColor: ground,
                            color: ink,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "14px", fontWeight: 700,
                          }}>
                            {row.direction === "in" ? "↓" : row.direction === "out" ? "↑" : "⇄"}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ color: "#FFFFFF", fontSize: "12px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {row.verb} {row.subject}
                            </Typography>
                            <Typography sx={{ color: "#B2B2B2", fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {counterparty ? `${counterparty.slice(0, 6)}...${counterparty.slice(-4)}` : "—"} · {date.toLocaleDateString()}
                            </Typography>
                          </Box>
                          <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                            {/* An empty string here is the point, not an
                                oversight: a legacy token-to-token row has no
                                USDC leg to price it by, and the column stays
                                blank rather than showing a number that means
                                something else. */}
                            {row.amountText !== "" && (
                              <Typography sx={{ color: ink, fontSize: "12px", fontWeight: 600, fontFamily: JUICE.mono }}>
                                {row.amountText}
                              </Typography>
                            )}
                            <Typography sx={{ color: tx.status === "confirmed" ? "#B2B2B2" : tx.status === "failed" ? JUICE.redSoft : "#FFD166", fontSize: "10px" }}>
                              {tx.status}
                            </Typography>
                          </Box>
                        </Box>
                      )
                    })}
                  </Box>
                )
              })()}
            </Box>
          )}

        </Box>
      </Box>
    </>
  )
}
