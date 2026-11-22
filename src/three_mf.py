"""Read Bambu-style 3MF metadata without extracting files or executing embedded content.

Only bounded metadata members and raster thumbnails are read; geometry and G-code
are never sliced, executed, fetched externally or unpacked to the filesystem.
"""

import base64
import hashlib
import io
import json
import math
import zlib
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

MAX_UPLOAD = 30 * 1024 * 1024


def text(value, limit=500):
    return str(value or "")[:limit]


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and 0 <= value <= 100000000 else None
    except (TypeError, ValueError):
        return None


def xml(data):
    # Reject declarations rather than expanding untrusted entity definitions.
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper() or b"\x00" in data:
        raise ValueError("XML med dokumenttyper eller entiteter understøttes ikke.")
    return ET.fromstring(data)


def metadata(node):
    return {item.get("key"): item.get("value", "") for item in node.findall("metadata")}


def extract_3mf(data, filename="projekt.3mf"):
    """Return a JSON-compatible preview; absent estimates remain None, never guesses."""
    if not data or len(data) > MAX_UPLOAD:
        raise ValueError("Vælg en 3MF-fil på højst 30 MB.")
    try:
        with ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if (
                len(infos) > 2000
                or sum(item.file_size for item in infos) > 500 * 1024 * 1024
            ):
                raise ValueError(
                    "3MF-pakken er for stor eller indeholder for mange filer."
                )
            names = {item.filename for item in infos}
            if len(names) != len(infos) or any(item.flag_bits & 1 for item in infos):
                raise ValueError("Dublerede eller krypterede filer understøttes ikke.")
            for name in names:
                if (
                    name.startswith(("/", "\\"))
                    or ".." in PurePosixPath(name).parts
                    or "\\" in name
                ):
                    raise ValueError("Ugyldig filsti i 3MF-pakken.")
            models = [name for name in names if name.lower().endswith(".model")]
            if not models:
                raise ValueError("Filen indeholder ingen 3MF-model.")

            def read(name, limit=2 * 1024 * 1024):
                if name not in names:
                    return None
                if archive.getinfo(name).file_size > limit:
                    raise ValueError("En metadatafil eller thumbnail er for stor.")
                return archive.read(name)

            # Top-level metadata precedes geometry. Parse a bounded prefix and stop
            # at resources so large meshes do not need loading into memory.
            model_name = (
                "3D/3dmodel.model" if "3D/3dmodel.model" in names else min(models)
            )
            with archive.open(model_name) as stream:
                prefix = stream.read(2 * 1024 * 1024)
            if (
                b"<!DOCTYPE" in prefix.upper()
                or b"<!ENTITY" in prefix.upper()
                or b"\x00" in prefix
            ):
                raise ValueError("Ugyldig XML i 3MF-modellen.")
            model_metadata = {}
            parser = ET.XMLPullParser(events=("start", "end"))
            stopped = False
            root_seen = False
            for start in range(0, len(prefix), 4096):
                parser.feed(prefix[start : start + 4096])
                for event, node in parser.read_events():
                    tag = node.tag.split("}")[-1]
                    if not root_seen:
                        if event != "start" or tag != "model":
                            raise ValueError(
                                "Filen indeholder ikke en gyldig 3MF-model."
                            )
                        root_seen = True
                    if event == "start" and tag == "resources":
                        stopped = True
                        break
                    if event == "end" and tag == "metadata":
                        model_metadata[node.get("name")] = text(node.text, 5000)
                if stopped:
                    break
            if not stopped:
                parser.close()
            raw = read("Metadata/project_settings.config")
            settings = json.loads(raw) if raw else {}
            if not isinstance(settings, dict):
                raise TypeError("Ugyldige projektindstillinger.")
            raw = read("Metadata/model_settings.config")
            model = xml(raw) if raw else ET.Element("config")
            raw = read("Metadata/slice_info.config")
            sliced = xml(raw) if raw else ET.Element("config")
            objects = {
                item.get("id"): metadata(item).get("name", "")
                for item in model.findall("object")
            }
            configured = []
            types = settings.get("filament_type", [])
            if isinstance(types, list):
                for index, kind in enumerate(types[:100]):

                    def setting(key, index=index):
                        values = settings.get(key, [])
                        return (
                            text(values[index])
                            if isinstance(values, list) and index < len(values)
                            else ""
                        )

                    configured.append(
                        {
                            "id": str(index + 1),
                            "type": text(kind),
                            "color": setting("filament_colour"),
                            "profile": setting("filament_settings_id"),
                            "vendor": setting("filament_vendor"),
                        }
                    )
            slices = {
                metadata(plate).get("index"): plate for plate in sliced.findall("plate")
            }
            plates = []
            plate_nodes = model.findall("plate") or sliced.findall("plate")
            if len(plate_nodes) > 30:
                raise ValueError("Import understøtter højst 30 printplader.")
            for index, plate in enumerate(plate_nodes):
                values = metadata(plate)
                identity = values.get("plater_id", values.get("index", str(index + 1)))
                sliced_plate = slices.get(identity)
                estimates = metadata(sliced_plate) if sliced_plate is not None else {}
                used = []
                if sliced_plate is not None:
                    for filament in sliced_plate.findall("filament"):
                        used.append(
                            {
                                "id": text(filament.get("id")),
                                "type": text(filament.get("type")),
                                "color": text(filament.get("color")),
                                "grams": number(filament.get("used_g")),
                            }
                        )
                image_name = values.get(
                    "thumbnail_file", f"Metadata/plate_{identity}.png"
                ).lstrip("/")
                image = read(image_name, 1024 * 1024)
                mime = (
                    "image/png"
                    if image and image.startswith(b"\x89PNG\r\n\x1a\n")
                    else "image/jpeg"
                    if image and image.startswith(b"\xff\xd8\xff")
                    else None
                )
                if mime == "image/png" and (
                    len(image) < 24
                    or int.from_bytes(image[16:20], "big")
                    * int.from_bytes(image[20:24], "big")
                    > 16000000
                ):
                    raise ValueError(
                        "Thumbnail har for stor opløsning eller er ugyldig."
                    )
                plates.append(
                    {
                        "id": text(identity),
                        "name": text(values.get("plater_name") or f"Plade {identity}"),
                        "objects": [
                            text(objects.get(metadata(instance).get("object_id")))
                            for instance in plate.findall("model_instance")
                        ],
                        "filaments": used[:100],
                        "estimated_seconds": number(estimates.get("prediction")),
                        "estimated_grams": number(estimates.get("weight")),
                        "thumbnail": f"data:{mime};base64,"
                        + base64.b64encode(image).decode()
                        if mime
                        else "",
                    }
                )
            if not plates:
                plates = [
                    {
                        "id": "1",
                        "name": "Plade 1",
                        "objects": list(objects.values())[:100],
                        "filaments": [],
                        "estimated_seconds": None,
                        "estimated_grams": None,
                        "thumbnail": "",
                    }
                ]
            if len(plates) > 30:
                raise ValueError("Import understøtter højst 30 printplader.")
            warnings = [
                "Estimater og printerprofil stammer fra filen og skal kontrolleres i din slicer."
            ]
            if any(
                plate["estimated_seconds"] is None or plate["estimated_grams"] is None
                for plate in plates
            ):
                warnings.append(
                    "En eller flere plader mangler samlet printtid eller gramforbrug. Ingen estimater er beregnet ud fra geometrien."
                )
            return {
                "filename": text(PurePosixPath(filename.replace("\\", "/")).name),
                "sha256": hashlib.sha256(data).hexdigest(),
                "name": text(
                    model_metadata.get("Title") or PurePosixPath(filename).stem, 200
                ),
                "designer": text(model_metadata.get("Designer")),
                "license": text(model_metadata.get("License")),
                "application": text(model_metadata.get("Application")),
                "printer": text(settings.get("printer_model")),
                "layer_height": text(settings.get("layer_height")),
                "infill": text(settings.get("sparse_infill_density")),
                "configured_filaments": configured,
                "plates": plates,
                "warnings": warnings,
            }
    except (
        BadZipFile,
        ET.ParseError,
        json.JSONDecodeError,
        KeyError,
        RuntimeError,
        NotImplementedError,
        EOFError,
        UnicodeDecodeError,
        zlib.error,
        RecursionError,
    ) as error:
        raise ValueError(
            "Filen kunne ikke læses som en understøttet 3MF-pakke."
        ) from error
