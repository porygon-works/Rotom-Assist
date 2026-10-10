"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalcResult } from "../lib/calc";
import { parseQuestion, type Named } from "../lib/parse";
import { buildSpeech } from "../lib/speech";
import { extractAfterWakeWord } from "../lib/wakeword";

export type Phase = "wake" | "question" | "calculating";
export const STATUS_LABEL = {
  idle: "待機中",
  wake: "合言葉待ち",
  question: "質問受付中",
  calculating: "計算中",
} as const;

export interface HistoryItem {
  id: number;
  time: string;
  text: string;
  note: string;
}
export interface ShownResult {
  title: string;
  result?: CalcResult;
  message?: string;
  speech: string;
}

// SpeechRecognition は lib.dom に型がないので最小限だけ定義する
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecCtor = new () => Rec;

const getCtor = (): RecCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const QUESTION_TIMEOUT_MS = 15000;

export function useVoiceAssistant() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("wake");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [shown, setShown] = useState<ShownResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const wantRef = useRef(false); // ユーザーが「開始」して、まだ「停止」していない
  const recRef = useRef<Rec | null>(null);
  const phaseRef = useRef<Phase>("wake");
  const reqRef = useRef(0);
  const histId = useRef(0);
  const lastStart = useRef(0);
  const lockRef = useRef<{ release(): Promise<void> } | null>(null);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const addHistory = (text: string, note: string) =>
    setHistory((h) => [{ id: ++histId.current, time: new Date().toLocaleTimeString("ja-JP"), text, note }, ...h].slice(0, 50));

  const stopSpeech = () => {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  };
  const speak = (text: string) => {
    if (typeof speechSynthesis === "undefined") return;
    stopSpeech(); // 読み上げ中に次の質問が来たら止めてから読む
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    speechSynthesis.speak(u);
  };

  const clearQTimer = () => {
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = null;
  };

  const ask = useCallback(
    async (question: string) => {
      clearQTimer();
      const id = ++reqRef.current;
      stopSpeech();
      setPhaseBoth("calculating");

      const parsed = parseQuestion(question);
      if (!parsed.ok) {
        const msg = parsed.message;
        setShown({ title: question, message: msg, speech: msg });
        addHistory(question, "解釈できず");
        setPhaseBoth("wake");
        speak(msg);
        return;
      }
      const names = { attacker: parsed.attacker, defender: parsed.defender, move: parsed.move };
      const title = `${names.attacker.ja}の${names.move.ja} → ${names.defender.ja}`;
      try {
        const res = await fetch("/api/calc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ attacker: names.attacker.en, defender: names.defender.en, move: names.move.en, gen: 9 }),
        });
        const data = await res.json();
        if (id !== reqRef.current) return; // 新しい質問が来ていたら捨てる
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        const result = data as CalcResult;
        const speech = buildSpeech(names, result);
        setShown({ title, result, speech });
        addHistory(question, `${result.minPercent}〜${result.maxPercent}% ${result.koText}`);
        setPhaseBoth("wake");
        speak(speech);
      } catch (e) {
        if (id !== reqRef.current) return;
        const msg = `計算に失敗しました。${(e as Error).message}`;
        setShown({ title, message: msg, speech: msg });
        addHistory(question, "計算エラー");
        setPhaseBoth("wake");
        speak("計算に失敗しました。");
      }
    },
    [setPhaseBoth],
  );

  const handleTranscript = useCallback(
    (text: string) => {
      const { found, rest } = extractAfterWakeWord(text);
      if (phaseRef.current === "question" && !found) {
        void ask(text); // 合言葉だけ言ったあとの次の発話
        return;
      }
      if (!found) {
        addHistory(text, "合言葉なし（無視）");
        return;
      }
      if (rest) {
        void ask(rest);
        return;
      }
      addHistory(text, "合言葉を検出。次の発話を質問として待ちます");
      setPhaseBoth("question");
      clearQTimer();
      qTimer.current = setTimeout(() => setPhaseBoth("wake"), QUESTION_TIMEOUT_MS);
    },
    [ask, setPhaseBoth],
  );
  const handleRef = useRef(handleTranscript);
  handleRef.current = handleTranscript;

  const requestWakeLock = async () => {
    try {
      if ("wakeLock" in navigator && !lockRef.current) {
        lockRef.current = await (navigator as unknown as { wakeLock: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen");
      }
    } catch {
      /* 使えなくても動く */
    }
  };
  const releaseWakeLock = () => {
    lockRef.current?.release().catch(() => {});
    lockRef.current = null;
  };

  const startRecognition = useCallback(() => {
    if (recRef.current) return;
    const Ctor = getCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ja-JP";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) handleRef.current(e.results[i][0].transcript.trim());
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false; // マイク拒否は再開しない
        setRunning(false);
        setError("マイクの使用が許可されていません。ブラウザの設定で許可してください。");
      }
      // no-speech / network / aborted などは onend から自動再開する
    };
    r.onend = () => {
      recRef.current = null;
      if (!wantRef.current || document.hidden) return;
      const quick = Date.now() - lastStart.current < 1000; // 即終了が続くときは間を空ける
      setTimeout(() => {
        if (wantRef.current && !document.hidden && !recRef.current) startRecognition();
      }, quick ? 1500 : 300);
    };
    recRef.current = r;
    lastStart.current = Date.now();
    try {
      r.start();
    } catch {
      recRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!getCtor()) return;
    setError(null);
    wantRef.current = true;
    setRunning(true);
    setPhaseBoth("wake");
    startRecognition();
    void requestWakeLock();
  }, [setPhaseBoth, startRecognition]);

  const stop = useCallback(() => {
    wantRef.current = false; // 先に false にして onend で再開しないようにする
    setRunning(false);
    clearQTimer();
    reqRef.current++; // 進行中の計算結果は捨てる
    recRef.current?.abort();
    recRef.current = null;
    releaseWakeLock();
    stopSpeech();
    setPhaseBoth("wake");
  }, [setPhaseBoth]);

  useEffect(() => {
    setSupported(!!getCtor());
    // 画面が隠れたら認識を止め、戻ってきたら（開始中だったときだけ）再開する
    const onVis = () => {
      if (document.hidden) {
        recRef.current?.abort();
        recRef.current = null;
        releaseWakeLock();
        stopSpeech();
      } else if (wantRef.current) {
        startRecognition();
        void requestWakeLock();
      }
    };
    const onHide = () => {
      recRef.current?.abort();
      recRef.current = null;
      stopSpeech();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      wantRef.current = false;
      recRef.current?.abort();
      releaseWakeLock();
      stopSpeech();
      clearQTimer();
    };
  }, [startRecognition]);

  const status: keyof typeof STATUS_LABEL = !running ? "idle" : phase;
  return { running, status, history, shown, error, supported, start, stop };
}

export type { Named };
