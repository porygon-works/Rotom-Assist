"use client";
// 画面（構成設計 3 章）: 大きな「押して話す」ボタン、結果カード、文字入力、診断
import { useCallback, useEffect, useRef, useState } from "react";
import { usePushToTalk } from "./usePushToTalk";
import type { DamageCard, SideCard } from "../lib/card";
import { RotomFace } from "./RotomFace";

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
  log?: boolean;
}
interface AskResult {
  speech: string;
  short?: string;
  title: string;
  lines: string[];
  card?: DamageCard;
  desc?: string;
  intent: string;
  extraction?: unknown;
  diagnostics?: { provider?: string; attempts: Attempt[]; totalMs: number; setup?: AiSetup };
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

// ---- しゃべっているか（顔の口を動かす）----
const speakingListeners = new Set<(b: boolean) => void>();
let speakingNow = false;
let speakingPoll = 0;
function setSpeaking(b: boolean) {
  if (b === speakingNow) return;
  speakingNow = b;
  speakingListeners.forEach((f) => f(b));
  window.clearInterval(speakingPoll);
  // 終わりの知らせ（onend）が来ない端末があるので、ブラウザの読み上げが止まったかを定期的に確かめる
  if (b) speakingPoll = window.setInterval(() => {
    if (!window.speechSynthesis?.speaking && !(player && !player.paused && player.src.startsWith("blob:"))) setSpeaking(false);
  }, 300);
}

function speak(text: string) {
  const s = window.speechSynthesis;
  if (!s) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 1.15;
  u.onstart = () => setSpeaking(true);
  u.onend = () => setSpeaking(false);
  u.onerror = () => setSpeaking(false);
  s.speak(u);
  setSpeaking(true);
}

// ---- 経過の記録（聞き取りが止まる原因を調べる用。roas.history に kind=event で送る。失敗しても何もしない）----
const pageT0 = typeof performance !== "undefined" ? performance.now() : 0;
function logEvent(name: string, detail = "") {
  try {
    const note = `${Math.round(performance.now() - pageT0)}ms ${detail}`.trim();
    void fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId(), kind: "event", text: name, note }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* 記録できなくてもアプリは動かす */
  }
}

// ---- 音（合図の音・Gemini の声）----
// 合図の音（public/sounds/rotom.mp3、約 1.7 秒）は「画面を開いたとき」と「答えの準備ができて読み上げる前」に鳴らす。
// **音声認識の前後（聞き始め・聞き取り直後）では鳴らさない**: スマホでは音の再生が音声認識とぶつかり、聞き取りが止まる。
// 再生には 1 つの audio 要素を使い回す（スマホは操作の後でないと音を出せないので、最初の「はじめる」で鳴らして使える状態にする）。
// 鳴らし終わったら中身を外し、マイクを使うときは止める
const CHIME = "/sounds/rotom.mp3";
export type Voice = "browser" | "gemini";
let player: HTMLAudioElement | null = null;
let seq = 0;

function playUrl(url: string): Promise<void> {
  const a = (player ??= new Audio());
  return new Promise((resolve) => {
    const done = () => {
      a.removeEventListener("ended", done);
      a.removeEventListener("error", done);
      resolve();
    };
    a.addEventListener("ended", done);
    a.addEventListener("error", done);
    a.src = url;
    void a.play().catch(done);
  });
}

function releaseAudio() {
  if (!player) return;
  player.pause();
  player.removeAttribute("src");
  player.load();
}

/** 読み上げ・合図を止める（次の答えの前） */
function stopSound() {
  seq++;
  releaseAudio();
  window.speechSynthesis?.cancel();
  setSpeaking(false);
}

/** マイクを使う前: 鳴っているときだけ止める。何も鳴っていなければ音の部品に触らない
 *  （スマホでは、聞き始めの直前に audio 要素を操作するだけで音声認識が止まった。2026-10-11 ask_log #25） */
function stopSoundForMic() {
  seq++;
  if (player && !player.paused) player.pause();
  setSpeaking(false);
}

