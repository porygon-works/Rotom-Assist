"use client";
// 画面（構成設計 3 章）: 大きな「押して話す」ボタン、結果カード、文字入力、診断
import { useCallback, useEffect, useRef, useState } from "react";
import { usePushToTalk } from "./usePushToTalk";

interface Attempt {
  provider: string;
  ms: number;
  ok: boolean;
  error?: string;
}
interface AiSetup {
  env: string;
  commit: string;
  keys: { GEMINI_API_KEY: boolean; GROQ_API_KEY: boolean; LLM_API_KEY: boolean };
  providers: string[];
}
interface AskResult {
  speech: string;
  short?: string;
  title: string;
  lines: string[];
  intent: string;
  extraction?: unknown;
  diagnostics?: { provider?: string; attempts: Attempt[]; totalMs: number; setup?: AiSetup; fixed?: string };
  error?: string;
}
interface Shown extends AskResult {
  question: string;
  ms: number;
}

let memoryId: string | null = null;
/** 端末ごとの匿名ID。質問の記録（roas.ask_log）をこの端末の分で絞るのに使う（ログインはなし） */
function deviceId(): string {
  try {
    let v = localStorage.getItem("rotom-device-id");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("rotom-device-id", v);
    }
    return v;
  } catch {
    return (memoryId ??= crypto.randomUUID());
  }
}

function speak(text: string) {
  const s = window.speechSynthesis;
  if (!s) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 1.15;
  s.speak(u);
}

export default function Home() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [log, setLog] = useState<Shown[]>([]);
  const shownRef = useRef<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [tapMode, setTapMode] = useState(false);
  const [mute, setMute] = useState(false);
  const [brief, setBrief] = useState(false);
  const last = useRef<{ user: string; extraction: unknown } | null>(null);

  const send = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      setBusy(true);
      const t0 = performance.now();
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: q, history: last.current ? [last.current] : [], device_id: deviceId() }),
        });
        const r = (await res.json()) as AskResult;
        if (!res.ok) {
          const msg = r.error ?? `エラー（${res.status}）`;
          setShown({ question: q, speech: msg, title: "エラー", lines: [], intent: "error", ms: performance.now() - t0 });
          if (!mute) speak(msg);
          return;
        }
        if (r.extraction) last.current = { user: q, extraction: r.extraction };
        const item = { ...r, question: q, ms: performance.now() - t0 };
        const prev = shownRef.current;
        if (prev && prev.intent !== "error") setLog((l) => [prev, ...l].slice(0, 5));
        shownRef.current = item;
        setShown(item);
        if (!mute) speak(brief ? (r.short ?? r.speech) : r.speech);
      } catch {
        const msg = "通信に失敗したロト";
        setShown({ question: q, speech: msg, title: "エラー", lines: [], intent: "error", ms: performance.now() - t0 });
      } finally {
        setBusy(false);
      }
    },
    [mute, brief],
  );

  const mic = usePushToTalk(send);

  // PC: スペースキーを押している間だけ聞き取る（文字入力中は除く）
  useEffect(() => {
    const typing = () => (document.activeElement?.tagName ?? "") === "INPUT";
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing()) return;
      e.preventDefault();
      mic.start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing()) return;
      e.preventDefault();
      mic.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mic]);

  const listening = mic.state === "listening";
  const label = busy ? "考え中ロト…" : listening ? (tapMode ? "聞いてるロト（タップで送る）" : "聞いてるロト（離すと送る）") : tapMode ? "タップして話す" : "押して話す";

  const buttonHandlers = tapMode
    ? { onClick: () => (listening ? mic.stop() : mic.start()) }
    : {
        onPointerDown: (e: React.PointerEvent) => {
          e.preventDefault();
          mic.start();
        },
        onPointerUp: () => mic.stop(),
        onPointerLeave: () => listening && mic.stop(),
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      };

  return (
    <main>
      <h1>ロトムアシスト</h1>
      <p className="hint">ボタンを押しながら話してください（PC はスペースキー）。例:「HB振りエンペルトにA特化ガブのじしん」「最速ドラパルト抜ける？」</p>

      {mic.state === "unsupported" && <p className="err">このブラウザは音声認識に対応していません。Chrome / Edge / Safari で開くか、下の文字入力を使ってください。</p>}
      {mic.error && <p className="err" role="alert">{mic.error}</p>}

      <div className="talk">
        <button className={`talk-btn ${listening ? "on" : ""}`} disabled={busy || mic.state === "unsupported"} aria-pressed={listening} {...buttonHandlers}>
          {label}
        </button>
        <p className="interim" aria-live="polite">{listening ? mic.interim || "…" : ""}</p>
      </div>

      {shown && (
        <section className="card" aria-label="結果">
          <p className="small">聞き取り: 「{shown.question}」</p>
          <h2>{shown.title}</h2>
          <p className="speech" data-testid="speech">{shown.speech}</p>
          <p className="small">
            {shown.diagnostics?.provider === "rules" ? "ルールで即答" : shown.diagnostics?.provider ? `AI（${shown.diagnostics.provider}）` : ""} {Math.round(shown.ms)} ms
          </p>
          {shown.lines.length > 0 && (
            <ul className="lines">
              {shown.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          <details>
            <summary className="small">診断</summary>
            <ul className="small lines">
              <li>全体 {Math.round(shown.ms)} ms（サーバ {shown.diagnostics?.totalMs ?? "-"} ms）</li>
              <li>AI: {shown.diagnostics?.provider ?? "なし"}</li>
              {shown.diagnostics?.fixed && <li>聞き間違いを直した文: {shown.diagnostics.fixed}</li>}
              {shown.diagnostics?.setup && (
                <li>
                  環境 {shown.diagnostics.setup.env}
                  {shown.diagnostics.setup.commit && `（${shown.diagnostics.setup.commit}）`} / キー: GEMINI {shown.diagnostics.setup.keys.GEMINI_API_KEY ? "あり" : "なし"}・GROQ{" "}
                  {shown.diagnostics.setup.keys.GROQ_API_KEY ? "あり" : "なし"}
                </li>
              )}
              {shown.diagnostics?.attempts.map((a, i) => (
                <li key={i}>
                  {a.provider}: {a.ok ? "成功" : `失敗（${a.error}）`} {a.ms} ms
                </li>
              ))}
              <li>解釈: <code>{JSON.stringify(shown.extraction)}</code></li>
            </ul>
          </details>
        </section>
      )}

      {log.length > 0 && (
        <section aria-label="さっきの質問">
          <h2 className="small">さっきの質問</h2>
          <ul className="history">
            {log.map((h, i) => (
              <li key={i} className="small">
                「{h.question}」→ {h.speech}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="bar"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="文字で聞く（例: ガブにミミッキュのじゃれつく）" aria-label="質問" maxLength={200} />
        <button type="submit" disabled={busy || !text.trim()}>送る</button>
      </form>

      <div className="bar small">
        <label><input type="checkbox" checked={tapMode} onChange={(e) => setTapMode(e.target.checked)} /> タップで開始／終了</label>
        <label><input type="checkbox" checked={brief} onChange={(e) => setBrief(e.target.checked)} /> 短く読む</label>
        <label><input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} /> 読み上げない</label>
        {shown && <button type="button" className="ghost" onClick={() => speak(brief ? (shown.short ?? shown.speech) : shown.speech)}>もう一度読む</button>}
      </div>

      <p className="small">
        ポケモンチャンピオンズ（Lv50・SP）の仕様で、@smogon/calc を使って計算しています。振り方を言わなかった側は無振りで計算し、振り方の幅も出します。日本語名: PokeAPI。
      </p>
    </main>
  );
}
