"""The lock refresher trusts only wheel hashes for the requested exact release."""

import io
import json
import unittest
from unittest.mock import patch

from scripts.hash_requirements import wheel_hashes


class HashRequirementsTest(unittest.TestCase):
    def metadata(self):
        return {
            "info": {"name": "demo-package", "version": "1.0"},
            "urls": [
                {"packagetype": kind, "yanked": yanked, "digests": {"sha256": digest * 64}}
                for kind, yanked, digest in [
                    ("bdist_wheel", False, "b"),
                    ("bdist_wheel", False, "a"),
                    ("bdist_wheel", False, "a"),
                    ("bdist_wheel", True, "c"),
                    ("sdist", False, "d"),
                ]
            ],
        }

    def test_only_non_yanked_wheel_hashes_are_sorted_and_deduplicated(self):
        response = io.BytesIO(json.dumps(self.metadata()).encode())
        with patch("scripts.hash_requirements.urlopen", return_value=response) as request:
            actual = wheel_hashes("Demo_Package[extra]==1.0")
        request.assert_called_once_with("https://pypi.org/pypi/Demo_Package/1.0/json", timeout=30)
        self.assertEqual(
            actual.splitlines(),
            [
                "Demo_Package[extra]==1.0 " + chr(92),
                "    --hash=sha256:" + "a" * 64 + " " + chr(92),
                "    --hash=sha256:" + "b" * 64,
            ],
        )

    def test_malformed_pins_are_rejected_before_network_access(self):
        with patch("scripts.hash_requirements.urlopen") as request:
            for pin in ["demo>=1", "demo==1; python_version > '3'", "../../secret==1", "demo"]:
                with self.subTest(pin=pin), self.assertRaises(ValueError):
                    wheel_hashes(pin)
            request.assert_not_called()

    def test_mismatched_releases_and_invalid_or_missing_wheels_fail_closed(self):
        invalid = [
            {**self.metadata(), "info": {"name": "other", "version": "1.0"}},
            {**self.metadata(), "info": {"name": "demo-package", "version": "2.0"}},
            {**self.metadata(), "urls": []},
            {
                **self.metadata(),
                "urls": [
                    {
                        "packagetype": "bdist_wheel",
                        "yanked": False,
                        "digests": {"sha256": "not-a-hash"},
                    }
                ],
            },
        ]
        for metadata in invalid:
            with self.subTest(metadata=metadata):
                response = io.BytesIO(json.dumps(metadata).encode())
                with patch("scripts.hash_requirements.urlopen", return_value=response):
                    with self.assertRaises(ValueError):
                        wheel_hashes("demo-package==1.0")
