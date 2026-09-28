import { JUICE } from "~/theme/juice"
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogProps,
  DialogTitle,
} from "@mui/material"
import { ReactNode } from "react"

interface CDialogProps extends Omit<DialogProps, "open" | "maxWidth" | "title"> {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  actions?: ReactNode
  maxWidth?: string
  minWidth?: string
  maxHeight?: string
  showBorder?: boolean
}

export function CDialog({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = "400px",
  // A 320px floor plus MUI's own 32px paper margins demands 384px of panel,
  // and the panel's supported minimum IS 320px — so at the floor the sheet
  // was wider than the window it opens in. min() keeps 320 wherever there is
  // room for it and lets the sheet track the panel below that.
  minWidth = "min(320px, calc(100% - 64px))",
  maxHeight,
  showBorder = true,
  slotProps,
  ...props
}: CDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        ...slotProps,
        paper: {
          ...slotProps?.paper,
          sx: {
            // A CONFIRMATION YOU CAN READ THE PAGE THROUGH IS NOT A
            // CONFIRMATION. This was `transparent`, and MUI's resolveProps
            // does not merge `sx`, so the theme's MuiPaper default
            // (helpers/themeHelper.ts) was discarded outright and every
            // dialog in the panel shipped see-through. The one caller that
            // needed a readable sheet re-supplied a background by hand.
            backgroundColor: JUICE.ground,
            // The hairline every other Poppin surface wears (juice.ts: "the
            // brand-tinted hairline"). It was a neutral white 10%, which is
            // the one edge in the panel that did not carry the brand's
            // temperature — next to a card or a header pill it read as a
            // different product's dialog.
            border: showBorder ? `1px solid ${JUICE.border}` : "none",
            boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
            color: "#FFFFFF",
            borderRadius: "16px",
            minWidth,
            maxWidth,
            maxHeight,
            ...(slotProps?.paper as any)?.sx,
          },
        },
      }}
      {...props}
    >
      {title && (
        <DialogTitle
          sx={{
            fontSize: "20px",
            fontWeight: 700,
            borderBottom: `1px solid ${JUICE.border}`,
            pb: 2,
            color: "#FFFFFF",
          }}
        >
          {title}
        </DialogTitle>
      )}
      <DialogContent sx={{ pt: title ? 3 : 2, pb: 2, mt: 2 }}>
        {children}
      </DialogContent>
      {actions && (
        <DialogActions sx={{ px: 3, pb: 3, gap: 1.5 }}>{actions}</DialogActions>
      )}
    </Dialog>
  )
}
