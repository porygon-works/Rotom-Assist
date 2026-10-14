// 開いたままの画面を新しい版に入れ替える（同じ URL を開いていれば、いつも最新の版で動くように）
// 対戦中の邪魔をしないよう、聞き取り・考え中・読み上げ中は入れ替えない。答えを読んでいる間も入れ替えない
import { useEffect, useRef } from "react";

/** 最後に話してから、入れ替えるまで待つ時間（答えを読んでいる間は入れ替えない） */
export const QUIET_MS = 3 * 60 * 1000;
/** 別のタブ・アプリから戻ってきたときは、これだけ静かなら入れ替える（答えを見てすぐ戻ったときは消さない） */
export const RETURN_QUIET_MS = 30 * 1000;
const CHECK_MS = 60 * 1000;

/**
 * 入れ替えるか決める。base: 開いたときの版、latest: 今の版（どちらも分からなければ入れ替えない）。
 * returning: 別のアプリやタブから戻ってきたとき（次の質問の前なので、少し静かなら入れ替えてよい）
 */
export function shouldReload(o: { base: string; latest: string; idle: boolean; quietFor: number; returning: boolean }): boolean {
  if (!o.base || !o.latest || o.base === o.latest || !o.idle) return false;
  return o.quietFor >= (o.returning ? RETURN_QUIET_MS : QUIET_MS);
}

export function useAutoUpdate(idle: boolean, log: (name: string, detail?: string) => void) {
  const base = useRef("");
  const lastActive = useRef(Date.now());
  const idleRef = useRef(idle);
  idleRef.current = idle;
  if (!idle) lastActive.current = Date.now();

  useEffect(() => {
    const latest = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        return r.ok ? (((await r.json()) as { commit?: string }).commit ?? "") : "";
      } catch {
        return "";
      }
    };
    const check = async (returning: boolean) => {
      if (document.visibilityState !== "visible") return;
      const now = await latest();
      if (!base.current) {
        base.current = now;
        return;
      }
      if (shouldReload({ base: base.current, latest: now, idle: idleRef.current, quietFor: Date.now() - lastActive.current, returning })) {
        log("auto-update", `${base.current.slice(0, 7)}→${now.slice(0, 7)}`);
        location.reload();
      }
    };
    void check(false);
    const onVisible = () => document.visibilityState === "visible" && void check(true);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => void check(false), CHECK_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [log]);
}
