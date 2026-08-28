import { randomUUID } from 'crypto';

export interface VideoCallLink {
  provider: 'jitsi' | 'zoom';
  url: string;
  roomId: string;
  createdAt: string;
  expiresAt?: string;
}

function createJitsiLink(appointmentId: string): VideoCallLink {
  const roomId = `PetChain-${appointmentId}-${randomUUID().slice(0, 8)}`;
  return {
    provider: 'jitsi',
    roomId,
    url: `https://meet.jit.si/${roomId}`,
    createdAt: new Date().toISOString(),
  };
}

export function generateVideoCallLink(appointmentId: string): VideoCallLink {
  if (process.env.ZOOM_API_KEY && process.env.ZOOM_API_SECRET) {
    const roomId = `Zoom-${appointmentId}-${randomUUID().slice(0, 8)}`;
    return {
      provider: 'zoom',
      roomId,
      url: `https://zoom.us/j/${roomId}`,
      createdAt: new Date().toISOString(),
    };
  }

  return createJitsiLink(appointmentId);
}
