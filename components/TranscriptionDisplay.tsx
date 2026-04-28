"use client";

import React, { useState } from "react";
import { TranscriptionSegment } from "@/lib/types";
import { TranscriptionLine } from "@/components/TranscriptionLine";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

interface TranscriptionDisplayProps {
  segments: TranscriptionSegment[];
  className?: string;
}

export function TranscriptionDisplay({
  segments,
  className,
}: TranscriptionDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (segments.length === 0) {
    return null;
  }

  const displaySegments = isExpanded ? segments : segments.slice(-3);
  const hasMore = segments.length > 3;

  return (
    <div className={cn("w-full space-y-2 flex flex-col pb-2", className)}>
      <div className="space-y-2">
        {displaySegments.map((segment) => (
          <TranscriptionLine
            key={segment.id}
            segment={segment}
            isFinal={segment.isFinal}
          />
        ))}
      </div>
      
      {hasMore && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-center gap-1.5 self-center mt-3 px-3 py-1.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] rounded-full transition-all"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Show Full Transcript ({segments.length - 3} more)
            </>
          )}
        </button>
      )}
    </div>
  );
}
