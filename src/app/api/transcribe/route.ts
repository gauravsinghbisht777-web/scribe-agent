import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    const language = String(form.get("language") || "en-IN");

    if (!(audio instanceof Blob) || audio.size < 1000) {
      return NextResponse.json({ error: "No usable microphone recording was received." }, { status: 400 });
    }
    if (audio.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "That recording is too long. Please record a shorter question." }, { status: 413 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 500 });
    }

    const mimeType = audio.type.split(";")[0] || "audio/webm";
    const base64Audio = Buffer.from(await audio.arrayBuffer()).toString("base64");
    const prompt = `Transcribe this student's spoken question exactly and return only the transcript, without explanation or quotation marks. Preserve mathematical words and numbers. The expected language is ${language}; if the student speaks another language, transcribe the language actually spoken.`;
    let lastError = "No transcription was returned.";

    for (const model of ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"]) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: mimeType, data: base64Audio } },
                ],
              }],
              generationConfig: { temperature: 0 },
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const transcript = data.candidates?.[0]?.content?.parts
            ?.map((part: { text?: string }) => part.text || "")
            .join("")
            .trim();
          if (transcript) return NextResponse.json({ transcript });
          lastError = "The speech service returned an empty transcript.";
        } else {
          lastError = await response.text();
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Speech service request failed.";
      }
    }

    console.error("Microphone transcription failed:", lastError);
    return NextResponse.json({ error: "Speech transcription is unavailable right now." }, { status: 502 });
  } catch (error) {
    console.error("Transcription route failed:", error);
    return NextResponse.json({ error: "Could not process the microphone recording." }, { status: 500 });
  }
}
