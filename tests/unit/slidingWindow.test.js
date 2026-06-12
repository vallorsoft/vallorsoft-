const { createSlidingWindowLimiter } = require('../../lib/slidingWindow');

describe('slidingWindow rate-limiter', () => {
  test('az ablakon belül a max-ig enged, utána tilt', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 3 });
    const t = 10000;
    expect(lim.check('a', t).ok).toBe(true);
    expect(lim.check('a', t + 1).ok).toBe(true);
    expect(lim.check('a', t + 2).ok).toBe(true);
    const blocked = lim.check('a', t + 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  test('kulcsonként külön számol', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 1 });
    const t = 0;
    expect(lim.check('a', t).ok).toBe(true);
    expect(lim.check('b', t).ok).toBe(true);   // másik kulcs nem érintett
    expect(lim.check('a', t).ok).toBe(false);
  });

  test('az ablak letelte után újra enged', () => {
    const lim = createSlidingWindowLimiter({ windowMs: 1000, max: 1 });
    expect(lim.check('a', 0).ok).toBe(true);
    expect(lim.check('a', 500).ok).toBe(false);   // ablakon belül
    expect(lim.check('a', 1500).ok).toBe(true);   // ablak letelt
  });
});
