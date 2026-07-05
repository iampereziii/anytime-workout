import "server-only";
import OpenAI from "openai";

/** Server-only OpenAI client — the key never reaches the client (spec Conventions #6). */
let _client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}
