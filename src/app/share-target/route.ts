import { NextResponse } from "next/server";

// Se il service worker non è ancora attivo, la condivisione arriva qui: rimanda alla cattura.
export async function POST(req: Request) {
  return NextResponse.redirect(new URL("/capture", req.url), 303);
}
