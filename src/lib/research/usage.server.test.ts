import assert from "node:assert/strict";
import test from "node:test";

/**
 * Mirrors the SQL reservation rule:
 *   UPDATE ... SET count = count + 1 WHERE count < cap RETURNING count
 * Two writers on the last slot: only the one that still sees count < cap wins.
 */
function reserveSlot(state: { count: number }, cap: number): boolean {
  if (state.count < cap) {
    state.count += 1;
    return true;
  }
  return false;
}

test("SQL-style WHERE count < cap: two racers, one slot, one winner", async () => {
  const state = { count: 0 };
  const cap = 1;
  let chain = Promise.resolve();
  const tryReserve = () => {
    let ok = false;
    const next = chain.then(() => {
      ok = reserveSlot(state, cap);
    });
    chain = next.then(() => undefined, () => undefined);
    return next.then(() => ok);
  };
  const results = await Promise.all([tryReserve(), tryReserve(), tryReserve()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(state.count, 1);
});

test("global cap blocks a second user even if their personal cap is unused", async () => {
  const global = { count: 0 };
  const globalCap = 1;
  const userA = { count: 0 };
  const userB = { count: 0 };
  const userCap = 10;
  function take(user: { count: number }): boolean {
    if (!reserveSlot(global, globalCap)) return false;
    if (!reserveSlot(user, userCap)) return false;
    return true;
  }
  assert.equal(take(userA), true);
  assert.equal(take(userB), false);
  assert.equal(global.count, 1);
});
