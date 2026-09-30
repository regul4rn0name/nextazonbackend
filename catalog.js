const data = require('animal-crossing');
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = obj => Object.entries(obj || {}).filter(([key, value]) => /^[a-zA-Z]{4}$/.test(key) && typeof value === 'string').map(([,value]) => value);
function category(sheet) {
  if (['Housewares','Miscellaneous','Wall-mounted','Ceiling Decor','Artwork','Gyroids','Photos','Posters'].includes(sheet)) return 'Furniture';
  if (['Accessories','Tops','Headwear','Socks','Bags','Dress-Up','Shoes','Umbrellas','Bottoms','Clothing Other'].includes(sheet)) return 'Clothing';
  if (['Rugs','Floors','Wallpaper'].includes(sheet)) return 'Walls & floors';
  return 'Other';
}
function buildCatalog() {
  const result = new Map();
  for (const [kind, entries] of Object.entries({items:data.items,villagers:data.villagers,recipes:data.recipes,creatures:data.creatures})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) for (const variation of entry.variations?.length ? entry.variations : [{}]) {
      const item = {...entry, ...variation};
      const image = item.image || item.storageImage || item.closetImage || item.inventoryImage || item.iconImage || item.furnitureImage || item.framedImage || item.albumImage;
      // Some non-collectible music tracks have no artwork in the source package.
      const variant = [item.variation, item.pattern].filter(Boolean).join(' · ') || (kind === 'recipes' ? 'DIY recipe' : 'Original');
      const localized = names(entry.translations);
      const variants = names(item.variantTranslations);
      const searchNames = [...new Set([entry.name, ...localized, ...localized.flatMap(name => variants.map(v => `${name} ${v}`))].map(normalize))];
      const _id = `${kind}-${item.uniqueEntryId || item.filename || item.internalId}`;
      result.set(_id, {_id, name: entry.name, image: image || "/item-placeholder.svg", variant, category: kind === 'villagers' ? 'Villagers' : kind === 'recipes' ? 'DIY recipes' : kind === 'creatures' ? 'Creatures' : category(item.sourceSheet), kind, translations: entry.translations || {}, searchNames});
    }
  }
  return [...result.values()];
}
const searchFilter = q => ({$or: [{name: {$regex: escapeRegex(q), $options:'i'}}, {searchNames: {$regex: escapeRegex(normalize(q))}}]});
const snapshot = item => ({itemId:item._id, name:item.name,image:item.image,category:item.category,variant:item.variant,searchNames:item.searchNames,translations:item.translations});
module.exports = {buildCatalog, normalize, searchFilter, snapshot};
