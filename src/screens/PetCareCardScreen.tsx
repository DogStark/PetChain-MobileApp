import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { Pet } from '../models/Pet';
import {
  buildCareCardPreview,
  CARE_CARD_FIELDS,
  createCareCard,
  DEFAULT_CARE_CARD_FIELDS,
  isCareCardExpired,
  revokeCareCard,
  type CareCard,
  type CareCardExpiry,
  type CareCardField,
} from '../services/careCardService';
import { PetSharingError } from '../services/petProfileSharingService';
import { getPetById } from '../services/petService';

interface Props {
  petId: string;
  petName: string;
  onBack: () => void;
}

const FIELD_TITLES: Record<CareCardField, string> = {
  name: 'Name',
  species: 'Species',
  breed: 'Breed',
  age: 'Age',
  weightKg: 'Weight',
  microchipId: 'Microchip ID',
};

const EXPIRY_OPTIONS: CareCardExpiry[] = ['1h', '24h', '7d'];

const PetCareCardScreen: React.FC<Props> = ({ petId, petName, onBack }) => {
  const [pet, setPet] = useState<Pet | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<CareCardField[]>(DEFAULT_CARE_CARD_FIELDS);
  const [expiry, setExpiry] = useState<CareCardExpiry>('24h');
  const [card, setCard] = useState<CareCard | null>(null);
  const [busy, setBusy] = useState<'create' | 'share' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPet = async () => {
    setLoadError(false);
    try {
      setPet(await getPetById(petId));
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    loadPet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId]);

  const toggleField = (field: CareCardField) => {
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  };

  const previewRows = pet ? buildCareCardPreview(pet, selected) : [];
  const expired = card ? isCareCardExpired(card) : false;

  const handleCreate = async () => {
    setBusy('create');
    setError(null);
    try {
      const created = await createCareCard(petId, selected, expiry);
      setCard(created);
    } catch (err) {
      setError(
        err instanceof PetSharingError && err.code === 'FORBIDDEN'
          ? 'You do not have permission to share this pet.'
          : 'Could not create the care card. Check your connection and try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    if (!card) return;
    setBusy('share');
    try {
      await Share.share({
        message: `${petName}'s care card (expires ${new Date(card.expiresAt).toLocaleString()})\n${card.url}`,
        url: card.url,
        title: `${petName}'s Care Card`,
      });
    } catch {
      setError('Could not open the share sheet. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = () => {
    if (!card) return;
    Alert.alert('Revoke care card', 'Anyone with this link will lose access immediately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          setBusy('revoke');
          setError(null);
          try {
            await revokeCareCard(card.id);
            setCard(null);
          } catch {
            // Keep the card visible: the server has not confirmed revocation.
            setError('Could not revoke the care card. It may still be active. Try again.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Care Card</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          Choose what recipients can see about {petName}. Everything is private unless selected.
        </Text>

        {loadError && (
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={loadPet}
            accessibilityRole="button"
            accessibilityLabel="Retry loading pet details"
          >
            <Text style={styles.retryText}>Could not load pet details. Tap to retry.</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Fields to share</Text>
        <View style={styles.chipRow}>
          {CARE_CARD_FIELDS.map((field) => {
            const on = selected.includes(field);
            return (
              <TouchableOpacity
                key={field}
                style={[styles.chip, on && styles.chipActive]}
                onPress={() => toggleField(field)}
                disabled={busy !== null}
                accessibilityRole="checkbox"
                accessibilityLabel={FIELD_TITLES[field]}
                accessibilityState={{ checked: on, disabled: busy !== null }}
              >
                <Text style={[styles.chipText, on && styles.chipTextActive]}>
                  {on ? '✓ ' : ''}
                  {FIELD_TITLES[field]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Expires after</Text>
        <View style={styles.chipRow}>
          {EXPIRY_OPTIONS.map((opt) => {
            const on = expiry === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.chip, on && styles.chipActive]}
                onPress={() => setExpiry(opt)}
                disabled={busy !== null}
                accessibilityRole="radio"
                accessibilityLabel={`Expires after ${opt}`}
                accessibilityState={{ selected: on, disabled: busy !== null }}
              >
                <Text style={[styles.chipText, on && styles.chipTextActive]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View
          style={styles.previewCard}
          accessible
          accessibilityLabel={`Preview of what recipients see: ${
            previewRows.length
              ? previewRows.map((r) => `${r.label} ${r.value}`).join(', ')
              : 'nothing selected'
          }`}
        >
          <Text style={styles.sectionTitle}>Recipients will see</Text>
          {previewRows.length === 0 ? (
            <Text style={styles.previewEmpty}>Nothing selected. Pick at least one field.</Text>
          ) : (
            previewRows.map((row) => (
              <View key={row.field} style={styles.previewRow}>
                <Text style={styles.previewLabel}>{row.label}</Text>
                <Text style={styles.previewValue}>{row.value}</Text>
              </View>
            ))
          )}
        </View>

        {error && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
        )}

        {!card && (
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (busy !== null || previewRows.length === 0) && styles.btnDisabled,
            ]}
            onPress={handleCreate}
            disabled={busy !== null || previewRows.length === 0 || !pet}
            accessibilityRole="button"
            accessibilityLabel="Create care card"
            accessibilityHint="Creates a time-limited card with the selected fields"
          >
            {busy === 'create' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Create Care Card</Text>
            )}
          </TouchableOpacity>
        )}

        {card && (
          <View style={styles.cardBox}>
            <Text style={styles.cardStatus}>
              {expired
                ? 'This card has expired. Create a new one to share.'
                : `Active until ${new Date(card.expiresAt).toLocaleString()}`}
            </Text>
            {!expired && (
              <TouchableOpacity
                style={[styles.primaryBtn, busy !== null && styles.btnDisabled]}
                onPress={handleShare}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityLabel="Share care card"
              >
                {busy === 'share' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Share Care Card</Text>
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.revokeBtn, busy !== null && styles.btnDisabled]}
              onPress={handleRevoke}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="Revoke care card"
            >
              {busy === 'revoke' ? (
                <ActivityIndicator size="small" color="#d32f2f" />
              ) : (
                <Text style={styles.revokeBtnText}>Revoke Card</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.permissionNote}>
          Cards are revocable and expire automatically. Only you can create them.
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 17, color: '#4CAF50' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a1a' },
  headerSpacer: { width: 40 },
  content: { padding: 16 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 20, textAlign: 'center' },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
    marginTop: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: '#4CAF50', backgroundColor: '#e8f5e9' },
  chipText: { fontSize: 14, color: '#666' },
  chipTextActive: { color: '#4CAF50', fontWeight: '700' },
  previewCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 16,
    elevation: 2,
  },
  previewEmpty: { fontSize: 14, color: '#999' },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  previewLabel: { fontSize: 14, color: '#666' },
  previewValue: {
    fontSize: 14,
    color: '#1a1a1a',
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  errorText: { color: '#d32f2f', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  retryBtn: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: '#fdecea',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  retryText: { color: '#d32f2f', fontWeight: '700', textAlign: 'center' },
  primaryBtn: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  primaryBtnText: { color: '#4CAF50', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  btnDisabled: { opacity: 0.6 },
  cardBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    elevation: 2,
  },
  cardStatus: { fontSize: 14, color: '#333', marginBottom: 4 },
  revokeBtn: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: '#fdecea',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  revokeBtnText: { color: '#d32f2f', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  permissionNote: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 16,
  },
});

export default PetCareCardScreen;
