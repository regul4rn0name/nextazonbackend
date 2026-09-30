const test = require('node:test');
const assert = require('node:assert/strict');
const {buildCatalog,searchFilter,normalize} = require('../catalog');
test('catalog preserves variants, CDN images, and multilingual names',()=>{
  const items=buildCatalog();
  assert.equal(items.length,26253);
  assert.equal(new Set(items.map(item=>item._id)).size,items.length);
  const mushroom=items.find(item=>item.name==='1-Up Mushroom');
  for(const key of ['eUru','eUfr','jPja','kRko','cNzh']) {
    assert.ok(mushroom.searchNames.includes(normalize(mushroom.translations[key])));
  }
  assert.equal(items.filter(item=>item.image==='/item-placeholder.svg').length,3);
  assert.ok(items.filter(item=>item.image.startsWith('https://acnhcdn.com/')).length>26000);
  const glasses=items.filter(item=>item.name==='3D glasses');
  assert.ok(glasses.length>1);
  assert.equal(new Set(glasses.map(item=>item.image)).size,glasses.length);
  assert.equal(searchFilter('Étoile').$or[1].searchNames.$regex,'etoile');
});
