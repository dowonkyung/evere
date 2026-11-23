import assert from 'node:assert/strict';
import fs from 'node:fs';
import { articlePath, articleNumberFromURL, categoryPath, categoryFromURL, routeTemplate } from '../assets/evere/routes.js';
import { articleCategories } from '../assets/evere/article-taxonomy.js';

assert.equal(articlePath({article_number:4}),'/article/4');
assert.throws(()=>articlePath({id:'uuid'}));
for (const path of ['/article/4','/article/4/']) {
 assert.equal(articleNumberFromURL('https://evere.test'+path),4);
 assert.equal(routeTemplate(path),'/article/index.html');
}
for(const path of ['/article/0','/article/-1','/article/01','/article/9007199254740992','/article/4/extra','/unknown/thing']) {
 assert.equal(articleNumberFromURL('https://evere.test'+path),null);
 assert.equal(routeTemplate(path),null);
}
let count=0;
for (const [sector, entries] of Object.entries(articleCategories)) {
 for(const [category] of entries) {
  const path=categoryPath(sector,category);
  assert.equal(path,'/'+sector+'/'+category);
  assert.equal(categoryFromURL(sector,'https://evere.test'+path),category);
  assert.equal(categoryFromURL(sector,'https://evere.test/'+sector+'/?category='+category),category);
  assert.equal(categoryFromURL(sector,'https://evere.test'+path+'/'),category);
  assert.ok(routeTemplate(path));
  assert.ok(fs.existsSync(new URL('..'+path+'/index.html',import.meta.url)));
  count++;
 }
}
assert.equal(categoryFromURL('wiki','https://evere.test/wiki/?category=not-real'),'');
assert.throws(()=>categoryPath('wiki','not-real'));
assert.equal(routeTemplate('/wiki/not-real'),null);
console.log('Article parsing, legacy category links, and '+count+' category routes passed.');

