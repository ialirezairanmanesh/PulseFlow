declare module "react-flame-graph" {
  import type { ComponentType } from "react";

  export interface FlameGraphNode {
    name: string;
    value: number;
    children?: FlameGraphNode[];
    tooltip?: string;
  }

  export interface FlameGraphProps {
    data: FlameGraphNode;
    height?: number;
    width?: number | string;
    onChange?: (node: FlameGraphNode) => void;
  }

  export const FlameGraph: ComponentType<FlameGraphProps>;
}
