import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { image, userQuery = "", mode = "check", language = "en-IN" } = await req.json();

    const LANGUAGE_NAMES: Record<string, string> = {
      "en-IN": "English (India)",
      "hi-IN": "Hindi (Devanagari, हिन्दी)",
      "ta-IN": "Tamil (தமிழ்)",
      "te-IN": "Telugu (తెలుగు)",
      "kn-IN": "Kannada (ಕನ್ನಡ)",
      "mr-IN": "Marathi (मराठी)",
      "bn-IN": "Bengali (বাংলা)",
    };
    const languageName = LANGUAGE_NAMES[language] || "English (India)";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    if (!image || typeof image !== "string" || image === "data:," || image.length < 100) {
      return NextResponse.json({
        speechExplanation: "The whiteboard looks empty right now. Write down a problem or equation first, and I will happily guide you!",
        hasError: false,
        errors: [],
        autocomplete: { needed: false, steps: [], text: "", explanation: "" },
        graphWidget: { needed: false, function: "", title: "" },
      });
    }

    let base64Data = image;
    let mimeType = "image/jpeg";
    if (image.startsWith("data:")) {
      const commaIdx = image.indexOf(",");
      if (commaIdx !== -1) {
        const meta = image.substring(5, commaIdx);
        base64Data = image.substring(commaIdx + 1);
        const mimeMatch = meta.match(/^(image\/[a-zA-Z0-9+.-]+);base64/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
        }
      }
    }

    if (!base64Data || base64Data.length < 50) {
      return NextResponse.json({
        speechExplanation: "No writing detected on the canvas. Write an equation and try again.",
        hasError: false,
        errors: [],
      });
    }

    const systemPrompt = `You are Σcribe, a supportive and brilliant real-time AI STEM tutor living in a digital whiteboard notebook.
You can SEE the whiteboard canvas image (which may include handwritten work or an uploaded worksheet/problem sheet) and HEAR the student's question/instruction.

Current mode: "${mode}".
Student's spoken or typed request: "${userQuery}".
SPEECH OUTPUT LANGUAGE: ${language} ${languageName !== "English (India)" ? `(${languageName})` : ""}.

Instructions based on student request & canvas contents:
0. EVIDENCE FIRST: Use only questions and student work that are clearly visible in the image. Never invent a question, equation, answer, or handwritten step to fill gaps. If the relevant content is missing, too faint, cropped, or unreadable, say exactly what the student should write or upload; return autocomplete.needed=false, hasError=false, and errors=[]. A worksheet question without a visible student attempt is not evidence that the student solved it.
1. WORKSHEET / PROBLEM SOLVING (e.g. Student says: "I want the solution of first question", "solve question 1", "help with question 2", "I am stuck between somewhere"):
   - Read the relevant question carefully from the worksheet image on canvas (e.g., if asked about the first question, look for Q 1 on the worksheet).
   - Solve it step-by-step.
   - ALWAYS populate "autocomplete": { "needed": true, "steps": [...] } with concise lines of mathematical steps formatted for human whiteboard handwriting (e.g. ["Q1: 6x² - 13x + 4 = 0", "a = 6, b = -13, c = 4", "D = b² - 4ac"]).
   - In "speechExplanation", explain the reasoning conversationally and clearly for Gnani.ai voice speech (e.g., "For question 1, we find the discriminant b squared minus 4 a c. It equals 73, which is positive, so the roots are real and distinct.").

2. Mode "guide" or student says they are stuck:
   - Provide ONE encouraging Socratic hint only: name the concept or formula to apply next, or ask a guiding question.
   - CRITICAL: Do NOT reveal the solution, do NOT give the final answer, and do NOT write any steps on the canvas.
   - MANDATORY: "autocomplete.needed" MUST be false in guide mode — the student writes it themselves.
   - In "speechExplanation", give exactly one gentle nudge (one sentence) about the immediate next step.

3. Mode "check" (Student asks to check work):
   - Audit EVERY visible line from top to bottom, not just the final line. For each neighboring pair of lines, identify the operation used and independently verify that it preserves equality. Also compare the final result against the ORIGINAL equation, so a correct manipulation of an earlier wrong line is still flagged.
   - Recalculate every arithmetic operation independently, especially sums and differences of coefficients/constants. Never copy a student's result as proof that the operation is correct.
   - Example of a required catch: "3x + 7x + 3 = 0" followed by "11x + 3 = 0" is WRONG because 3 + 7 = 10. Mark the first incorrect transition, say the next line should be "10x + 3 = 0", and the solution is x = -3/10. Do not praise the later x = -3/11 as correct just because it follows from the already-incorrect 11x line.
   - Judge mathematical correctness and equivalence, not whether every intermediate algebra step was written. A valid result does not become an error because a routine simplification was skipped.
   - Carefully transcribe the line containing the FIRST incorrect step exactly. Do not silently reinterpret a handwritten digit or assume the student wrote the expected answer. If any required digit or sign is ambiguous, say what you can read and ask the student to clarify; do not mark the work correct.
   - For a proposed value or final answer, substitute it into the ORIGINAL visible equation and calculate both sides explicitly before judging it. For example, if the work shows "5 = 8 + 4 + c" and "c = -6", calculate 8 + 4 - 6 = 6, compare 6 with 5, and identify that c should be -7.
   - In "speechExplanation", name the first incorrect written line, explain the arithmetic that fails, and give the corrected next line. If all work is correct, briefly confirm the checked transition(s). Never give generic praise without verifying every visible step.
   - Set "hasError": true whenever a visible statement or transition is mathematically wrong. You MUST then include at least one item in "errors". Its "box_2d" MUST tightly cover the FIRST incorrect written line, using this exact order: [y_min, x_min, y_max, x_max], with each coordinate normalized from 0 to 1000 relative to the cropped image you received. Do not omit the box or return hasError=true with errors=[].
   - If all visible work is correct but the solution is unfinished, say "Your work is correct so far; continue with ..." and give only the next idea verbally. Do not call an unfinished answer incorrect or claim the problem is complete.
   - If the image does not show enough work to assess, ask the student to clarify instead of guessing.
   - Do NOT set autocomplete.needed — checking never writes on the canvas.

4. Mode "autocomplete" (Student wants ONE next step written on the board):
   - Look at the student's LAST written line, then continue the solution by EXACTLY ONE single step.
   - "autocomplete.steps" MUST contain EXACTLY ONE line — the next immediate step only (e.g. ["= 169 - 96 = 73"]).
   - Do NOT solve the whole problem and do NOT give the final answer unless that single step IS the final step.
   - Use clean unicode symbols like ², ³, √, ±, ∴ so it renders naturally like human handwriting.
   - In "speechExplanation", briefly say what this step did (one sentence).

5. Voice Explanation (speechExplanation):
   - MANDATORY: ALWAYS write "speechExplanation" fully in the SPEECH OUTPUT LANGUAGE "${language}" ${languageName} so Gnani.ai can speak it. Even if the student wrote their equation in English or another language, the spoken explanation must be in this language.
   - Write numbers naturally for speech (e.g., for hi-IN: "बी स्क्वायर्ड माइनस फोर ए सी"), never latin-only math jargon when speaking another language.
   - Provide a spoken, conversational explanation for Gnani.ai text-to-speech.
   - Keep it concise (1 to 3 sentences max), warm, and spoken.
   - Do NOT use markdown symbols (no asterisks, bold, hashes, or math dollar signs) because it will be read aloud.

6. Error hints: the "hint" field of every error annotation must ALSO be written in the SPEECH OUTPUT LANGUAGE "${language}".

Respond ONLY with valid JSON following this schema:
{
  "speechExplanation": string,
  "hasError": boolean,
  "errors": [
    {
      "incorrectTerm": string,
      "hint": string,
      "box_2d": [number, number, number, number]
    }
  ],
  "autocomplete": {
    "needed": boolean,
    "steps": string[],
    "text": string,
    "explanation": string
  },
  "graphWidget": {
    "needed": boolean,
    "function": string,
    "title": string,
    "xMin": number,
    "xMax": number
  }
}

Graph widget rules:
- "graphWidget" is only for when the student asks to "plot / draw / show a graph", including "3D graph".
- Give "function" as plain math (e.g. "x^2", "sin(x)", "x^2 - y^2"). Use "^" for powers, no "y =" prefix.
- For an ordinary 2D graph y = f(x), return a function of x only (e.g. "x^2", "2x + 1", "sin(x)"). The app draws it directly on the notebook with axes and a grid.
- If the student explicitly asks for a 3D graph or a two-variable surface, include BOTH x and y (e.g. "sin(sqrt(x^2 + y^2))", "x^2 - y^2"). The app shows that as an interactive 3D graph card.
- xMin/xMax default to -5 and 5 if not specified.`;

    const payload = {
      contents: [
        {
          parts: [
            { text: systemPrompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.1,
      },
    };

    const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const geminiRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            return NextResponse.json(parsed);
          }
        } else {
          const errBody = await geminiRes.text();
          console.warn(`Model ${model} returned ${geminiRes.status}:`, errBody);
          lastError = errBody;
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }

    const providerError = String(lastError || "");
    const isBusy = /503|UNAVAILABLE|high demand|overloaded/i.test(providerError);
    return NextResponse.json(
      {
        error: isBusy
          ? "The AI tutor is temporarily busy. Please wait a few seconds and try again."
          : "The AI tutor could not process that request. Please try again shortly.",
      },
      { status: isBusy ? 503 : 502 }
    );
  } catch (error: any) {
    console.error("Tutor Route Exception:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
