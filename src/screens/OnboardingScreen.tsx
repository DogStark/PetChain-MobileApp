import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  Platform,
} from 'react-native';

import AppText from '../components/AppText';
import { scale } from '../utils/scaling';

const { width } = Dimensions.get('window');

interface OnboardingScreenProps {
  onComplete: () => void;
  onSkip: () => void;
}

const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete, onSkip }) => {
  const [currentPage, setCurrentPage] = useState(0);

  const slides = [
    {
      id: 1,
      title: 'Welcome to PetChain',
      subtitle: 'Your trusted companion for pet healthcare management',
      image: '🐕',
      description: "Securely manage your pet's medical records with blockchain technology",
    },
    {
      id: 2,
      title: 'Secure Medical Records',
      subtitle: 'Blockchain-verified pet health information',
      image: '🔒',
      description: 'All medical records are cryptographically secured on the Stellar blockchain',
      features: [
        '✓ Immutable record storage',
        '✓ Tamper-proof verification',
        '✓ Complete medical history',
      ],
    },
    {
      id: 3,
      title: 'Smart QR Scanning',
      subtitle: 'Quick access to pet information',
      image: '📱',
      description: 'Scan QR codes to instantly access pet records and verify authenticity',
      features: [
        '✓ Fast QR code scanning',
        '✓ Offline record access',
        '✓ Veterinarian verification',
      ],
    },
    {
      id: 4,
      title: 'Veterinarian Network',
      subtitle: 'Connect with trusted healthcare providers',
      image: '🏥',
      description: 'Find and connect with verified veterinarians in your area',
      features: ['✓ Licensed veterinarians', '✓ Appointment scheduling', '✓ Emergency contacts'],
    },
    {
      id: 5,
      title: 'Emergency Ready',
      subtitle: 'Critical information when you need it most',
      image: '🚨',
      description: 'Access emergency contacts and critical medical information instantly',
      features: ['✓ Emergency contacts', '✓ Critical medical info', '✓ 24/7 access'],
    },
  ];

  const handleNext = () => {
    if (currentPage < slides.length - 1) {
      setCurrentPage(currentPage + 1);
    } else {
      onComplete();
    }
  };

  const handleSkip = () => {
    onSkip();
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const renderSlide = (slide: (typeof slides)[0], index: number) => {
    const isLastSlide = index === slides.length - 1;

    return (
      <View key={slide.id} style={[styles.slide, { width }]}>
        <View style={styles.imageContainer}>
          <AppText style={styles.emojiImage}>{slide.image}</AppText>
        </View>

        <View style={styles.contentContainer}>
          <AppText style={styles.title}>{slide.title}</AppText>
          <AppText style={styles.subtitle}>{slide.subtitle}</AppText>
          <AppText style={styles.description}>{slide.description}</AppText>

          {slide.features && (
            <View style={styles.featuresContainer}>
              {slide.features.map((feature, featureIndex) => (
                <AppText key={featureIndex} style={styles.featureText}>
                  {feature}
                </AppText>
              ))}
            </View>
          )}
        </View>

        <View style={styles.buttonContainer}>
          {index > 0 && (
            <TouchableOpacity style={styles.backButton} onPress={() => handlePageChange(index - 1)}>
              <AppText style={styles.backButtonText}>Back</AppText>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.nextButton, isLastSlide && styles.getStartedButton]}
            onPress={handleNext}
          >
            <AppText style={[styles.nextButtonText, isLastSlide && styles.getStartedButtonText]}>
              {isLastSlide ? 'Get Started' : 'Next'}
            </AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderPagination = () => {
    return (
      <View style={styles.paginationContainer}>
        {slides.map((_, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.paginationDot, index === currentPage && styles.paginationDotActive]}
            onPress={() => handlePageChange(index)}
          />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />

      <View style={styles.header}>
        <TouchableOpacity onPress={handleSkip}>
          <AppText style={styles.skipText}>Skip</AppText>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const slideIndex = Math.round(event.nativeEvent.contentOffset.x / width);
          setCurrentPage(slideIndex);
        }}
        style={styles.scrollView}
      >
        {slides.map((slide, index) => renderSlide(slide, index))}
      </ScrollView>

      {renderPagination()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: scale(20),
    paddingTop: Platform.OS === 'ios' ? scale(10) : scale(20),
    paddingBottom: scale(10),
  },
  skipText: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  slide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(20),
  },
  imageContainer: {
    alignItems: 'center',
    marginBottom: scale(40),
  },
  emojiImage: {
    fontSize: scale(120),
    marginBottom: scale(20),
  },
  contentContainer: {
    alignItems: 'center',
    marginBottom: scale(40),
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: scale(10),
    lineHeight: scale(38),
  },
  subtitle: {
    fontSize: 18,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: scale(20),
    lineHeight: scale(24),
  },
  description: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: scale(24),
    paddingHorizontal: scale(20),
    marginBottom: scale(20),
  },
  featuresContainer: {
    width: '100%',
    paddingHorizontal: scale(20),
  },
  featureText: {
    fontSize: 16,
    color: '#059669',
    marginBottom: scale(8),
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: scale(20),
    paddingBottom: scale(40),
  },
  backButton: {
    paddingHorizontal: scale(20),
    paddingVertical: scale(12),
    borderRadius: scale(8),
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: 'transparent',
  },
  backButtonText: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  nextButton: {
    paddingHorizontal: scale(30),
    paddingVertical: scale(12),
    borderRadius: scale(8),
    backgroundColor: '#3B82F6',
    minWidth: scale(100),
    alignItems: 'center',
  },
  getStartedButton: {
    backgroundColor: '#10B981',
  },
  nextButtonText: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
  },
  getStartedButtonText: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: scale(30),
  },
  paginationDot: {
    width: scale(8),
    height: scale(8),
    borderRadius: scale(4),
    backgroundColor: '#D1D5DB',
    marginHorizontal: scale(4),
  },
  paginationDotActive: {
    backgroundColor: '#3B82F6',
    width: scale(24),
  },
});

export default OnboardingScreen;
