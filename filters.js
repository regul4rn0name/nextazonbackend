const { searchFilter } = require('./catalog');
const categories = ['Furniture', 'Villagers', 'Clothing', 'Materials', 'Walls & floors', 'DIY recipes', 'Creatures', 'Other'];
const sorts = { newest: { createdAt: -1, _id: -1 }, priceAsc: { currency: 1, price: 1, _id: 1 }, priceDesc: { currency: 1, price: -1, _id: 1 }, name: { name: 1, _id: 1 } };
function positiveInteger(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= max ? number : null;
}
function parseFilters(query) {
  const page = positiveInteger(query.page, 1, 1000000);
  const pageSize = positiveInteger(query.limit, 20, 100);
  const text = key => {
    if (query[key] === undefined) return '';
    if (typeof query[key] !== 'string' || query[key].length > 100) throw new Error(`Invalid ${key}.`);
    return query[key].trim();
  };
  const q = text('q'), category = text('category'), seller = text('seller'), scope = text('scope'), sort = text('sort') || 'newest';
  if (page === null || pageSize === null || !Object.hasOwn(sorts, sort)) throw new Error('Invalid page, limit, or sort.');
  if (category && !categories.includes(category)) throw new Error('Unknown category.');
  if (scope && !['mine', 'wishlist'].includes(scope)) throw new Error('Unknown listing scope.');
  if (query.online !== undefined && !['true', 'false'].includes(query.online)) throw new Error('Invalid online filter.');
  const price = key => {
    const value = text(key);
    if (!value) return undefined;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 999999999) throw new Error(`Invalid ${key}.`);
    return Number(value);
  };
  const minPrice = price('minPrice'), maxPrice = price('maxPrice');
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) throw new Error('Minimum price exceeds maximum price.');
  const filter = {};
  if (q) Object.assign(filter, searchFilter(q));
  const currency = text('currency');
  if (currency && !['Bells','Nook Miles Tickets','trade'].includes(currency)) throw new Error('Unknown currency.');
  if (currency === 'trade') filter.offerType = 'trade';
  else if (currency) filter.currency = currency === 'Bells' ? {$in:['Bells','Belle']} : currency;
  if (query.online === 'true') filter.online = true;
  if (seller) filter.userId = /^\d+$/.test(seller) ? { $in: [seller, Number(seller)] } : seller;
  if (minPrice !== undefined || maxPrice !== undefined) filter.price = {
    ...(minPrice !== undefined ? { $gte: minPrice } : {}), ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
  };
  return { page, pageSize, filter, category, scope, sort: sorts[sort] };
}
module.exports = { parseFilters, positiveInteger };
