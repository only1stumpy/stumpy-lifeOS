import assert from "node:assert/strict";
import { test } from "node:test";
import { createScrollLock } from "../src/components/scroll-lock";

function setup(webApp?: Record<string, unknown>) {
  const style = { position: "", top: "", left: "", right: "", width: "", overflow: "auto" };
  const calls: string[] = [];
  let scrollY = 340;
  const lock = createScrollLock({
    body: { style },
    getScrollY: () => scrollY,
    scrollTo: (y) => { calls.push(`scrollTo:${y}`); scrollY = y; },
    telegram: webApp ? () => webApp : undefined,
  });
  return { style, calls, lock };
}

test("scroll lock pins the body, restores styles and scroll position", () => {
  const { style, calls, lock } = setup();
  lock.lock();
  assert.equal(style.position, "fixed");
  assert.equal(style.top, "-340px");
  lock.unlock();
  assert.equal(style.position, "");
  assert.equal(style.overflow, "auto");
  assert.deepEqual(calls, ["scrollTo:340"]);
});

test("scroll lock is reference counted and ignores extra unlocks", () => {
  const { style, calls, lock } = setup();
  lock.lock();
  lock.lock();
  lock.unlock();
  assert.equal(style.position, "fixed");
  assert.deepEqual(calls, []);
  lock.unlock();
  lock.unlock();
  assert.equal(style.position, "");
  assert.deepEqual(calls, ["scrollTo:340"]);
});

test("scroll lock toggles Telegram vertical swipes only when supported", () => {
  const events: string[] = [];
  const modern = { isVersionAtLeast: () => true, disableVerticalSwipes: () => events.push("off"), enableVerticalSwipes: () => events.push("on") };
  const a = setup(modern);
  a.lock.lock();
  a.lock.lock();
  a.lock.unlock();
  a.lock.unlock();
  assert.deepEqual(events, ["off", "on"]);

  const old = { isVersionAtLeast: () => false, disableVerticalSwipes: () => events.push("bad") };
  const b = setup(old);
  b.lock.lock();
  b.lock.unlock();
  const throwing = setup({ disableVerticalSwipes: () => { throw new Error("x"); }, enableVerticalSwipes: () => undefined });
  assert.doesNotThrow(() => { throwing.lock.lock(); throwing.lock.unlock(); });
  assert.deepEqual(events, ["off", "on"]);
});
