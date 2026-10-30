import { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "./database.types.ts";

type Client = SupabaseClient<Database>;
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type Organization = Database["public"]["Tables"]["organizations"]["Row"];

const uuid = z.uuid();
const label = z.string().trim().min(1).max(80);
const text = z.string().trim().min(1);
const optionalText = z.string().nullable().optional();
const page = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
};
const contactFields =
  "id,owner_id,name,email,phone,company,title,info,created_at,updated_at";
const organizationFields =
  "id,owner_id,name,kind,email,phone,website,address,info,created_at,updated_at";

const inverseContacts: Record<string, string> = {
  married: "married",
  spouse: "spouse",
  partner: "partner",
  friend: "friend",
  sibling: "sibling",
  colleague: "colleague",
  parent: "child",
  father: "child",
  mother: "child",
  child: "parent",
  son: "parent",
  daughter: "parent",
};
const inverseOrganizations: Record<string, string> = {
  partner: "partner",
  affiliate: "affiliate",
  peer: "peer",
};

async function unwrap<T>(
  operation: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await operation;
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Record not found or inaccessible");
  return data as NonNullable<T>;
}

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

async function runTool(work: () => Promise<unknown>) {
  try {
    return toolResult(await work());
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : "Unexpected error",
      }],
    };
  }
}

async function contact(client: Client, id: string): Promise<Contact> {
  const row = await unwrap(
    client.from("contacts").select("*").eq("id", id).is("deleted_at", null)
      .maybeSingle(),
  );
  if (!row) throw new Error("Contact not found or inaccessible");
  return row;
}

async function organization(client: Client, id: string): Promise<Organization> {
  const row = await unwrap(
    client.from("organizations").select("*").eq("id", id).maybeSingle(),
  );
  if (!row) throw new Error("Organization not found or inaccessible");
  return row;
}

async function contactLinks(client: Client, row: Contact) {
  const links = await unwrap(
    client.from("contact_relationships")
      .select(
        "id,contact_id,related_contact_id,relationship,inverse_relationship,notes,created_at",
      )
      .eq("owner_id", row.owner_id)
      .or(`contact_id.eq.${row.id},related_contact_id.eq.${row.id}`)
      .order("created_at", { ascending: true }),
  );
  const ids = [
    ...new Set(
      links.map((link) =>
        link.contact_id === row.id ? link.related_contact_id : link.contact_id
      ),
    ),
  ];
  const others = ids.length
    ? await unwrap(
      client.from("contacts").select("id,name,deleted_at").in("id", ids),
    )
    : [];
  const names = new Map(others.map((other) => [other.id, other]));
  return links.map((link) => {
    const forward = link.contact_id === row.id;
    const otherId = forward ? link.related_contact_id : link.contact_id;
    const other = names.get(otherId);
    return {
      id: link.id,
      related_contact_id: otherId,
      related_contact_name: other?.name ?? null,
      related_contact_deleted: Boolean(other?.deleted_at),
      relationship: forward ? link.relationship : link.inverse_relationship,
      inverse_relationship: forward
        ? link.inverse_relationship
        : link.relationship,
      notes: link.notes,
      created_at: link.created_at,
    };
  });
}

async function organizationLinks(client: Client, row: Organization) {
  const links = await unwrap(
    client.from("organization_relationships")
      .select(
        "id,organization_id,related_organization_id,relationship,inverse_relationship,notes,created_at",
      )
      .eq("owner_id", row.owner_id)
      .or(`organization_id.eq.${row.id},related_organization_id.eq.${row.id}`)
      .order("created_at", { ascending: true }),
  );
  const ids = [
    ...new Set(
      links.map((link) =>
        link.organization_id === row.id
          ? link.related_organization_id
          : link.organization_id
      ),
    ),
  ];
  const others = ids.length
    ? await unwrap(
      client.from("organizations").select("id,name,kind").in("id", ids),
    )
    : [];
  const names = new Map(others.map((other) => [other.id, other]));
  return links.map((link) => {
    const forward = link.organization_id === row.id;
    const otherId = forward
      ? link.related_organization_id
      : link.organization_id;
    const other = names.get(otherId);
    return {
      id: link.id,
      related_organization_id: otherId,
      related_organization_name: other?.name ?? null,
      related_organization_kind: other?.kind ?? null,
      relationship: forward ? link.relationship : link.inverse_relationship,
      inverse_relationship: forward
        ? link.inverse_relationship
        : link.relationship,
      notes: link.notes,
      created_at: link.created_at,
    };
  });
}

