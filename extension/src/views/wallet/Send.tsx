/**
 * Extracted VERBATIM from wallet-ui.tsx (V2-PLAN.md Faz D). This file handles
 * real money: the split moved code, it did not edit it. The import block is
 * the original file's, shared by every sibling — unused lines cost nothing
 * and diffing against history stays trivial.
 */
import { normalizeDecimal } from "~/helpers/decimalInput"
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
import { maxSwapFill, swappableUi } from "~/helpers/swapMax"
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
import { ARC_EDITION } from "~/config/edition"
import { isEvmAddress } from "~/arc/chain"

interface SendProps {
  activeTab: "send" | "send-final"
  setActiveTab: (tab: "tokens" | "receive" | "send" | "send-final") => void
  tokens: Token[]
  walletAddress: string
  truncatedWalletAddress: string
  solPrice: number
  preselectedToken?: Token | null
}

export function Send(props: SendProps) {
  const theme = useTheme()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const executeSwap = useExecuteSwap()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedToken, setSelectedToken] = useState<Token | null>(
    props.preselectedToken || null
  )

  const [recipientAddress, setRecipientAddress] = useState("")
  const [amount, setAmount] = useState<number | "">("")
  const [isSending, setIsSending] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // SOL mint address for Jupiter swap
  const SOL_MINT = "So11111111111111111111111111111111111111112"

  // If a token is preselected, automatically go to send-final view
  useEffect(() => {
    if (props.preselectedToken && props.activeTab === "send") {
      props.setActiveTab("send-final")
    }
  }, [props.preselectedToken])

  // Filter tokens based on search query
  const filteredTokens = props.tokens.filter(
    (token) =>
      token.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Get selected token or default to first token
  const activeToken = selectedToken || props.tokens[0]

  /**
   * EXACT BALANCE, NOT THE DISPLAY STRING. `amount` is rounded for reading
   * ("3.020272" shows as "3.0203"), and Max once submitted that verbatim:
   * more SOL than exists, refused by the backend. Swap was moved to
   * `amountExact` plus the fee-reserve arithmetic in helpers/swapMax; this
   * screen kept the old road. Same helper now, so Max is a number the
   * backend will actually accept and SOL keeps its fee behind.
   */
  const exactAmount = activeToken ? (activeToken.amountExact ?? activeToken.amount) : "0"
  const sendDecimals = activeToken?.decimals ?? 9
  const availableBalance = swappableUi(exactAmount, sendDecimals, activeToken?.mint)

  // Validation
  const isValid =
    recipientAddress && typeof amount === 'number' && amount > 0 && amount <= availableBalance && !isSending &&
    // The Arc edition sends to a 0x address only; the server checks too.
    (!ARC_EDITION || isEvmAddress(recipientAddress.trim()))

  // Handle setting max amount
  function handleSetMaxAmount() {
    if (!activeToken) return
    const filled = maxSwapFill(exactAmount, sendDecimals, activeToken.mint)
    setAmount(filled === "0" ? 0 : Number(filled))
  }

  // Handle token selection
  function handleSelectToken(token: Token) {
    setSelectedToken(token)
    props.setActiveTab("send-final")
  }

  // Convert amount to USD for display
  function convertAmountToUSD(amount: number | ""): string {
    if (!activeToken || amount === "") return "0.00"

    // For SOL, use the SOL price
    if (activeToken.symbol === "SOL") {
      const usdValue = amount * props.solPrice
      return usdValue.toFixed(2)
    }

    // For other tokens, calculate price per token from their USD value
    const tokenBalance = parseFloat(activeToken.amount)
    const tokenUsdValue = parseFloat(activeToken.value.replace(/[^0-9.-]+/g, ""))

    if (tokenBalance > 0 && tokenUsdValue > 0) {
      const pricePerToken = tokenUsdValue / tokenBalance
      const usdValue = amount * pricePerToken
      return usdValue.toFixed(2)
    }

    return "0.00"
  }

  // Handle Next button click
  function handleNext() {
    if (!isValid) return
    setShowConfirmDialog(true)
  }

  // Handle confirm send
  async function handleConfirmSend() {
    setShowConfirmDialog(false)
    setIsSending(true)

    // Ensure amount is a number
    if (amount === "" || amount <= 0) {
      showToast("Invalid amount", "error")
      setIsSending(false)
      return
    }

    try {
      let result

      if (activeToken.symbol === "SOL") {
        // Direct SOL transfer
        result = await WalletService.transferSOL({
          to: recipientAddress,
          amount: amount,
        })
      } else if (activeToken.mint) {
        // Direct token transfer
        showToast(`Transferring ${amount} ${activeToken.symbol}...`, "info")

        // Transfer token directly to recipient
        result = await WalletService.transferToken({
          to: recipientAddress,
          mint: activeToken.mint,
          amount: amount,
        })
      } else {
        throw new Error("Invalid token configuration")
      }

      if (result.success) {
        /**
         * THE BALANCE THE READER RETURNS TO MUST KNOW. The direct
         * WalletService calls bypass the useTransfer* mutations whose
         * onSuccess invalidates the wallet queries, so "Sent 5 USDC"
         * teleported the reader to a Tokens tab still showing the money as
         * held for up to a minute of staleTime. One invalidation, before
         * the tab switch.
         */
        void queryClient.invalidateQueries({ queryKey: ["wallet"] })
        // Says what happened, in the money's own words.
        showToast(`Sent ${amount} ${activeToken.symbol}`, "success")
        setTimeout(() => {
          props.setActiveTab("tokens")
        }, 1500)
      } else {
        showToast(result.message || "Transaction failed", "error")
      }
    } catch (error: any) {
      console.error("Transaction error", error)
      // The server's exception class is not a sentence, and this one
      // fires while somebody is moving money. See helpers/apiError.
      showToast(humanApiError(error, "Failed to process transaction"), "error")
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: JUICE.groundDeep,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        padding: "10px",
      }}
    >
      <Box
        sx={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
        }}
      >
        <IconButton
          onClick={() => props.setActiveTab("tokens")}
          sx={{
            marginRight: "6px",
            background: JUICE.well,
            width: "24px",
            height: "24px",
            borderRadius: "9999px",
            "&:hover": {
              opacity: 0.7,
            },
          }}
        >
          <ArrowBackIcon
            sx={{
              color: "#FFFFFF",
              fontSize: 16,
            }}
          />
        </IconButton>

        <Box
          sx={{
            paddingLeft: "6px",
            paddingRight: "10px",
            py: "4px",
            borderRadius: "14px",
            display: "flex",
            gap: "10px",
            alignItems: "center",
            justifyContent: "center",
            background: JUICE.well,
          }}
        >
          <Box
            sx={{
              width: "20px",
              height: "20px",
              borderRadius: "6px",
              backgroundColor: "#FFFFFF33",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <WalletIcon sx={{ fontSize: 12, color: "#FFFFFF" }} />
          </Box>

          <Typography
            sx={{
              color: "#FFFFFF",
              fontSize: "14px",
              fontWeight: "500",
              maxWidth: "150px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {props.truncatedWalletAddress}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          width: "100%",
          height: "1px",
          background: `linear-gradient(90deg, #FFFFFF33, #FFFFFF0D) border-box`,
          marginY: "10px",
        }}
      />

      {/* Select wallet part */}
      {props.activeTab === "send" && (
        <>
          <Box
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <SearchIcon
              sx={{
                color: "#FFFFFF",
                position: "absolute",
                left: "14px",
                fontSize: "24px",
                fill: "#FFFFFF",
                zIndex: 1,
              }}
            />

            <TextField
              fullWidth
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              variant="outlined"
              size="medium"
              sx={{
                "& .MuiInputBase-input": {
                  padding: 0,
                  background: JUICE.well,
                  color: "#ffffff",
                  fontSize: "14px",
                  borderRadius: "14px",
                  height: "50px",
                  paddingLeft: "42px",
                  paddingRight: "12px",
                  "&::placeholder": {
                    color: theme.palette.secondary.contrastText,
                  },
                },
                "& .Mui-focused>.MuiInputBase-input": {
                  border: `1px solid ${theme.palette.primary.main}`,
                  backgroundClip: "unset",
                  backgroundColor: JUICE.well,
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  border: "none",
                },
              }}
            />
          </Box>

          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              marginTop: "16px",
              gap: "10px",
            }}
          >
            {filteredTokens.length > 0 ? (
              filteredTokens.map((token, index) => (
                <Box
                  key={token.mint || token.symbol + index}
                  sx={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "15px",
                    backgroundColor: "#0F0F16",
            border: "1px solid rgba(255,255,255,0.07)",
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                  onClick={() => handleSelectToken(token)}
                >
                  {/* The face, not a blank colored square: wallet-ui sets
                      icon:"" whenever a logo exists, so reading only
                      token.icon erased most real tokens' identity at the
                      moment of choosing what to SEND. Same road as the
                      wallet rows and Swap's pickers. */}
                  <Avatar
                    src={token.logoURI || undefined}
                    sx={{
                      backgroundColor: token.logoURI ? "transparent" : token.iconBg,
                      borderRadius: "14px",
                      width: "45px",
                      height: "45px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "20px",
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
                        fontWeight: "700",
                        fontSize: "14px",
                      }}
                    >
                      {token.name}
                    </Typography>

                    <Typography
                      sx={{
                        color: JUICE.text3,
                        fontWeight: "400",
                        fontSize: "13px",
                        marginTop: "-6px",
                      }}
                    >
                      {token.amount} {token.symbol}
                    </Typography>
                  </Box>
                </Box>
              ))
            ) : (
              <Box sx={{ py: 4, textAlign: "center" }}>
                <Typography sx={{ color: "#8B92A0", fontSize: "14px" }}>
                  No tokens found
                </Typography>
              </Box>
            )}
          </Box>
        </>
      )}

      {/* Send final part */}
      {props.activeTab === "send-final" && activeToken && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            flexDirection: "column",
          }}
        >
          <Typography
            sx={{
              color: "#FFFFFF",
              fontSize: "19px",
              fontWeight: "700",
            }}
          >
            Send {activeToken.symbol}
          </Typography>

          <Avatar
            src={activeToken.logoURI || undefined}
            sx={{
              marginTop: "20px",
              backgroundColor: activeToken.logoURI ? "transparent" : activeToken.iconBg,
              borderRadius: "25px",
              width: "85px",
              height: "85px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
              fontWeight: 700,
            }}
          >
            {activeToken.icon}
          </Avatar>

          <TextField
            fullWidth
            placeholder={ARC_EDITION ? "Recipient's address (0x…)" : "Recipient's Solana Address"}
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            variant="outlined"
            size="medium"
            sx={{
              marginTop: "20px",
              "& .MuiInputBase-input": {
                padding: 0,
                background: JUICE.well,
                color: "#ffffff",
                fontSize: "13px",
                borderRadius: "14px",
                height: "50px",
                paddingX: "16px",
                "&::placeholder": {
                  color: theme.palette.secondary.contrastText,
                },
              },
              "& .Mui-focused>.MuiInputBase-input": {
                border: `1px solid ${theme.palette.primary.main}`,
                backgroundClip: "unset",
                backgroundColor: JUICE.well,
              },
              "& .MuiOutlinedInput-notchedOutline": {
                border: "none",
              },
            }}
          />

          <Box
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              marginTop: "12px",
              width: "100%",
            }}
          >
            {/*
              THE LOCALE RULE, HERE TOO. This was the last type="number"
              amount field in the product: a scroll wheel over it silently
              changed a figure the reader never typed, and on a keyboard
              whose decimal key is a comma the value became NaN on the way
              in. Same normalizeDecimal road as Swap, the chip and the card
              - the state stays a number so every reader of `amount` below
              is unchanged, and an unparseable string reads as empty rather
              than as zero.
            */}
            <TextField
              fullWidth
              type="text"
              inputMode="decimal"
              placeholder="Amount"
              value={amount}
              onChange={(e) => {
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
                "& .MuiInputBase-input": {
                  padding: 0,
                  background: JUICE.well,
                  color: "#ffffff",
                  fontSize: "13px",
                  borderRadius: "14px",
                  height: "50px",
                  paddingLeft: "16px",
                  paddingRight: "95px",
                  "&::placeholder": {
                    color: theme.palette.secondary.contrastText,
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
                "& .Mui-focused>.MuiInputBase-input": {
                  border: `1px solid ${theme.palette.primary.main}`,
                  backgroundClip: "unset",
                  backgroundColor: JUICE.well,
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  border: "none",
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
                gap: "12px",
              }}
            >
              <Typography
                sx={{
                  color: "#FFFFFF",
                  fontSize: "14px",
                  fontWeight: "400",
                }}
              >
                {activeToken.symbol}
              </Typography>

              <Button
                variant="text"
                size="medium"
                sx={{
                  fontSize: "14px",
                  fontWeight: "400",
                  backgroundColor: "#68C9FF7D",
                  backdropFilter: "blur(3.5px)",
                  borderRadius: "14px",
                  px: "10px",
                  py: "2px",
                  color: "#FFFFFF",
                  minWidth: "unset",
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
              marginTop: "10px",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <Typography
              sx={{
                color: "#ADADAD",
                fontSize: "13px",
                fontWeight: "400",
              }}
            >
              ${convertAmountToUSD(amount)}
            </Typography>

            <Box
              sx={{
                background: JUICE.well,
                borderRadius: "14px",
                paddingY: "2px",
                paddingX: "8px",
                color: "#ADADAD",
                fontSize: "14px",
                fontWeight: "400",
              }}
            >
              Available {maxSwapFill(exactAmount, sendDecimals, activeToken.mint)}{" "}
              {activeToken.symbol}
            </Box>
          </Box>
        </Box>
      )}

      <Box sx={{ flexGrow: 1 }} />

      {props.activeTab === "send-final" && (
        <Box
          sx={{
            display: "flex",
            gap: "14px",
            width: "100%",
          }}
        >
          <Button
            sx={{
              flexGrow: 1,
              height: "57px",
              backgroundColor: JUICE.well,
              color: "#FFFFFF",
              fontSize: "13px",
              fontWeight: "600",
              borderRadius: "15px",
              textTransform: "none",
              "&:hover": {
                backgroundColor: JUICE.well,
              },
            }}
            onClick={() => props.setActiveTab("send")}
          >
            Cancel
          </Button>

          <Button
            sx={{
              flexGrow: 1,
              height: "57px",
              backgroundColor: isValid ? JUICE.accent : "rgba(104, 198, 255, 0.3)",
              color: isValid ? "#000000" : "rgba(0, 0, 0, 0.5)",
              fontSize: "13px",
              fontWeight: "600",
              borderRadius: "15px",
              textTransform: "none",
              "&:hover": {
                backgroundColor: isValid
                  ? darken(JUICE.accent, 0.1)
                  : "rgba(104, 198, 255, 0.3)",
              },
              "&:disabled": {
                backgroundColor: "rgba(104, 198, 255, 0.3)",
                color: "rgba(0, 0, 0, 0.5)",
              },
            }}
            onClick={handleNext}
            disabled={!isValid}
          >
            {isSending ? "Sending..." : "Next"}
          </Button>
        </Box>
      )}

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
          Confirm Transaction
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
                {/* One sentence for every token, and the TRUE one: the
                    handler below does a direct transfer. "Swapping via
                    Jupiter" was a leftover from a retired swap-then-send
                    flow, shown at the exact moment of irreversible
                    commitment. */}
                You are sending
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                }}
              >
                {activeToken && (
                  <>
                    <Avatar
                      src={activeToken.logoURI || undefined}
                      sx={{
                        width: 40,
                        height: 40,
                        background: activeToken.logoURI ? "transparent" : activeToken.iconBg,
                        fontSize: "18px",
                        fontWeight: 700,
                        borderRadius: "14px",
                      }}
                    >
                      {activeToken.icon}
                    </Avatar>
                    <Box>
                      <Typography
                        sx={{
                          fontSize: "14px",
                          fontWeight: 700,
                        }}
                      >
                        {amount} {activeToken.symbol}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: "14px",
                          color: "#8B92A0",
                        }}
                      >
                        {`≈ $${convertAmountToUSD(amount)}`}
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
                To address
              </Typography>
              <Typography
                sx={{
                  fontSize: "14px",
                  fontWeight: 500,
                  wordBreak: "break-all",
                  color: "#FFFFFF",
                }}
              >
                {recipientAddress}
              </Typography>
            </Box>
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
            {isSending ? "Sending..." : "Confirm"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
