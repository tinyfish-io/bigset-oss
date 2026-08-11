"use client";

import Link from "next/link";

export default function ShareError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <p className="text-sm text-muted">Dataset not found.</p>
        <p className="mt-1 text-xs text-muted/70">
          It may have been deleted or made private.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-medium text-foreground hover:underline"
        >
          Go to BigSet
        </Link>
      </div>
    </div>
  );
}
