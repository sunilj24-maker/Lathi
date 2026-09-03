export type GraphNode = {
  lat: number;
  lon: number;
  isEntrance?: boolean;
  tags?: Record<string, string>;
};

export type GraphEdge = {
  from: string;
  to: string;
  lengthM: number;
  tags: Record<string, string>;
};

export type RoutingGraph = {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
};

export type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: "building" | "entrance" | "landmark";
  osmId?: string;
  nodeId?: string;
};

export type FeatureProps = {
  osmId: string;
  kind:
    | "ramp"
    | "stairs"
    | "skywalk"
    | "crossing"
    | "elevator"
    | "entrance"
    | "bench"
    | "rest_area"
    | "other";
  name?: string;
  check_date?: string;
  tags: Record<string, string>;
};