async function contactOrganizations(client: Client, row: Contact) {
  const links = await unwrap(
    client.from("contact_organization_relationships")
      .select(
        "id,organization_id,contact_relationship,organization_relationship,notes,created_at",
      )
      .eq("owner_id", row.owner_id).eq("contact_id", row.id)
      .order("created_at", { ascending: true }),
  );
  const ids = [...new Set(links.map((link) => link.organization_id))];
  const others = ids.length
    ? await unwrap(
      client.from("organizations").select("id,name,kind").in("id", ids),
    )
    : [];
  const names = new Map(others.map((other) => [other.id, other]));
  return links.map((link) => ({
    id: link.id,
    organization_id: link.organization_id,
    organization_name: names.get(link.organization_id)?.name ?? null,
    organization_kind: names.get(link.organization_id)?.kind ?? null,
    relationship: link.contact_relationship,
    inverse_relationship: link.organization_relationship,
    notes: link.notes,
    created_at: link.created_at,
  }));
}

async function organizationContacts(client: Client, row: Organization) {
  const links = await unwrap(
    client.from("contact_organization_relationships")
      .select(
        "id,contact_id,contact_relationship,organization_relationship,notes,created_at",
      )
      .eq("owner_id", row.owner_id).eq("organization_id", row.id)
      .order("created_at", { ascending: true }),
  );
  const ids = [...new Set(links.map((link) => link.contact_id))];
  const others = ids.length
    ? await unwrap(
      client.from("contacts").select("id,name,deleted_at").in("id", ids),
    )
    : [];
  const names = new Map(others.map((other) => [other.id, other]));
  return links.map((link) => ({
    id: link.id,
    contact_id: link.contact_id,
    contact_name: names.get(link.contact_id)?.name ?? null,
    contact_deleted: Boolean(names.get(link.contact_id)?.deleted_at),
    relationship: link.organization_relationship,
    inverse_relationship: link.contact_relationship,
    notes: link.notes,
    created_at: link.created_at,
  }));
}

