# Σcribe — AI Whiteboard Tutor

Σcribe is a browser-based math and STEM whiteboard. Write or upload a problem, then ask the AI tutor to check your work, offer a hint, or show the next step. It also supports voice questions, spoken explanations, and multiple saved notebooks.

**Live app:** [Open Σcribe on Vercel](https://scribe-agent-pied.vercel.app)

## Features

- Large, scrollable writing canvas with pen, eraser, undo, and redo.
- Upload or paste worksheet images, then move and resize them on the board.
- **Check** reviews the visible work, including intermediate steps. When it detects an error, it can mark the relevant area and provide a hint.
- **Guide** gives a hint; **Next Step** writes one step on the board.
- AI image input is cropped around visible writing and worksheets to make handwritten work easier to read.
- Draw 2D graphs on the board.
- Ask questions by typing or speaking. If the browser's speech recognition service is unavailable, the app can record audio and transcribe it through Gemini.
- Spoken tutor responses use Gnani.ai text-to-speech.
- Light and dark notebook themes.
- Create, switch between, and delete notebooks. Boards autosave in the current browser.

## Tech stack

- **Framework:** Next.js 16 (App Router)
- **UI:** React 19 with TypeScript
- **Styling:** Tailwind CSS 4
- **Icons:** Lucide React
- **Whiteboard and graphs:** HTML Canvas 2D
- **Local notebook storage:** IndexedDB
- **Microphone input:** Browser Speech Recognition where available, with `MediaRecorder` fallback
- **AI tutor and fallback transcription:** Google Gemini API
- **Spoken responses:** Gnani.ai text-to-speech API

## Requirements

- Node.js and npm.
- A Gemini API key for tutor analysis and microphone transcription.
- A Gnani.ai API key for spoken tutor responses.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env.local` file in the project root and add your server-side API keys:

   ```dotenv
   GEMINI_API_KEY=your_gemini_api_key
   GNANI_API_KEY=your_gnani_api_key
   # Optional; defaults to the Vachana/Gnani TTS endpoint used by this project.
   GNANI_TTS_URL=https://api.vachana.ai/api/v1/tts/inference
   ```

   Keep these values private. `.env.local` is ignored by Git; do not add secrets to client-side variables such as `NEXT_PUBLIC_*`.

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

Microphone access must be allowed in the browser. Browsers generally require a secure context for microphone use; `localhost` and HTTPS are supported.

## Using the whiteboard

1. Write a problem or paste/upload a worksheet.
2. Choose an action:
   - **Check** checks the work currently visible and does not write an answer on the board.
   - **Guide** gives one hint to help you decide what to do next.
   - **Next Step** asks the tutor to write one next step.
   - **Ask** lets you type a question.
3. Use **Undo** if you want to remove a written or AI-generated step.
4. Open the notebook selector to create a new notebook, return to a saved one, or delete one.

When the mic switches to fallback recording, speak your question and tap the mic again to send it for transcription.

## Saving and privacy

Notebook boards and worksheet images are stored in IndexedDB in the browser where you use Σcribe. They are not synced to an account or another device. Clearing that browser's site data can remove saved notebooks.

AI requests are sent from the app's server routes to Gemini. Speech output is sent to the configured Gnani.ai TTS endpoint. API keys stay on the server and are read from `.env.local`.

## Project layout

```text
src/app/
  page.tsx                 Whiteboard, notebook storage, and tutor UI
  globals.css              Global and canvas styles
  api/tutor/route.ts       Image-based tutor analysis
  api/transcribe/route.ts  Microphone audio transcription
  api/tts/route.ts         Gnani.ai speech generation
```

## Available commands

```bash
npm run dev     # Start the development server
npm run build   # Create a production build
npm run start   # Serve the production build
npm run lint    # Run ESLint
```

To run the production server, build first with `npm run build`, then run `npm run start`.
