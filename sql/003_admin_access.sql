-- CRM administrators are assigned through Auth app_metadata.crm_role.
-- Supabase Auth users cannot edit their own app_metadata.
create policy "Admins can read contacts" on public.contacts
  for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin');

create policy "Admins can update contacts" on public.contacts
  for update to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin');

create policy "Admins can read history" on public.history
  for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin');

create policy "Admins can add history" on public.history
  for insert to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin');

-- No API caller should be able to transfer ownership through PATCH.
revoke update on public.contacts from authenticated;
grant update (name, email, phone, company, title, info, updated_at)
  on public.contacts to authenticated;
