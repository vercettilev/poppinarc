import { forwardRef } from "react";
import defaultAvatar from "~/assets/avatar.png";
import CAvatarRoot from "./CAvatarRoot";
import ICAvatarProps from "./types";

const defaultAvatarUrl = new URL(defaultAvatar, import.meta.url).href;

const CAvatar = forwardRef<HTMLDivElement, ICAvatarProps>(
  ({ size = "medium", clickable = false, src, ...rest }, ref) => (
    <CAvatarRoot
      {...rest}
      src={src || defaultAvatarUrl}
      ref={ref}
      ownerState={{ size, clickable, ...rest }}
    />
  )
);

export default CAvatar; 