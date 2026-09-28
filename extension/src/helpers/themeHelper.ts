import { createTheme, CssVarsThemeOptions, ThemeOptions } from "@mui/material"
import { useAppConfigStore } from "~/store/useAppConfigStore"
import { JUICE } from "~/theme/juice"

// Extend the palette interface to include tetriary color
declare module '@mui/material/styles' {
  interface Palette {
    tetriary: Palette['primary']
  }
  interface PaletteOptions {
    tetriary?: PaletteOptions['primary']
  }
}

// Define the type for mainTheme
type ThemeType = Omit<ThemeOptions, "components"> &
  Pick<
    CssVarsThemeOptions,
    "defaultColorScheme" | "colorSchemes" | "components"
  >

export const createMyTheme = (container: HTMLElement) => {
  const organization = useAppConfigStore.getState().organization
  // V2 marka geçişi: panelin varsayılan aksanı artık kartla aynı mavi —
  // #68C6FF, embed'in DEFAULT_BRAND.primaryColor'ı. Org override'ı (beyaz
  // etiket) aynen çalışır; değişen yalnızca org'suz varsayılan. Eski #00476A
  // koyu laciverti, koyu zeminde kaybolan bir aksandı.
  const primaryColor = organization?.primaryColor || "#68C6FF"
  const secondaryColor = organization?.secondaryColor || JUICE.wellSolid
  const tertiaryColor = organization?.tertiaryColor || JUICE.wellSolid
  


  const mainTheme: ThemeType = {
    palette: {
      // Dark mode so MUI derives light-on-dark tokens (text.secondary,
      // divider, action.*, and the dark Alert/Snackbar/Menu variants)
      // instead of the default light-mode black-on-white. Without this,
      // any component that uses palette tokens instead of hardcoded
      // colors renders dark-on-dark (invisible) or a light box on the
      // #000 canvas. background/paper are still pinned to #000 below.
      mode: "dark",
      primary: {
        main: primaryColor,
        // Açık aksan koyu metin ister; kartın Buy pill'iyle aynı eşleşme.
        // Org kendi rengini getirirse MUI kontrastı kendisi hesaplar — bu
        // sadece varsayılan mavinin çifti.
        ...(organization?.primaryColor ? {} : { contrastText: JUICE.onAccent }),
      },
      secondary: {
        main: secondaryColor, // secondary/main
      },
      common: {
        white: "#FFFFFF", // common/white/main
        black: "#DCDCDC", // common/black/outlinedBorder
      },
      background: {
        // The juice grounds (src/theme/juice.ts): blue-black canvas with a
        // raised surface one step above it. Flat #000 was the FOMO-era
        // canvas — on it every card needs its own border to exist, which is
        // why the panel read as a list of outlines instead of objects
        // sitting in a dark room.
        default: JUICE.groundDeep,
        paper: JUICE.ground,
      },
      info: {
        main: JUICE.accent,
        contrastText: JUICE.onAccent,
      },
      /**
       * The card's state colors, verbatim — Apple's dark-mode set. One
       * green, one red, one amber, each with one job. Without these, any
       * panel component reaching for palette.success/error/warning got
       * MUI's stock #66bb6a/#f44336/#ffa726, so the same "up" was one green
       * on the card and a different green an inch away in the panel.
       */
      success: { main: JUICE.green, contrastText: JUICE.onAccent },
      error: { main: JUICE.red, contrastText: "#FFFFFF" },
      warning: { main: JUICE.amber, contrastText: JUICE.onAccent },
      // The juice hairline: brand-tinted, never neutral white.
      divider: JUICE.border,
      text: {
        primary: JUICE.text,
        secondary: JUICE.text2,
      },
    },
  }

  let theme=  createTheme({
    ...mainTheme,
    typography: {
      htmlFontSize: 10,
      fontFamily: "PoppinSans",
      allVariants: {
        textTransform: "none",
        // The card sets tabular-nums on every numeric class by hand; a
        // panel-wide variant is the same decision made once. It only
        // affects digit glyph widths, so prose costs nothing.
        fontVariantNumeric: "tabular-nums",
      },
      h5: {
        fontSize: "14px",
        "@container (min-width: 960px)": {
          fontSize: "20px",
        },
        "@container (min-width: 1280px)": {
          fontSize: "22px",
        },
      },
      h6: {
        fontSize: "16px",
        "@container (min-width: 960px)": {
          fontSize: "18px",
        },
        "@container (min-width: 1280px)": {
          fontSize: "20px",
        },
      },
      body1: {
        fontSize: "14px",
        "@container (min-width: 960px)": {
          fontSize: "16px",
        },
        "@container (min-width: 1280px)": {
          fontSize: "18px",
        },
      },
      body2: {
        fontSize: "12px",
        "@container (min-width: 960px)": {
          fontSize: "14px",
        },
        "@container (min-width: 1280px)": {
          fontSize: "14px",
        },
      },
    },
    components: {
      
      MuiAlert: {
        styleOverrides: {
          message: {
            fontSize: "14px",
          },
          root: {
            fontSize: "14px !important",
          },
          // Brand-blue dark variant for bare <Alert severity="info"> (used
          // as empty-state notices in the prediction views) so they don't
          // fall back to MUI's light-blue box on the black UI.
          standardInfo: {
            backgroundColor: "rgba(104, 198, 255, 0.08)",
            color: "#68C6FF",
            border: "1px solid rgba(104, 198, 255, 0.25)",
            "& .MuiAlert-icon": { color: "#68C6FF" },
          },
          standardError: {
            backgroundColor: "rgba(255, 69, 58, 0.12)",
            color: "#FF453A",
            border: "1px solid rgba(255, 69, 58, 0.30)",
            "& .MuiAlert-icon": { color: "#FF453A" },
          },
        },
      },

      MuiButton: {
        defaultProps: {
          variant: "contained",
          color: "secondary",
        },
        styleOverrides: {
          root: {
            textTransform: "none",
            // Pill, like every button on poppin.so and on the card. 8px was
            // a generic app radius; the pill is the brand's.
            borderRadius: "999px",
            fontWeight: 600,
          },
          // THE SIGNATURE: the accent button glows. Measured off the site's
          // "Get early access" — the light it throws is what makes the dark
          // ground read as a room rather than a background colour.
          containedPrimary: {
            boxShadow: JUICE.glowMoney,
            "&:hover": { boxShadow: JUICE.glowMoneyHover },
            "&.Mui-disabled": { boxShadow: "none" },
          },
          // The site's second button is a ghost: transparent with a hairline.
          // Kept as an OVERRIDE of the filled default rather than a palette
          // change, so an org's white-label secondary colour still works.
          containedSecondary: {
            backgroundColor: JUICE.well,
            border: `1px solid ${JUICE.border}`,
            boxShadow: "none",
            "&:hover": {
              backgroundColor: "rgba(122,183,255,0.10)",
              boxShadow: "none",
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          // The card's chip grammar: a pill, bold, small. Colors stay with
          // each usage (tinted per meaning); the SHAPE is the system's.
          root: {
            borderRadius: "999px",
            fontWeight: 700,
            fontSize: "11px",
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          "#app": {
            containerType: "inline-size",
            height: "100%",
          },
          // RULE 6 — THE DATA SPEAKS MONO. Every amount input in the panel
          // is inputMode="decimal", so the terminal voice lands on all of
          // them from one rule; display numbers opt in per site with
          // sx fontFamily JUICE.mono.
          'input[inputmode="decimal"]': {
            fontFamily: JUICE.mono,
            letterSpacing: "-.01em",
          },
          // Hairline scrollbar that blends into #000 — visible only on
          // hover, no chunky track. Matches the leaderboard reference.
          "*": {
            "&::-webkit-scrollbar": {
              width: "2px",
            },
            "&::-webkit-scrollbar-track": {
              background: "transparent",
            },
            "&::-webkit-scrollbar-thumb": {
              background: "rgba(122,183,255,0.22)",
              borderRadius: "2px",
            },
            "&::-webkit-scrollbar-thumb:hover": {
              background: "rgba(122,183,255,0.34)",
            },
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(122,183,255,0.22) transparent",
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-notchedOutline": {
              top: 0,
            },
            "& legend": {
              display: "none",
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: {
          elevation: 0,
          sx: {
            backgroundColor: JUICE.ground,
          },
        },
        styleOverrides: {
          root: {
            // One step above the ground, with the site's card radius. Menus,
            // dialogs and popovers all ride this.
            backgroundColor: JUICE.ground,
            backgroundImage: "none",
            borderRadius: "16px",
          },
        },
      },
      MuiPopover: {
        defaultProps: {
          container,
        },
        styleOverrides: {
          root: {
            zIndex: 999999999999999999,
          },
        },
      },
      MuiModal: {
        defaultProps: {
          container,
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontSize: "0.75rem",
            paddingLeft: "8px",
            paddingRight: "8px",
            paddingTop: "4px",
            paddingBottom: "4px",
            // Tooltips sit on the universal #000 surface with a hairline
            // border so they read as a quiet annotation, not a slate chip.
            backgroundColor: JUICE.ground,
            border: `1px solid ${JUICE.border}`,
            color: JUICE.text,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          },
          arrow: {
            color: JUICE.ground,
          },
        },
      },
    },
  })

  theme = createTheme(theme, {
    // Custom colors created with augmentColor go here
    palette: {
      tetriary: theme.palette.augmentColor({
        color: {
          main: tertiaryColor,
        },
        name: 'tetriary',
      }),
    },
  });
  return theme
}
