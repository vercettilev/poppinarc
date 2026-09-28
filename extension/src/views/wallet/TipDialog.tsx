/**
 * Extracted VERBATIM from wallet-ui.tsx (V2-PLAN.md Faz D). This file handles
 * real money: the split moved code, it did not edit it. The import block is
 * the original file's, shared by every sibling — unused lines cost nothing
 * and diffing against history stays trivial.
 */
import { normalizeDecimal } from "~/helpers/decimalInput"
import { swappableUi } from "~/helpers/swapMax"
import { USDC_MINT } from "~/helpers/depositWatch"
import { JUICE } from "~/theme/juice"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import ContentCopyIcon from "@mui/icons-material/ContentCopy"
import ExpandMore from "@mui/icons-material/ExpandMore"
import FileDownloadIcon from "@mui/icons-material/FileDownload"
import SearchIcon from "@mui/icons-material/Search"
import SwapHorizIcon from "@mui/icons-material/SwapHoriz"
import SwapVert from "@mui/icons-material/SwapVert"
import WalletIcon from "@mui/icons-material/Wallet"
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
import { useToast } from "~/components/Toast/ToastProvider"
import { useCreateComment } from "~/hooks/useComments"
import { useCurrentUser } from "~/hooks/useCurrentUser"
import { useExecuteSwap, useSwapQuote } from "~/hooks/useTerminalTokens"
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

import type { Token } from "./types"
import { humanApiError } from "~/helpers/apiError"

interface TipDialogProps {
  open: boolean
  onClose: () => void
  recipient: {
    id: string
    username: string
    display_name?: string
    wallet_address?: string | null
  } | null
  postId?: string // Post ID for tipper badge tracking
}

