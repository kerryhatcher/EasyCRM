#!/usr/bin/env python3
"""Small, JSON-speaking CLI for a Supabase-backed CRM."""

import getpass
import json
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import UUID

import typer

FIELDS = ("name", "email", "phone", "company", "title", "info")
ORG_FIELDS = ("name", "kind", "email", "phone", "website", "address", "info")
KINDS = ("note", "call", "email", "meeting", "other")
INVERSE_RELATIONSHIPS = {
    "married": "married",
    "spouse": "spouse",
    "partner": "partner",
    "friend": "friend",
    "sibling": "sibling",
    "colleague": "colleague",
    "parent": "child",
    "father": "child",
    "mother": "child",
    "child": "parent",
    "son": "parent",
    "daughter": "parent",
}
ORG_INVERSE_RELATIONSHIPS = {
    "partner": "partner",
    "affiliate": "affiliate",
    "peer": "peer",
}


class CRMError(Exception):
    pass


def nonempty(value):
    if value is None:
        return None
    if not value.strip():
        raise typer.BadParameter("value cannot be blank")
    return value.strip()


def relationship_label(value):
    label = nonempty(value)
    if label is None:
        return None
    if len(label) > 80:
        raise typer.BadParameter("relationship labels must be at most 80 characters")
    return label


def timestamp(value):
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("timezone required")
        return parsed.isoformat()
    except ValueError as exc:
        raise typer.BadParameter(
            "use ISO 8601 with a timezone, e.g. 2026-10-20T14:00:00-04:00"
        ) from exc


def history_kind(value):
    if value not in KINDS:
        raise typer.BadParameter("choose note, call, email, meeting, or other")
    return value


def contact_clear(value):
    value = value or []
    if any(field not in FIELDS[1:] for field in value):
        raise typer.BadParameter("choose email, phone, company, title, or info")
    return value


def organization_clear(value):
    value = value or []
    if any(field not in ORG_FIELDS[2:] for field in value):
        raise typer.BadParameter("choose email, phone, website, address, or info")
    return value


class Client:
    def __init__(self, sign_in=True):
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
        self.email = os.environ.get("EASYCRM_EMAIL", "")
        self.password = os.environ.get("EASYCRM_PASSWORD", "")
        if not self.url.startswith("https://") or not self.key:
            raise CRMError("set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY")
        if not self.email:
            raise CRMError("set EASYCRM_EMAIL to a Supabase Auth user")
        if not self.password and sys.stdin.isatty():
            self.password = getpass.getpass("Supabase password: ")
        if not self.password:
            raise CRMError("set EASYCRM_PASSWORD or run in a terminal to enter it")
        if sign_in:
            auth = self._request(
                "POST",
                "/auth/v1/token",
                {"grant_type": "password"},
                {"email": self.email, "password": self.password},
            )
            self.token = auth.get("access_token")
            if not self.token:
                raise CRMError("Supabase sign-in returned no access token")

    def _request(self, method, path, params=None, payload=None):
        query = "?" + urlencode(params) if params else ""
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"apikey": self.key, "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if hasattr(self, "token"):
            headers["Authorization"] = "Bearer " + self.token
        if method in ("POST", "PATCH", "DELETE") and path.startswith("/rest/"):
            headers["Prefer"] = "return=representation"
        request = Request(
            self.url + path + query, data=data, headers=headers, method=method
        )
        try:
            with urlopen(request, timeout=20) as response:
                body = response.read()
                return json.loads(body) if body else None
        except HTTPError as exc:
            try:
                error = json.loads(exc.read())
                message = (
                    error.get("message")
                    or error.get("msg")
                    or error.get("error_description")
                    or error.get("error")
                )
            except (ValueError, AttributeError):
                message = None
            raise CRMError(
                f"Supabase HTTP {exc.code}: {message or exc.reason}"
            ) from exc
        except URLError as exc:
            raise CRMError(f"cannot reach Supabase: {exc.reason}") from exc

    def table(self, method, name, params=None, payload=None):
        return self._request(method, "/rest/v1/" + name, params, payload)


