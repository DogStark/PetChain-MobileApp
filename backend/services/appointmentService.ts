import apiClient from './apiClient';
import { errorHandler } from '../middleware/errorHandler';
import {
  type Appointment,
  AppointmentStatus,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type AppointmentResponse,
  type AppointmentListResponse,
} from '../models/Appointment';

const APPOINTMENTS_ENDPOINT = '/appointments';

/**
 * Fetch all appointments, optionally filtered by petId.
 */
export async function getAppointments(petId?: string): Promise<AppointmentListResponse> {
  try {
    const params = petId ? { petId } : {};
    const response = await apiClient.get<AppointmentListResponse>(APPOINTMENTS_ENDPOINT, {
      params,
    });
    return response.data;
  } catch (error) {
    const handled = errorHandler(error);
    throw new Error(handled.message);
  }
}

/**
 * Fetch a single appointment by ID.
 */
export async function getAppointment(id: string): Promise<AppointmentResponse> {
  try {
    const response = await apiClient.get<AppointmentResponse>(`${APPOINTMENTS_ENDPOINT}/${id}`);
    return response.data;
  } catch (error) {
    const handled = errorHandler(error);
    throw new Error(handled.message);
  }
}

/**
 * Create a new appointment.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<AppointmentResponse> {
  try {
    const response = await apiClient.post<AppointmentResponse>(APPOINTMENTS_ENDPOINT, input);
    return response.data;
  } catch (error) {
    const handled = errorHandler(error);
    throw new Error(handled.message);
  }
}

/**
 * Update an existing appointment.
 */
export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput,
): Promise<AppointmentResponse> {
  try {
    const response = await apiClient.put<AppointmentResponse>(
      `${APPOINTMENTS_ENDPOINT}/${id}`,
      input,
    );
    return response.data;
  } catch (error) {
    const handled = errorHandler(error);
    throw new Error(handled.message);
  }
}

/**
 * Cancel an appointment (sets status to "cancelled").
 */
export async function cancelAppointment(id: string): Promise<AppointmentResponse> {
  return updateAppointment(id, { status: AppointmentStatus.CANCELLED });
}

/**
 * Fetch upcoming appointments (scheduled, not cancelled, dateTime >= now).
 * Optionally filter by petId.
 */
export async function getUpcomingAppointments(petId?: string): Promise<AppointmentListResponse> {
  try {
    const { data: appointments } = await getAppointments(petId);
    const list = Array.isArray(appointments) ? appointments : [];

    const now = new Date();
    const upcoming = list.filter((apt: Appointment) => {
      if (apt.status === AppointmentStatus.CANCELLED || apt.status === AppointmentStatus.COMPLETED)
        return false;
      const appointmentDateTime = new Date(`${apt.date}T${apt.time}`);
      return appointmentDateTime >= now;
    });

    return {
      success: true,
      data: upcoming.sort(
        (a, b) =>
          new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime(),
      ),
      total: upcoming.length,
    };
  } catch (error) {
    const handled = errorHandler(error);
    throw new Error(handled.message);
  }
}
