import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { screenName, screenOf, setupOf } from './screens';

const laptop = screenOf({
  label: 'Built-in Retina Display',
  internal: true,
  size: { width: 1728, height: 1117 },
  scaleFactor: 2,
});
const monitor = screenOf({
  label: 'LG HDR 4K',
  size: { width: 3840, height: 2160 },
  scaleFactor: 1,
});

describe('screens', () => {
  it('reads a display in pixels', () => {
    assert.deepEqual(laptop, {
      label: 'Built-in Retina Display',
      internal: true,
      width: 3456,
      height: 2234,
    });
    assert.equal(monitor.internal, false);
  });

  it('names a screen by its name, or what it is when it has none', () => {
    assert.equal(screenName(laptop), 'Built-in Retina Display');
    assert.equal(screenName({ ...laptop, label: '' }), 'Built-in display');
    assert.equal(screenName({ ...monitor, label: '' }), '3840×2160 display');
  });

  it('names a setup by its screens, in the same order however they are listed', () => {
    assert.equal(setupOf([laptop]), 'Built-in Retina Display');
    assert.equal(setupOf([monitor, laptop]), 'Built-in Retina Display + LG HDR 4K');
    assert.equal(setupOf([laptop, monitor]), 'Built-in Retina Display + LG HDR 4K');
    assert.equal(setupOf([monitor]), 'LG HDR 4K');
    assert.equal(setupOf([]), null);
  });

  it('is the same setup at another resolution', () => {
    const scaled = screenOf({
      label: 'Built-in Retina Display',
      internal: true,
      size: { width: 1800, height: 1169 },
      scaleFactor: 2,
    });
    assert.equal(setupOf([scaled]), setupOf([laptop]));
  });
});
