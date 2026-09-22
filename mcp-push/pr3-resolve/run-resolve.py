#!/usr/bin/env python3
import base64, zlib
from pathlib import Path
p = Path("mcp-push/pr3-resolve/resolve.py.zlib.b64")
code = zlib.decompress(base64.b64decode(p.read_text().strip()))
Path("scripts/resolve-pr3-vs-main.py").write_bytes(code)
exec(compile(code, "scripts/resolve-pr3-vs-main.py", "exec"), {"__name__":"__main__"})
