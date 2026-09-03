import { pointInPolygon, type LonLat } from "./point-in-polygon";

export type BBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export function pointInBBox(
  lon: number,
  lat: number,
  bbox: BBox,
): boolean {
  return lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

export function bboxToRing(bbox: BBox): LonLat[] {
  return [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south],
  ];
}

export function expandBBox(bbox: BBox, padDeg: number): BBox {
  return {
    south: bbox.south - padDeg,
    west: bbox.west - padDeg,
    north: bbox.north + padDeg,
    east: bbox.east + padDeg,
  };
}

export { pointInPolygon };
