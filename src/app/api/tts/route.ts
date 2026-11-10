import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const {
      text,
      language = "en-IN",
      voice = "Nalini",
      speed = 1.0,
    } = await req.json();

    if (!text || text.trim() === "") {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const apiKey = process.env.GNANI_API_KEY;
    const ttsUrl = process.env.GNANI_TTS_URL || "https://api.vachana.ai/api/v1/tts/inference";

    if (!apiKey) {
      return NextResponse.json({ error: "GNANI_API_KEY is not configured" }, { status: 500 });
    }

    const payload = {
      text: text.trim(),
      voice: voice,
      model: "timbre-v2.5",
      language: language,
      speed: Number(speed) || 1.0,
      audio_config: {
        sample_rate: 24000,
        container: "wav",
      },
    };

    const res = await fetch(ttsUrl, {
      method: "POST",
      headers: {
        "X-API-Key-ID": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gnani TTS Error:", res.status, errText);
      return NextResponse.json({ error: `Gnani TTS failed: ${errText}` }, { status: res.status });
    }

    const audioBuffer = await res.arrayBuffer();

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "no-cache",
      },
    });
  } catch (error: any) {
    console.error("TTS Route Exception:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