export function buildServer(client: Client) {
  const server = new McpServer({ name: "easycrm", version: "0.1.0" });

  server.registerTool("list_contacts", {
    description: "List visible contacts, optionally searching by name",
    inputSchema: z.object({ search: z.string().optional(), ...page }),
    annotations: { readOnlyHint: true },
  }, ({ search, limit, offset }) =>
    runTool(async () => {
      let query = client.from("contacts").select(contactFields)
        .is("deleted_at", null).order("name").range(offset, offset + limit - 1);
      if (search) query = query.ilike("name", `%${search}%`);
      return await unwrap(query);
    }));

  server.registerTool("get_contact", {
    description:
      "Get a contact with its history, people relationships, and organizations",
    inputSchema: z.object({ id: uuid }),
    annotations: { readOnlyHint: true },
  }, ({ id }) =>
    runTool(async () => {
      const row = await contact(client, id);
      const [history, relationships, organizations] = await Promise.all([
        unwrap(
          client.from("history").select("id,kind,body,happened_at,created_at")
            .eq("contact_id", id).order("happened_at", { ascending: false })
            .limit(100),
        ),
        contactLinks(client, row),
        contactOrganizations(client, row),
      ]);
      return { ...row, history, relationships, organizations };
    }));

  server.registerTool("create_contact", {
    description: "Create a contact owned by the signed-in user",
    inputSchema: z.object({
      name: text,
      email: optionalText,
      phone: optionalText,
      company: optionalText,
      title: optionalText,
      info: optionalText,
    }),
  }, (values) =>
    runTool(() => {
      const id = crypto.randomUUID();
      return unwrap(
        client.from("contacts").insert({ ...values, id, carddav_uid: id })
          .select(contactFields).single(),
      );
    }));

  server.registerTool("update_contact", {
    description:
      "Update fields on an existing contact; use null to clear optional fields",
    inputSchema: z.object({
      id: uuid,
      name: text.optional(),
      email: optionalText,
      phone: optionalText,
      company: optionalText,
      title: optionalText,
      info: optionalText,
    }),
  }, ({ id, ...changes }) =>
    runTool(async () => {
      if (!Object.keys(changes).length) {
        throw new Error("Provide at least one field to update");
      }
      return await unwrap(
        client.from("contacts")
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq("id", id).is("deleted_at", null).select(contactFields)
          .maybeSingle(),
      );
    }));

  server.registerTool("list_history", {
    description: "List a contact's notes, calls, emails, and meetings",
    inputSchema: z.object({ contact_id: uuid, ...page }),
    annotations: { readOnlyHint: true },
  }, ({ contact_id, limit, offset }) =>
    runTool(async () => {
      await contact(client, contact_id);
      return await unwrap(
        client.from("history").select("id,kind,body,happened_at,created_at")
          .eq("contact_id", contact_id).order("happened_at", {
            ascending: false,
          })
          .range(offset, offset + limit - 1),
      );
    }));

  server.registerTool("add_history", {
    description:
      "Record a note, call, email, meeting, or other event for a contact",
    inputSchema: z.object({
      contact_id: uuid,
      kind: z.enum(["note", "call", "email", "meeting", "other"]),
      body: text,
      happened_at: z.iso.datetime({ offset: true }).optional(),
    }),
  }, ({ contact_id, ...values }) =>
    runTool(async () => {
      const row = await contact(client, contact_id);
      return await unwrap(
        client.from("history")
          .insert({ contact_id, owner_id: row.owner_id, ...values })
          .select("id,contact_id,kind,body,happened_at,created_at").single(),
      );
    }));

  server.registerTool(
    "list_contact_relationships",
    {
      description: "List a contact's relationships to other people",
      inputSchema: z.object({ contact_id: uuid }),
      annotations: { readOnlyHint: true },
    },
    ({ contact_id }) =>
      runTool(async () =>
        contactLinks(client, await contact(client, contact_id))
      ),
  );

  server.registerTool(
    "link_contacts",
    {
      description:
        "Relate two contacts with labels from each person's point of view",
      inputSchema: z.object({
        contact_id: uuid,
        related_contact_id: uuid,
        relationship: label,
        inverse_relationship: label.optional(),
        notes: optionalText,
      }),
    },
    (
      {
        contact_id,
        related_contact_id,
        relationship,
        inverse_relationship,
        notes,
      },
    ) =>
      runTool(async () => {
        if (contact_id === related_contact_id) {
          throw new Error("A contact cannot be related to itself");
        }
        const [first, second] = await Promise.all([
          contact(client, contact_id),
          contact(client, related_contact_id),
        ]);
        if (first.owner_id !== second.owner_id) {
          throw new Error("Both contacts must have the same owner");
        }
        const inverse = inverse_relationship ??
          inverseContacts[relationship.toLowerCase()];
        if (!inverse) {
          throw new Error("Provide inverse_relationship for this label");
        }
        return await unwrap(
          client.from("contact_relationships")
            .insert({
              owner_id: first.owner_id,
              contact_id,
              related_contact_id,
              relationship,
              inverse_relationship: inverse,
              notes,
            })
            .select().single(),
        );
      }),
  );

  server.registerTool("unlink_contacts", {
    description: "Remove a person-to-person relationship by link ID",
    inputSchema: z.object({ id: uuid }),
    annotations: { destructiveHint: true },
  }, ({ id }) =>
    runTool(() =>
      unwrap(
        client.from("contact_relationships")
          .delete().eq("id", id).select().maybeSingle(),
      )
    ));

  server.registerTool("list_organizations", {
    description: "List visible organizations, optionally searching by name",
    inputSchema: z.object({ search: z.string().optional(), ...page }),
    annotations: { readOnlyHint: true },
  }, ({ search, limit, offset }) =>
    runTool(async () => {
      let query = client.from("organizations").select(organizationFields)
        .order("name").range(offset, offset + limit - 1);
      if (search) query = query.ilike("name", `%${search}%`);
      return await unwrap(query);
    }));

  server.registerTool("get_organization", {
    description: "Get an organization with related organizations and people",
    inputSchema: z.object({ id: uuid }),
    annotations: { readOnlyHint: true },
  }, ({ id }) =>
    runTool(async () => {
      const row = await organization(client, id);
      const [relationships, contacts] = await Promise.all([
        organizationLinks(client, row),
        organizationContacts(client, row),
      ]);
      return { ...row, relationships, contacts };
    }));

  server.registerTool("create_organization", {
    description: "Create an organization owned by the signed-in user",
    inputSchema: z.object({
      name: text,
      kind: label.default("other"),
      email: optionalText,
      phone: optionalText,
      website: optionalText,
      address: optionalText,
      info: optionalText,
    }),
  }, (values) =>
    runTool(() =>
      unwrap(
        client.from("organizations")
          .insert(values).select(organizationFields).single(),
      )
    ));

  server.registerTool("update_organization", {
    description:
      "Update an organization; use null to clear optional contact fields",
    inputSchema: z.object({
      id: uuid,
      name: text.optional(),
      kind: label.optional(),
      email: optionalText,
      phone: optionalText,
      website: optionalText,
      address: optionalText,
      info: optionalText,
    }),
  }, ({ id, ...changes }) =>
    runTool(async () => {
      if (!Object.keys(changes).length) {
        throw new Error("Provide at least one field to update");
      }
      return await unwrap(
        client.from("organizations")
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq("id", id).select(organizationFields).maybeSingle(),
      );
    }));

  server.registerTool(
    "list_organization_relationships",
    {
      description:
        "List relationships between this organization and other organizations",
      inputSchema: z.object({ organization_id: uuid }),
      annotations: { readOnlyHint: true },
    },
    ({ organization_id }) =>
      runTool(async () =>
        organizationLinks(client, await organization(client, organization_id))
      ),
  );

  server.registerTool(
    "link_organizations",
    {
      description: "Relate two organizations with labels in both directions",
      inputSchema: z.object({
        organization_id: uuid,
        related_organization_id: uuid,
        relationship: label,
        inverse_relationship: label.optional(),
        notes: optionalText,
      }),
    },
    (
      {
        organization_id,
        related_organization_id,
        relationship,
        inverse_relationship,
        notes,
      },
    ) =>
      runTool(async () => {
        if (organization_id === related_organization_id) {
          throw new Error("An organization cannot relate to itself");
        }
        const [first, second] = await Promise.all([
          organization(client, organization_id),
          organization(client, related_organization_id),
        ]);
        if (first.owner_id !== second.owner_id) {
          throw new Error("Both organizations must have the same owner");
        }
        const inverse = inverse_relationship ??
          inverseOrganizations[relationship.toLowerCase()];
        if (!inverse) {
          throw new Error("Provide inverse_relationship for this label");
        }
        return await unwrap(
          client.from("organization_relationships")
            .insert({
              owner_id: first.owner_id,
              organization_id,
              related_organization_id,
              relationship,
              inverse_relationship: inverse,
              notes,
            })
            .select().single(),
        );
      }),
  );

  server.registerTool("unlink_organizations", {
    description:
      "Remove an organization-to-organization relationship by link ID",
    inputSchema: z.object({ id: uuid }),
    annotations: { destructiveHint: true },
  }, ({ id }) =>
    runTool(() =>
      unwrap(
        client.from("organization_relationships")
          .delete().eq("id", id).select().maybeSingle(),
      )
    ));

  server.registerTool(
    "list_contact_organizations",
    {
      description: "List an individual contact's organization relationships",
      inputSchema: z.object({ contact_id: uuid }),
      annotations: { readOnlyHint: true },
    },
    ({ contact_id }) =>
      runTool(async () =>
        contactOrganizations(client, await contact(client, contact_id))
      ),
  );

  server.registerTool(
    "list_organization_contacts",
    {
      description: "List an organization's people relationships",
      inputSchema: z.object({ organization_id: uuid }),
      annotations: { readOnlyHint: true },
    },
    ({ organization_id }) =>
      runTool(async () =>
        organizationContacts(
          client,
          await organization(client, organization_id),
        )
      ),
  );

  server.registerTool(
    "link_contact_organization",
    {
      description:
        "Link a person and organization with a label from each point of view",
      inputSchema: z.object({
        contact_id: uuid,
        organization_id: uuid,
        contact_relationship: label,
        organization_relationship: label,
        notes: optionalText,
      }),
    },
    (
      {
        contact_id,
        organization_id,
        contact_relationship,
        organization_relationship,
        notes,
      },
    ) =>
      runTool(async () => {
        const [person, org] = await Promise.all([
          contact(client, contact_id),
          organization(client, organization_id),
        ]);
        if (person.owner_id !== org.owner_id) {
          throw new Error("Contact and organization must have the same owner");
        }
        return await unwrap(
          client.from("contact_organization_relationships")
            .insert({
              owner_id: person.owner_id,
              contact_id,
              organization_id,
              contact_relationship,
              organization_relationship,
              notes,
            })
            .select().single(),
        );
      }),
  );

  server.registerTool(
    "unlink_contact_organization",
    {
      description: "Remove a contact-to-organization relationship by link ID",
      inputSchema: z.object({ id: uuid }),
      annotations: { destructiveHint: true },
    },
    ({ id }) =>
      runTool(() =>
        unwrap(
          client.from("contact_organization_relationships")
            .delete().eq("id", id).select().maybeSingle(),
        )
      ),
  );

  return server;
}
