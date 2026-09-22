#!/usr/bin/env python3
from pathlib import Path
p = Path("src/components/owner-desk.tsx")
t = p.read_text()
old = '''    if (result.plan.type === "linkedin_agent_order") {
      const plan = result.plan;
      if (plan.confirmRequired) {
        pendingLinkedInOrderRef.current = { kind: plan.kind, payload: plan.payload || {} };
        const spoken = "Outreach is HIGH risk. Say Confirm LinkedIn order to queue draft connects under soft caps. Nothing was sent.";
        setVoiceReply(spoken);
        utter(spoken, "CONFIRM");
        return;
      }
      void (async () => {
        try {
          const created = await createLinkedInAgentOrderFn({
            data: { kind: plan.kind, payload: plan.payload || {} },
          });
          const spoken = created.ok
            ? (String(result.output?.spoken || `Queued LinkedIn agent order: ${plan.kind}.`))
            : (created.reason || "Could not queue LinkedIn order.");
          setVoiceReply(spoken);
          utter(spoken, "LINKEDIN_ORDER");
        } catch {
          const spoken = "Could not queue LinkedIn agent order.";
          setVoiceReply(spoken);
          utter(spoken, "LINKEDIN_ORDER");
        }
      })();
      return;
    }'''
new = '''    if (result.plan.type === "linkedin_agent_order") {
      const plan = result.plan;
      const payload = (plan.payload || {}) as Record<string, string | number | boolean | null | string[]>;
      if (plan.confirmRequired) {
        pendingLinkedInOrderRef.current = { kind: plan.kind, payload };
        const spoken = "Outreach is HIGH risk. Say Confirm LinkedIn order to queue draft connects under soft caps. Nothing was sent.";
        setVoiceReply(spoken);
        utter(spoken, "CONFIRM");
        return { ...result.output, ok: true, spoken, staysOnScreen: true, changed: false };
      }
      void (async () => {
        try {
          const created = await createLinkedInAgentOrderFn({
            data: { kind: plan.kind, payload },
          });
          const spoken = created.ok
            ? (String(result.output?.spoken || `Queued LinkedIn agent order: ${plan.kind}.`))
            : (created.reason || "Could not queue LinkedIn order.");
          setVoiceReply(spoken);
          utter(spoken, "LINKEDIN_ORDER");
        } catch {
          const spoken = "Could not queue LinkedIn agent order.";
          setVoiceReply(spoken);
          utter(spoken, "LINKEDIN_ORDER");
        }
      })();
      return { ...result.output, ok: true, staysOnScreen: true, changed: false };
    }'''
if old not in t:
    old2 = old.replace("payload: plan.payload || {}", "payload: plan.payload")
    if old2 in t:
        old = old2
    else:
        raise SystemExit("linkedin_agent_order block not found")
t = t.replace(old, new, 1)
ref_old = 'const pendingLinkedInOrderRef = useRef<{ kind: string; payload: Record<string, unknown> } | null>(null);'
ref_new = 'const pendingLinkedInOrderRef = useRef<{ kind: string; payload: Record<string, string | number | boolean | null | string[]> } | null>(null);'
if ref_old in t:
    t = t.replace(ref_old, ref_new, 1)
p.write_text(t)
print("patched owner-desk", p.stat().st_size)
