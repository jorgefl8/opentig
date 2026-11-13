import assert from 'node:assert/strict';
import { test } from 'node:test';
import { documentationPaths } from '../docs.config.mjs';
import { pageSources, readPageDates } from './page-dates.mjs';

test('every sitemap page has sources to date it by', () => {
  assert.deepEqual(Object.keys(pageSources).sort(), ['/', ...documentationPaths].sort());
});

test('page dates are commit dates, or absent without complete history', () => {
  const dates = readPageDates();
  for (const [path, date] of dates) {
    assert.ok(path in pageSources, path);
    assert.match(date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
    assert.ok(Date.parse(date) <= Date.now());
  }
  assert.equal(readPageDates({ '/': ['no/such/path'] }).size, 0);
});
