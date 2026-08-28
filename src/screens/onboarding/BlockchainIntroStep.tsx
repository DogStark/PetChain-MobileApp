import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { WebView } from 'react-native-webview';

interface Props {
  onNext: () => void;
  onSkip: () => void;
  isLast?: boolean;
}

const HOW_IT_WORKS_URL = 'https://petchain.app/how-it-works';

const SLIDES = [
  {
    emoji: '🔗',
    title: 'What is a blockchain record?',
    desc: "A blockchain record is a permanent, tamper-proof entry of your pet's medical history. Once written, it can't be silently changed.",
  },
  {
    emoji: '✅',
    title: 'What does "verified" mean?',
    desc: 'A verified badge means the record on your phone matches what was anchored on the Stellar blockchain — proof nothing was altered.',
  },
  {
    emoji: '🩺',
    title: 'Sharing with a vet',
    desc: "Show your vet the record's QR code. They scan it to instantly confirm authenticity — no calls or faxes needed.",
  },
];

const BlockchainIntroStep: React.FC<Props> = ({ onNext, onSkip, isLast = false }) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [webviewVisible, setWebviewVisible] = useState(false);

  const isLastSlide = slideIndex === SLIDES.length - 1;
  const slide = SLIDES[slideIndex];

  const handlePrimaryPress = () => {
    if (isLastSlide) {
      onNext();
    } else {
      setSlideIndex((i) => i + 1);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{slide.emoji}</Text>
      <Text style={styles.title}>{slide.title}</Text>
      <Text style={styles.subtitle}>{slide.desc}</Text>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === slideIndex && styles.dotActive]} />
        ))}
      </View>

      <TouchableOpacity onPress={() => setWebviewVisible(true)} accessibilityRole="button">
        <Text style={styles.learnMore}>Learn more</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.primary, isLastSlide && isLast && styles.primaryGreen]}
        onPress={handlePrimaryPress}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>
          {isLastSlide ? (isLast ? "Let's Go! 🎉" : 'Continue') : 'Next'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onSkip} accessibilityRole="button">
        <Text style={styles.skip}>Skip</Text>
      </TouchableOpacity>

      <Modal
        visible={webviewVisible}
        animationType="slide"
        onRequestClose={() => setWebviewVisible(false)}
      >
        <View style={styles.webviewContainer}>
          <TouchableOpacity
            style={styles.webviewClose}
            onPress={() => setWebviewVisible(false)}
            accessibilityRole="button"
          >
            <Text style={styles.webviewCloseText}>✕ Close</Text>
          </TouchableOpacity>
          <WebView source={{ uri: HOW_IT_WORKS_URL }} style={styles.webview} />
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emoji: { fontSize: 72, marginBottom: 16 },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  dots: { flexDirection: 'row', marginBottom: 16, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  dotActive: { backgroundColor: '#3B82F6', width: 20 },
  learnMore: { color: '#3B82F6', fontSize: 14, fontWeight: '600', marginBottom: 24 },
  primary: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  primaryGreen: { backgroundColor: '#10B981' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skip: { color: '#6B7280', fontSize: 15 },
  webviewContainer: { flex: 1, backgroundColor: '#fff' },
  webviewClose: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  webviewCloseText: { color: '#3B82F6', fontSize: 15, fontWeight: '600' },
  webview: { flex: 1 },
});

export default BlockchainIntroStep;
