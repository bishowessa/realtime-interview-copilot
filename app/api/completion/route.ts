import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as { prompt: string; bg?: string; flag?: string };
    const prompt = payload.prompt;
    const bg = payload.bg || "";
    
    let finalPrompt = prompt;
    
    if (payload.flag === "copilot") {
      const systemInstruction = `You are an expert senior software engineer and interview copilot. You possess vast general knowledge about programming, system design, and computer science. Answer the interviewer's questions flawlessly using your full capabilities. Additionally, you will be provided with the candidate's personal background context. Whenever relevant, naturally weave this context into your technical answers to personalize them, but never restrict your knowledge only to the context. If a question is general, answer it fully.

While you are primarily an expert software engineering copilot, you must act as an omniscient general AI if the topic changes. If the interviewer asks a question that is completely unrelated to software engineering or the user's background (for example: medical questions, general science, riddles, or history), you must INSTANTLY drop the software engineering persona. Answer the non-technical question factually, accurately, and perfectly as a general AI. Do not try to force a coding context onto a medical or general question. Never hallucinate.

CRITICAL INSTRUCTIONS FOR LIVE TRANSCRIPTIONS:
1. Focus on the Latest Unanswered Questions: You will be provided with a running transcript of an interview. You must ONLY answer the newly asked questions at the very end of the transcript. If the interviewer asked multiple new questions in their most recent turn, answer all of them. Do not re-answer older questions from earlier in the conversation.
2. Context Retention: Use the earlier parts of the transcript strictly as conversational context. The interviewer may ask follow-up questions based on previous answers, so you must understand the flow of the conversation, but only output the response for the newest prompt.
3. Format & Verbosity: Keep your answers highly concise and short so they can be read quickly on a screen, but ensure they are technically sufficient and do not miss critical details. Use short bullet points or quick sentences. Eliminate fluff.`;
      
      finalPrompt = bg 
        ? `${systemInstruction}\n\nCandidate's Background Context:\n${bg}\n\nRunning Interview Transcript:\n${prompt}`
        : `${systemInstruction}\n\nRunning Interview Transcript:\n${prompt}`;
    } else if (payload.flag === "summarizer") {
      finalPrompt = `Summarize the following:\n${prompt}`;
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      console.error("[API ERROR] Missing GOOGLE_GENERATIVE_AI_API_KEY");
      return NextResponse.json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY" }, { status: 500 });
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    console.log(`[API REQUEST] Firing request to Gemini using model: ${modelName}`);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }]
      }),
    });

    // Handle Google's 429 or other errors directly
    if (!response.ok) {
      const text = await response.text();
      console.error(`[GEMINI REJECTED] Status: ${response.status} - Details: ${text}`);
      return NextResponse.json({ error: `Gemini API error: ${text}` }, { status: response.status });
    }
    
    console.log("[API SUCCESS] Stream opened, parsing SSE data...");
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    
    (async () => {
      try {
        if (!response.body) throw new Error("No body returned from Gemini");
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        const SSERegex = /^data:\s*(.*)(?:\n\n|\r\r|\r\n\r\n)/;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += value;
          let match;
          while ((match = buffer.match(SSERegex)) !== null) {
            const jsonDataString = match[1];
            if (jsonDataString) {
              try {
                const jsonChunk = JSON.parse(jsonDataString);
                const text = jsonChunk.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  const sseData = JSON.stringify({ text });
                  await writer.write(encoder.encode(`data: ${sseData}\n\n`));
                }
              } catch (e) {
                // Ignore parse errors for partial chunks
              }
            }
            buffer = buffer.substring(match[0].length);
          }
        }
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        console.error("[STREAM ERROR]", err);
        const errPayload = { error: String(err) };
        try { await writer.write(encoder.encode(`data: ${JSON.stringify(errPayload)}\n\n`)); } catch {}
      } finally {
        writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('[CRITICAL COMPLETION ERROR]:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}