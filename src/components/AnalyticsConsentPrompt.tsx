import React, { useEffect, useState } from 'react';
import { Modal, SafeAreaView, StyleSheet } from 'react-native';

import { AnalyticsConsentContent } from '../screens/onboarding/AnalyticsConsentStep';
import { getAnalyticsConsent, needsAnalyticsConsent } from '../services/analyticsService';

/**
 * Asks for analytics consent when the user has never been asked or when the
 * data collection scope has changed since they last answered (#1391).
 */
const AnalyticsConsentPrompt: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [scopeChanged, setScopeChanged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await getAnalyticsConsent();
      const needed = await needsAnalyticsConsent();
      if (!cancelled && needed) {
        setScopeChanged(existing !== null);
        setVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => undefined}>
      <SafeAreaView style={styles.container}>
        <AnalyticsConsentContent
          scopeChanged={scopeChanged}
          onDecided={() => setVisible(false)}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});

export default AnalyticsConsentPrompt;
