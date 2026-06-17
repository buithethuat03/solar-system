#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fetch real Voyager 1 & 2 heliocentric trajectories from NASA/JPL HORIZONS
and emit an ES module (js/voyager_ephem.js) of sampled state vectors.

Frame: Ecliptic of J2000.0, Sun-centered (CENTER='500@10'), units AU & AU/day.
This is the SAME frame kepler.js uses for the planets, so the scene mapping
(x, y:z, z:-y) is identical. Position is interpolated in JS with cubic Hermite
using the true velocities at each sample (exact local tangents), so even a
monthly backbone reproduces the planetary flybys faithfully; dense daily windows
around each encounter make the swing-bys crisp.
"""
import json, sys, time, urllib.parse, urllib.request, re, os

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
J2000_JD = 2451545.0

# Well-known closest-approach dates (used only to center the dense daily windows;
# the windows are wide enough that exact dates are not required).
ENCOUNTERS = {
    "-31": ["1979-03-05", "1980-11-12"],                              # V1: Jupiter, Saturn
    "-32": ["1979-07-09", "1981-08-26", "1986-01-24", "1989-08-25"],  # V2: Jupiter, Saturn, Uranus, Neptune
}
# HORIZONS earliest available epoch per craft (probed from the API: V1 starts
# 1977-09-05 13:59:24 TDB, V2 1977-08-20 15:32:32 TDB — i.e. at launch injection).
# Start a couple of minutes later so the request is inside the valid span; the
# first sample then sits right next to Earth, at launch.
LAUNCH = {"-31": "1977-09-05 14:01", "-32": "1977-08-20 15:34"}

CRAFT = {"-31": "voyager1", "-32": "voyager2"}

JD_RE = re.compile(r"^\s*(\d+\.\d+)\s*=\s*A\.D\.")
NUM = r"([-+]?\d+\.\d+E[-+]?\d+)"
XYZ_RE = re.compile(r"X\s*=\s*" + NUM + r".*?Y\s*=\s*" + NUM + r".*?Z\s*=\s*" + NUM, re.S)
VEL_RE = re.compile(r"VX\s*=\s*" + NUM + r".*?VY\s*=\s*" + NUM + r".*?VZ\s*=\s*" + NUM, re.S)


def fetch(cmd, start, stop, step):
    params = {
        "format": "text", "COMMAND": f"'{cmd}'", "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'VECTORS'", "CENTER": "'500@10'",
        "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'", "STEP_SIZE": f"'{step}'",
        "REF_PLANE": "'ECLIPTIC'", "REF_SYSTEM": "'J2000'", "VEC_TABLE": "'2'",
        "OUT_UNITS": "'AU-D'", "CSV_FORMAT": "'NO'",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            sys.stderr.write(f"  retry {attempt+1} ({e})\n")
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"HORIZONS fetch failed: {cmd} {start}..{stop} @ {step}")


def parse(text):
    """Return list of [jd, x, y, z, vx, vy, vz] from a HORIZONS VECTORS block."""
    a, b = text.find("$$SOE"), text.find("$$EOE")
    if a < 0 or b < 0:
        # Surface the explanatory message (e.g. "No ephemeris ... prior to ...").
        hint = "\n".join(l for l in text.splitlines() if "ephemeris" in l.lower() or "Trajectory" in l)
        raise RuntimeError("No $$SOE block. " + (hint or text[-300:]))
    block = text[a + 5:b]
    recs, lines = [], block.splitlines()
    i = 0
    while i < len(lines):
        m = JD_RE.match(lines[i])
        if not m:
            i += 1
            continue
        jd = float(m.group(1))
        chunk = " ".join(lines[i + 1:i + 3])
        mx, mv = XYZ_RE.search(chunk), VEL_RE.search(chunk)
        if mx and mv:
            recs.append([jd] + [float(mx.group(k)) for k in (1, 2, 3)]
                              + [float(mv.group(k)) for k in (1, 2, 3)])
        i += 3
    return recs


def date_minus(iso, days):
    import datetime
    d = datetime.date.fromisoformat(iso) + datetime.timedelta(days=days)
    return d.isoformat()


def collect(cmd):
    recs = []
    launch = LAUNCH[cmd]
    print(f"[{CRAFT[cmd]}] backbone monthly {launch}..2015 ...")
    recs += parse(fetch(cmd, launch, "2015-01-01", "1 MO"))
    print(f"[{CRAFT[cmd]}] backbone yearly 2015..2055 ...")
    recs += parse(fetch(cmd, "2015-01-01", "2055-01-01", "1 Y"))
    for enc in ENCOUNTERS[cmd]:
        s, e = date_minus(enc, -22), date_minus(enc, 22)
        print(f"[{CRAFT[cmd]}] encounter window {s}..{e} (daily) ...")
        recs += parse(fetch(cmd, s, e, "1 d"))
    # Sort by JD and de-duplicate (segments share endpoints; windows overlap backbone).
    recs.sort(key=lambda r: r[0])
    out = []
    for r in recs:
        if out and abs(r[0] - out[-1][0]) < 1e-4:
            continue
        out.append(r)
    return out


def to_samples(recs):
    """JD(TDB) -> days since J2000; round to keep the module compact."""
    samples = []
    for jd, x, y, z, vx, vy, vz in recs:
        t = round(jd - J2000_JD, 5)
        samples.append([t, round(x, 6), round(y, 6), round(z, 6),
                        round(vx, 9), round(vy, 9), round(vz, 9)])
    return samples


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.join(here, "..", "js", "voyager_ephem.js")
    data = {}
    for cmd in ("-31", "-32"):
        recs = collect(cmd)
        samples = to_samples(recs)
        data[CRAFT[cmd]] = {"t0": samples[0][0], "t1": samples[-1][0], "samples": samples}
        # Sanity report: heliocentric distance at first/last and each encounter.
        import datetime
        def jd_to_iso(t):
            d = datetime.datetime(2000, 1, 1, 12) + datetime.timedelta(days=t)
            return d.date().isoformat()
        f, l = samples[0], samples[-1]
        df = (f[1]**2 + f[2]**2 + f[3]**2) ** 0.5
        dl = (l[1]**2 + l[2]**2 + l[3]**2) ** 0.5
        print(f"  {CRAFT[cmd]}: {len(samples)} samples, "
              f"{jd_to_iso(f[0])} (r={df:.3f} AU) .. {jd_to_iso(l[0])} (r={dl:.2f} AU)")
        for enc in ENCOUNTERS[cmd]:
            te = (datetime.date.fromisoformat(enc) - datetime.date(2000, 1, 1)).days - 0.5
            # nearest sample
            ns = min(samples, key=lambda s: abs(s[0] - te))
            r = (ns[1]**2 + ns[2]**2 + ns[3]**2) ** 0.5
            print(f"     encounter {enc}: nearest sample {jd_to_iso(ns[0])} at r={r:.3f} AU")

    header = ("// AUTO-GENERATED by tools/fetch_voyager_ephem.py — DO NOT EDIT BY HAND.\n"
              "// Source: NASA/JPL HORIZONS. Frame: Ecliptic of J2000.0, Sun-centered,\n"
              "// units AU & AU/day. Each sample: [t, x, y, z, vx, vy, vz] where t is\n"
              "// days since J2000 (TDB). Interpolated in JS with cubic Hermite (true\n"
              "// velocities as tangents). Linear extrapolation beyond the last sample.\n"
              "export const VOYAGER_EPHEM = ")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(header + json.dumps(data, separators=(",", ":")) + ";\n")
    size = os.path.getsize(out_path)
    print(f"Wrote {out_path}  ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
