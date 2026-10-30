# EasyCRM product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro static site on Cloudflare Workers, requested by the user. Supabase is the existing data and authentication backend.

## Users

One person managing their own contacts and organizations. The existing database also supports an admin role with access to other owners' records.

## Product Purpose

EasyCRM stores contact details, organizations, relationships, and a dated history of notes, calls, emails, and meetings. The web interface should make these records easy to find, maintain, and review.

## Operating Context

The current interface is a Python CLI. A Supabase Auth account signs users in, and row level security scopes data. A CardDAV endpoint syncs contact fields with phones. An MCP endpoint exposes the CRM to agents.

## Capabilities and Constraints

- Contacts: create, search, view, update, and link to people and organizations.
- Organizations: create, search, view, update, and link to contacts or other organizations.
- History: append notes, calls, emails, meetings, and other events to a contact. History is append only.
- The static frontend must use the public Supabase key only. No service role credential belongs in browser code.
- Contact deletion exists for CardDAV as a soft delete; the CLI has no contact delete command.
- The first release prioritizes finding and updating contacts, confirmed by the user.

## Evidence on Hand

The source of truth is `README.md`, the SQL migrations in `sql/`, and the existing CLI and Supabase functions. No customer testimonials, product metrics, or marketing claims were supplied.

## Product Principles

- Keep a person's details and history easy to scan.
- Make common record changes direct and reversible where the data model allows.
- Preserve the existing authorization rules and terminology.
