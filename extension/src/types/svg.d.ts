declare module "*.svg?react" {
    import { FunctionComponent } from "react";
    const ReactComponent: FunctionComponent<React.SVGProps<SVGSVGElement>>;
    export default ReactComponent;
  }