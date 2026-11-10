"use client";
/** Messaggio breve a comparsa (mostrato da <Toaster/> nel layout). */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("app-toast", { detail: message }));
}
