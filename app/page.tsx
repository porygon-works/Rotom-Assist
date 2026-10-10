"use client";

import { STATUS_LABEL, useVoiceAssistant, type Engine, type SaveState } from "./useVoiceAssistant";

const ENGINE_LABEL: Record<Engine, string> = { off: "停止中", listening: "聞いています", hearing: "話し声を検出" };
const SAVE_LABEL: Record<SaveState, string> = {
  unknown: "確認中",
  unconfigured: "未設定（この端末の画面内のみ）",
  ok: "Supabaseに保存中",
  error: "保存に失敗",
};

export default function Home() {
  const { running, status, history, shown, error, supported, engine, diag, saveState, start, stop } = useVoiceAssistant();
  const r = shown?.result;

  return (
    <main>
      <h1>ロトムアシスト</h1>
      <p className="hint">
        「開始」を押したあと、「<b>ダメ計</b> ガブリアスにミミッキュのじゃれつく」のように話しかけます。
      </p>

      {!supported && <p className="err">このブラウザは音声認識（Web Speech API）に対応していません。Chrome / Edge / Safari で開いてください。</p>}
      {error && <p className="err" role="alert">{error}</p>}

      <div className="bar">
        <button onClick={start} disabled={running || !supported}>開始</button>
        <button onClick={stop} disabled={!running}>停止</button>
        <span className={`badge ${status}`} role="status" aria-live="polite" data-testid="status">
          {STATUS_LABEL[status]}
        </span>
        <span className={`badge ${engine}`} data-testid="engine">マイク: {ENGINE_LABEL[engine]}</span>
      </div>

      {shown && (
        <section className="card" aria-label="計算結果">
          <h2>{shown.title}</h2>
          {r ? (
            <dl>
              <dt>ダメージ範囲</dt>
              <dd data-testid="range">{r.min}〜{r.max}（{r.minPercent}〜{r.maxPercent}%）</dd>
              <dt>確定数</dt>
              <dd data-testid="ko">{r.koText}</dd>
              <dt>前提条件</dt>
              <dd>
                <ul>{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              </dd>
              <dt>計算内訳</dt>
              <dd className="small">{r.description}</dd>
            </dl>
          ) : (
            <p data-testid="message">{shown.message}</p>
          )}
          <p className="small">読み上げ: {shown.speech}</p>
        </section>
      )}

      <section aria-label="認識履歴">
        <h2>認識履歴</h2>
        {history.length === 0 ? (
          <p className="small">まだありません</p>
        ) : (
          <ul className="history">
            {history.map((h) => (
              <li key={h.id}>
                <span className="small">{h.time}</span> {h.text}
                <span className="note"> → {h.note}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details>
        <summary>診断（反応しないとき）</summary>
        <p className="small">履歴の保存: <span data-testid="save">{SAVE_LABEL[saveState]}</span></p>
        {diag.length === 0 ? (
          <p className="small">「開始」を押すとここに認識エンジンの動きが出ます。</p>
        ) : (
          <ul className="history small">
            {diag.map((d) => (
              <li key={d.id}>{d.time} {d.text}</li>
            ))}
          </ul>
        )}
      </details>

      <p className="small">世代9のデータで計算しています。ポケモンチャンピオンズ固有の仕様は未検証です。</p>
    </main>
  );
}
