from pathlib import Path
import re

p = Path("src/components/owner-desk.tsx")
src = p.read_text()

if 'from "@/components/find-vertical-field"' not in src:
    needle = 'import { VoiceBar } from "@/components/voice-bar";'
    if needle in src:
        src = src.replace(
            needle,
            needle + '\nimport { FindVerticalField } from "@/components/find-vertical-field";',
            1,
        )
    else:
        src = src.replace(
            'import { CalendarDesk } from "@/components/calendar-desk";',
            'import { FindVerticalField } from "@/components/find-vertical-field";\nimport { CalendarDesk } from "@/components/calendar-desk";',
            1,
        )

if "<FindVerticalField" not in src:
    patterns = [
        re.compile(
            r'\s*<label className="la-label">What kind of company\?</label>\s*'
            r"<select[\s\S]*?</select>\s*"
            r"(?:\{\(!vert[\s\S]*?\) : null\})?",
            re.M,
        ),
        re.compile(
            r'\s*<label className="la-label">What kind of company\?</label>\s*'
            r'<input[\s\S]*?list="vert-list"[\s\S]*?/>\s*'
            r'<datalist id="vert-list">[\s\S]*?</datalist>',
            re.M,
        ),
    ]
    replaced = False
    for pat in patterns:
        m = pat.search(src)
        if m:
            src = (
                src[: m.start()]
                + "\n            <FindVerticalField value={vert} onChange={setVert} />"
                + src[m.end() :]
            )
            replaced = True
            break
    if not replaced:
        if "<FindPresets" in src:
            src = re.sub(
                r"(</FindPresets>\s*)",
                r"\1            <FindVerticalField value={vert} onChange={setVert} />\n",
                src,
                count=1,
            )
            src = re.sub(
                r'\s*<label className="la-label">What kind of company\?</label>\s*<select[\s\S]*?</select>\s*(?:\{\(!vert[\s\S]*?\) : null\})?',
                "\n",
                src,
                count=1,
            )
        elif 'value={vert}' in src and "What kind of company" in src:
            pass
        else:
            if '<label className="la-label">Where?</label>' in src:
                src = src.replace(
                    '<label className="la-label">Where?</label>',
                    '<FindVerticalField value={vert} onChange={setVert} />\n            <label className="la-label">Where?</label>',
                    1,
                )
                src = re.sub(
                    r'\s*<label className="la-label">What kind of company\?</label>\s*<select[\s\S]*?</select>\s*(?:\{\(!vert[\s\S]*?\) : null\})?',
                    "\n",
                    src,
                    count=1,
                )
            else:
                raise SystemExit("Could not wire FindVerticalField")

p.write_text(src)
print("FindVerticalField wired", src.count("FindVerticalField"))
