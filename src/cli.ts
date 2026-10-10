import { calc, type Side } from "./calc.js";

// 使い方: npm run calc -- <攻撃側> <わざ> <防御側> [攻撃側持ち物] [防御側持ち物]
const [a, move, d, aItem, dItem] = process.argv.slice(2);
if (!a || !move || !d) {
  console.error("usage: npm run calc -- <attacker> <move> <defender> [attackerItem] [defenderItem]");
  process.exit(1);
}
const side = (pokemon: string, item?: string): Side => ({ pokemon, item });
const r = calc({ attacker: side(a, aItem), defender: side(d, dItem), move });
console.log(r.description);
console.log(r.speech);
