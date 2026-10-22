import type { IAPItemDetails } from 'expo-in-app-purchases';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import subscriptionService, {
  type ProductId,
  PRODUCT_IDS,
  type SubscriptionStatus,
} from '../services/subscriptionService';
import { useAppTheme } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubscribed: (status: SubscriptionStatus) => void;
}

const FEATURES = {
  free: ['1 pet', 'Basic health records', 'Appointment reminders'],
  premium: [
    'Unlimited pets',
    'Advanced health analytics',
    'Medication tracking',
    'QR pet profiles',
    'Community access',
    'Priority support',
  ],
};

const PaywallModal: React.FC<Props> = ({ visible, onClose, onSubscribed }) => {
  const colors = useAppTheme();
  const [products, setProducts] = useState<IAPItemDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    subscriptionService
      .getProducts()
      .then(setProducts)
      .catch(() => setError('Could not load plans. Check your connection.'));
  }, [visible]);

  const handlePurchase = useCallback(
    async (productId: ProductId) => {
      setLoading(true);
      setError(null);
      try {
        const status = await subscriptionService.purchasePlan(productId);
        if (status.isPremium) onSubscribed(status);
        else onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Purchase failed. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [onSubscribed, onClose],
  );

  const handleRestore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await subscriptionService.restorePurchases();
      if (status.isPremium) onSubscribed(status);
      else setError('No previous purchases found.');
    } catch {
      setError('Restore failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [onSubscribed]);

  const priceFor = (id: ProductId) =>
    products.find((p) => p.productId === id)?.price ??
    (id === PRODUCT_IDS.annual ? '$95.88/yr' : '$9.99/mo');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close">
            <Text style={[styles.closeTxt, { color: colors.secondaryText }]}>✕</Text>
          </TouchableOpacity>

          <Text style={[styles.title, { color: colors.text }]}>Upgrade to Premium</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Add unlimited pets and unlock all features
          </Text>

          {/* Feature comparison */}
          <View style={styles.comparison}>
            <View style={[styles.col, { backgroundColor: colors.muted }]}>
              <Text style={[styles.colHeader, { color: colors.text }]}>Free</Text>
              {FEATURES.free.map((f) => (
                <Text key={f} style={[styles.featureRow, { color: colors.secondaryText }]}>
                  {'✓ ' + f}
                </Text>
              ))}
            </View>
            <View
              style={[
                styles.col,
                styles.premiumCol,
                { backgroundColor: colors.primaryMuted, borderColor: colors.primary },
              ]}
            >
              <Text style={[styles.colHeader, { color: colors.primary }]}>Premium</Text>
              {FEATURES.premium.map((f) => (
                <Text key={f} style={[styles.featureRow, { color: colors.primary }]}>
                  {'✓ ' + f}
                </Text>
              ))}
            </View>
          </View>

          {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

          {loading ? (
            <ActivityIndicator color="#4CAF50" style={{ marginVertical: 16 }} />
          ) : (
            <>
              <TouchableOpacity
                style={[styles.planBtn, { backgroundColor: colors.success }]}
                onPress={() => void handlePurchase(PRODUCT_IDS.annual)}
                accessibilityRole="button"
                accessibilityLabel="Subscribe annually"
              >
                <Text style={styles.planBtnText}>Annual - {priceFor(PRODUCT_IDS.annual)}</Text>
                <Text style={[styles.saveBadge, { color: colors.success }]}>Save 20%</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.planBtn, { backgroundColor: colors.primary }]}
                onPress={() => void handlePurchase(PRODUCT_IDS.monthly)}
                accessibilityRole="button"
                accessibilityLabel="Subscribe monthly"
              >
                <Text style={styles.planBtnText}>Monthly - {priceFor(PRODUCT_IDS.monthly)}</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => void handleRestore()} style={styles.restoreBtn}>
                <Text style={[styles.restoreTxt, { color: colors.primary }]}>
                  Restore Purchases
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  closeBtn: { alignSelf: 'flex-end', padding: 4 },
  closeTxt: { fontSize: 18 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  subtitle: { fontSize: 14, marginTop: 4, marginBottom: 16 },
  comparison: { flexDirection: 'row', marginBottom: 16 },
  col: { flex: 1, borderRadius: 10, padding: 12, marginRight: 12 },
  premiumCol: { borderWidth: 1.5, marginRight: 0 },
  colHeader: { fontWeight: '700', fontSize: 14, marginBottom: 8 },
  featureRow: { fontSize: 12, marginBottom: 4 },
  error: { fontSize: 13, marginBottom: 8, textAlign: 'center' },
  planBtn: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  planBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  saveBadge: {
    backgroundColor: '#fff',
    color: '#2e7d32',
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  restoreBtn: { alignItems: 'center', marginTop: 4 },
  restoreTxt: { color: '#4CAF50', fontSize: 13, fontWeight: '600' },
});

export default PaywallModal;
