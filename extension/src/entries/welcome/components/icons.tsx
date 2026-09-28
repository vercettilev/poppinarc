import { SvgIconProps } from "@mui/material"

const MagicedenUrl = new URL("~/assets/MagicEden.png", import.meta.url)
export const MagicedenIcon = (props: SvgIconProps) => (
  <img src={MagicedenUrl.toString()} alt="Magiceden" {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
)

const BirdeyeUrl = new URL("~/assets/BirdEye.png", import.meta.url)
export const BirdeyeIcon = (props: SvgIconProps) => (
  <img src={BirdeyeUrl.toString()} alt="Birdeye" {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
)

const url = new URL("~/assets/logo.png", import.meta.url)
export const LogoIcon = (props: SvgIconProps) => (
  <img src={url.toString()} alt="Logo" {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
)

export { XIcon } from "~/components/icons"


import LogoBlack from "~/assets/LogoBlack.svg?react"
import { CIcon } from "~/components/CIcon"
export const LogoBlackIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={LogoBlack} />
)