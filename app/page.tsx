"use client";

import { STATUS_LABEL, useVoiceAssistant } from "./useVoiceAssistant";

export default function Home() {
  const { running, status, history, shown, error, supported, start, stop } = useVoiceAssistant();
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

      <p className="small">世代9のデータで計算しています。ポケモンチャンピオンズ固有の仕様は未検証です。</p>
    </main>
  );
}
