// アプリでの動作確認: 起動中のアプリ（/api/ask）に、対戦でありそうな質問を通して回答を一覧にする（AI を実際に呼ぶ）
// 使い方: npx next start -p 3123 を起動してから npx tsx eval/app-check.ts [a|b|c] [http://localhost:3123] > eval/app-checks/<日時>.md
// 1 行が 1 つの会話。「 → 」でつなぐと、前の質問を文脈として続けて聞く
const SET = ["b", "c"].includes(process.argv[2]) ? process.argv[2] : "a";
const BASE = process.argv[3] ?? "http://localhost:3123";

export const CONVERSATIONS: string[] = [
  "メガガブリアスのじしん、HB特化カバルドンに",
  "ドラパルトのドラゴンアロー、最速スカーフガブリアスに何発？",
  "ハッサムのバレットパンチでサーナイト確定？",
  "雨のウォッシュロトムのハイドロポンプでバンギラス落ちる？",
  "ゲンガーのシャドーボール、HD特化ニンフィアに何発？",
  "サザンドラのりゅうせいぐん、メガネ持ちでサーフゴーに",
  "ガブリアスの弱点は？",
  "ミミッキュの種族値",
  "しんそくの優先度は？",
  "最速ガブリアスの素早さ",
  "ガオガエンとドドゲザンどっちが速い？",
  "砂嵐ですなかきのドリュウズって最速ドラパルト抜ける？",
  "いかくを受けたガブのじしん、ドドゲザンに",
  "リザードンのエアスラッシュ、ガブリアスに",
  "メガリザードンXのフレアドライブ、ドドゲザンに確定？",
  "HP半分のドドゲザン、ガブのじしんで落ちる？",
  "C+1のサザンドラのあくのはどう、サーフゴー耐える？",
  "ハバタクカミのムーンフォース、ガブリアスに",
  "ガブリアス",
  "ありがとう",
  "ニンフィアのハイパーボイス、ガブに",
  "ガブリアスにミミッキュのじゃれつく → じゃあA特化なら？ → じゃあガブがH振りだったら？",
  "イダイトウって最速メガルカリオZ抜ける？ → じゃあスカーフ持ってたら？",
  "サーフゴーのゴールドラッシュ、HB特化カイリューに → マルチスケイル込みだと？",
];

// 4 回目から使う別の組（1〜3 回目で直したことが、別の言い方でも効くかを見る）
export const CONVERSATIONS_B: string[] = [
  "ガブのげきりん、H振りメガカイリューに",
  "マルチスケイルのカイリューにガブのげきりん",
  "ハッサムにリザードンのかえんほうしゃ、晴れ",
  "ガブリアスとドラパルトとサーフゴー、どれが一番速い？",
  "ガブの地震でゲンガー落ちる？",
  "ドドゲザンのふいうち、HP3割のサーフゴーに",
  "しんそくとバレットパンチどっちが優先度高い？",
  "がぶりあすのじゃくてん",
  "メガルカリオZの種族値",
  "最速イダイトウの実数値",
  "ハッサムってつるぎのまい覚える？",
  "S+1ガブリアスと最速メガルカリオZどっちが速い？",
  "ステロ込みでリザードンにドドゲザンのアイアンヘッド",
  "スカーフガブリアス抜ける？",
  "こんにちは",
  "ガブリアスにピカチュウのボルテッカー",
  "がぶりあすにみみっきゅのじゃれ付く",
  "ウォッシュロトムのハイドロポンプ、ガブリアスに → じゃあ雨なら？ → じゃあH振りなら？",
];

// 7 回目から使う組: 音声認識の出力に近い書き方（空白・漢字・カタカナの略号）と、くだけた言い方
export const CONVERSATIONS_C: string[] = [
  "ガブリアス に ミミッキュ の じゃれつく",
  "エー特化ガブの地震 エイチビー振りのカバルドンに何発",
  "ドラパルトのシャドーボールでゲンガー一発？",
  "サーフゴーってメガルカリオゼットより速い？",
  "準速ガブとスカーフドラパってどっち速いの",
  "ニンフィアのハイパーボイスってカイリュー確定1発？",
  "相手のバンギラス砂起こしだけどガブの地震で落ちる？",
  "ハッサムのバレットパンチ 襷のサーナイトに",
  "まひしたガブとドドゲザンどっち速い",
  "やけどしたミミッキュのじゃれつくでガブ何発",
  "トリトドンの弱点",
  "流星群の威力いくつ？",
  "イダイトウってアクアブレイク覚える？",
  "ねえロトム、ガブリアスのじしんでエンペルト倒せる？",
  "メガリザードンワイのソーラービーム、ウォッシュロトムに",
  "最速メガルカリオZとS+1の最速ガブ、どっちが先？",
  "ミミッキュのじゃれつく、ガブに → じゃあA特化いのちのたまなら？ → じゃあステロ込みだったら？",
];

interface Res {
  speech?: string;
  title?: string;
  lines?: string[];
  intent?: string;
  extraction?: unknown;
  error?: string;
  diagnostics?: { provider?: string; totalMs: number; attempts?: { provider: string; ok: boolean; error?: string; ms: number }[] };
}

async function main() {
  console.log(`# アプリでの動作確認（組 ${SET}、${new Date().toISOString()}）\n`);
  for (const conv of SET === "b" ? CONVERSATIONS_B : SET === "c" ? CONVERSATIONS_C : CONVERSATIONS) {
    let history: { user: string; extraction: unknown }[] = [];
    for (const q of conv.split(" → ")) {
      const t0 = Date.now();
      const res = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q, history }) });
      const r = (await res.json()) as Res;
      const ms = Date.now() - t0;
      if (r.extraction) history = [{ user: q, extraction: r.extraction }];
      console.log(`- **${q}**（${ms} ms、${r.diagnostics?.provider ?? "AI なし"}）`);
      console.log(`  - 見出し: ${r.title ?? r.error}`);
      console.log(`  - 読み上げ: ${r.speech ?? r.error}`);
      console.log(`  - 解釈: \`${JSON.stringify(r.extraction)}\``);
      const failed = (r.diagnostics?.attempts ?? []).filter((a) => !a.ok);
      if (failed.length) console.log(`  - AI の失敗: ${failed.map((a) => `${a.provider} ${a.error} ${a.ms}ms`).join("、")}`);
      await new Promise((ok) => setTimeout(ok, 5000)); // 1 分あたりの上限に当たらないように（実際の対戦より速いペースにしない）
    }
  }
}

// 直接実行したときだけ動かす（質問の一覧を他のスクリプトから読み込めるように）
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
