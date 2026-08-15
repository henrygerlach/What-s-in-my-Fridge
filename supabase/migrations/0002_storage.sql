insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', true);

create policy "recipe_photos_public_read" on storage.objects for select
  using (bucket_id = 'recipe-photos');

create policy "recipe_photos_public_write" on storage.objects for insert
  with check (bucket_id = 'recipe-photos');
