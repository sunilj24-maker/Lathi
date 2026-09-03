export type LonLat = [number, number];

/** Ray-casting point-in-polygon. Ring is GeoJSON [lon, lat][], optionally closed. */
export function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(
  lon: number,
  lat: number,
  rings: LonLat[][],
): boolean {
  if (!rings.length) return false;
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}
