"""Extract label reference data from the reviewed Bambu guide; never open app DBs.

Requires pdfplumber only when run manually. Runtime uses the bundled JSON.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

SOURCE_URL = "https://cms.bblmw.com/Bambu_Filament_Guide_77b0b697ca.pdf"
SOURCE_SHA256 = "3556a92bc3785046d1b0be8b0a3682a7b7c9e2ea99bf485db74f5c41397b8714"
RANGE = r"(\d+)(?:\s*-\s*(\d+))?"


def bounds(match, start=1):
    low = int(match.group(start))
    high = int(match.group(start + 1) or low)
    if low > high:
        raise ValueError("Reversed range in source")
    return [low, high]


def extract_row(row):
    material = row[0].strip()
    nozzle = re.fullmatch(RANGE + r"\s*°C", row[20].replace("℃", "°C"))
    if not nozzle:
        raise ValueError(f"Unknown nozzle temperature: {material}")
    beds = []
    for name, low, high in re.findall(
        r"([^()]+)\(\s*(\d+)\s*-\s*(\d+)\s*°C\)", row[15]
    ):
        plate = " ".join(name.split())
        beds.append({"plate": plate, "temperature_c": [int(low), int(high)]})
    if len(beds) != row[15].count("°C") or not beds:
        raise ValueError(f"Unparsed build plate: {material}")
    drying_text = " ".join(row[12].replace("℃", "°C").replace("，", ",").split())
    drying = []
    for code, label, pattern in (
        ("blast_oven", "Blast Drying Oven", r"Blast Drying Oven:\s*"),
        (
            "printer_heatbed",
            "Printer Heatbed",
            r"Printer Heatbed \(Covered, Flip midway\):\s*",
        ),
    ):
        match = re.search(pattern + RANGE + r"\s*°C,\s*" + RANGE + r"\s*h", drying_text)
        if not match:
            raise ValueError(f"Unparsed drying condition: {material}/{code}")
        notes = []
        if code == "printer_heatbed":
            notes.append("Cover the filament and turn it halfway through drying.")
        if material in {"PPS-CF", "PPA-CF"} and code == "blast_oven":
            notes.append("Higher temperatures within this range improve drying.")
        if material == "PPS-CF" and code == "printer_heatbed":
            notes.append("Less effective than a blast drying oven.")
        drying.append(
            {
                "method": code,
                "name": label,
                "temperature_c": bounds(match),
                "hours": bounds(match, 3),
                "notes": notes,
            }
        )
    if row[11] not in {"Required", "Optional"}:
        raise ValueError(f"Unknown drying requirement: {material}")
    return {
        "material": material,
        "nozzle_temperature_c": bounds(nozzle),
        "bed_temperatures": beds,
        "drying_required": row[11] == "Required",
        "drying_conditions": drying,
        "flow_ratio": None,
    }


def extract(pdf_path):
    import pdfplumber

    if hashlib.sha256(pdf_path.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError(
            "PDF differs from the reviewed source; review layout and values before importing"
        )
    with pdfplumber.open(pdf_path) as pdf:
        if len(pdf.pages) != 1:
            raise ValueError("Expected a one-page guide")
        tables = [
            t for t in pdf.pages[0].extract_tables() if len(t) == 44 and len(t[1]) == 23
        ]
    if len(tables) != 1:
        raise ValueError("Expected exactly one 42-material table")
    table = tables[0]
    for index, title in (
        (0, "Filament"),
        (12, "Drying Condition"),
        (15, "Build Plate & Bed Temperature"),
        (20, "Nozzle Temperature"),
    ):
        if " ".join(table[1][index].split()) != title:
            raise ValueError(f"Unexpected source column {index}")
    profiles = [extract_row(row) for row in table[2:]]
    if len({p["material"] for p in profiles}) != 42:
        raise ValueError("Expected 42 unique materials")
    return {
        "source_url": SOURCE_URL,
        "source_sha256": SOURCE_SHA256,
        "source_page": 1,
        "retrieved_on": "2026-11-22",
        "manufacturer": "Bambu Lab",
        "profiles": profiles,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = extract(args.pdf)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"Extracted {len(data['profiles'])} material profiles to {args.output}")
