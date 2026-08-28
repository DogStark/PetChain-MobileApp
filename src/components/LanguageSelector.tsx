import React from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { SUPPORTED_LANGUAGES, type LanguageCode } from '../i18n';
import { switchLanguage } from '../utils/locale';

const LanguageSelector: React.FC = () => {
  const { t, i18n } = useTranslation();
  const current = i18n.language as LanguageCode;

  const handleSelect = (code: LanguageCode) => {
    void switchLanguage(code);
  };

  return (
    <View>
      <Text style={styles.label}>{t('language.selectLanguage')}</Text>
      <View style={styles.row}>
        {SUPPORTED_LANGUAGES.map(({ code, label }) => (
          <TouchableOpacity
            key={code}
            style={[styles.btn, current === code && styles.btnActive]}
            onPress={() => handleSelect(code)}
          >
            <Text style={[styles.btnText, current === code && styles.btnTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  label: { fontSize: 13, color: '#666', marginTop: 12, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  btnActive: { borderColor: '#4CAF50', backgroundColor: '#e8f5e9' },
  btnText: { fontSize: 14, color: '#555' },
  btnTextActive: { color: '#2e7d32', fontWeight: '600' },
});

export default LanguageSelector;
