SELECT setval(
  pg_get_serial_sequence('public.users', 'id'),
  COALESCE((SELECT MAX(id)::bigint FROM public.users), 0),
  true
);