def one(rows, what):
    if not rows:
        raise CRMError(f"{what} not found or inaccessible")
    return rows[0]


def get_contact(client, id):
    return one(
        client.table(
            "GET",
            "contacts",
            {
                "id": "eq." + id,
                "deleted_at": "is.null",
                "select": "*",
            },
        ),
        "contact",
    )


def get_organization(client, id):
    return one(
        client.table(
            "GET",
            "organizations",
            {
                "id": "eq." + id,
                "select": "*",
            },
        ),
        "organization",
    )


def all_rows(client, table, params):
    rows = []
    offset = 0
    while True:
        page = client.table("GET", table, {**params, "limit": 1000, "offset": offset})
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += len(page)


def names_by_id(client, table, ids, fields):
    names = {}
    for start in range(0, len(ids), 100):
        chunk = ids[start : start + 100]
        rows = client.table(
            "GET",
            table,
            {
                "id": "in.(" + ",".join(chunk) + ")",
                "select": fields,
            },
        )
        names.update((item["id"], item) for item in rows)
    return names


def list_relationships(client, contact):
    id = contact["id"]
    rows = all_rows(
        client,
        "contact_relationships",
        {
            "owner_id": "eq." + contact["owner_id"],
            "or": f"(contact_id.eq.{id},related_contact_id.eq.{id})",
            "select": "id,contact_id,related_contact_id,relationship,inverse_relationship,notes,created_at",
            "order": "created_at.asc,id.asc",
        },
    )

    related_ids = list(
        dict.fromkeys(
            row["related_contact_id"] if row["contact_id"] == id else row["contact_id"]
            for row in rows
        )
    )
    names = names_by_id(client, "contacts", related_ids, "id,name,deleted_at")

    result = []
    for row in rows:
        forward = row["contact_id"] == id
        other_id = row["related_contact_id"] if forward else row["contact_id"]
        other = names.get(other_id, {})
        result.append(
            {
                "id": row["id"],
                "related_contact_id": other_id,
                "related_contact_name": other.get("name"),
                "related_contact_deleted": bool(other.get("deleted_at")),
                "relationship": row["relationship"]
                if forward
                else row["inverse_relationship"],
                "inverse_relationship": row["inverse_relationship"]
                if forward
                else row["relationship"],
                "notes": row["notes"],
                "created_at": row["created_at"],
            }
        )
    return result


def list_org_relationships(client, organization):
    id = organization["id"]
    rows = all_rows(
        client,
        "organization_relationships",
        {
            "owner_id": "eq." + organization["owner_id"],
            "or": f"(organization_id.eq.{id},related_organization_id.eq.{id})",
            "select": "id,organization_id,related_organization_id,relationship,inverse_relationship,notes,created_at",
            "order": "created_at.asc,id.asc",
        },
    )
    related_ids = list(
        dict.fromkeys(
            row["related_organization_id"]
            if row["organization_id"] == id
            else row["organization_id"]
            for row in rows
        )
    )
    names = names_by_id(client, "organizations", related_ids, "id,name,kind")
    result = []
    for row in rows:
        forward = row["organization_id"] == id
        other_id = row["related_organization_id"] if forward else row["organization_id"]
        other = names.get(other_id, {})
        result.append(
            {
                "id": row["id"],
                "related_organization_id": other_id,
                "related_organization_name": other.get("name"),
                "related_organization_kind": other.get("kind"),
                "relationship": row["relationship"]
                if forward
                else row["inverse_relationship"],
                "inverse_relationship": row["inverse_relationship"]
                if forward
                else row["relationship"],
                "notes": row["notes"],
                "created_at": row["created_at"],
            }
        )
    return result


