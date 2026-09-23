import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendAraTurn, deleteAraThread, deleteAraTurn, emptyAraLog, searchAraLog, startAraThread } from "./ara-history.ts";

describe("Ara conversation log", () => {
  it("keeps a conversation and titles it from what you said", () => {
    let log = emptyAraLog();
    log = appendAraTurn(log, "you", "Book AWO Lending Thursday at 11", 1_000);
    log = appendAraTurn(log, "ara", "Done — I scheduled AWO Lending for Thursday at 11:00 AM.", 2_000);
    assert.equal(log.threads.length, 1);
    assert.match(log.threads[0].title, /AWO Lending/);
    assert.equal(log.threads[0].turns.length, 2);
  });

  it("does not save the same line twice in a row", () => {
    let log = appendAraTurn(emptyAraLog(), "ara", "Done — booked.", 1_000);
    log = appendAraTurn(log, "ara", "Done — booked.", 2_000);
    assert.equal(log.threads[0].turns.length, 1);
  });

  it("starts a new conversation after a long gap", () => {
    let log = appendAraTurn(emptyAraLog(), "you", "First thing", 1_000);
    log = appendAraTurn(log, "you", "Much later", 1_000 + 46 * 60 * 1000);
    assert.equal(log.threads.length, 2);
    assert.equal(log.threads[0].title, "Much later");
  });

  it("search finds a message inside a conversation", () => {
    let log = appendAraTurn(emptyAraLog(), "you", "What is on Thursday", 1_000);
    log = appendAraTurn(log, "ara", "AWO Lending at 11.", 2_000);
    const hits = searchAraLog(log, "awo");
    assert.equal(hits.length >= 1, true);
    assert.match(hits[0].snippet, /AWO/i);
  });

  it("deletes one saved message and drops an empty conversation", () => {
    let log = appendAraTurn(emptyAraLog(), "you", "Keep this", 1_000);
    log = appendAraTurn(log, "ara", "Throw this away", 2_000);
    const araId = log.threads[0].turns[1].id;
    log = deleteAraTurn(log, log.threads[0].id, araId);
    assert.equal(log.threads[0].turns.length, 1);
    assert.equal(log.threads[0].turns[0].text, "Keep this");
    const onlyId = log.threads[0].turns[0].id;
    log = deleteAraTurn(log, log.threads[0].id, onlyId);
    assert.equal(log.threads.length, 0);
    assert.equal(log.activeId, null);
  });

  it("deletes a whole saved conversation", () => {
    let log = appendAraTurn(emptyAraLog(), "you", "First", 1_000);
    log = appendAraTurn(log, "you", "Second", 1_000 + 46 * 60 * 1000);
    const drop = log.threads[1].id;
    log = deleteAraThread(log, drop);
    assert.equal(log.threads.length, 1);
    assert.equal(log.threads[0].title, "Second");
  });

  it("new conversation does not duplicate an empty one", () => {
    const started = startAraThread(emptyAraLog(), 5);
    const again = startAraThread(started, 6);
    assert.equal(again.threads.length, 1);
  });
});
