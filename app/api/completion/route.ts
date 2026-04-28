import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as { prompt: string; bg?: string; flag?: string };
    const prompt = payload.prompt;
    const bg = payload.bg || "";
    
    let finalPrompt = prompt;
    if (payload.flag === "copilot" && bg) {
      finalPrompt = `Context:\n${bg}\n\nTask:\n${prompt}`;
    } else if (payload.flag === "summarizer") {
      finalPrompt = `Summarize the following:\n${prompt}`;
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_GENERATIVE_AI_API_KEY" }, { status: 500 });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }]
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `Gemini API error: ${text}` }, { status: response.status });
    }
    
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    
    (async () => {
      try {
        if (!response.body) throw new Error("No body");
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
        console.error("Stream error", err);
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
    console.error('Completion error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
