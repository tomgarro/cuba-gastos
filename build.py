#!/usr/bin/env python3
"""Genera index.html (un solo archivo) a partir de src/. No editar index.html a mano."""
import pathlib
r = pathlib.Path(__file__).parent
html = (r / "src/app.html").read_text()
html = html.replace("/*CORE*/", (r / "src/core.js").read_text())
html = html.replace("/*CUBA*/", (r / "src/cuba.js").read_text())
html = html.replace("/*SHEETS*/", (r / "src/sheets.js").read_text())
(r / "index.html").write_text(html)
print("index.html:", len(html), "bytes")
