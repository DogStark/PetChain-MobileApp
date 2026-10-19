export type PackingCategory = 'food' | 'records' | 'medication' | 'equipment';

export const PACKING_CATEGORIES: PackingCategory[] = [
  'food',
  'records',
  'medication',
  'equipment',
];

export type SyncStatus = 'synced' | 'pending' | 'error';

export interface PackingItem {
  id: string;
  label: string;
  checked: boolean;
  editable: boolean;
  notes?: string;
}

export type PackingItemsByCategory = Record<PackingCategory, PackingItem[]>;

export interface PackingChecklist {
  id: string;
  petId: string;
  tripId: string;
  tripName: string;
  items: PackingItemsByCategory;
  updatedAt: string;
  syncStatus: SyncStatus;
}

export interface CategoryProgress {
  checked: number;
  total: number;
}

export interface ProgressSummary {
  byCategory: Record<PackingCategory, CategoryProgress>;
  overall: CategoryProgress;
}

export interface PackingTemplateItem {
  label: string;
  notes?: string;
}

export type PackingTemplate = Record<PackingCategory, PackingTemplateItem[]>;

export const DEFAULT_PACKING_TEMPLATE: PackingTemplate = {
  food: [
    { label: 'Pet food (enough for the trip)', notes: 'Pack extra in case of delays' },
    { label: 'Food & water bowls' },
    { label: 'Treats' },
    { label: 'Bottled water' },
  ],
  records: [
    { label: 'Vaccination records' },
    { label: 'ID tags & microchip info' },
    { label: 'Travel health certificate' },
    { label: 'Vet contact information' },
  ],
  medication: [
    { label: 'Prescription medications', notes: 'Include dosage instructions' },
    { label: 'Flea & tick treatment' },
    { label: 'First-aid kit' },
  ],
  equipment: [
    { label: 'Leash & collar/harness' },
    { label: 'Carrier or crate' },
    { label: 'Bedding & blanket' },
    { label: 'Waste bags' },
    { label: 'Favorite toy' },
  ],
};

let idCounter = 0;

function generateId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${random}`;
}

function emptyItemsByCategory(): PackingItemsByCategory {
  return {
    food: [],
    records: [],
    medication: [],
    equipment: [],
  };
}

function cloneItems(items: PackingItemsByCategory): PackingItemsByCategory {
  const next = emptyItemsByCategory();
  for (const category of PACKING_CATEGORIES) {
    next[category] = items[category].map((item) => ({ ...item }));
  }
  return next;
}

function touch(checklist: PackingChecklist, items: PackingItemsByCategory): PackingChecklist {
  return {
    ...checklist,
    items,
    updatedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };
}

export function createChecklistFromTemplate(
  petId: string,
  tripId: string,
  tripName: string,
  template: PackingTemplate = DEFAULT_PACKING_TEMPLATE,
): PackingChecklist {
  const items = emptyItemsByCategory();
  for (const category of PACKING_CATEGORIES) {
    items[category] = template[category].map((templateItem) => ({
      id: generateId('item'),
      label: templateItem.label,
      checked: false,
      editable: true,
      ...(templateItem.notes !== undefined ? { notes: templateItem.notes } : {}),
    }));
  }

  return {
    id: generateId('checklist'),
    petId,
    tripId,
    tripName,
    items,
    updatedAt: new Date().toISOString(),
    syncStatus: 'pending',
  };
}

export function toggleItem(checklist: PackingChecklist, itemId: string): PackingChecklist {
  const items = cloneItems(checklist.items);
  let found = false;
  for (const category of PACKING_CATEGORIES) {
    const item = items[category].find((candidate) => candidate.id === itemId);
    if (item) {
      item.checked = !item.checked;
      found = true;
      break;
    }
  }
  if (!found) {
    return checklist;
  }
  return touch(checklist, items);
}

export function addItem(
  checklist: PackingChecklist,
  category: PackingCategory,
  label: string,
): PackingChecklist {
  const trimmed = label.trim();
  if (!trimmed) {
    return checklist;
  }
  const items = cloneItems(checklist.items);
  items[category].push({
    id: generateId('item'),
    label: trimmed,
    checked: false,
    editable: true,
  });
  return touch(checklist, items);
}

export function removeItem(checklist: PackingChecklist, itemId: string): PackingChecklist {
  const items = cloneItems(checklist.items);
  let found = false;
  for (const category of PACKING_CATEGORIES) {
    const index = items[category].findIndex((candidate) => candidate.id === itemId);
    if (index !== -1) {
      items[category].splice(index, 1);
      found = true;
      break;
    }
  }
  if (!found) {
    return checklist;
  }
  return touch(checklist, items);
}

export function renameItem(
  checklist: PackingChecklist,
  itemId: string,
  label: string,
): PackingChecklist {
  const trimmed = label.trim();
  if (!trimmed) {
    return checklist;
  }
  const items = cloneItems(checklist.items);
  let found = false;
  for (const category of PACKING_CATEGORIES) {
    const item = items[category].find((candidate) => candidate.id === itemId);
    if (item) {
      if (!item.editable) {
        return checklist;
      }
      item.label = trimmed;
      found = true;
      break;
    }
  }
  if (!found) {
    return checklist;
  }
  return touch(checklist, items);
}

export function progressSummary(checklist: PackingChecklist): ProgressSummary {
  const byCategory = {} as Record<PackingCategory, CategoryProgress>;
  let overallChecked = 0;
  let overallTotal = 0;

  for (const category of PACKING_CATEGORIES) {
    const list = checklist.items[category];
    const checked = list.filter((item) => item.checked).length;
    byCategory[category] = { checked, total: list.length };
    overallChecked += checked;
    overallTotal += list.length;
  }

  return {
    byCategory,
    overall: { checked: overallChecked, total: overallTotal },
  };
}