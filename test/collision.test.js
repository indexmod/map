import test from 'node:test';
import assert from 'node:assert/strict';
import { separatePoints } from '../src/position.js';

function check(points, options) {
  separatePoints(points, options);
  for (const [i, a] of points.entries()) {
    assert.ok(a.x >= options.margin && a.x <= options.width - options.margin);
    assert.ok(a.y >= options.margin && a.y <= options.height - options.margin);
    for (const b of points.slice(i + 1)) {
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= options.distance - .1);
    }
  }
}

test('coincident desktop and mobile points separate inside the viewport', () => {
  for (const width of [390, 1440]) {
    const options = { width, height: 844, margin: 44, distance: 76 };
    check(Array.from({ length: 20 }, () => ({ x: width / 2, y: 422 })), options);
    check(Array.from({ length: 5 }, () => ({ x: 44, y: 44 })), options);
  }
});

test('an arriving point pushes its neighbour while a dragged point stays fixed', () => {
  const options = { width: 1000, height: 800, margin: 38, distance: 64 };
  const moving = [{ x: 500, y: 400, weight: .08 }, { x: 520, y: 400, weight: 1 }];
  check(moving, options);
  assert.ok(Math.abs(moving[0].x - 500) < 4);
  assert.ok(moving[1].x > 560);
  const dragging = [{ x: 500, y: 400, weight: 0 }, { x: 500, y: 400, weight: 1 }];
  check(dragging, options);
  assert.deepEqual(dragging[0], { x: 500, y: 400, weight: 0 });
});
