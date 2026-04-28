"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Identify user in PostHog when session is available (app load or login)
    // We'll just hardcode a generic user here since auth is disabled
    posthog.identify("local-user@example.com", {
      email: "local-user@example.com",
      name: "Local User",
    });
  }, []);

  return <>{children}</>;
}

