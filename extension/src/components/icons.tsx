import { SvgIconProps } from "@mui/material"

import ArrowUp from "~/assets/ArrowUp.svg?react"
import ChevronDown from "~/assets/ChevronDown.svg?react"
import Copy from "~/assets/Copy.svg?react"
import Filter from "~/assets/Filter.svg?react"
import Microphone from "~/assets/Microphone.svg?react"
import Scaling from "~/assets/Scaling.svg?react"
import Send from "~/assets/Send.svg?react"
import SidebarToggle from "~/assets/SidebarToggle.svg?react"
import Smile from "~/assets/Smile.svg?react"
import World from "~/assets/World.svg?react"
import { CIcon } from "./CIcon"

import Comment from "~/assets/Comment.svg?react"

import DailyComment from "~/assets/DailyComment.svg?react"
import Eye from "~/assets/Eye.svg?react"
import InviteFrens from "~/assets/InviteFrens.svg?react"
import Login from "~/assets/Login.svg?react"
import Popvote from "~/assets/Popvote.svg?react"
import Wallet from "~/assets/Wallet.svg?react"
import X from "~/assets/XIcon.svg?react"

import Photo from "~/assets/Photo.svg?react"
export const PhotoIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Photo} />
)

import User from "~/assets/User.svg?react"
export const UserIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={User} />
)

const ReferralUrl = new URL("~/assets/Referral.png", import.meta.url)
export const ReferralIcon = (props: SvgIconProps) => (
  <img src={ReferralUrl.toString()} alt="Referral" {...(props as any)} />
)

const StockMarketUrl = new URL("~/assets/StockMarket.png", import.meta.url)
export const StockMarketIcon = (props: SvgIconProps) => (
  <img src={StockMarketUrl.toString()} alt="Stock Market" {...(props as any)} />
)

const LetterKUrl = new URL("~/assets/LetterK.png", import.meta.url)
export const LetterKIcon = (props: SvgIconProps) => (
  <img src={LetterKUrl.toString()} alt="Kalshi" {...(props as any)} />
)

const WalletPngUrl = new URL("~/assets/Wallet.png", import.meta.url)
export const WalletPngIcon = (props: SvgIconProps) => (
  <img src={WalletPngUrl.toString()} alt="Wallet" {...(props as any)} />
)

export const CopyIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Copy} />
)

export const WalletIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Wallet} />
)

export const SmileIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Smile} />
)

export const EyeIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Eye} />
)

export const CommentIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Comment} />
)

export const ArrowUpIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={ArrowUp} />
)

export const WorldIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={World} />
)

export const HomeIcon = ({
  strokeWidth = 1.5,
  ...props
}: SvgIconProps & { strokeWidth?: number }) => (
  <CIcon {...props}>
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16.129 5.63586L10.6745 1.39313C9.68993 0.626768 8.31084 0.626768 7.32539 1.39313L1.87084 5.63586C1.2063 6.15222 0.818115 6.94677 0.818115 7.78859V14.4549C0.818115 15.9613 2.03902 17.1822 3.54539 17.1822H14.4545C15.9608 17.1822 17.1818 15.9613 17.1818 14.4549V7.78859C17.1818 6.94677 16.7936 6.15222 16.129 5.63586Z"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <path
        d="M12.6363 11.0347C10.6272 13.0438 7.3708 13.0438 5.36353 11.0347"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </CIcon>
)

export const MicrophoneIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Microphone} />
)

export const SidebarToggleIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={SidebarToggle} />
)

export const FilterIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Filter} />
)

export const ChevronDownIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={ChevronDown} />
)

export const ScalingIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Scaling} />
)

export const SendIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Send} />
)

export const XIcon = (props: SvgIconProps) => <CIcon {...props} component={X} />

export const LoginIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Login} />
)

export const PopvoteIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Popvote} />
)

export const DailyCommentIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={DailyComment} />
)

export const InviteFrensIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={InviteFrens} />
)

import Sort from "~/assets/Sort.svg?react"
export const SortIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Sort} />
)

import Post from "~/assets/Post.svg?react"
export const PostIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Post} />
)

import Diamond from "~/assets/Diamond.svg?react"
export const DiamondIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Diamond} />
)

import Reply from "~/assets/Reply.svg?react"
export const ReplyIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Reply} />
)

import Notification from "~/assets/Notification.svg?react"
export const NotificationsIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Notification} />
)

import NotificationOff from "~/assets/NotificationOff.svg?react"
export const NotificationsOffIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={NotificationOff} />
)

import Ellipse from "~/assets/Ellipse.svg?react"
export const EllipseIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Ellipse} />
)

import Announcement from "~/assets/Announcement.svg?react"
export const AnnouncementIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Announcement} />
)

import LogoWithoutEye from "~/assets/LogoWithoutEye.svg?react"
export const LogoWithoutEyeIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={LogoWithoutEye} />
)

import LogoBlack from "~/assets/LogoBlack.svg?react"
export const LogoBlackIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={LogoBlack} />
)

import Heart from "~/assets/Heart.svg?react"
export const HeartIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Heart} />
)

import HeartFilled from "~/assets/HeartFilled.svg?react"
export const HeartFilledIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={HeartFilled} />
)

import FollowIconSvg from "~/assets/FollowIcon.svg?react"
export const FollowIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={FollowIconSvg} />
)

import UnfollowIconSvg from "~/assets/UnfollowIcon.svg?react"
export const UnfollowIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={UnfollowIconSvg} />
)

import ArrowLeft from "~/assets/ArrowLeft.svg?react"
export const ArrowLeftIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={ArrowLeft} />
)

import People from "~/assets/People.svg?react"
export const PeopleIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={People} />
)

import Task from "~/assets/Task.svg?react"
export const TaskIcon = (props: SvgIconProps) => (
  <CIcon {...props} component={Task} />
)

const ShareUrl = new URL("~/assets/ShareIcon.png", import.meta.url)
export const ShareIcon = (props: SvgIconProps) => (
  <img
    src={ShareUrl.toString()}
    width={10}
    height={10}
    alt="Share Icon"
    {...(props as any)}
  />
)

const CoinUrl = new URL("~/assets/CoinIcon.png", import.meta.url)
export const CoinIcon = (props: SvgIconProps) => (
  <img
    src={CoinUrl.toString()}
    width={10}
    height={10}
    alt="Coin Icon"
    {...(props as any)}
  />
)