/** Gemini の声（/api/tts）。失敗したら null（ブラウザの読み上げに戻す） */
async function fetchVoice(text: string): Promise<string | null> {
  try {
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/** 答えを読み上げる。chime: 先に合図の音を鳴らす（その間に Gemini の声を用意する） */
async function announce(text: string, voice: Voice, chime: boolean) {
  stopSound();
  const my = seq;
  const audio = voice === "gemini" ? fetchVoice(text) : null;
  if (chime) {
    logEvent("sound-chime");
    await playUrl(CHIME);
  }
  const url = audio ? await audio : null;
  if (voice === "gemini") logEvent(url ? "sound-gemini" : "sound-gemini-failed");
  if (my !== seq) {
    if (url) URL.revokeObjectURL(url);
    return; // 途中でマイクを使った・次の答えが来た
  }
  if (url) {
    setSpeaking(true);
    await playUrl(url);
    setSpeaking(false);
    URL.revokeObjectURL(url);
    releaseAudio();
    return;
  }
  releaseAudio();
  logEvent("speak");
  speak(text);
}

/** 最初の「はじめる」: 合図の音を鳴らし、ブラウザの読み上げも使える状態にする（スマホは最初の読み上げも操作の後でないと出ない） */
function unlockSound() {
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis?.speak(u);
  } catch {
    /* 読み上げがない環境 */
  }
  void playUrl(CHIME).then(releaseAudio);
}

export default function Home() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [log, setLog] = useState<Shown[]>([]);
  const shownRef = useRef<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [tapMode, setTapMode] = useState(false);
  const [mute, setMute] = useState(false);
  const [voice, setVoiceState] = useState<Voice>("browser");
  // 合図の音（答えの前）。端末によって音声認識とぶつかる場合に切れるようにする
  // 初期値はオフ: 聞き取りが止まる原因を切り分ける間は、答えの前の音も鳴らさない（オンにすると鳴る）
  const [chimeOn, setChimeOnState] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("rotom-chime") === "on") setChimeOnState(true);
    } catch {
      /* 保存できない環境 */
    }
  }, []);
  const setChimeOn = (on: boolean) => {
    setChimeOnState(on);
    try {
      localStorage.setItem("rotom-chime", on ? "on" : "off");
    } catch {
      /* 保存できない環境 */
    }
  };
  useEffect(() => {
    try {
      if (localStorage.getItem("rotom-voice") === "gemini") setVoiceState("gemini");
    } catch {
      /* 保存できない環境 */
    }
  }, []);
  const setVoice = (v: Voice) => {
    setVoiceState(v);
    try {
      localStorage.setItem("rotom-voice", v);
    } catch {
      /* 保存できない環境 */
    }
  };
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
          // 返事が来ないと「考え中」のままボタンが押せなくなるので、時間を区切る
          signal: AbortSignal.timeout(25_000),
        });
        const r = (await res.json()) as AskResult;
        if (!res.ok) {
          const msg = r.error ?? `エラー（${res.status}）`;
          setShown({ question: q, speech: msg, title: "エラー", lines: [], intent: "error", ms: performance.now() - t0 });
          if (!mute) void announce(msg, "browser", false);
          return;
        }
        if (r.extraction) last.current = { user: q, extraction: r.extraction };
        const item = { ...r, question: q, ms: performance.now() - t0 };
        const prev = shownRef.current;
        if (prev && prev.intent !== "error") setLog((l) => [prev, ...l].slice(0, 5));
        shownRef.current = item;
        setShown(item);
        // 答えの準備ができたら合図の音 → 読み上げ（聞き取りはもう終わっているので音声認識とはぶつからない）
        if (!mute) void announce(brief ? (r.short ?? r.speech) : r.speech, voice, chimeOn);
      } catch {
        const msg = "通信に失敗したロト";
        logEvent("ask-failed", q.slice(0, 40));
        setShown({ question: q, speech: msg, title: "エラー", lines: [], intent: "error", ms: performance.now() - t0 });
      } finally {
        setBusy(false);
      }
    },
    [mute, brief, voice, chimeOn],
  );

  const [speaking, setSpeakingState] = useState(false);
  useEffect(() => {
    speakingListeners.add(setSpeakingState);
    return () => void speakingListeners.delete(setSpeakingState);
  }, []);
  const mic0 = usePushToTalk(send, logEvent);
  // 開いたときの環境（端末・ブラウザ）を記録
  useEffect(() => logEvent("page-load", navigator.userAgent), []);
  // マイクを使う前に、鳴っている合図・読み上げを止める
  const mic = { ...mic0, start: () => (stopSoundForMic(), mic0.start()) };
  // 画面を開いたときの確認（音が出ること・マナーモードの解除）。押すと合図の音を鳴らす（ブラウザは操作の後でないと音を出せない）
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // マイクが聞き始めたら振動で合図（音は鳴らさない: スマホでは音の再生が音声認識とぶつかり、聞き取りが止まるため）
  useEffect(() => {
    if (mic.state === "listening") navigator.vibrate?.(40);
  }, [mic.state]);

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
  const label = busy ? "考え中…" : listening ? (tapMode ? "タップで送る" : "離すと送る") : tapMode ? "タップして話す" : "押して話す";

  const buttonHandlers = tapMode
    ? { onClick: () => (listening ? mic.stop() : mic.start()) }
    : {
        onPointerDown: (e: React.PointerEvent) => {
          e.preventDefault();
          mic.start();
        },
        onPointerUp: () => mic.stop(),
        onPointerLeave: () => listening && mic.stop(),
        // スクロールや長押しの判定などで、指が離れた知らせが来ないことがある
        onPointerCancel: () => mic.stop(),
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      };

  if (!ready)
    return (
      <div className="app">
        <Header />
        <main>
          <section className="hero">
            <RotomFace speaking={false} />
          </section>
          <section className="card start" aria-label="はじめに">
            <p className="speech">このアプリは音が出ます</p>
            <p>答えを読み上げます。いまボタンを押すと、確認の音が鳴ります。</p>
            <p>
              <strong>マナーモード（消音）を解除して、音量を上げてください。</strong>
            </p>
            <button
              type="button"
              className="start-btn"
              onClick={() => {
                unlockSound();
                setReady(true);
              }}
            >
              音を鳴らしてはじめる
            </button>
            <p className="small">音が聞こえなければ、マナーモードと音量を確かめてください。</p>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setMute(true);
                setReady(true);
              }}
            >
              音なしで使う
            </button>
          </section>
        </main>
      </div>
    );

  // 顔の下に出す今の状態
  const status = busy ? "考え中ロト…" : listening ? mic.interim || "聞いてるロト…" : shown ? "" : tapMode ? "下のボタンをタップして話してロト" : "下のボタンを押しながら話してロト";

  return (
    <div className="app">
      <Header onSettings={() => setSettingsOpen((v) => !v)} settingsOpen={settingsOpen} />

      {settingsOpen && (
        <section className="sheet" aria-label="設定">
          <label className="row"><span>タップで開始／終了</span><input type="checkbox" checked={tapMode} onChange={(e) => setTapMode(e.target.checked)} /></label>
          <label className="row"><span>短く読む</span><input type="checkbox" checked={brief} onChange={(e) => setBrief(e.target.checked)} /></label>
          <label className="row"><span>読み上げない</span><input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} /></label>
          <label className="row"><span>答えの前の合図</span><input type="checkbox" checked={chimeOn} onChange={(e) => setChimeOn(e.target.checked)} /></label>
          <label className="row">
            <span>声</span>
            <select value={voice} onChange={(e) => setVoice(e.target.value as Voice)}>
              <option value="browser">ブラウザ（速い）</option>
              <option value="gemini">Gemini（自然・約2秒遅い）</option>
            </select>
          </label>
          <p className="small">PC はスペースキーを押している間だけ聞き取ります。</p>
        </section>
      )}

      <main>
        <section className="hero">
          <RotomFace speaking={speaking} />
          <p className={`status ${listening ? "on" : ""}`} aria-live="polite">{status}</p>
          {!shown && <p className="hint">例:「HB振りエンペルトにA特化ガブのじしん」「最速ドラパルト抜ける？」</p>}
        </section>

        {mic.state === "unsupported" && <p className="err">このブラウザは音声認識に対応していません。Chrome / Edge / Safari で開くか、下の文字入力を使ってください。</p>}
        {mic.error && <p className="err" role="alert">{mic.error}</p>}

        {shown && (
          <section className="card result" aria-label="結果">
            <div className="result-head">
              <p className="small">「{shown.question}」</p>
              <button type="button" className="chip" onClick={() => void announce(brief ? (shown.short ?? shown.speech) : shown.speech, voice, false)} aria-label="もう一度読む">
                もう一度読む
              </button>
            </div>
            <h2>{shown.title}</h2>
            {/* ダメ計は結論だけを大きく出す（場合分け・前提はカードに出る。全文は読み上げる） */}
            <p className="speech" data-testid="speech">{shown.card ? (shown.short ?? shown.speech) : shown.speech}</p>
            {shown.card && <CardView card={shown.card} />}
            {shown.lines.length > 0 && (
              <div className="lines">
                {shown.lines.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </div>
            )}
            <details>
              <summary className="small">
                診断（{shown.diagnostics?.provider === "rules" ? "ルールで即答" : shown.diagnostics?.provider ? `AI: ${shown.diagnostics.provider}` : "AI なし"}・{Math.round(shown.ms)} ms）
              </summary>
              <ul className="small lines">
                <li>全体 {Math.round(shown.ms)} ms（サーバ {shown.diagnostics?.totalMs ?? "-"} ms）</li>
                {shown.diagnostics?.setup && (
                  <li>
                    環境 {shown.diagnostics.setup.env}
                    {shown.diagnostics.setup.commit && `（${shown.diagnostics.setup.commit}）`} / キー: GEMINI {shown.diagnostics.setup.keys.GEMINI_API_KEY ? "あり" : "なし"}・GROQ{" "}
                    {shown.diagnostics.setup.keys.GROQ_API_KEY ? "あり" : "なし"} / 記録(ask_log) {shown.diagnostics.setup.log ? "あり" : "なし"}
                  </li>
                )}
                {shown.diagnostics?.attempts.map((a, i) => (
                  <li key={i}>
                    {a.provider}: {a.ok ? "成功" : `失敗（${a.error}）`} {a.ms} ms
                  </li>
                ))}
                {shown.desc && <li>計算: <code>{shown.desc}</code></li>}
                <li>解釈: <code>{JSON.stringify(shown.extraction)}</code></li>
              </ul>
            </details>
          </section>
        )}

        {log.length > 0 && (
          <section className="history-wrap" aria-label="さっきの質問">
            <h2 className="label">さっきの質問</h2>
            <ul className="history">
              {log.map((h, i) => (
                <li key={i}>
                  <span className="q">「{h.question}」</span>
                  <span className="a">{h.card ? (h.short ?? h.speech) : h.speech}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="foot">
          ポケモンチャンピオンズ（Lv50・SP）の仕様で、@smogon/calc を使って計算しています。振り方を言わなければ、攻撃側は使う能力に全振り（補正ありの場合も出す）、防御側は無振り（耐久に振った場合も出す）で計算します。日本語名: PokeAPI。
        </p>
        <p className="foot">
          質問と答えは、答えの精度を上げるために記録しています（名前やアカウントなど個人を特定する情報は記録しません）。公式大会やランクマッチでの外部ツールの使用は、それぞれのルールを確認してください。
        </p>
      </main>

      {/* 下に固定: 親指で押しやすい「押して話す」と文字入力 */}
      <div className="dock">
        <button className={`talk-btn ${listening ? "on" : ""}`} disabled={busy || mic.state === "unsupported"} aria-pressed={listening} {...buttonHandlers}>
          <MicIcon />
          <span>{label}</span>
        </button>
        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
            setText("");
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="文字で聞く（例: ガブにミミッキュのじゃれつく）" aria-label="質問" maxLength={200} />
          <button type="submit" disabled={busy || !text.trim()} aria-label="送る">
            送る
          </button>
        </form>
      </div>
    </div>
  );
}

/** 上のバー: 左にロゴ、右に設定 */
function Header({ onSettings, settingsOpen }: { onSettings?: () => void; settingsOpen?: boolean }) {
  return (
    <header className="topbar">
      <Logo />
      {onSettings && (
        <button type="button" className="icon-btn" onClick={onSettings} aria-label="設定" aria-expanded={settingsOpen}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="18" r="2" />
          </svg>
        </button>
      )}
    </header>
  );
}

/** ロゴ（public/brand/logo.webp）。「Rotom」がオレンジなので、背景のオレンジに溶けないよう黒い帯に載せる */
function Logo() {
  return (
    <span className="logo-wrap">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo.webp" alt="ロトムアシスト" className="logo" width={915} height={120} />
    </span>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** ダメ計の計算条件カード: 結果 → 攻撃側・防御側 → わざ → 場 */
function CardView({ card }: { card: DamageCard }) {
  return (
    <div className="dcard">
      <p className="dresult">
        <strong>{card.result.damage}</strong> <span className="ko">{card.result.ko}</span>
      </p>
      {card.result.cases.map((c) => (
        <p key={c} className="small drange">
          {c}
        </p>
      ))}
      <div className="sides">
        <SideView side={card.attacker} />
        <div className="arrow" aria-hidden>
          ▶
        </div>
        <SideView side={card.defender} />
      </div>
      <dl className="drow">
        <dt>わざ</dt>
        <dd>
          <strong>{card.move.name}</strong>　{card.move.type}・{card.move.category}・威力 {card.move.power}
        </dd>
        <dt>天候・フィールド</dt>
        <dd>{card.field.length ? card.field.join("・") : <span className="assumed">なし</span>}</dd>
      </dl>
    </div>
  );
}

function SideView({ side }: { side: SideCard }) {
  return (
    <div className={`side ${side.role === "攻撃側" ? "atk" : "def"}`}>
      <p className="role">{side.role}</p>
      <p className="pname">{side.name}</p>
      <dl>
        {side.items.map((it) => (
          <div key={it.label} className="kv">
            <dt>{it.label}</dt>
            <dd className={it.assumed ? "assumed" : ""}>
              {it.value}
              {it.assumed && <span className="tag">仮定</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
