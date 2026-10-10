import { ask } from "./assistant.js";

const q = process.argv.slice(2).join(" ");
if (!q) { console.error('usage: npm run ask -- "ブリジュラスのラスターカノンはハバタクカミに何割？"'); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY を環境変数で設定してください"); process.exit(1); }
console.log(await ask(q));
