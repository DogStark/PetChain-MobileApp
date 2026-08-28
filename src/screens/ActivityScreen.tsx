import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Button } from 'react-native';

import LazyScreen from '../components/LazyScreen';
import PetSelectorBar from '../components/PetSelectorBar';
import { usePetContext } from '../context/PetContext';

interface SummaryRow {
  metric_type: string;
  avg: string;
  sum: string;
}

export default function ActivityScreen() {
  const { activePet } = usePetContext();
  const petId = activePet?.id ?? null;
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!petId) return;
    setLoading(true);
    fetch(`/api/activity/summary/${petId}`)
      .then((r) => r.json())
      .then((data) => {
        setSummary(data?.data ?? []);
      })
      .catch(() => setSummary([]))
      .finally(() => setLoading(false));
  }, [petId]);

  return (
    <LazyScreen screenName="Activity">
      <View style={styles.container}>
        <PetSelectorBar />
        <View style={styles.header}>
          <Text style={styles.title}>Activity</Text>
          <Button
            title="Sync now"
            onPress={() =>
              petId &&
              fetch('/api/activity/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ petId, providerKey: 'mockfit' }),
              })
            }
          />
        </View>

        <ScrollView style={styles.body}>
          {loading && <Text>Loading...</Text>}
          {!loading && summary.length === 0 && <Text>No recent activity</Text>}
          {summary.map((s) => (
            <View key={s.metric_type} style={styles.row}>
              <Text style={styles.metric}>{s.metric_type}</Text>
              <Text style={styles.value}>avg: {String(s.avg)}</Text>
              <Text style={styles.value}>sum: {String(s.sum)}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </LazyScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 20, fontWeight: '600' },
  body: { padding: 16 },
  row: { marginBottom: 12 },
  metric: { fontSize: 16, fontWeight: '600' },
  value: { color: '#666' },
});
