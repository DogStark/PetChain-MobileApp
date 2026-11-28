import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useSosStore } from '../state/sosStore';

export type ClinicHours = {
  day: string;
  open: string;
  close: string;
};

export type EmergencyDirectoryEntry = {
  id: string;
  name: string;
  kind: 'vet' | 'emergency-vet' | 'animal-control' | 'poison-control';
  phone: string;
  address?: string;
  hours: ClinicHours[];
  is24Hours: boolean;
  updatedAt: string;
};

const EMERGENCY_SERVICES_NUMBER = '911';

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function isOpenNow(entry: EmergencyDirectoryEntry, now: Date): boolean {
  if (entry.is24Hours) {
    return true;
  }
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const today = entry.hours.find((slot) => slot.day === dayName);
  if (!today) {
    return false;
  }
  const open = parseTimeToMinutes(today.open);
  const close = parseTimeToMinutes(today.close);
  if (open === null || close === null) {
    return false;
  }
  const current = now.getHours() * 60 + now.getMinutes();
  if (close < open) {
    return current >= open || current < close;
  }
  return current >= open && current < close;
}

function formatFreshness(updatedAt: string): string {
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(updated)) {
    return 'Freshness unknown';
  }
  const diffMs = Date.now() - updated;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) {
    return 'Updated just now';
  }
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

function formatHours(entry: EmergencyDirectoryEntry): string {
  if (entry.is24Hours) {
    return 'Open 24 hours';
  }
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const today = entry.hours.find((slot) => slot.day === dayName);
  if (!today) {
    return 'Closed today';
  }
  return `Today ${today.open} - ${today.close}`;
}

export default function EmergencyScreen(): React.ReactElement {
  const directory = useSosStore((state) => state.emergencyDirectory);
  const directoryStatus = useSosStore((state) => state.emergencyDirectoryStatus);
  const loadEmergencyDirectory = useSosStore((state) => state.loadEmergencyDirectory);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    loadEmergencyDirectory();
  }, [loadEmergencyDirectory]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const callNumber = useCallback((phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => undefined);
  }, []);

  const openMaps = useCallback((address: string) => {
    const query = encodeURIComponent(address);
    Linking.openURL(`https://maps.google.com/?q=${query}`).catch(() => undefined);
  }, []);

  const sortedDirectory = useMemo(() => {
    return [...directory].sort((a, b) => {
      const aOpen = isOpenNow(a, now) ? 0 : 1;
      const bOpen = isOpenNow(b, now) ? 0 : 1;
      return aOpen - bOpen;
    });
  }, [directory, now]);

  const isLoading = directoryStatus === 'loading';
  const isUnavailable = directoryStatus === 'error' || (directoryStatus === 'ready' && directory.length === 0);

  return (
    <ScrollView contentContainerStyle={styles.container} accessibilityLabel="Emergency directory">
      <Text style={styles.title} accessibilityRole="header">
        Emergency Directory
      </Text>

      <Pressable
        style={styles.emergencyButton}
        accessibilityRole="button"
        accessibilityLabel="Call emergency services"
        onPress={() => callNumber(EMERGENCY_SERVICES_NUMBER)}
      >
        <Text style={styles.emergencyButtonText}>Call emergency services ({EMERGENCY_SERVICES_NUMBER})</Text>
      </Pressable>

      {isLoading ? (
        <View style={styles.stateBox} accessibilityLabel="Loading emergency directory">
          <ActivityIndicator />
          <Text style={styles.stateText}>Loading directory…</Text>
        </View>
      ) : null}

      {isUnavailable ? (
        <View style={styles.stateBox} accessibilityLabel="Emergency directory unavailable">
          <Text style={styles.stateText}>
            Directory data is unavailable right now. If this is an emergency, call {EMERGENCY_SERVICES_NUMBER} directly.
          </Text>
          <Pressable
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading emergency directory"
            onPress={() => loadEmergencyDirectory()}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {sortedDirectory.map((entry) => {
        const open = isOpenNow(entry, now);
        return (
          <View key={entry.id} style={styles.card} accessibilityLabel={`${entry.name}, ${open ? 'open now' : 'closed'}`}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{entry.name}</Text>
              <Text style={[styles.statusBadge, open ? styles.statusOpen : styles.statusClosed]}>
                {open ? 'Open now' : 'Closed'}
              </Text>
            </View>
            <Text style={styles.cardMeta}>{formatHours(entry)}</Text>
            {entry.address ? <Text style={styles.cardMeta}>{entry.address}</Text> : null}
            <Text style={styles.freshness}>{formatFreshness(entry.updatedAt)}</Text>
            <View style={styles.actions}>
              <Pressable
                style={styles.actionButton}
                accessibilityRole="button"
                accessibilityLabel={`Call ${entry.name}`}
                onPress={() => callNumber(entry.phone)}
              >
                <Text style={styles.actionButtonText}>Call</Text>
              </Pressable>
              {entry.address ? (
                <Pressable
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Directions to ${entry.name}`}
                  onPress={() => openMaps(entry.address as string)}
                >
                  <Text style={styles.actionButtonText}>Directions</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  emergencyButton: {
    backgroundColor: '#B00020',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  emergencyButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  stateBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#F2F2F2',
    gap: 8,
  },
  stateText: {
    fontSize: 14,
    color: '#333333',
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#333333',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  card: {
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  statusBadge: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  statusOpen: {
    backgroundColor: '#E6F4EA',
    color: '#1E7B34',
  },
  statusClosed: {
    backgroundColor: '#FBE9E7',
    color: '#B00020',
  },
  cardMeta: {
    fontSize: 14,
    color: '#444444',
  },
  freshness: {
    fontSize: 12,
    color: '#777777',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#0A6CFF',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
