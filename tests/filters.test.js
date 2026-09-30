const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFilters } = require('../filters');

test('combined filters preserve literal search and numeric price bounds', () => {
  const result = parseFilters({ q: 'chair.*', online: 'true', category: 'Furniture', minPrice: '100', maxPrice: '500', sort: 'priceAsc', page: '2' });
  assert.equal(result.page, 2);
  assert.deepEqual(result.filter.price, { $gte: 100, $lte: 500 });
  assert.deepEqual(result.filter.$or[0].name, { $regex: 'chair\\.\\*', $options: 'i' });
  assert.equal(result.filter.online, true);
  assert.equal(result.category, 'Furniture');
  assert.deepEqual(result.sort, { currency: 1, price: 1, _id: 1 });
});

test('invalid filters are rejected, including query objects and unknown sorts', () => {
  for (const query of [{ minPrice: '2', maxPrice: '1' }, { minPrice: '-1' }, { minPrice: '1.5' }, { sort: '__proto__' }, { sort: 'invalid' }, { online: 'yes' }, { category: 'Unknown' }, { q: { $ne: null } }, { scope: 'admin' }, { page: '0' }, { limit: '101' }]) {
    assert.throws(() => parseFilters(query));
  }
});
