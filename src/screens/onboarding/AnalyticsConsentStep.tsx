import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ANALYTICS_DATA_COLLECTED } from '../../models/UserPreferences';
import { setAnalyticsConsent } from '../../services/analyticsService';

interface ContentProps {
  /** Called after the choice has been stored. */
  onDecided: (granted: boolean) => void;
  /** Shown when the user is asked again because the scope changed. */
  scopeChanged?: boolean;
}

/**
 * Analytics opt-in content (#1391). Explains what is collected and stores the
 * user's choice in UserPreferences. Used by the onboarding step and by the
 * re-consent prompt when the data collection scope changes.
 */
export const AnalyticsConsentContent: React.FC<ContentProps> = ({ onDecided, scopeChanged }) => {
  const [saving, setSaving] = useState(false);

  async function decide(granted: boolean) {
    if (saving) return;
    setSaving(true);
    try {
      await setAnalyticsConsent(granted);
    } finally {
      setSaving(false);
      onDecided(granted);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>📊</Text>
      <Text style={styles.title}>Help improve PetChain</Text>
      <Text style={styles.subtitle}>
        {scopeChanged
          ? 'What we collect has changed. Please review and choose again.'
          : 'Can we collect anonymous usage analytics? It is off unless you allow it.'}
      </Text>

      <View style={styles.list} accessibilityLabel="Data collected">
        <Text style={styles.listHeading}>If you allow it, we collect:</Text>
        {ANALYTICS_DATA_COLLECTED.map((item) => (
          <Text key={item} style={styles.listItem}>
            • {item}
          </Text>
        ))}
        <Text style={styles.note}>
          We never collect your pets&apos; health records, your name, email, phone number or
          location. You can change this at any time in the Privacy Dashboard.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.primary}
        onPress={() => void decide(true)}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Allow analytics"
        testID="analytics-consent-allow"
      >
        <Text style={styles.primaryText}>Allow analytics</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => void decide(false)}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Don't allow analytics"
        testID="analytics-consent-deny"
      >
        <Text style={styles.secondary}>Don&apos;t allow</Text>
      </TouchableOpacity>
    </View>
  );
};

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

/** Onboarding step shown right after the Welcome step. */
const AnalyticsConsentStep: React.FC<Props> = ({ onNext }) => (
  <AnalyticsConsentContent onDecided={() => onNext()} />
);

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emoji: { fontSize: 72, marginBottom: 16 },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: { fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 24 },
  list: { width: '100%', marginBottom: 32 },
  listHeading: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginBottom: 8 },
  listItem: { fontSize: 15, color: '#4B5563', marginBottom: 6 },
  note: { fontSize: 13, color: '#6B7280', marginTop: 12, lineHeight: 18 },
  primary: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { color: '#6B7280', fontSize: 15 },
});

export default AnalyticsConsentStep;
