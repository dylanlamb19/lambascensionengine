import { classifyReply } from "../outreach/reply.ts";
import { emailCannotBecomeCommand, looksLikeInjection } from "./untrusted.ts";
import { stopSequence } from "./sequence.ts";
import type { FollowupRecord, SequenceRecord } from "./types.ts";
import type { ReplyClass } from "../outreach/types.ts";

export type InboundMail = {
  id: string;
  from: string;
  body: string;
};

export function ingestReply(opts: {
  inbound: InboundMail;
  sequence: SequenceRecord;
  followups: FollowupRecord[];
  alreadySeen: Set<string>;
}): {
  classification: ReplyClass;
  sequence: SequenceRecord;
  followups: FollowupRecord[];
  unsubscribed: boolean;
  treatedAsCommand: boolean;
  duplicate: boolean;
} {
  if (opts.alreadySeen.has(opts.inbound.id)) {
    return {
      classification: "OTHER" as ReplyClass,
      sequence: opts.sequence,
      followups: opts.followups,
      unsubscribed: false,
      treatedAsCommand: false,
      duplicate: true,
    };
  }
  opts.alreadySeen.add(opts.inbound.id);
  const treatedAsCommand = false;
  emailCannotBecomeCommand(opts.inbound.body);
  void looksLikeInjection(opts.inbound.body);
  const classification = classifyReply(opts.inbound.body) as ReplyClass;
  const unsubscribed = classification === "UNSUBSCRIBE";
  const stopped = stopSequence(opts.followups, opts.sequence, unsubscribed ? "unsubscribe" : "reply");
  return {
    classification,
    sequence: stopped.sequence,
    followups: stopped.followups,
    unsubscribed,
    treatedAsCommand,
    duplicate: false,
  };
}
