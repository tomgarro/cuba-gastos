#!/usr/bin/env python3
"""Genera index.html (un solo archivo) a partir de src/. No editar index.html a mano."""
import pathlib
r = pathlib.Path(__file__).parent
html = (r / "src/app.html").read_text()
html = html.replace("/*CORE*/", (r / "src/core.js").read_text())
import base64, json
imgs = {p.stem: "data:image/webp;base64," + base64.b64encode(p.read_bytes()).decode() for p in sorted((r / "assets/cuba").glob("*.webp"))}
html = html.replace("/*CUBAIMG*/", "var CUBA_IMG=" + json.dumps(imgs) + ";")
html = html.replace("/*CUBA*/", (r / "src/cuba.js").read_text())
import json
html = html.replace("__VERSION__", json.loads((r / "package.json").read_text())["version"])
html = html.replace("/*RESUMEN*/", (r / "src/resumen.js").read_text())
html = html.replace("/*COMPARTIR*/", (r / "src/compartir.js").read_text())
html = html.replace("/*PREGUNTAS*/", (r / "src/preguntas.js").read_text())
html = html.replace("/*AVISOS*/", (r / "src/avisos.js").read_text())
html = html.replace("/*SHEETS*/", (r / "src/sheets.js").read_text())
(r / "index.html").write_text(html)
print("index.html:", len(html), "bytes")
