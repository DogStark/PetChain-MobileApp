import React, { useState } from 'react';
import { View, Text, TextInput, Button, ScrollView, StyleSheet } from 'react-native';

import config from '../config';

export default function ImportScreen() {
  const [csv, setCsv] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${config.api.baseUrl}/v1/import/csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Import failed');
      setResult(data.data ?? data);
    } catch (err: any) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>CSV Batch Import</Text>
      <Text style={styles.label}>Paste CSV content below (header required):</Text>
      <TextInput
        style={styles.input}
        multiline
        value={csv}
        onChangeText={setCsv}
        placeholder={`petId,vetId,type,visitDate,diagnosis,treatment,notes,nextVisitDate`}
      />
      <Button
        title={loading ? 'Importing…' : 'Import CSV'}
        onPress={handleImport}
        disabled={loading || !csv.trim()}
      />

      {error ? <Text style={styles.error}>Error: {error}</Text> : null}

      {result ? (
        <View style={styles.result}>
          <Text style={styles.resultLine}>Imported: {result.imported}</Text>
          <Text style={styles.resultLine}>Skipped: {result.skipped}</Text>
          <Text style={styles.resultLine}>Tx Hashes: {JSON.stringify(result.txHashes)}</Text>
          <Text style={styles.resultTitle}>Errors:</Text>
          {result.errors && result.errors.length > 0 ? (
            result.errors.map((e: any, i: number) => (
              <Text
                key={i}
                style={styles.errorLine}
              >{`Row ${e.row} - ${e.field}: ${e.message}`}</Text>
            ))
          ) : (
            <Text style={styles.resultLine}>None</Text>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12 },
  label: { marginBottom: 6 },
  input: { minHeight: 160, borderWidth: 1, borderColor: '#ccc', padding: 8, marginBottom: 12 },
  result: {
    marginTop: 16,
    padding: 8,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fafafa',
  },
  resultLine: { marginBottom: 6 },
  resultTitle: { marginTop: 8, fontWeight: '600' },
  error: { color: 'red', marginTop: 8 },
  errorLine: { color: 'red' },
});
