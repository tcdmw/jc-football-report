import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const meta = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rawDir = process.argv[3];
for (const it of meta.matches) {
  const h = JSON.parse(readFileSync(join(rawDir, `${it.id}.handicap.json`), 'utf8'));
  const o = h.open, l = h.live;
  console.log(`#${it.no} ${it.home}vs${it.away} [${h.isMacau ? '澳' : h.source}]`);
  console.log(`  让球: 初 ${o.hc} (主${o.hw}/客${o.aw}) -> 即 ${l.hc} (主${l.hw}/客${l.aw})`);
  console.log(`  大小: 初 ${o.ouLine} (大${o.over}/小${o.under}) -> 即 ${l.ouLine} (大${l.over}/小${l.under})`);
}
