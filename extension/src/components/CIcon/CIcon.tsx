import { forwardRef } from "react";
import CIconRoot from "./CIconRoot";
import ICIconProps from "./types";

const CIcon = forwardRef<SVGSVGElement, ICIconProps>(
  ({ children, ...rest }, ref) => (
    <CIconRoot inheritViewBox={true} {...rest} ref={ref} ownerState={{}}>
      {children}
    </CIconRoot>
  )
);

export default CIcon;
