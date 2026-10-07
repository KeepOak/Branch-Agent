// From google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad:packages/core/src/core/agentChatHistory.ts (atlas AGENT-LOOP-0096). Structural history-turn type for the native hardener.
import type { Content } from "@google/genai";
export interface HistoryTurn {
  id: string;
  content: Content;
}
