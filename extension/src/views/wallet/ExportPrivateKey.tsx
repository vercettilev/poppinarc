/**
 * Extracted VERBATIM from wallet-ui.tsx (V2-PLAN.md Faz D). This file handles
 * real money: the split moved code, it did not edit it. The import block is
 * the original file's, shared by every sibling — unused lines cost nothing
 * and diffing against history stays trivial.
 */
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

interface ExportPrivateKeyProps {
  onClose: () => void
  walletAddress: string
}

export function ExportPrivateKey(props: ExportPrivateKeyProps) {
  const { showToast } = useToast()
  const [step, setStep] = useState<"warning" | "loading" | "display">("warning")
  const [privateKey, setPrivateKey] = useState("")
  const [copied, setCopied] = useState(false)

  async function handleConfirmExport() {
    setStep("loading")
    try {
      // One chain. The Arc branch that stood here asked an endpoint the
      // backend no longer has (apps/backend carries no @Controller('arc/…')
      // since 2026-08-12); the chain picker that could reach it is gone.
      const result = await WalletService.exportPrivateKey()
      if (result.success && result.privateKey) {
        setPrivateKey(result.privateKey)
        setStep("display")
      } else {
        const errorMsg = "Unexpected response from server"
        console.error("Export error: Invalid response structure", result)
        showToast(errorMsg, "error")
        setStep("warning")
      }
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.message ||
        error.message ||
        "Failed to export private key. Check backend logs for details."
      console.error("Export error", error, errorMsg)
      showToast(errorMsg, "error")
      setStep("warning")
    }
  }

  function handleCopyPrivateKey() {
    navigator.clipboard.writeText(privateKey)
    setCopied(true)
    showToast("Private key copied to clipboard", "success", {
      vertical: "bottom",
      horizontal: "center",
    })
    setTimeout(() => setCopied(false), 2000)
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
        alignItems: "center",
        flexDirection: "column",
        paddingX: "24px",
        paddingTop: "30px",
      }}
    >
      {step === "warning" && (
        <>
          <Typography
            sx={{
              color: "#FF453A",
              fontSize: "19px",
              fontWeight: "700",
              marginBottom: "16px",
            }}
          >
            ⚠️ Warning
          </Typography>

          <Box
            sx={{
              width: "100%",
              padding: "16px",
              borderRadius: "14px",
              backgroundColor: "#0F0F16",
              border: "1px solid rgba(255,69,58,0.35)",
              marginBottom: "16px",
            }}
          >
            <Typography
              sx={{
                color: "#FFFFFF",
                fontSize: "14px",
                fontWeight: "600",
                marginBottom: "12px",
              }}
            >
              Read carefully before continuing:
            </Typography>

            <Typography
              sx={{
                color: JUICE.text3,
                fontSize: "13px",
                marginBottom: "8px",
              }}
            >
              • Never share your private key
            </Typography>

            <Typography
              sx={{
                color: JUICE.text3,
                fontSize: "13px",
                marginBottom: "8px",
              }}
            >
              • Anyone with this key controls your wallet
            </Typography>

            <Typography
              sx={{
                color: JUICE.text3,
                fontSize: "13px",
                marginBottom: "8px",
              }}
            >
              • Store it securely offline
            </Typography>

            <Typography
              sx={{
                color: JUICE.text3,
                fontSize: "13px",
              }}
            >
              • We will never ask for it
            </Typography>
          </Box>

          <Box
            sx={{
              width: "100%",
              padding: "12px",
              borderRadius: "14px",
              background: JUICE.well,
              marginBottom: "20px",
            }}
          >
            <Typography
              sx={{
                color: "#FFFFFF",
                fontSize: "12px",
                fontWeight: "400",
              }}
            >
              Wallet: <br />
              <Typography
                component="span"
                sx={{
                  color: JUICE.accent,
                  fontSize: "11px",
                  fontWeight: "500",
                  wordBreak: "break-all",
                }}
              >
                {props.walletAddress}
              </Typography>
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Box
            sx={{
              display: "flex",
              gap: "10px",
              width: "100%",
              marginBottom: "16px",
            }}
          >
            <Button
              sx={{
                flexGrow: 1,
                height: "48px",
                backgroundColor: JUICE.well,
                color: "#FFFFFF",
                fontSize: "15px",
                fontWeight: "600",
                borderRadius: "14px",
                textTransform: "none",
                "&:hover": {
                  backgroundColor: JUICE.well,
                },
              }}
              onClick={props.onClose}
            >
              Cancel
            </Button>

            <Button
              sx={{
                flexGrow: 1,
                height: "48px",
                backgroundColor: "#FF453A",
                color: "#FFFFFF",
                fontSize: "15px",
                fontWeight: "600",
                borderRadius: "14px",
                textTransform: "none",
                "&:hover": {
                  backgroundColor: darken("#FF453A", 0.1),
                },
              }}
              onClick={handleConfirmExport}
            >
              Show Key
            </Button>
          </Box>
        </>
      )}

      {step === "loading" && (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flexGrow: 1,
          }}
        >
          <CircularProgress sx={{ color: JUICE.accent, marginBottom: "20px" }} />
          <Typography sx={{ color: "#FFFFFF", fontSize: "13px" }}>
            Decrypting private key...
          </Typography>
        </Box>
      )}

      {step === "display" && (
        <>
          <Typography
            sx={{
              color: "#FFFFFF",
              fontSize: "14px",
              fontWeight: "700",
              marginBottom: "16px",
            }}
          >
            Your Private Key
          </Typography>

          <Box
            sx={{
              width: "100%",
              padding: "16px",
              borderRadius: "14px",
              backgroundColor: "#0F0F16",
              border: "1px solid rgba(104,198,255,0.35)",
              marginBottom: "16px",
            }}
          >
            <Typography
              sx={{
                color: JUICE.accent,
                fontSize: "11px",
                fontWeight: "500",
                wordBreak: "break-all",
                marginBottom: "12px",
              }}
            >
              {privateKey}
            </Typography>

            <Button
              sx={{
                width: "100%",
                fontSize: "14px",
                fontWeight: "600",
                color: "#FFFFFF",
                backgroundColor: "#224154",
                borderRadius: "14px",
                paddingY: "8px",
                textTransform: "none",
                "&:hover": {
                  backgroundColor: darken("#224154", 0.1),
                },
              }}
              onClick={handleCopyPrivateKey}
            >
              <ContentCopyIcon sx={{ fontSize: 16, marginRight: "6px" }} />
              {copied ? "Copied!" : "Copy Key"}
            </Button>
          </Box>

          <Box
            sx={{
              width: "100%",
              padding: "12px",
              borderRadius: "14px",
              background: JUICE.well,
              marginBottom: "16px",
            }}
          >
            <Typography
              sx={{
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: "600",
                marginBottom: "6px",
              }}
            >
              Import to Phantom:
            </Typography>
            <Typography
              sx={{
                color: JUICE.text3,
                fontSize: "11px",
                marginBottom: "10px",
              }}
            >
              Settings → Add/Connect Wallet → Import Private Key
            </Typography>

            <Typography
              sx={{
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: "600",
                marginBottom: "6px",
              }}
            >
              Import to Solflare:
            </Typography>
            <Typography
              sx={{
                color: JUICE.text3,
                fontSize: "11px",
              }}
            >
              Add Wallet → Import Wallet
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Button
            sx={{
              width: "100%",
              height: "48px",
              backgroundColor: JUICE.accent,
              color: "#000000",
              fontSize: "13px",
              fontWeight: "600",
              borderRadius: "14px",
              textTransform: "none",
              marginBottom: "16px",
              "&:hover": {
                backgroundColor: darken(JUICE.accent, 0.1),
              },
            }}
            onClick={props.onClose}
          >
            Done
          </Button>
        </>
      )}
    </Box>
  )
}
