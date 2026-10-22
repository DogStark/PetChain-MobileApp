import type { Appointment } from '../models/Appointment';
import { AppointmentStatus } from '../models/Appointment';
import type { HealthMetricEntry } from '../models/HealthMetric';
import type { MedicalRecord } from '../services/medicalRecordService';
import type { MedicationAdherence } from '../services/medicationService';

export interface HealthScoreInput {
  metrics: HealthMetricEntry[];
  adherence?: MedicationAdherence;
  appointments: Appointment[];
  vetNotes: MedicalRecord[];
  now?: Date;
}

export interface HealthScoreResult {
  score: number;
  weightTrendScore: number;
  medicationAdherenceScore: number;
  appointmentScore: number;
  vetNotesScore: number;
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function calculateWeightTrendScore(metrics: HealthMetricEntry[]): number {
  const weights = metrics
    .filter((metric) => typeof metric.weightKg === 'number')
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  if (weights.length < 2) return 80;
  const first = weights[0].weightKg ?? 0;
  const last = weights[weights.length - 1].weightKg ?? first;
  if (first <= 0) return 80;
  const changePercent = Math.abs(((last - first) / first) * 100);
  if (changePercent <= 5) return 100;
  if (changePercent <= 10) return 80;
  if (changePercent <= 20) return 55;
  return 30;
}

function calculateAppointmentScore(appointments: Appointment[], now: Date): number {
  const recent = appointments.filter((appointment) => {
    const date = new Date(`${appointment.date}T${appointment.time || '00:00'}`);
    const diffDays = (now.getTime() - date.getTime()) / 86400000;
    return diffDays >= 0 && diffDays <= 365 && appointment.status !== AppointmentStatus.CANCELLED;
  });
  const upcoming = appointments.filter((appointment) => {
    const date = new Date(`${appointment.date}T${appointment.time || '00:00'}`);
    const diffDays = (date.getTime() - now.getTime()) / 86400000;
    return diffDays >= 0 && diffDays <= 90 && appointment.status !== AppointmentStatus.CANCELLED;
  });
  if (recent.length > 0 || upcoming.length > 0) return 100;
  return 60;
}

function calculateVetNotesScore(records: MedicalRecord[], now: Date): number {
  const concerning = records.filter((record) => {
    const text = `${record.notes ?? ''}`.toLowerCase();
    const created = new Date(record.createdAt);
    const ageDays = (now.getTime() - created.getTime()) / 86400000;
    return ageDays <= 90 && /(urgent|emergency|critical|severe|worsen|pain)/.test(text);
  });
  return clamp(100 - concerning.length * 20);
}

export function computeCompositeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const now = input.now ?? new Date();
  const weightTrendScore = calculateWeightTrendScore(input.metrics);
  const medicationAdherenceScore = input.adherence ? clamp(input.adherence.score) : 80;
  const appointmentScore = calculateAppointmentScore(input.appointments, now);
  const vetNotesScore = calculateVetNotesScore(input.vetNotes, now);
  const score = clamp(
    weightTrendScore * 0.3 +
      medicationAdherenceScore * 0.3 +
      appointmentScore * 0.2 +
      vetNotesScore * 0.2,
  );
  return { score, weightTrendScore, medicationAdherenceScore, appointmentScore, vetNotesScore };
}
