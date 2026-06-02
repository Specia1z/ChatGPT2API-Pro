"use client";

import { Turnstile, type TurnstileProps } from "@marsidev/react-turnstile";

interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string) => void;
}

export function TurnstileWidget({ siteKey, onToken }: TurnstileWidgetProps) {
  if (!siteKey) return null;
  return (
    <div className="flex justify-center my-4">
      <Turnstile
        siteKey={siteKey}
        onSuccess={onToken}
        options={{ theme: "auto" }}
      />
    </div>
  );
}