export function TipDialog(props: TipDialogProps) {
  const theme = useTheme()
  const { showToast } = useToast()
  const { mutateAsync: createComment } = useCreateComment()

  // Fetch wallet data
  const { data: balanceData, isLoading: isLoadingBalance } = useWalletBalance()
  const { data: tokensData, isLoading: isLoadingTokens } = useWalletTokens()
  const { data: solPrice, isLoading: isLoadingPrice } = useSOLPrice()

  // Get current SOL price
  const currentSOLPrice = solPrice?.usd || 0
  const sol24hChange = solPrice?.usd_24h_change || 0

  // SOL mint address constant
  const SOL_MINT = "So11111111111111111111111111111111111111112"

  // Process tokens data - now using aggregated data from backend
  const tokens: Token[] = useMemo(() => {
    const tokenList: Token[] = []

    // Try to find wrapped SOL in the tokens data to get its logoURI dynamically
    const wrappedSolToken = tokensData?.tokens?.find((t: any) => t.mint === SOL_MINT)
    const solLogoURI = wrappedSolToken?.logoURI || "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"

    // Add SOL token
    if (balanceData?.balance && currentSOLPrice > 0) {
      const solValue = balanceData.balance.sol * currentSOLPrice
      const sol24hChangePercent = sol24hChange
      const changeSign = sol24hChangePercent >= 0 ? "+" : ""

      tokenList.push({
        name: "Solana",
        symbol: "SOL",
        amount: balanceData.balance.sol.toFixed(4),
        value: `$${solValue.toFixed(2)}`,
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
        // Backend now returns all metadata: name, symbol, decimals, logoURI, price, usdValue, priceChange24h
        const name = token.name || `${token.mint.substring(0, 8)}...`
        const symbol = token.symbol || "TOKEN"
        const logoURI = token.logoURI
        const usdValue = token.usdValue || 0
        const priceChange24h = token.priceChange24h || 0

        tokenList.push({
          name,
          symbol,
          amount: token.uiAmount.toFixed(token.decimals),
          value: usdValue > 0 ? `$${usdValue.toFixed(2)}` : "-",
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

    // Sort tokens by USD value (highest first), tokens with no value at the end
    tokenList.sort((a, b) => {
      const aValue = a.value === "-" ? 0 : parseFloat(a.value.replace("$", ""))
      const bValue = b.value === "-" ? 0 : parseFloat(b.value.replace("$", ""))
      return bValue - aValue
    })

    return tokenList
  }, [balanceData, tokensData, currentSOLPrice, sol24hChange])

  const [selectedToken, setSelectedToken] = useState<Token | null>(null)
  /**
   * "" NOT 0. A numeric state rendered a literal 0 in the box that the
   * reader had to select and delete before typing anything - the money
   * field on a screen whose whole job is one number. Empty is also the
   * honest starting state: nothing has been chosen yet, and a 0 sitting
   * there reads as a chosen amount of nothing.
   */
  const [amount, setAmount] = useState<number | "">("")
  const [isSending, setIsSending] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  /** The landed tip, for the in-dialog success beat. The old path toasted
   *  and left the armed dialog up for 1.5s - a fast second tap could start
   *  a second transfer - then closed onto an unchanged feed. */
  const [sentTip, setSentTip] = useState<null | { amount: number; symbol: string }>(null)
  const [commentMessage, setCommentMessage] = useState("")

  // Set first token as selected when tokens are loaded
  useEffect(() => {
    if (tokens.length > 0 && !selectedToken) {
      setSelectedToken(tokens[0])
    }
  }, [tokens, selectedToken])

  /**
   * WHAT A TIP MAY ACTUALLY SPEND — the balance, minus the network-fee
   * reserve when the asset IS the fee currency.
   *
   * Send and Swap were both fixed to respect this reserve; the tip screen
   * was left behind, so Max filled the whole SOL balance and the transfer
   * then failed for the fee it had just given away. Same helper, same
   * reserve, so the three money screens cannot disagree about what "all of
   * it" means.
   */
  const availableBalance = selectedToken
    ? swappableUi(
        selectedToken.amountExact ?? selectedToken.amount,
        selectedToken.decimals ?? 9,
        selectedToken.mint,
      )
    : 0

  /**
   * The typed figure as a NUMBER, or null when the box is empty. Every
   * check and every send below reads this, so an empty box can never be
   * mistaken for a zero-value tip on its way to the chain.
   */
  const amountNum = typeof amount === "number" ? amount : null

  // Validation
  const isValid =
    amountNum !== null && amountNum > 0 && amountNum <= availableBalance && !isSending

  // Handle setting max amount
  function handleSetMaxAmount() {
    setAmount(availableBalance)
  }

  // Convert amount to USD for display
  function convertAmountToUSD(amount: number | ""): string {
    if (amount === "") return "0.00"
    if (selectedToken?.symbol === "SOL") {
      const usdValue = amount * currentSOLPrice
      return usdValue.toFixed(2)
    }
    // USDC IS its own dollar. This screen priced SOL and answered "-" for
    // the product's own money — the one place SOL was better supported
    // than USDC.
    if (selectedToken?.mint === USDC_MINT) return amount.toFixed(2)
    return "-"
  }

  // Early return if no recipient
  if (!props.recipient) {
    return null
  }

  // Handle close with state reset
  function handleClose() {
    setCommentMessage("")
    setAmount("")
    setSentTip(null)
    props.onClose()
  }

  // Handle confirm send
  async function handleConfirmSend() {
    if (!selectedToken || !props.recipient || amountNum === null) return

    setShowConfirmDialog(false)
    setIsSending(true)

    try {
      let result

      if (selectedToken.symbol === "SOL") {
        result = await WalletService.transferSOL({
          to_user_id: props.recipient.id,
          post_id: props.postId,
          amount: amountNum,
        })
      } else if (selectedToken.mint) {
        result = await WalletService.transferToken({
          to_user_id: props.recipient.id,
          post_id: props.postId,
          mint: selectedToken.mint,
          amount: amountNum,
        })
      } else {
        throw new Error("Invalid token configuration")
      }

      if (result.success) {
        // If there's a comment message and postId, create the tip comment
        if (commentMessage.trim() && props.postId && props.recipient) {
          try {
            await createComment({
              content: commentMessage.trim(),
              post_id: props.postId,
              // Include tip information for TipComment display
              tip_amount: amount.toString(),
              tip_token: selectedToken.symbol,
              recipient_username: props.recipient.username,
            })
          } catch (commentError) {
            console.error("Failed to create tip comment", commentError)
            // Don't fail the whole operation if comment fails
          }
        }

        // The beat happens IN the dialog: the send controls unmount (the
        // double-fire window disappears with them), the check names the
        // money, and one door leads on.
        setSentTip({ amount: amountNum, symbol: selectedToken.symbol })
      } else {
        showToast(result.message || "Transaction failed", "error")
      }
    } catch (error: any) {
      console.error("Tip error", error)
      showToast(humanApiError(error, "Failed to send tip"), "error")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <>
      {/* Main Tip Dialog */}
      <Dialog
        open={props.open}
        onClose={handleClose}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: "#0F0F16",
            border: "1px solid rgba(255,255,255,0.07)",
              color: "#FFFFFF",
              borderRadius: "16px",
              minWidth: "320px",
              maxWidth: "400px",
              maxHeight: "80vh",
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            fontSize: "14px",
            fontWeight: 700,
            borderBottom: `1px solid ${JUICE.border}`,
            pb: 2,
            color: "#FFFFFF",
          }}
        >
          Send Tip to @{props.recipient.username}
        </DialogTitle>

        <DialogContent sx={{ pt: 3, pb: 2 }}>
          {sentTip ? (
            /* THE SUCCESS BEAT, in place of the form: the send controls are
               gone (so is the double-fire window), the check names the
               money, one door leads on. Static under reduced motion via
               the global gate. */
            <Box sx={{ textAlign: "center", py: 3 }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  mx: "auto",
                  mb: 1.5,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#06240F",
                  background: "linear-gradient(180deg,#5BE58F,#22C55E)",
                  boxShadow: JUICE.glowPop,
                }}
              >
                ✓
              </Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
                Tipped {sentTip.amount} {sentTip.symbol} to @
                {props.recipient.username}
              </Typography>
              <Button
                onClick={handleClose}
                sx={{
                  mt: 2,
                  px: 3,
                  py: 1,
                  fontSize: "13px",
                  fontWeight: 700,
                  textTransform: "none",
                  color: "#FFFFFF",
                  background: JUICE.well,
                  border: `1px solid ${JUICE.border}`,
                  borderRadius: "999px",
                }}
              >
                Done
              </Button>
            </Box>
          ) : isLoadingBalance || isLoadingTokens ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress sx={{ color: JUICE.accent }} />
            </Box>
          ) : (
            <Stack spacing={2}>
              {/* Token Selection */}
              <Box>
                <Typography
                  sx={{
                    color: "#8B92A0",
                    fontSize: "12px",
                    fontWeight: "500",
                    marginBottom: "10px",
                    pt: 2,
                  }}
                >
                  Select Token
                </Typography>

                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "150px",
                    overflowY: "auto",
                  }}
                >
                  {tokens.map((token, index) => (
                    <Box
                      key={token.mint || token.symbol + index}
                      sx={{
                        width: "100%",
                        padding: "10px",
                        borderRadius: "14px",
                        border:
                          selectedToken === token
                            ? "1px solid #68C6FF"
                            : "1px solid transparent",
                        background:
                          selectedToken === token
                            ? `#1E2530`
                            : `#1A202C`,
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                        "&:hover": {
                          background:
                            selectedToken === token
                              ? `#1E2530`
                              : JUICE.well,
                        },
                      }}
                      onClick={() => setSelectedToken(token)}
                    >
                      <Avatar
                        sx={{
                          backgroundColor: token.iconBg,
                          borderRadius: "14px",
                          width: "36px",
                          height: "36px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "16px",
                          fontWeight: 700,
                        }}
                      >
                        {token.icon}
                      </Avatar>

                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          marginLeft: "10px",
                          justifyContent: "center",
                        }}
                      >
                        <Typography
                          sx={{
                            color: "#FFFFFF",
                            fontWeight: "600",
                            fontSize: "14px",
                          }}
                        >
                          {token.name}
                        </Typography>

                        <Typography
                          sx={{
                            color: JUICE.text3,
                            fontWeight: "400",
                            fontSize: "12px",
                            marginTop: "-2px",
                          }}
                        >
                          {token.amount} {token.symbol}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Amount Input */}
              {selectedToken && (
                <Box>
                  <Typography
                    sx={{
                      color: "#8B92A0",
                      fontSize: "12px",
                      fontWeight: "500",
                      marginBottom: "8px",
                    }}
                  >
                    Amount
                  </Typography>

                  <Box
                    sx={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <TextField
                      fullWidth
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => {
                        // Same locale rule as Send, Swap, the chip and the
                        // card: type="number" lets a scroll wheel change a
                        // figure nobody typed, and a comma decimal key
                        // arrives as NaN.
                        const clean = normalizeDecimal(e.target.value)
                        if (clean === "" || clean === ".") {
                          setAmount("")
                          return
                        }
                        const n = Number(clean)
                        setAmount(Number.isFinite(n) ? n : "")
                      }}
                      variant="outlined"
                      size="medium"
                      sx={{
                        "& .MuiOutlinedInput-root": {
                          backgroundColor: JUICE.well,
                          borderRadius: "14px",
                          "& fieldset": { borderColor: "#374151" },
                          "&:hover fieldset": { borderColor: "#4B5563" },
                          "&.Mui-focused fieldset": { borderColor: JUICE.accent },
                        },
                        "& .MuiInputBase-input": {
                          color: "#ffffff",
                          fontSize: "13px",
                          paddingRight: "100px",
                          "&::placeholder": {
                            color: "#8B92A0",
                            opacity: 1,
                          },
                        },
                        "& input[type=number]": {
                          MozAppearance: "textfield",
                        },
                        "& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button":
                          {
                            WebkitAppearance: "none",
                            margin: 0,
                          },
                      }}
                    />

                    <Box
                      sx={{
                        position: "absolute",
                        right: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                      }}
                    >
                      <Typography
                        sx={{
                          color: "#FFFFFF",
                          fontSize: "14px",
                          fontWeight: "400",
                        }}
                      >
                        {selectedToken.symbol}
                      </Typography>

                      <Button
                        variant="text"
                        size="small"
                        sx={{
                          fontSize: "12px",
                          fontWeight: "500",
                          backgroundColor: "#68C9FF7D",
                          backdropFilter: "blur(3.5px)",
                          borderRadius: "14px",
                          px: "8px",
                          py: "2px",
                          color: "#FFFFFF",
                          minWidth: "unset",
                          "&:hover": {
                            backgroundColor: JUICE.accent,
                          },
                        }}
                        onClick={handleSetMaxAmount}
                      >
                        Max
                      </Button>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      width: "100%",
                      mt: 1,
                    }}
                  >
                    <Typography
                      sx={{
                        color: "#8B92A0",
                        fontSize: "12px",
                        fontWeight: "400",
                      }}
                    >
                      ≈ ${convertAmountToUSD(amount)}
                    </Typography>

                    <Typography
                      sx={{
                        color: "#8B92A0",
                        fontSize: "12px",
                        fontWeight: "400",
                      }}
                    >
                      Available: {selectedToken.amount} {selectedToken.symbol}
                    </Typography>
                  </Box>
                </Box>
              )}

              {/* Reply Message (Optional) */}
              {props.postId && (
                <Box>
                  <Typography
                    sx={{
                      color: "#8B92A0",
                      fontSize: "12px",
                      fontWeight: "500",
                      marginBottom: "8px",
                    }}
                  >
                    Add a reply (optional)
                  </Typography>

                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    placeholder="Say something with it (optional)"
                    value={commentMessage}
                    onChange={(e) => setCommentMessage(e.target.value)}
                    variant="outlined"
                    size="medium"
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        backgroundColor: JUICE.well,
                        borderRadius: "14px",
                        "& fieldset": { borderColor: "#374151" },
                        "&:hover fieldset": { borderColor: "#4B5563" },
                        "&.Mui-focused fieldset": { borderColor: JUICE.accent },
                      },
                      "& .MuiInputBase-input": {
                        color: "#ffffff",
                        fontSize: "14px",
                        "&::placeholder": {
                          color: "#8B92A0",
                          opacity: 1,
                        },
                      },
                    }}
                  />
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>

        {!sentTip && (
        <DialogActions
          sx={{
            px: 3,
            pb: 3,
            gap: 1.5,
          }}
        >
          <Button
            onClick={handleClose}
            sx={{
              flex: 1,
              py: 1.5,
              fontSize: "14px",
              fontWeight: 600,
              textTransform: "none",
              color: "#FFFFFF",
              background: JUICE.well,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "15px",
              "&:hover": {
                background: `#1E252E`,
              },
            }}
          >
            Cancel
          </Button>

          <Button
            onClick={() => setShowConfirmDialog(true)}
            disabled={!isValid}
            sx={{
              flex: 1,
              py: 1.5,
              fontSize: "14px",
              fontWeight: 600,
              textTransform: "none",
              background: `#68C6FF`,
              border: `1px solid ${JUICE.border}`,
              color: "#000000",
              borderRadius: "15px",
              "&:hover": {
                background: darken(JUICE.accent, 0.1),
              },
              "&:disabled": {
                background: "rgba(104, 198, 255, 0.3)",
                color: "rgba(0, 0, 0, 0.5)",
              },
            }}
          >
            {/* The step before money moves reviews it; the button that
                moves it names it. */}
            {isSending ? "Sending..." : "Review tip"}
          </Button>
        </DialogActions>
        )}
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog
        open={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: "#0F0F16",
            border: "1px solid rgba(255,255,255,0.07)",
              color: "#FFFFFF",
              borderRadius: "16px",
              minWidth: "320px",
              maxWidth: "400px",
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            fontSize: "14px",
            fontWeight: 700,
            borderBottom: `1px solid ${JUICE.border}`,
            pb: 2,
            color: "#FFFFFF",
          }}
        >
          Confirm Tip
        </DialogTitle>

        <DialogContent sx={{ pt: 3, pb: 2 }}>
          <Stack spacing={2.5}>
            <Box sx={{ mt: 2 }}>
              <Typography
                sx={{
                  fontSize: "14px",
                  color: "#8B92A0",
                  mt: 1,
                  mb: 0.5,
                }}
              >
                You are tipping
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                }}
              >
                {selectedToken && (
                  <>
                    <Avatar
                      sx={{
                        width: 40,
                        height: 40,
                        background: selectedToken.iconBg,
                        fontSize: "18px",
                        fontWeight: 700,
                        borderRadius: "14px",
                      }}
                    >
                      {selectedToken.icon}
                    </Avatar>
                    <Box>
                      <Typography
                        sx={{
                          fontSize: "14px",
                          fontWeight: 700,
                        }}
                      >
                        {amount} {selectedToken.symbol}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: "14px",
                          color: "#8B92A0",
                        }}
                      >
                        ≈ ${convertAmountToUSD(amount)}
                      </Typography>
                    </Box>
                  </>
                )}
              </Box>
            </Box>

            <Divider sx={{ borderColor: JUICE.border }} />

            <Box>
              <Typography
                sx={{
                  fontSize: "14px",
                  color: "#8B92A0",
                  mb: 0.5,
                }}
              >
                To
              </Typography>
              <Typography
                sx={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                }}
              >
                @{props.recipient.username}
              </Typography>
              {props.recipient.display_name && (
                <Typography
                  sx={{
                    fontSize: "14px",
                    color: "#8B92A0",
                  }}
                >
                  {props.recipient.display_name}
                </Typography>
              )}
            </Box>

            {commentMessage.trim() && (
              <>
                <Divider sx={{ borderColor: JUICE.border }} />

                <Box>
                  <Typography
                    sx={{
                      fontSize: "14px",
                      color: "#8B92A0",
                      mb: 0.5,
                    }}
                  >
                    Your reply
                  </Typography>
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: "14px",
                      backgroundColor: JUICE.well,
                      border: "1px solid #374151",
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: "14px",
                        color: "#FFFFFF",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {commentMessage.trim()}
                    </Typography>
                  </Box>
                </Box>
              </>
            )}
          </Stack>
        </DialogContent>

        <DialogActions
          sx={{
            px: 3,
            pb: 3,
            gap: 1.5,
          }}
        >
          <Button
            onClick={() => setShowConfirmDialog(false)}
            disabled={isSending}
            sx={{
              flex: 1,
              py: 1.5,
              fontSize: "13px",
              fontWeight: 600,
              textTransform: "none",
              color: "#FFFFFF",
              background: JUICE.well,
              border: `1px solid ${JUICE.border}`,
              borderRadius: "15px",
              "&:hover": {
                background: `#1E252E`,
              },
              "&:disabled": {
                background: JUICE.well,
                color: "rgba(255, 255, 255, 0.3)",
              },
            }}
          >
            Cancel
          </Button>

          <Button
            onClick={handleConfirmSend}
            disabled={isSending}
            sx={{
              flex: 1,
              py: 1.5,
              fontSize: "13px",
              fontWeight: 600,
              textTransform: "none",
              background: `#68C6FF`,
              border: `1px solid ${JUICE.border}`,
              color: "#000000",
              borderRadius: "15px",
              "&:hover": {
                background: darken(JUICE.accent, 0.1),
              },
              "&:disabled": {
                background: "rgba(104, 198, 255, 0.3)",
                color: "rgba(0, 0, 0, 0.5)",
              },
            }}
          >
            {isSending
              ? "Sending..."
              : `Tip ${amount} ${selectedToken?.symbol ?? ""}`.trim()}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
