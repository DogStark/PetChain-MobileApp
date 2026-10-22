import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Notification privacy levels for health data.
 *
 * - full:    Full health content (pet names, medication names, medical details).
 * - minimal: Generic content only. Lock-screen payloads MUST NOT contain any
 *            diagnosis, medication, or location data.
 * - silent:  No visible content at all; delivered silently.
 *
 * Default is `minimal` so a fresh install never leaks health data on a locked
 * device shared with other people.
 */
export type NotificationPrivacyLevel = 'full' | 'minimal' | 'silent';

export const DEFAULT_NOTIFICATION_PRIVACY_LEVEL: NotificationPrivacyLevel = 'minimal';

export const NOTIFICATION_PRIVACY_STORAGE_KEY = '@notification_privacy_level';

const PRIVACY_LEVELS: {
  value: NotificationPrivacyLevel;
  title: string;
  description: string;
}[] = [
  {
    value: 'full',
    title: 'Full content',
    description: 'Show pet names, medication names, and medical details on the lock screen.',
  },
  {
    value: 'minimal',
    title: 'Minimal content',
    description:
      'Show a generic reminder only. No diagnosis, medication, or location data on the lock screen.',
  },
  {
    value: 'silent',
    title: 'Silent',
    description: 'Deliver notifications silently with no visible content.',
  },
];

/**
 * Redact a notification payload according to the selected privacy level.
 *
 * In `minimal` mode the returned payload contains no diagnosis, medication,
 * or location data. In `silent` mode no visible content is produced at all.
 * Notification actions are preserved so they keep working without sensitive
 * data being embedded in the payload.
 */
export function redactNotificationPayload(
  payload: Record<string, unknown>,
  level: NotificationPrivacyLevel,
): Record<string, unknown> {
  const actions = payload.actions;

  if (level === 'silent') {
    return {
      ...(actions ? { actions } : {}),
      contentAvailable: true,
      silent: true,
    };
  }

  if (level === 'minimal') {
    return {
      title: 'Health reminder',
      body: 'You have a health reminder. Open the app for details.',
      ...(actions ? { actions } : {}),
      contentAvailable: true,
    };
  }

  return payload;
}

const NotificationSettingsScreen: React.FC = () => {
  const [level, setLevel] = useState<NotificationPrivacyLevel>(
    DEFAULT_NOTIFICATION_PRIVACY_LEVEL,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const stored = await AsyncStorage.getItem(NOTIFICATION_PRIVACY_STORAGE_KEY);
        if (mounted && stored) {
          setLevel(stored as NotificationPrivacyLevel);
        }
      } catch {
        // Fall back to the documented default on read failure.
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const selectLevel = useCallback(async (next: NotificationPrivacyLevel) => {
    setLevel(next);
    setSaving(true);
    try {
      await AsyncStorage.setItem(NOTIFICATION_PRIVACY_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory selection; persistence will retry on next change.
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Notification privacy</Text>
      <Text style={styles.subheading}>
        Choose how much health information appears in notifications, including on the lock
        screen.
      </Text>

      {PRIVACY_LEVELS.map((option) => {
        const selected = option.value === level;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.option, selected && styles.optionSelected]}
            onPress={() => selectLevel(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{option.title}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </View>
            <Switch
              value={selected}
              onValueChange={() => selectLevel(option.value)}
              disabled={saving}
            />
          </TouchableOpacity>
        );
      })}

      <Text style={styles.footnote}>
        Default: minimal. Notification actions continue to work in every mode without
        embedding sensitive data in the payload.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subheading: {
    fontSize: 14,
    color: '#555',
    marginBottom: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 12,
  },
  optionSelected: {
    borderColor: '#2f6fed',
    backgroundColor: '#f2f6ff',
  },
  optionText: {
    flex: 1,
    paddingRight: 12,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 13,
    color: '#666',
  },
  footnote: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
  },
});

export default NotificationSettingsScreen;
