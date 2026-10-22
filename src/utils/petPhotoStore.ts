import { getItem, setItem } from '../services/localDB';

const KEY = '@pet_photos';

async function getAll(): Promise<Record<string, string>> {
  const raw = await getItem(KEY);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

export async function getPhoto(petId: string): Promise<string | null> {
  const map = await getAll();
  return map[petId] ?? null;
}

export async function savePhoto(petId: string, uri: string): Promise<void> {
  const map = await getAll();
  map[petId] = uri;
  await setItem(KEY, JSON.stringify(map));
}

export async function removePhoto(petId: string): Promise<void> {
  const map = await getAll();
  delete map[petId];
  await setItem(KEY, JSON.stringify(map));
}
