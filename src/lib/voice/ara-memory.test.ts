import assert from "node:assert/strict";
import test from "node:test";
import { appendAraTurn, emptyAraLog } from "./ara-history.ts";
import {
  answerMemory,
  classifyMemoryAsk,
  conversationContext,
  foldFinalUserTurn,
  historyInstruction,
  memoryAskClearsPending,
  preferServerLog,
  sanitizeAraLog,
  scopedConversationUser,
  shouldPersistTranscript,
} from "./ara-memory.ts";

function spoken(text: string) {
  return appendAraTurn(emptyAraLog(), "ara", text, 1_000);
}

test("what did you just say uses the saved Ara message, not the page", () => {
  let log = spoken("The latest deployment is healthy.");
  log = appendAraTurn(log, "you", "What did you just say?", 2_000);
  const ask = classifyMemoryAsk("What did you just say?");
  assert.equal(ask?.kind, "last_ara");
  const found = answerMemory(log, ask!, "What did you just say?");
  assert.equal(found.text, "The latest deployment is healthy.");
  assert.equal(classifyMemoryAsk("What am I looking at?"), null);
  assert.equal(classifyMemoryAsk("What did you just add?"), null);
  const page = "You’re looking at outreach for Davis Roofing Solutions";
  assert.equal(found.text.includes("Davis"), false);
  assert.equal(page.includes("Davis"), true);
});

test("Ara, what's the last thing you said to me uses an older thread too", () => {
  let older = appendAraTurn(emptyAraLog(), "ara", "The latest deployment is healthy.", 1_000);
  older = { ...older, activeId: "new", threads: [...older.threads, { id: "new", title: "Ara", updatedAt: 5_000, turns: [] }] };
  older = appendAraTurn(older, "you", "Ara, what's the last thing you said to me?", 5_100);
  const ask = classifyMemoryAsk("Ara, what's the last thing you said to me?");
  assert.equal(ask?.kind, "last_ara");
  assert.equal(answerMemory(older, ask!, "Ara, what's the last thing you said to me?").text, "The latest deployment is healthy.");
});

test("what did I just say and the message before that come from the thread", () => {
  let log = appendAraTurn(emptyAraLog(), "you", "Find me five roofers in Fort Worth.", 1_000);
  log = appendAraTurn(log, "ara", "I found five.", 1_100);
  log = appendAraTurn(log, "ara", "Sentinel is yellow because Ara Voice is stale.", 1_200);
  log = appendAraTurn(log, "you", "What did I just ask you?", 1_300);
  assert.match(answerMemory(log, { kind: "last_user" }, "What did I just ask you?").text, /five roofers in Fort Worth/);
  assert.equal(answerMemory(log, { kind: "ara_before" }, "What did you say before that?").text, "I found five.");
  assert.match(answerMemory(log, { kind: "recent_ara", n: 2 }, "").text, /I found five/);
});

test("reload and a new voice session still have the saved thread", () => {
  const log = spoken("Sentinel is yellow because Ara Voice is stale.");
  const reloaded = sanitizeAraLog(JSON.parse(JSON.stringify(log)));
  assert.equal(answerMemory(reloaded, { kind: "last_ara" }).text, "Sentinel is yellow because Ara Voice is stale.");
  const instructions = historyInstruction(reloaded);
  assert.match(instructions, /Sentinel is yellow/);
  assert.match(instructions, /cannot see the Conversations box/);
  assert.doesNotMatch(instructions, /I can read the full screen/);
});

test("interim transcripts are not stored and a replayed final runs once", () => {
  assert.equal(shouldPersistTranscript(false), false);
  assert.equal(shouldPersistTranscript(true), true);
  const first = foldFinalUserTurn(emptyAraLog(), "You do have a record. It's in conversations on the", "utt-1", 5_000, null);
  assert.equal(first.action, "new");
  const grown = foldFinalUserTurn(first.log, "You do have a record. It's in conversations on the app.", "utt-1", 5_400, first.state);
  assert.equal(grown.action, "replace");
  assert.equal(grown.log.threads[0].turns.length, 1);
  assert.match(grown.log.threads[0].turns[0].text, /on the app/);
  const replay = foldFinalUserTurn(grown.log, grown.state!.text, "utt-1", 5_800, grown.state);
  assert.equal(replay.action, "replay");
  assert.equal(replay.log.threads[0].turns.length, 1);
});

test("missing history is truthful and another owner is blocked", () => {
  const missing = answerMemory(emptyAraLog(), { kind: "last_ara" });
  assert.equal(missing.ok, false);
  assert.match(missing.text, /couldn’t retrieve/i);
  assert.equal(scopedConversationUser("dylan", "someone-else"), null);
  assert.equal(scopedConversationUser("dylan", "dylan"), "dylan");
  assert.equal(memoryAskClearsPending({ kind: "last_ara" }), false);
  assert.equal(classifyMemoryAsk("Can you hear me?"), null);
});

test("server history wins after reload and local history is kept if the server is empty", () => {
  const local = spoken("local only");
  const server = spoken("server copy");
  assert.equal(preferServerLog(server, local).threads[0].turns[0].text, "server copy");
  assert.equal(preferServerLog(emptyAraLog(), local).threads[0].turns[0].text, "local only");
  const ctx = conversationContext(server);
  assert.match(ctx.recent, /ARA: server copy/);
});
