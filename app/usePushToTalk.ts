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

/** onText: 聞き取れた文字（確定）を渡す */
export function usePushToTalk(onText: (text: string) => void) {
  const [state, setState] = useState<MicState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<Rec | null>(null);
  const textRef = useRef("");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    if (!getCtor()) setState("unsupported");
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;
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
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      setError(ERROR_TEXT[e.error] ?? `音声認識のエラー: ${e.error}`);
      setState("error");
    };
    rec.onend = () => {
      recRef.current = null;
      setState((s) => (s === "error" ? s : "idle"));
      const t = textRef.current.trim();
      if (t) onTextRef.current(t);
    };
    recRef.current = rec;
    try {
      rec.start();
      setState("listening");
    } catch (err) {
      recRef.current = null;
      setError(String(err));
      setState("error");
    }
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

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
