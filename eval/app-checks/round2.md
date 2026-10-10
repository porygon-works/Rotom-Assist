# アプリでの動作確認（2026-10-10T17:16:45.624Z）

- **メガガブリアスのじしん、HB特化カバルドンに**（1353 ms、gemini-3.1-flash-lite）
  - 見出し: メガガブリアスのじしん → カバルドン（H32B32・B↑）
  - 読み上げ: 攻撃側が無振りなら確定4発ロト。27から32パーセント。振り方しだいで27から41パーセントロト
  - 解釈: `{"attacker":"メガガブリアス","defender":"カバルドン","move":"じしん","conditions":{"defender":{"sp":{"hp":32,"def":32},"nature_up":"def"}},"uses_context":false,"intent":"damage"}`
  - AI の失敗: gemini-3.5-flash-lite HTTP 429 140ms
- **ドラパルトのドラゴンアロー、最速スカーフガブリアスに何発？**（3143 ms、AI なし）
  - 見出し: AI に接続できない
  - 読み上げ: いま混み合ってるロト。少し待ってからもう一回聞いてほしいロト
  - 解釈: `null`
  - AI の失敗: gemini-3.1-flash-lite 時間切れ 3002ms、groq-gpt-oss-120b HTTP 429 130ms
- **ハッサムのバレットパンチでサーナイト確定？**（632 ms、gemini-3.1-flash-lite）
  - 見出し: ハッサムのバレットパンチ → サーナイト
  - 読み上げ: 1発では落ちないロト。無振り同士なら確定2発ロト。59から69パーセント。振り方しだいで31から90パーセントロト
  - 解釈: `{"attacker":"ハッサム","defender":"サーナイト","move":"バレットパンチ","uses_context":false,"intent":"damage"}`
