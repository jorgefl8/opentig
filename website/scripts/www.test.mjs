import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../workers/www.mjs';

test('redirects HTTP and HTTPS www requests permanently to the canonical origin', () => {
  for (const protocol of ['http:', 'https:']) {
    const response = worker.fetch(new Request(`${protocol}//www.opentig.com/`));
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), 'https://opentig.com/');
  }
});

test('preserves encoded paths and query parameters without accepting a destination override', () => {
  const suffix = '/docs/a%20b/?q=git%2Bdiff&next=https%3A%2F%2Fexample.com';
  const response = worker.fetch(new Request(`https://www.opentig.com${suffix}`));
  assert.equal(response.headers.get('location'), `https://opentig.com${suffix}`);
});
