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

export type Engine = "off" | "listening" | "hearing";
export type SaveState = "unknown" | "unconfigured" | "ok" | "error";
export interface DiagItem {
  id: number;
  time: string;
  text: string;
}
export interface HistoryItem {
  id: number | string;
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
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onnomatch: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecCtor = new () => Rec;

const getCtor = (): RecCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const QUESTION_TIMEOUT_MS = 15000;

let memoryId: string | null = null;
/** 端末ごとの匿名ID。履歴の保存・取得はこのIDで絞る（ログインはなし）。 */
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

export function useVoiceAssistant() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("wake");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [shown, setShown] = useState<ShownResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [engine, setEngine] = useState<Engine>("off");
  const [diag, setDiag] = useState<DiagItem[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("unknown");

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

  const persist = (kind: "utterance" | "event", text: string, note: string) => {
    fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_id: deviceId(), kind, text, note }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        setSaveState(r.ok && d.saved ? "ok" : d.configured === false ? "unconfigured" : "error");
      })
      .catch(() => setSaveState("error"));
  };

  const addHistory = (text: string, note: string) => {
    setHistory((h) => [{ id: ++histId.current, time: new Date().toLocaleTimeString("ja-JP"), text, note }, ...h].slice(0, 50));
    persist("utterance", text, note);
  };

  /** 認識エンジンの動きを画面に出す（反応しない原因の切り分け用）。エラーだけ保存する。 */
  const log = (text: string, save = false) => {
    setDiag((d) => [{ id: ++histId.current, time: new Date().toLocaleTimeString("ja-JP"), text }, ...d].slice(0, 30));
    if (save) persist("event", text, "");
  };

  const stopSpeech = () => {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  };
  const speak = (text: string) => {
    if (typeof speechSynthesis === "undefined") return;
    stopSpeech(); // 読み上げ中に次の質問が来たら止めてから読む
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      speechSynthesis.speak(u);
    } catch {
      /* 読み上げに失敗しても、画面の結果はそのまま残す */
    }
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
        if (e.results[i].isFinal) {
          const t = e.results[i][0].transcript.trim();
          log(`認識結果: ${t}`);
          handleRef.current(t);
        }
      }
    };
    r.onstart = () => {
      setEngine("listening");
      log("認識エンジン起動");
    };
    r.onaudiostart = () => log("マイク入力を開始");
    r.onsoundstart = () => log("音を検出");
    r.onspeechstart = () => {
      setEngine("hearing");
      log("話し声を検出");
    };
    r.onspeechend = () => {
      setEngine("listening");
      log("話し声が止まった（認識結果を待っています）");
    };
    r.onnomatch = () => log("聞き取れませんでした（候補なし）");
    r.onerror = (e) => {
      log(`エラー: ${e.error}`, e.error !== "no-speech" && e.error !== "aborted");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false; // マイク拒否は再開しない
        setRunning(false);
        setError("マイクの使用が許可されていません。ブラウザの設定で許可してください。");
      } else if (e.error === "network") {
        setError("音声認識サーバに接続できません（ネットワークを確認してください）。");
      } else if (e.error === "audio-capture") {
        setError("マイクが見つかりません。");
      }
      // no-speech / network / aborted などは onend から自動再開する
    };
    r.onend = () => {
      recRef.current = null;
      setEngine("off");
      log("認識エンジン終了" + (wantRef.current && !document.hidden ? "（自動で再開します）" : ""));
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
    setEngine("off");
    releaseWakeLock();
    stopSpeech();
    setPhaseBoth("wake");
  }, [setPhaseBoth]);

  useEffect(() => {
    setSupported(!!getCtor());
    fetch(`/api/history?device_id=${encodeURIComponent(deviceId())}`)
      .then((r) => r.json())
      .then((d: { configured?: boolean; items?: { id: number; text: string; note: string; created_at: string }[] }) => {
        if (d.configured === false) return setSaveState("unconfigured");
        const items = (d.items ?? []).map((x) => ({
          id: `s${x.id}`,
          time: new Date(x.created_at).toLocaleString("ja-JP"),
          text: x.text,
          note: x.note,
        }));
        setHistory((h) => [...h, ...items].slice(0, 50));
        setSaveState("ok");
      })
      .catch(() => setSaveState("error"));
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
  return { running, status, history, shown, error, supported, engine, diag, saveState, start, stop };
}

export type { Named };
