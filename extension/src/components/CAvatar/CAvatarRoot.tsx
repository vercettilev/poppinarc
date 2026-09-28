import { Avatar } from "@mui/material";
import { styled } from "@mui/material/styles";
import ICAvatarProps from "./types";

const CAvatarRoot = styled(Avatar)<{
  ownerState: ICAvatarProps;
}>(({ ownerState, theme }) => {
  const { size = "medium", clickable } = ownerState;

  const sizeMap = {
    small: 24,
    medium: 32,
    large: 40,
    xlarge: 56,
  };

  return {
    width: sizeMap[size],
    height: sizeMap[size],
    cursor: clickable ? "pointer" : "default",
    "& img": {
      objectFit: "contain",
    },
    "&:hover": clickable ? {
      opacity: 0.8,
      transition: "opacity 0.2s ease-in-out",
    } : {},
  };
});

export default CAvatarRoot; 