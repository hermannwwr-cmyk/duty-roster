// Gives every script and stylesheet a version in its URL, so phones fetch new files after each update
// instead of mixing old cached files with new ones. Run before committing: `npm run stamp`.
//
// It rewrites the block between <!-- version:start --> and <!-- version:end --> in each page:
// an import map (which also versions the files modules import from each other), the stylesheet
// and the page's main script.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const modules = ['config.js', ...readdirSync('src').filter(f => f.endsWith('.js')).map(f => 'src/' + f)];
const importMap = JSON.stringify({ imports: Object.fromEntries(modules.map(m => ['./' + m, './' + m + '?v=' + version])) }, null, 2);

for (const [page, main] of [['index.html', 'src/app.js'], ['calendar.html', 'src/calendar.js']]) {
  const html = readFileSync(page, 'utf8');
  const block = `<!-- version:start -->
<script type="importmap">
${importMap}
</script>
<link rel="stylesheet" href="styles.css?v=${version}">
<script type="module" src="${main}?v=${version}"></script>
<!-- version:end -->`;
  const next = html.replace(/<!-- version:start -->[\s\S]*?<!-- version:end -->/, block);
  if (next === html && !html.includes('version:start')) throw new Error(page + ' has no version block');
  writeFileSync(page, next);
}
console.log('Stamped version', version);
