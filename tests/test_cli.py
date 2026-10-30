import json
import unittest
from unittest.mock import patch

from typer.testing import CliRunner

import easycrm

CONTACT = "00000000-0000-0000-0000-000000000001"
ORGANIZATION = "00000000-0000-0000-0000-000000000002"
OWNER = "00000000-0000-0000-0000-000000000003"
LINK = "00000000-0000-0000-0000-000000000004"


class FakeClient:
    def __init__(self, sign_in=True):
        self.calls = []

    def table(self, method, name, params=None, payload=None):
        self.calls.append((method, name, params, payload))
        if method == "GET" and name == "contacts":
            return [{"id": CONTACT, "owner_id": OWNER, "name": "Ada"}]
        if method == "GET" and name == "organizations":
            return [{"id": ORGANIZATION, "owner_id": OWNER, "name": "Agency"}]
        if method in ("POST", "PATCH"):
            return [{"id": LINK, **payload}]
        raise AssertionError((method, name, params, payload))


class CliTests(unittest.TestCase):
    def setUp(self):
        self.runner = CliRunner()
        self.client = FakeClient()
        self.client_patch = patch.object(easycrm, "Client", return_value=self.client)
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)

    def invoke(self, *args):
        result = self.runner.invoke(easycrm.app, list(args))
        self.assertEqual(result.exit_code, 0, result.output)
        return json.loads(result.stdout)

    def test_add_preserves_json_and_payload(self):
        result = self.invoke("add", "--name", " Ada ", "--email", "ada@example.com")
        self.assertEqual(result["name"], "Ada")
        self.assertEqual(
            self.client.calls[-1][3],
            {
                "name": "Ada",
                "email": "ada@example.com",
            },
        )

    def test_repeated_clear_options(self):
        self.invoke("update", CONTACT, "--clear", "email", "--clear", "phone")
        payload = self.client.calls[-1][3]
        self.assertIsNone(payload["email"])
        self.assertIsNone(payload["phone"])
        self.assertIn("updated_at", payload)

    def test_org_contact_link_direction(self):
        self.invoke(
            "org-link-contact",
            ORGANIZATION,
            CONTACT,
            "--as",
            "employs",
            "--inverse",
            "employee",
        )
        payload = self.client.calls[-1][3]
        self.assertEqual(payload["organization_relationship"], "employs")
        self.assertEqual(payload["contact_relationship"], "employee")
        self.assertEqual(payload["owner_id"], OWNER)

    def test_event_time_and_invalid_options(self):
        self.invoke(
            "log",
            CONTACT,
            "--kind",
            "call",
            "--body",
            "Spoke",
            "--at",
            "2026-10-20T14:00:00-04:00",
        )
        self.assertEqual(
            self.client.calls[-1][3]["happened_at"], "2026-10-20T14:00:00-04:00"
        )
        for args in (
            ("list", "--limit", "101"),
            ("show", "not-a-uuid"),
            ("add", "--name", " "),
            ("update", CONTACT, "--clear", "name"),
            ("log", CONTACT, "--kind", "fax", "--body", "Spoke"),
        ):
            with self.subTest(args=args):
                result = self.runner.invoke(easycrm.app, list(args))
                self.assertNotEqual(result.exit_code, 0)

    def test_crm_errors_remain_json(self):
        self.client.table = lambda *args, **kwargs: []
        result = self.runner.invoke(easycrm.app, ["show", CONTACT])
        self.assertEqual(result.exit_code, 1)
        self.assertEqual(
            json.loads(result.stderr), {"error": "contact not found or inaccessible"}
        )


if __name__ == "__main__":
    unittest.main()
