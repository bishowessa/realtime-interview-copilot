import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as { prompt: string; bg?: string; flag?: string; latestQuestion?: string; transcriptHistory?: string };
    const prompt = payload.prompt;
    const bg = payload.bg || "";
    const latestQuestion = payload.latestQuestion || prompt;
    const transcriptHistory = payload.transcriptHistory || "";
    
    let finalPrompt = prompt;
    
    if (payload.flag === "copilot") {
      const systemInstruction = `You are an expert software engineer taking a live technical interview. You must answer the interviewer's latest question flawlessly, but you MUST sound like a real human being speaking naturally.

CRITICAL TONE INSTRUCTIONS:

Write in the first-person perspective ('I usually...', 'In my experience...', 'What I like to do is...').

NEVER use bullet points, numbered lists, or markdown formatting like bold text.

Write in short, conversational, easy-to-read paragraphs. The text should flow exactly like a spoken script that the candidate can read aloud seamlessly.

Sound confident but natural. If discussing a technical choice, frame it as a professional preference based on experience.

Keep the response highly concise (2 to 3 short sentences maximum). The candidate needs to read this quickly on a screen, so get straight to the exact terminology or solution, but wrap it in natural conversational phrasing.`;
      
      finalPrompt = `${systemInstruction}\n\nCandidate Background: ${bg}\n\nPrevious Conversation History (FOR CONTEXT ONLY, DO NOT ANSWER THESE):\n${transcriptHistory}\n\n=====================================\nLATEST QUESTION (YOU MUST ONLY ANSWER THIS):\n${latestQuestion}\n=====================================`;
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