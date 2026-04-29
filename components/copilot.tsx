"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { FLAGS, HistoryData, TranscriptionSegment } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { TranscriptionDisplay } from "@/components/TranscriptionDisplay";
import { useClientReady } from "@/hooks/useClientReady";
import { BACKEND_API_URL } from "@/lib/constant";
import { authClient } from "@/lib/auth-client";
import { sendGTMEvent } from "@next/third-parties/google";
import posthog from "posthog-js";
import SafeMarkdown from "@/components/SafeMarkdown";
import { BookmarkPlus, Sparkles, Zap, Upload, Loader2 } from "lucide-react";

const RecorderTranscriber = dynamic(() => import("@/components/recorder"), {
  ssr: false,
  loading: () => <RecorderFallback />,
});

interface CopilotProps {
  addInSavedData: (data: HistoryData) => void;
  isActive?: boolean;
  presetContext?: string;
}

export function Copilot({
  addInSavedData,
  isActive = false,
  presetContext = "",
}: CopilotProps) {
  const isClientReady = useClientReady();
  const { data: session } = authClient.useSession();
  const [transcribedText, setTranscribedText] = useState<string>("");
  const [transcriptionSegments, setTranscriptionSegments] = useState<
    TranscriptionSegment[]
  >([]);
  const [flag, setFlag] = useState<FLAGS>(FLAGS.COPILOT);
  const [bg, setBg] = useState<string>("");
  const [completion, setCompletion] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const transcriptionBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptionBoxRef.current) {
      transcriptionBoxRef.current.scrollTop =
        transcriptionBoxRef.current.scrollHeight;
    }
  }, [transcriptionSegments]);

  // Preset context (from the active preset) always wins over the cached
  // value. Hydration below only runs once on mount, so we flip this flag to
  // skip the storage read whenever the preset already provided context.
  const bgHydratedRef = useRef(false);
  useEffect(() => {
    if (presetContext) {
      setBg(presetContext);
      bgHydratedRef.current = true;
    }
  }, [presetContext]);

  const handleFlag = useCallback((checked: boolean) => {
    if (!checked) {
      setFlag(FLAGS.SUMMARIZER);
      sendGTMEvent({ event: "switch_mode", mode: "summarizer" });
      posthog.capture("mode_switched", {
        mode: "summarizer",
        previous_mode: "copilot",
      });
    } else {
      setFlag(FLAGS.COPILOT);
      sendGTMEvent({ event: "switch_mode", mode: "copilot" });
      posthog.capture("mode_switched", {
        mode: "copilot",
        previous_mode: "summarizer",
      });
    }
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const controller = useRef<AbortController | null>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    const isTypingInInput =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    switch (event.key.toLowerCase()) {
      case "s":
        if (!isTypingInInput) {
          event.preventDefault();
          setFlag(FLAGS.SUMMARIZER);
        }
        break;
      case "c":
        if (!isTypingInInput) {
          event.preventDefault();
          setFlag(FLAGS.COPILOT);
        }
        break;
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown, isActive]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    try {
      if (file.type === "text/plain" || file.name.endsWith(".txt")) {
        const text = await file.text();
        setBg(text);
      } else if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        const script = document.createElement("script");
        script.src = "/pdf.min.js";
        document.body.appendChild(script);
        
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
        });

        const pdfjsLib = (window as any).pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.js`;
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(" ");
          fullText += pageText + "\n";
        }
        setBg(fullText);
      } else {
        alert("Unsupported file type. Please upload a .txt or .pdf file.");
      }
    } catch (err) {
      console.error("Error extracting file:", err);
      alert("Failed to extract text from file.");
    } finally {
      setIsExtracting(false);
      event.target.value = "";
    }
  };

  const addTextinTranscription = (text: string) => {
    setTranscribedText((prev) => prev + " " + text);
  };

  const addTranscriptionSegment = (segment: TranscriptionSegment) => {
    setTranscriptionSegments((prev) => {
      const existingIndex = prev.findIndex((s) => s.id === segment.id);
      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = segment;
        return updated;
      }
      return [...prev, segment];
    });
  };

  const clearTranscriptionChange = () => {
    setTranscribedText("");
    setTranscriptionSegments([]);
  };

  const stop = (e?: React.MouseEvent<HTMLButtonElement>) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur();
    }
    if (controller.current) {
      controller.current.abort();
      controller.current = null;
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isGenerating) return;
    if (controller.current) return;

    setError(null);
    setCompletion("");
    setIsGenerating(true);

    controller.current = new AbortController();

    sendGTMEvent({ event: "generate_completion", flag: flag });
    posthog.capture("completion_generated", {
      mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
      has_context: bg.length > 0,
      transcription_length: transcribedText.length,
    });

    let latestQuestion = "";
    let transcriptHistory = "";
    if (transcriptionSegments.length > 0) {
      const lastSegment = transcriptionSegments[transcriptionSegments.length - 1];
      latestQuestion = lastSegment.text;
      transcriptHistory = transcriptionSegments.slice(0, -1).map((s) => s.text).join(" ");
    } else {
      latestQuestion = transcribedText;
    }

    try {
      const response = await fetch(`${BACKEND_API_URL}/api/completion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bg,
          flag,
          prompt: transcribedText,
          latestQuestion,
          transcriptHistory,
        }),
        signal: controller.current.signal,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is null");
      }

      const decoder = new TextDecoder();
      // SSE events are delimited by a blank line. We buffer across reads so a
      // chunk that splits in the middle of `data: {...}` is parsed correctly,
      // and we cap the buffer so a broken upstream can't balloon memory.
      let buffer = "";
      const SSE_CLIENT_BUFFER_MAX = 1_000_000;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > SSE_CLIENT_BUFFER_MAX) {
          throw new Error("SSE buffer overflow");
        }

        let sepIdx: number;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const eventString = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          if (!eventString.trim()) continue;

          const dataMatch = eventString.match(/data: (.*)/);
          if (!dataMatch) continue;

          const data = dataMatch[1];
          if (data === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.text) {
              setCompletion((text) => text + parsed.text);
            }
          } catch (err) {
            console.error("Error parsing SSE data:", err);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Stream error:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        posthog.captureException(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } finally {
      setIsGenerating(false);
      controller.current = null;
    }
  };

  // Background context can include resume / JD / PII. Keep it in
  // sessionStorage so it's cleared when the tab closes rather than surviving
  // indefinitely in localStorage. Also skip hydration if the preset already
  // populated the field.
  useEffect(() => {
    if (bgHydratedRef.current) return;
    try {
      const savedBg = sessionStorage.getItem("bg");
      if (savedBg) setBg(savedBg);
    } catch {
      // sessionStorage unavailable (e.g. disabled storage)
    }
    bgHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!bg) return;
    try {
      sessionStorage.setItem("bg", bg);
    } catch {
      // Quota or unavailable — non-fatal.
    }
  }, [bg]);

  const handleSave = () => {
    addInSavedData({
      createdAt: new Date().toISOString(),
      data: completion,
      tag: flag === FLAGS.COPILOT ? "Copilot" : "Summarizer",
    });
    sendGTMEvent({
      event: "save_completion",
      tag: flag === FLAGS.COPILOT ? "Copilot" : "Summarizer",
    });
    posthog.capture("completion_saved", {
      mode: flag === FLAGS.COPILOT ? "copilot" : "summarizer",
      completion_length: completion.length,
    });
  };

  useEffect(() => {
    if (!isActive) return;
    if (typeof window !== "undefined" && window.electronAPI && session) {
      window.electronAPI.windowSetSize(1180, 640);
    }
  }, [session, isActive]);

  if (!isClientReady) {
    return <CopilotSkeleton />;
  }

  return (
    <div className="flex flex-col md:grid md:grid-cols-2 md:grid-rows-[minmax(0,280px)_auto_minmax(0,1fr)] h-full min-h-0 gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 overflow-y-auto md:overflow-hidden">
      {error && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 px-4 py-2 text-center text-xs bg-red-500/90 backdrop-blur-xl text-white z-[60] animate-fade-in-scale rounded-xl border border-red-400/20 shadow-xl max-w-md">
          {error.message}
        </div>
      )}

      {/* Context Card (Mobile: 1st, Desktop: Top Left) */}
      <div className="glass-card p-5 flex flex-col gap-3 min-h-[220px] md:h-full md:min-h-0 overflow-hidden md:col-start-1 md:row-start-1 order-1 shrink-0">
        <div className="flex items-center justify-between shrink-0">
          <Label
            htmlFor="system_prompt"
            className="text-zinc-500 font-semibold tracking-wider text-[10px] uppercase flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3 text-emerald-500/50" />
            Interview Context
          </Label>
          <div className="flex items-center gap-2">
            {presetContext && (
              <span className="text-[9px] text-emerald-500/60 bg-emerald-500/[0.06] px-2 py-0.5 rounded-full border border-emerald-500/10">
                Preset loaded
              </span>
            )}
            <div className="relative">
              <input
                type="file"
                id="cv-upload"
                accept=".txt,.pdf"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isExtracting}
              />
              <label
                htmlFor="cv-upload"
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer border ${
                  isExtracting
                    ? "text-zinc-500 border-zinc-800 bg-zinc-900 cursor-not-allowed"
                    : "text-zinc-400 border-white/[0.08] hover:text-zinc-200 hover:bg-white/[0.04]"
                }`}
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Extracting CV...
                  </>
                ) : (
                  <>
                    <Upload className="w-3 h-3" />
                    Upload CV
                  </>
                )}
              </label>
            </div>
          </div>
        </div>

        <Textarea
          id="system_prompt"
          placeholder="Paste job description, resume, or interview topic here..."
          className="flex-1 min-h-0 resize-none bg-transparent border-0 focus-visible:ring-0 p-0 text-zinc-200 placeholder:text-zinc-700 text-xs leading-relaxed overflow-y-auto"
          value={bg}
          onChange={(e) => setBg(e.target.value)}
        />

        <div className="pt-3 border-t border-white/[0.04] space-y-3 shrink-0">
          <RecorderTranscriber
            addTextinTranscription={addTextinTranscription}
            addTranscriptionSegment={addTranscriptionSegment}
          />
        </div>
      </div>

      {/* Action Bar (Mobile: 2nd, Desktop: Middle Row) */}
      <div
        ref={formRef as any}
        className="w-full flex items-center justify-between gap-3 shrink-0 md:col-span-2 md:row-start-2 order-2"
      >
        <div className="flex items-center gap-2 glass-panel px-3 py-1.5 rounded-xl">
          <span
            className={`text-[10px] font-medium transition-colors ${flag === FLAGS.SUMMARIZER ? "text-blue-400" : "text-zinc-600"}`}
          >
            Summarizer
          </span>
          <Switch
            className="scale-75 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-700"
            onCheckedChange={handleFlag}
            checked={flag === FLAGS.COPILOT}
          />
          <span
            className={`text-[10px] font-medium transition-colors ${flag === FLAGS.COPILOT ? "text-emerald-400" : "text-zinc-600"}`}
          >
            Copilot
          </span>
        </div>

        <Button
          className="h-9 px-6 accent-gradient text-white font-medium shadow-lg hover:shadow-emerald-500/20 transition-all active:scale-[0.97] text-xs tracking-wide rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          disabled={isGenerating}
          onClick={(e) => handleSubmit(e)}
        >
          {isGenerating ? (
            <div className="flex items-center gap-1">
              <span
                className="w-1 h-1 bg-white rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1 h-1 bg-white rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1 h-1 bg-white rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          ) : (
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Generate
            </span>
          )}
        </Button>
      </div>

      {/* AI Output Section (Mobile: 3rd, Desktop: Bottom Row) */}
      <div className="flex-1 min-h-[300px] md:min-h-0 flex flex-col glass-card overflow-hidden rounded-2xl border border-white/[0.06] shrink-0 md:shrink md:col-span-2 md:row-start-3 order-3">
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-white/[0.06] bg-zinc-900/30">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 truncate min-w-0 pr-2">
            Output
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!completion.trim()}
            className="h-8 min-w-[7.25rem] max-w-[7.25rem] shrink-0 gap-1.5 px-2 text-[11px] font-medium rounded-lg border border-emerald-500/20 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 disabled:opacity-40 disabled:hover:bg-emerald-500/15 disabled:hover:text-emerald-300 disabled:cursor-not-allowed"
            onClick={handleSave}
          >
            <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
            Save note
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-4 sm:px-5 sm:py-5">
          {!completion ? (
            <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-zinc-700 space-y-3 px-2">
              <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center border border-white/[0.04]">
                <Sparkles className="w-6 h-6 text-zinc-600" />
              </div>
              <div className="text-center max-w-sm">
                <p className="text-sm font-medium text-zinc-500">
                  Ready to assist
                </p>
                <p className="text-xs text-zinc-600 mt-1">
                  Start recording or press{" "}
                  <kbd className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-zinc-500 font-mono text-[9px]">
                    Enter
                  </kbd>{" "}
                  to generate
                </p>
              </div>
            </div>
          ) : (
            <div className="prose prose-invert prose-xs max-w-none text-zinc-300 text-2xl md:text-base leading-relaxed pl-0.5 pr-1">
              <SafeMarkdown>{completion}</SafeMarkdown>
            </div>
          )}
        </div>
      </div>

      {/* Transcription Card (Mobile: Hidden initially, 4th when visible, Desktop: Top Right) */}
      <div className={`glass-card p-5 min-h-[220px] md:h-full md:min-h-0 overflow-hidden md:col-start-2 md:row-start-1 order-4 shrink-0 flex-col ${completion ? 'flex' : 'hidden md:flex'}`}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <Label
            htmlFor="transcription"
            className="text-zinc-500 font-semibold tracking-wider text-[10px] uppercase flex items-center gap-1.5"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            Live Transcription
          </Label>
          <button
            type="button"
            className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors font-medium tracking-wide px-2 py-1 rounded-lg hover:bg-red-500/[0.06]"
            onClick={clearTranscriptionChange}
          >
            Clear
          </button>
        </div>
        <div
          ref={transcriptionBoxRef}
          className="flex-1 min-h-0 overflow-y-auto rounded-xl custom-scrollbar -mr-2 pr-2"
        >
          <TranscriptionDisplay segments={transcriptionSegments} />
        </div>
      </div>
    </div>
  );
}

function CopilotSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="glass-card p-5 space-y-3">
          <div className="h-3 w-28 bg-white/[0.04] rounded-md" />
          <div className="h-[120px] bg-white/[0.03] rounded-xl" />
          <div className="h-9 bg-white/[0.03] rounded-xl" />
        </div>
        <div className="glass-card p-5 space-y-3">
          <div className="h-3 w-32 bg-white/[0.04] rounded-md" />
          <div className="h-[160px] bg-white/[0.03] rounded-xl" />
        </div>
      </div>
      <div className="glass-card p-6 h-40">
        <div className="h-3 w-48 bg-white/[0.04] rounded-md mx-auto" />
      </div>
    </div>
  );
}

function RecorderFallback() {
  return (
    <div className="flex h-9 items-center justify-center rounded-xl bg-white/[0.02] border border-white/[0.04] text-xs text-zinc-600">
      Initializing recorder...
    </div>
  );
}