def list_contact_organizations(client, contact):
    rows = all_rows(
        client,
        "contact_organization_relationships",
        {
            "owner_id": "eq." + contact["owner_id"],
            "contact_id": "eq." + contact["id"],
            "select": "id,organization_id,contact_relationship,organization_relationship,notes,created_at",
            "order": "created_at.asc,id.asc",
        },
    )
    names = names_by_id(
        client,
        "organizations",
        list(dict.fromkeys(row["organization_id"] for row in rows)),
        "id,name,kind",
    )
    return [
        {
            "id": row["id"],
            "organization_id": row["organization_id"],
            "organization_name": names.get(row["organization_id"], {}).get("name"),
            "organization_kind": names.get(row["organization_id"], {}).get("kind"),
            "relationship": row["contact_relationship"],
            "inverse_relationship": row["organization_relationship"],
            "notes": row["notes"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def list_organization_contacts(client, organization):
    rows = all_rows(
        client,
        "contact_organization_relationships",
        {
            "owner_id": "eq." + organization["owner_id"],
            "organization_id": "eq." + organization["id"],
            "select": "id,contact_id,contact_relationship,organization_relationship,notes,created_at",
            "order": "created_at.asc,id.asc",
        },
    )
    names = names_by_id(
        client,
        "contacts",
        list(dict.fromkeys(row["contact_id"] for row in rows)),
        "id,name,deleted_at",
    )
    return [
        {
            "id": row["id"],
            "contact_id": row["contact_id"],
            "contact_name": names.get(row["contact_id"], {}).get("name"),
            "contact_deleted": bool(names.get(row["contact_id"], {}).get("deleted_at")),
            "relationship": row["organization_relationship"],
            "inverse_relationship": row["contact_relationship"],
            "notes": row["notes"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def run(args, client):
    if args.command == "signup":
        result = client._request(
            "POST",
            "/auth/v1/signup",
            payload={
                "email": client.email,
                "password": client.password,
            },
        )
        return {
            "user_id": (result.get("user") or {}).get("id"),
            "confirmation_required": not bool(result.get("session")),
        }

    if args.command == "add":
        payload = {
            field: getattr(args, field)
            for field in FIELDS
            if getattr(args, field) is not None
        }
        return one(client.table("POST", "contacts", payload=payload), "contact")

    if args.command == "list":
        params = {
            "select": "id,owner_id,name,email,phone,company,title,info,created_at,updated_at",
            "deleted_at": "is.null",
            "order": "name.asc",
            "limit": args.limit,
            "offset": args.offset,
        }
        if args.search:
            params["name"] = f"ilike.*{args.search}*"
        return client.table("GET", "contacts", params)

    if args.command == "show":
        contact = get_contact(client, args.id)
        contact["history"] = client.table(
            "GET",
            "history",
            {
                "contact_id": "eq." + args.id,
                "select": "id,kind,body,happened_at,created_at",
                "order": "happened_at.desc",
                "limit": 100,
            },
        )
        contact["relationships"] = list_relationships(client, contact)
        contact["organizations"] = list_contact_organizations(client, contact)
        return contact

    if args.command == "relate":
        if args.id == args.related_id:
            raise CRMError("a contact cannot be related to itself")
        first = get_contact(client, args.id)
        second = get_contact(client, args.related_id)
        if first["owner_id"] != second["owner_id"]:
            raise CRMError("both contacts must have the same owner")
        inverse = args.inverse or INVERSE_RELATIONSHIPS.get(args.relationship.lower())
        if inverse is None:
            raise CRMError("provide --inverse for this relationship label")
        return one(
            client.table(
                "POST",
                "contact_relationships",
                payload={
                    "owner_id": first["owner_id"],
                    "contact_id": args.id,
                    "related_contact_id": args.related_id,
                    "relationship": args.relationship,
                    "inverse_relationship": inverse,
                    "notes": args.notes,
                },
            ),
            "relationship",
        )

    if args.command == "relations":
        return list_relationships(client, get_contact(client, args.id))

    if args.command == "unrelate":
        return one(
            client.table(
                "DELETE",
                "contact_relationships",
                {
                    "id": "eq." + args.id,
                },
            ),
            "relationship",
        )

    if args.command == "org-add":
        payload = {
            field: getattr(args, field)
            for field in ORG_FIELDS
            if getattr(args, field) is not None
        }
        return one(
            client.table("POST", "organizations", payload=payload), "organization"
        )

    if args.command == "org-list":
        params = {
            "select": "id,owner_id,name,kind,email,phone,website,address,info,created_at,updated_at",
            "order": "name.asc",
            "limit": args.limit,
            "offset": args.offset,
        }
        if args.search:
            params["name"] = f"ilike.*{args.search}*"
        return client.table("GET", "organizations", params)

    if args.command == "org-show":
        organization = get_organization(client, args.id)
        organization["relationships"] = list_org_relationships(client, organization)
        organization["contacts"] = list_organization_contacts(client, organization)
        return organization

    if args.command == "org-update":
        payload = {
            field: getattr(args, field)
            for field in ORG_FIELDS
            if getattr(args, field) is not None
        }
        for field in args.clear:
            payload[field] = None
        if not payload:
            raise CRMError("provide a field to update or --clear FIELD")
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        return one(
            client.table(
                "PATCH",
                "organizations",
                {
                    "id": "eq." + args.id,
                },
                payload,
            ),
            "organization",
        )

    if args.command == "org-relate":
        if args.id == args.related_id:
            raise CRMError("an organization cannot be related to itself")
        first = get_organization(client, args.id)
        second = get_organization(client, args.related_id)
        if first["owner_id"] != second["owner_id"]:
            raise CRMError("both organizations must have the same owner")
        inverse = args.inverse or ORG_INVERSE_RELATIONSHIPS.get(
            args.relationship.lower()
        )
        if inverse is None:
            raise CRMError("provide --inverse for this organization relationship")
        return one(
            client.table(
                "POST",
                "organization_relationships",
                payload={
                    "owner_id": first["owner_id"],
                    "organization_id": args.id,
                    "related_organization_id": args.related_id,
                    "relationship": args.relationship,
                    "inverse_relationship": inverse,
                    "notes": args.notes,
                },
            ),
            "organization relationship",
        )

    if args.command == "org-relations":
        return list_org_relationships(client, get_organization(client, args.id))

    if args.command == "org-unrelate":
        return one(
            client.table(
                "DELETE",
                "organization_relationships",
                {
                    "id": "eq." + args.id,
                },
            ),
            "organization relationship",
        )

    if args.command == "org-link-contact":
        organization = get_organization(client, args.id)
        contact = get_contact(client, args.contact_id)
        if organization["owner_id"] != contact["owner_id"]:
            raise CRMError("the organization and contact must have the same owner")
        return one(
            client.table(
                "POST",
                "contact_organization_relationships",
                payload={
                    "owner_id": organization["owner_id"],
                    "organization_id": args.id,
                    "contact_id": args.contact_id,
                    "organization_relationship": args.relationship,
                    "contact_relationship": args.inverse,
                    "notes": args.notes,
                },
            ),
            "contact organization relationship",
        )

    if args.command == "org-contacts":
        return list_organization_contacts(client, get_organization(client, args.id))

    if args.command == "contact-orgs":
        return list_contact_organizations(client, get_contact(client, args.id))

    if args.command == "org-unlink-contact":
        return one(
            client.table(
                "DELETE",
                "contact_organization_relationships",
                {
                    "id": "eq." + args.id,
                },
            ),
            "contact organization relationship",
        )

    if args.command == "update":
        payload = {
            field: getattr(args, field)
            for field in FIELDS
            if getattr(args, field) is not None
        }
        for field in args.clear:
            payload[field] = None
        if not payload:
            raise CRMError("provide a field to update or --clear FIELD")
        if payload.get("name") is None and "name" in payload:
            raise CRMError("name cannot be cleared")
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        return one(
            client.table(
                "PATCH",
                "contacts",
                {"id": "eq." + args.id, "deleted_at": "is.null"},
                payload,
            ),
            "contact",
        )

    if args.command in ("note", "log"):
        # Admins can write history on another user's contact; the composite FK
        # requires its owner's ID on each history entry.
        contact = one(
            client.table(
                "GET",
                "contacts",
                {
                    "id": "eq." + args.id,
                    "deleted_at": "is.null",
                    "select": "id,owner_id",
                },
            ),
            "contact",
        )
        payload = {
            "contact_id": args.id,
            "kind": "note" if args.command == "note" else args.kind,
            "body": args.body,
            "owner_id": contact["owner_id"],
        }
        if args.at:
            payload["happened_at"] = args.at
        return one(client.table("POST", "history", payload=payload), "history entry")

    if args.command == "history":
        one(
            client.table(
                "GET",
                "contacts",
                {"id": "eq." + args.id, "deleted_at": "is.null", "select": "id"},
            ),
            "contact",
        )
        return client.table(
            "GET",
            "history",
            {
                "contact_id": "eq." + args.id,
                "select": "id,kind,body,happened_at,created_at",
                "order": "happened_at.desc",
                "limit": args.limit,
                "offset": args.offset,
            },
        )
    raise CRMError("unknown command")


app = typer.Typer(
    help="Supabase CRM; all command results are JSON",
    add_completion=False,
    context_settings={"help_option_names": ["-h", "--help"]},
)


def execute(command, **values):
    values = {
        key: str(value) if isinstance(value, UUID) else value
        for key, value in values.items()
    }
    args = SimpleNamespace(command=command, **values)
    try:
        result = run(args, Client(sign_in=command != "signup"))
    except CRMError as exc:
        typer.echo(json.dumps({"error": str(exc)}), err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(json.dumps(result, indent=2, ensure_ascii=False))


@app.command("signup", help="Create a Supabase Auth user; confirm email if required")
def signup():
    execute("signup")


@app.command("add", help="Create a contact")
def add(
    name: str = typer.Option(..., callback=nonempty),
    email: str | None = None,
    phone: str | None = None,
    company: str | None = None,
    title: str | None = None,
    info: str | None = None,
):
    execute(
        "add",
        name=name,
        email=email,
        phone=phone,
        company=company,
        title=title,
        info=info,
    )


@app.command("list", help="List contacts")
def list_contacts(
    search: str | None = typer.Option(None, help="Case-insensitive name search"),
    limit: int = typer.Option(50, min=1, max=100),
    offset: int = typer.Option(0, min=0),
):
    execute("list", search=search, limit=limit, offset=offset)


@app.command(
    "show", help="Show a contact, its relationships, and latest 100 history entries"
)
def show(id: UUID):
    execute("show", id=id)


@app.command("relate", help="Link two contacts with labels in both directions")
def relate(
    id: UUID,
    related_id: UUID,
    relationship: str = typer.Option(..., "--as", callback=relationship_label),
    inverse: str | None = typer.Option(None, callback=relationship_label),
    notes: str | None = typer.Option(None, callback=nonempty),
):
    execute(
        "relate",
        id=id,
        related_id=related_id,
        relationship=relationship,
        inverse=inverse,
        notes=notes,
    )


@app.command("relations", help="List a contact's relationships")
def relations(id: UUID):
    execute("relations", id=id)


@app.command("unrelate", help="Remove a relationship by UUID")
def unrelate(id: UUID):
    execute("unrelate", id=id)


@app.command("org-add", help="Create an organization")
def org_add(
    name: str = typer.Option(..., callback=nonempty),
    kind: str | None = typer.Option(
        None,
        callback=relationship_label,
        help="Business, department, agency, club, or another type",
    ),
    email: str | None = None,
    phone: str | None = None,
    website: str | None = None,
    address: str | None = None,
    info: str | None = None,
):
    execute(
        "org-add",
        name=name,
        kind=kind,
        email=email,
        phone=phone,
        website=website,
        address=address,
        info=info,
    )


@app.command("org-list", help="List organizations")
def org_list(
    search: str | None = typer.Option(None, help="Case-insensitive name search"),
    limit: int = typer.Option(50, min=1, max=100),
    offset: int = typer.Option(0, min=0),
):
    execute("org-list", search=search, limit=limit, offset=offset)


@app.command(
    "org-show", help="Show an organization, its contacts, and related organizations"
)
def org_show(id: UUID):
    execute("org-show", id=id)


@app.command("org-update", help="Change an organization")
def org_update(
    id: UUID,
    name: str | None = typer.Option(None, callback=nonempty),
    kind: str | None = typer.Option(None, callback=relationship_label),
    email: str | None = None,
    phone: str | None = None,
    website: str | None = None,
    address: str | None = None,
    info: str | None = None,
    clear: Annotated[
        list[str] | None, typer.Option(callback=organization_clear)
    ] = None,
):
    execute(
        "org-update",
        id=id,
        name=name,
        kind=kind,
        email=email,
        phone=phone,
        website=website,
        address=address,
        info=info,
        clear=clear or [],
    )


@app.command("org-relate", help="Link two organizations")
def org_relate(
    id: UUID,
    related_id: UUID,
    relationship: str = typer.Option(..., "--as", callback=relationship_label),
    inverse: str | None = typer.Option(None, callback=relationship_label),
    notes: str | None = typer.Option(None, callback=nonempty),
):
    execute(
        "org-relate",
        id=id,
        related_id=related_id,
        relationship=relationship,
        inverse=inverse,
        notes=notes,
    )


@app.command("org-relations", help="List an organization's relationships")
def org_relations(id: UUID):
    execute("org-relations", id=id)


@app.command("org-unrelate", help="Remove an organization relationship")
def org_unrelate(id: UUID):
    execute("org-unrelate", id=id)


@app.command("org-link-contact", help="Link an organization and a contact")
def org_link_contact(
    id: UUID,
    contact_id: UUID,
    relationship: str = typer.Option(
        ...,
        "--as",
        callback=relationship_label,
        help="Organization's relationship to contact",
    ),
    inverse: str = typer.Option(
        ..., callback=relationship_label, help="Contact's relationship to organization"
    ),
    notes: str | None = typer.Option(None, callback=nonempty),
):
    execute(
        "org-link-contact",
        id=id,
        contact_id=contact_id,
        relationship=relationship,
        inverse=inverse,
        notes=notes,
    )


@app.command("org-contacts", help="List an organization's contacts")
def org_contacts(id: UUID):
    execute("org-contacts", id=id)


@app.command("contact-orgs", help="List a contact's organizations")
def contact_orgs(id: UUID):
    execute("contact-orgs", id=id)


@app.command("org-unlink-contact", help="Remove a contact organization link")
def org_unlink_contact(id: UUID):
    execute("org-unlink-contact", id=id)


@app.command("update", help="Change a contact")
def update(
    id: UUID,
    name: str | None = typer.Option(None, callback=nonempty),
    email: str | None = None,
    phone: str | None = None,
    company: str | None = None,
    title: str | None = None,
    info: str | None = None,
    clear: Annotated[list[str] | None, typer.Option(callback=contact_clear)] = None,
):
    execute(
        "update",
        id=id,
        name=name,
        email=email,
        phone=phone,
        company=company,
        title=title,
        info=info,
        clear=clear or [],
    )


@app.command("note", help="Add a note")
def note(
    id: UUID,
    body: str = typer.Option(..., callback=nonempty),
    at: str | None = typer.Option(
        None, callback=timestamp, help="Event time in ISO 8601 with timezone"
    ),
):
    execute("note", id=id, body=body, at=at)


@app.command("log", help="Record a call, email, meeting, or other event")
def log(
    id: UUID,
    kind: str = typer.Option(..., callback=history_kind),
    body: str = typer.Option(..., callback=nonempty),
    at: str | None = typer.Option(None, callback=timestamp),
):
    execute("log", id=id, kind=kind, body=body, at=at)


@app.command("history", help="List a contact's history")
def history(
    id: UUID,
    limit: int = typer.Option(50, min=1, max=100),
    offset: int = typer.Option(0, min=0),
):
    execute("history", id=id, limit=limit, offset=offset)


def main():
    app()


if __name__ == "__main__":
    main()
