import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pointInPolygon } from "./point-in-polygon";

const square: [number, number][][] = [
  [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
  ],
];

describe("pointInPolygon", () => {
  it("detects interior points", () => {
    assert.equal(pointInPolygon(1, 1, square), true);
  });

  it("detects exterior points", () => {
    assert.equal(pointInPolygon(3, 1, square), false);
  });
});
