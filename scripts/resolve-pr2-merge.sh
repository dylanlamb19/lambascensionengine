#!/usr/bin/env bash
set -euo pipefail
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git fetch origin main

rebuild_from_main_plus_patches() {
  set -euo pipefail
  echo "Rebuilding owner-desk.tsx + tools.ts from origin/main + LinkedIn patches"
  git show origin/main:src/components/owner-desk.tsx > src/components/owner-desk.tsx
  git show origin/main:src/lib/voice/tools.ts > src/lib/voice/tools.ts
  git show origin/main:src/components/find-vertical-field.tsx > src/components/find-vertical-field.tsx || true
  if [[ ! -f src/components/find-vertical-field.tsx ]]; then
    git show HEAD:src/components/find-vertical-field.tsx > src/components/find-vertical-field.tsx || true
  fi

  patch -p1 --forward --reject-file=- < build-assets/linkedin-agent/tools-linkedin.patch || echo "tools patch non-clean"
  patch -p1 --forward --reject-file=- < build-assets/linkedin-agent/owner-linkedin.patch || echo "owner-linkedin patch non-clean"
  if [[ -f build-assets/linkedin-agent/owner-ux.patch ]]; then
    patch -p1 --forward --reject-file=- < build-assets/linkedin-agent/owner-ux.patch || echo "owner-ux patch non-clean"
  fi

  python3 scripts/wire-find-vertical.py

  if [[ -f src/lib/prospects/view-filter.ts ]]; then
    sed -i 's/filter\.sort || "score"/filter.sort || "needs_attention"/g' src/lib/prospects/view-filter.ts || true
  fi

  python3 - <<'PY'
from pathlib import Path
od = Path("src/components/owner-desk.tsx").read_bytes()
assert b"LinkedInAgentChat" in od, "missing LinkedInAgentChat"
assert b"NextMoves" in od, "missing NextMoves"
assert b"FindPresets" in od, "missing FindPresets"
assert b"FindVerticalField" in od, "missing FindVerticalField"
assert b"runHighTicketFill" in od or b"fillHighTicketLeadsFn" in od, "missing high-ticket fill"
assert b"repairBookingInvariantFn" in od, "missing booking mismatch repair"
tools = Path("src/lib/voice/tools.ts").read_bytes()
assert len(tools) > 90000 and b"linkedin_agent_order" in tools, "tools.ts missing linkedin_agent_order"
assert Path("src/components/find-vertical-field.tsx").exists()
vf = Path("src/lib/prospects/view-filter.ts").read_text()
assert "needs_attention" in vf
print("integrity ok", len(od), len(tools))
PY
}

set +e
git merge origin/main --no-edit
merge_rc=$?
set -e

if [[ $merge_rc -ne 0 ]]; then
  echo "Conflicts detected — resolving via main+patches rebuild"
  conflicted=$(git diff --name-only --diff-filter=U || true)
  echo "Conflicted: $conflicted"
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
      src/components/owner-desk.tsx|src/lib/voice/tools.ts|src/components/find-vertical-field.tsx|src/lib/prospects/view-filter.ts)
        git checkout --ours -- "$f" 2>/dev/null || true
        ;;
      *)
        if git show :2:"$f" >/dev/null 2>&1; then
          git checkout --ours -- "$f"
        elif git show :3:"$f" >/dev/null 2>&1; then
          git checkout --theirs -- "$f"
        fi
        git add "$f" 2>/dev/null || true
        ;;
    esac
  done <<< "$conflicted"

  rebuild_from_main_plus_patches
  git add src/components/owner-desk.tsx src/lib/voice/tools.ts src/components/find-vertical-field.tsx src/lib/prospects/view-filter.ts
  remaining=$(git diff --name-only --diff-filter=U || true)
  if [[ -n "$remaining" ]]; then
    echo "Still conflicted: $remaining"
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      git checkout --ours -- "$f" 2>/dev/null || git checkout --theirs -- "$f" || true
      git add "$f" 2>/dev/null || true
    done <<< "$remaining"
  fi
  git add -A
  git commit -m "merge: main into linkedin-agent-in-app — keep LinkedIn agent + FindVerticalField + NextMoves"
else
  echo "Clean merge — still enforce required markers"
  if ! grep -q 'LinkedInAgentChat' src/components/owner-desk.tsx || ! grep -q 'FindVerticalField' src/components/owner-desk.tsx || ! grep -q 'NextMoves' src/components/owner-desk.tsx || ! grep -q 'linkedin_agent_order' src/lib/voice/tools.ts; then
    rebuild_from_main_plus_patches
    git add src/components/owner-desk.tsx src/lib/voice/tools.ts src/components/find-vertical-field.tsx src/lib/prospects/view-filter.ts
    git commit -m "fix(pr2): restore LinkedIn + FindVerticalField + NextMoves after merge" || true
  else
    if grep -q 'filter.sort || "score"' src/lib/prospects/view-filter.ts; then
      sed -i 's/filter\.sort || "score"/filter.sort || "needs_attention"/g' src/lib/prospects/view-filter.ts
      git add src/lib/prospects/view-filter.ts
      git commit -m "fix(pr2): keep needs_attention default sort" || true
    fi
  fi
fi

git push origin HEAD:linkedin-agent-in-app
