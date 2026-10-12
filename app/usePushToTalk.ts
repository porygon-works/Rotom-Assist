"use client";
// 押して話す（構成設計 3 章）: ボタン（PC はスペースキー）を押している間だけ聞き取り、離したら文字にして返す
// 音声認識は当面ブラウザの Web Speech API（構成設計の第一候補 Groq Whisper は、無料枠の確認後に差し替える）
import { useCallback, useEffect, useRef, useState } from "react";

interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onnomatch?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecCtor = new () => Rec;

const getCtor = (): RecCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export type MicState = "idle" | "listening" | "unsupported" | "error";

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "マイクの使用が許可されていません。ブラウザの設定で許可してください",
  "service-not-allowed": "このブラウザでは音声認識が使えません",
  "no-speech": "声が聞こえませんでした",
  "audio-capture": "マイクが見つかりません",
  network: "音声認識の通信に失敗しました",
};

/** 聞き取りの経過（調べる用。画面から roas.history に送る） */
export type MicEvent = (name: string, detail?: string) => void;

/** 離してから「終わった」の知らせ（onend）を待つ長さ。来なければ止まったとみなして片付ける */
const END_TIMEOUT_MS = 4000;
/** 押しっぱなしの上限（押したまま放置されたとき） */
const MAX_LISTEN_MS = 30_000;

/** onText: 聞き取れた文字（確定）を渡す。onEvent: 経過の記録 */
export function usePushToTalk(onText: (text: string) => void, onEvent: MicEvent = () => {}) {
  const [state, setState] = useState<MicState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<Rec | null>(null);
  const textRef = useRef("");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const timers = useRef<number[]>([]);
  const t0 = useRef(0);

  useEffect(() => {
    if (!getCtor()) setState("unsupported");
  }, []);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  /** 1 回の聞き取りを終える（onend が来たとき、または来ないまま時間が過ぎたとき）。同じ rec で 2 回は動かない */
  const finish = useCallback((rec: Rec, why: string) => {
    if (recRef.current !== rec) return;
    clearTimers();
    recRef.current = null;
    const ms = Math.round(performance.now() - t0.current);
    onEventRef.current("mic-end", `${why} ${ms}ms 文字数${textRef.current.trim().length}`);
    setState((s) => (s === "error" ? s : "idle"));
    const t = textRef.current.trim();
    if (t) onTextRef.current(t);
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    // 前の聞き取りが「終わった」の知らせを返さずに残っていたら、捨ててやり直す
    // （以前はここで何もせずに戻っていたため、一度止まると押しても聞かなくなった）
    if (recRef.current) {
      onEventRef.current("mic-stale", "前の聞き取りが残っていたので捨てた");
      const old = recRef.current;
      recRef.current = null;
      clearTimers();
      try {
        old.onend = null;
        old.onresult = null;
        old.onerror = null;
        old.abort();
      } catch {
        /* すでに止まっている */
      }
    }
    window.speechSynthesis?.cancel(); // 読み上げ中なら止める
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    textRef.current = "";
    setInterim("");
    setError("");
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      textRef.current = finalText + interimText;
      setInterim(textRef.current);
    };
    rec.onaudiostart = () => onEventRef.current("mic-audiostart", `${Math.round(performance.now() - t0.current)}ms`);
    rec.onspeechstart = () => onEventRef.current("mic-speechstart", `${Math.round(performance.now() - t0.current)}ms`);
    rec.onnomatch = () => onEventRef.current("mic-nomatch");
    rec.onerror = (e) => {
      onEventRef.current("mic-error", e.error);
      if (e.error === "aborted") return;
      setError(ERROR_TEXT[e.error] ?? `音声認識のエラー: ${e.error}`);
      setState("error");
    };
    rec.onend = () => finish(rec, "onend");
    recRef.current = rec;
    t0.current = performance.now();
    try {
      rec.start();
      setState("listening");
      onEventRef.current("mic-start");
      timers.current.push(window.setTimeout(() => rec === recRef.current && rec.stop(), MAX_LISTEN_MS));
    } catch (err) {
      recRef.current = null;
      onEventRef.current("mic-start-failed", String(err));
      setError(String(err));
      setState("error");
    }
  }, [finish]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    onEventRef.current("mic-stop", `${Math.round(performance.now() - t0.current)}ms`);
    try {
      rec.stop();
    } catch {
      /* すでに止まっている */
    }
    // 「終わった」の知らせが来ないまま止まることがある。来なければ片付けて、次に押せるようにする
    timers.current.push(window.setTimeout(() => finish(rec, "timeout"), END_TIMEOUT_MS));
  }, [finish]);

  // 画面が隠れたら止める
  useEffect(() => {
    const h = () => {
      if (document.hidden) recRef.current?.abort();
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  return { state, interim, error, start, stop };
}
