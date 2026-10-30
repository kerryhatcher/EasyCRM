-- The project already had this event-trigger function. It should not be an API RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
