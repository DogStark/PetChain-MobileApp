import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import type { Medication } from '../models/Medication';

export type { Medication };

export interface DoseLog {
  id: string;
  medicationId: string;
  takenAt: string; // ISO string
  skipped?: boolean;
  notes?: string;
}

const MEDICATIONS_KEY = '@medications';
const DOSE_LOGS_KEY = '@dose_logs';

export async function getMedications(): Promise<Medication[]> {
  const raw = await AsyncStorage.getItem(MEDICATIONS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveMedication(med: Medication): Promise<void> {
  const meds = await getMedications();
  const idx = meds.findIndex((m) => m.id === med.id);
  if (idx >= 0) meds[idx] = med;
  else meds.push(med);
  await AsyncStorage.setItem(MEDICATIONS_KEY, JSON.stringify(meds));
}

export async function deleteMedication(id: string): Promise<void> {
  const meds = await getMedications();
  await AsyncStorage.setItem(MEDICATIONS_KEY, JSON.stringify(meds.filter((m) => m.id !== id)));
}

export async function getDoseLogs(): Promise<DoseLog[]> {
  const raw = await AsyncStorage.getItem(DOSE_LOGS_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function logDose(log: DoseLog): Promise<void> {
  const logs = await getDoseLogs();
  logs.push(log);
  await AsyncStorage.setItem(DOSE_LOGS_KEY, JSON.stringify(logs));
}

export function getMedicationEndDate(med: Medication): Date | null {
  if (!med.endDate) return null;
  const end = new Date(med.endDate);
  return Number.isNaN(end.getTime()) ? null : end;
}

export function isMedicationActive(med: Medication, date = new Date()): boolean {
  const now = date;
  const start = new Date(med.startDate);
  if (Number.isNaN(start.getTime()) || now < start) return false;
  const end = getMedicationEndDate(med);
  if (end && now > end) return false;
  return med.status !== 'paused' && med.status !== 'discontinued';
}

export function getScheduleForRange(med: Medication, fromDate: Date, toDate: Date): Date[] {
  const times: Date[] = [];
  const start = new Date(med.startDate);
  if (Number.isNaN(start.getTime()) || fromDate > toDate) return times;

  const end = getMedicationEndDate(med);
  if (end && fromDate > end) return times;

  const intervalMs = med.frequency * 60 * 60 * 1000;
  if (intervalMs <= 0) return times;

  if (toDate < start) return times;

  let cursor = new Date(start);
  if (cursor < fromDate) {
    const diff = fromDate.getTime() - cursor.getTime();
    const steps = Math.ceil(diff / intervalMs);
    cursor = new Date(cursor.getTime() + steps * intervalMs);
  }

  const lastDate = end && end < toDate ? end : toDate;
  while (cursor <= lastDate) {
    if (cursor >= fromDate) {
      times.push(new Date(cursor));
    }
    cursor = new Date(cursor.getTime() + intervalMs);
  }

  return times;
}

export function getDaySchedule(med: Medication, date: Date): Date[] {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  return getScheduleForRange(med, dayStart, dayEnd);
}

export function getUpcomingDoseTimes(med: Medication, days = 7, fromDate = new Date()): Date[] {
  const windowEnd = new Date(fromDate);
  windowEnd.setDate(windowEnd.getDate() + days);
  return getScheduleForRange(med, fromDate, windowEnd);
}

export async function scheduleRefillReminder(med: Medication): Promise<void> {
  if (!med.refillDate) return;
  const trigger = new Date(med.refillDate);
  trigger.setHours(9, 0, 0, 0); // 9 AM on refill day
  if (trigger <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Refill Reminder',
      body: `Time to refill ${med.name}`,
      data: { medicationId: med.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
  });
}
