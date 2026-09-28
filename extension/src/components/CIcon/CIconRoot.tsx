import { SvgIcon } from "@mui/material";
import { styled } from "@mui/material/styles";
import ICIconProps from "./types";

const CIconRoot = styled(SvgIcon)<{
  ownerState: ICIconProps;
}>(({ ownerState }) => {
  const {} = ownerState;

  return {
    width: "unset",
    height: "unset",
  };
});

export default CIconRoot;
