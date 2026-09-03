import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeCost } from "./profiles";

describe("edgeCost", () => {
  it("forbids wheelchair use of stairs without a ramp", () => {
    const r = edgeCost(10, { highway: "steps" }, undefined, "wheelchair");
    assert.equal(r.kind, "forbidden");
  });

  it("allows stairs for the normal profile with a small penalty", () => {
    const r = edgeCost(10, { highway: "steps" }, undefined, "normal");
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") {
      assert.ok(r.cost > 10);
      assert.equal(r.usedSteps, true);
    }
  });

  it("prefers marked wheelchair ramps", () => {
    const ramp = edgeCost(
      10,
      { highway: "footway", wheelchair: "yes", ramp: "yes" },
      undefined,
      "wheelchair",
    );
    const plain = edgeCost(10, { highway: "footway" }, undefined, "wheelchair");
    assert.equal(ramp.kind, "ok");
    assert.equal(plain.kind, "ok");
    if (ramp.kind === "ok" && plain.kind === "ok") {
      assert.ok(ramp.cost < plain.cost);
    }
  });
});
