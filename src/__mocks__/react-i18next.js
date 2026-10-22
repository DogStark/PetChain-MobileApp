const React = require('react');

const I18nextProvider = ({ children }) => children;

const useTranslation = () => ({
  t: (key) => key,
  i18n: { language: 'en', changeLanguage: jest.fn() },
  ready: true,
});

const initReactI18next = {
  type: '3rdParty',
  init: jest.fn(),
};

module.exports = {
  I18nextProvider,
  useTranslation,
  initReactI18next,
};
