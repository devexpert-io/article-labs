import json, sys
LAB = "/home/antonio/Projects/devexpert-io/article-labs/2026-11-validacion"
for c in sys.argv[1:]:
    d = json.load(open(f"{LAB}/resultados/completo/codigos-descuento-{c}.json"))
    print("=====", c, "impl", d["commit_implementacion"][:8])
    A = d["A"]
    print("  A gate_ok", A["gate_ok"], "completo", A["completo"], "crit", A["criterios_ok"], "inest", A.get("inestables"))
    for k in ["B", "C"]:
        v = d.get(k)
        if not v:
            continue
        print("  ", k, "validador", v["validador"], "veredicto_final", v["veredicto_final"])
        for r in v["rondas"]:
            print("     ronda", r["ronda"], "keys", list(r.keys()))
            for kk, vv in r.items():
                if isinstance(vv, dict) and "gate_ok" in vv:
                    print("        ", kk, "gate_ok", vv["gate_ok"], "completo", vv.get("completo"), "crit", vv.get("criterios_ok"), "inest", vv.get("inestables"))
                elif kk in ("commit", "commit_reparacion", "veredicto"):
                    print("        ", kk, json.dumps(vv, ensure_ascii=False)[:100])
        f = v.get("final")
        if isinstance(f, dict):
            print("     final", {a: b for a, b in f.items() if a not in ("gate_salida", "ocultos_salida", "tests", "criterios")})
