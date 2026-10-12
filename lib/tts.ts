// 読み上げ（Gemini の音声生成）。ブラウザの読み上げの代わりに選べる（サーバ側専用。キーはブラウザに出さない）
// 無料枠は 1 日の回数に上限があるので、失敗したらブラウザの読み上げに戻す（画面側）

/** 速い順。上限・不調なら次へ */
export const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"];
/** 声（Gemini の既定の声の名前）。明るめの声 */
export const TTS_VOICE = "Puck";

/** 16bit PCM（モノラル）に WAV のヘッダを付ける */
export function pcmToWav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // モノラル
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export interface TtsResult {
  wav?: Uint8Array;
  model?: string;
  errors: string[];
}

export async function synthesize(text: string, key: string, fetchImpl: typeof fetch = fetch): Promise<TtsResult> {
  const errors: string[] = [];
  for (const model of TTS_MODELS) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } } },
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        errors.push(`${model}: HTTP ${res.status}`);
        continue;
      }
      const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };
      const d = j.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!d?.data) {
        errors.push(`${model}: 音声が返らない`);
        continue;
      }
      const bytes = Uint8Array.from(Buffer.from(d.data, "base64"));
      const mime = d.mimeType ?? "";
      // WAV ならそのまま、生の PCM（audio/L16;rate=24000）ならヘッダを付ける
      if (mime.includes("wav")) return { wav: bytes, model, errors };
      const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
      return { wav: pcmToWav(bytes, rate), model, errors };
    } catch (e) {
      const err = e as Error;
      errors.push(`${model}: ${err.name === "TimeoutError" ? "時間切れ" : err.message}`);
    }
  }
  return { errors };
}
