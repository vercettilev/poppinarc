import { AvatarProps } from "@mui/material";

export default interface ICAvatarProps extends AvatarProps {
  size?: "small" | "medium" | "large" | "xlarge";
  clickable?: boolean;
} 