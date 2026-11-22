"""Synthetic packages exercise extractor behavior without committing user models."""

import io
import json
import unittest
from zipfile import ZIP_DEFLATED, ZipFile

from src.three_mf import extract_3mf


def package(sliced=True, extra=None):
    members = {
        "3D/3dmodel.model": '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Test &amp; model</metadata><metadata name="Designer">Designer</metadata><resources/></model>',
        "Metadata/project_settings.config": json.dumps(
            {
                "printer_model": "Bambu Lab P2S",
                "filament_type": ["PLA", "PETG"],
                "filament_colour": ["#ffffff", "#000000"],
                "filament_settings_id": ["PLA Basic", "PETG HF"],
            }
        ),
        "Metadata/model_settings.config": '<config><object id="1"><metadata key="name" value="Object.stl"/></object><plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="1"/></model_instance></plate><plate><metadata key="plater_id" value="2"/></plate></config>',
        "Metadata/slice_info.config": '<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="10481"/><metadata key="weight" value="103.04"/><filament id="1" type="PLA" color="#ffffff" used_g="103.04"/></plate></config>'
        if sliced
        else "<config/>",
    }
    members.update(extra or {})
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name, value in members.items():
            archive.writestr(name, value)
    return output.getvalue()


class ExtractorTest(unittest.TestCase):
    def test_estimates_and_configured_filaments_remain_distinct(self):
        result = extract_3mf(package(), "Test.3mf")
        self.assertEqual(result["name"], "Test & model")
        self.assertEqual(result["printer"], "Bambu Lab P2S")
        self.assertEqual(len(result["plates"]), 2)
        self.assertEqual(result["plates"][0]["estimated_seconds"], 10481)
        self.assertEqual(result["plates"][0]["estimated_grams"], 103.04)
        self.assertEqual(len(result["plates"][0]["filaments"]), 1)
        self.assertEqual(len(result["configured_filaments"]), 2)
        self.assertEqual(result["plates"][0]["objects"], ["Object.stl"])
        self.assertIsNone(result["plates"][1]["estimated_grams"])
        self.assertEqual(len(result["sha256"]), 64)

    def test_missing_estimates_are_not_inferred(self):
        result = extract_3mf(package(False))
        self.assertIsNone(result["plates"][0]["estimated_seconds"])
        self.assertIsNone(result["plates"][0]["estimated_grams"])
        self.assertEqual(result["plates"][0]["filaments"], [])
        self.assertTrue(result["warnings"])

    def test_invalid_packages_and_unsafe_metadata_are_rejected(self):
        for data in [
            b"not a zip",
            package(extra={"../outside": "bad"}),
            package(
                extra={
                    "Metadata/model_settings.config": '<!DOCTYPE config [<!ENTITY x "boom">]><config/>'
                }
            ),
            package(extra={"Metadata/project_settings.config": "not json"}),
            package(extra={"3D/3dmodel.model": "<notamodel/>"}),
        ]:
            with (
                self.subTest(data=len(data)),
                self.assertRaises((ValueError, TypeError)),
            ):
                extract_3mf(data)

    def test_oversized_metadata_and_nonfinite_estimates(self):
        with self.assertRaises(ValueError):
            extract_3mf(
                package(
                    extra={
                        "Metadata/project_settings.config": "x" * (2 * 1024 * 1024 + 1)
                    }
                )
            )
        result = extract_3mf(
            package(
                extra={
                    "Metadata/slice_info.config": '<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="NaN"/><metadata key="weight" value="-1"/></plate></config>'
                }
            )
        )
        self.assertIsNone(result["plates"][0]["estimated_seconds"])
        self.assertIsNone(result["plates"][0]["estimated_grams"])
