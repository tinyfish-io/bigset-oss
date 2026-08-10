/// <reference types="svelte" />
/// <reference types="vite/client" />

// Google Apps Script runtime — available in the sidebar iframe
type GasRunner = {
  withFailureHandler(cb: (err: Error | string) => void): GasRunner;
  [key: string]: (...args: unknown[]) => unknown;
};

declare const google: {
  script: {
    run: {
      withSuccessHandler<T>(cb: (value: T) => void): GasRunner;
      [key: string]: (...args: unknown[]) => unknown;
    };
  };
} | undefined;
