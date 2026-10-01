#!/usr/bin/env node
/**
 * Localization completeness gate for runtime keys.
 *
 * Scans the runtime namespaces used by the app, enforces a set of required
 * locales, and fails CI when critical keys are missing or extra.
 *
 * Dynamic keys (built at runtime from variables) cannot be statically
 * resolved and are documented as exceptions in DYNAMIC_KEY_EXCEPTIONS.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Locales that must be present and complete for every runtime namespace.
const REQUIRED_LOCALES = ['en', 'es', 'fr'];

// Runtime namespaces the app loads at runtime. Each maps to a catalog file
// under locales/<locale>/<namespace>.json.
const RUNTIME_NAMESPACES = ['common', 'clinical', 'medicalRecords'];

// Namespaces whose keys are considered critical: a missing or extra key here
// fails CI. Non-critical namespaces only warn.
const CRITICAL_NAMESPACES = ['clinical', 'medicalRecords'];

// Keys that are constructed dynamically at runtime and therefore cannot be
// statically verified. Documented here as explicit exceptions.
const DYNAMIC_KEY_EXCEPTIONS = [
  'clinical.diagnosis.code.<code>',
  'medicalRecords.attachment.type.<mime>',
];

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

function readCatalog(locale, namespace) {
  const file = path.join(LOCALES_DIR, locale, `${namespace}.json`);
  if (!fs.existsSync(file)) {
    return { file, missing: true, keys: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { file, missing: false, parseError: err.message, keys: [] };
  }
  return { file, missing: false, keys: flattenKeys(parsed) };
}

function flattenKeys(obj, prefix) {
  const out = [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flattenKeys(value, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isException(namespace, key) {
  const full = `${namespace}.${key}`;
  return DYNAMIC_KEY_EXCEPTIONS.some((pattern) => {
    const regex = new RegExp(
      '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>/g, '[^.]+') + '$'
    );
    return regex.test(full);
  });
}

function main() {
  const errors = [];
  const warnings = [];

  for (const namespace of RUNTIME_NAMESPACES) {
    const critical = CRITICAL_NAMESPACES.includes(namespace);
    const reference = readCatalog(REQUIRED_LOCALES[0], namespace);

    if (reference.missing) {
      errors.push(`[${namespace}] missing reference catalog: ${reference.file}`);
      continue;
    }
    if (reference.parseError) {
      errors.push(`[${namespace}] invalid JSON in ${reference.file}: ${reference.parseError}`);
      continue;
    }

    const referenceKeys = new Set(reference.keys);

    for (const locale of REQUIRED_LOCALES) {
      const catalog = readCatalog(locale, namespace);

      if (catalog.missing) {
        errors.push(`[${namespace}] missing required locale catalog: ${catalog.file}`);
        continue;
      }
      if (catalog.parseError) {
        errors.push(`[${namespace}] invalid JSON in ${catalog.file}: ${catalog.parseError}`);
        continue;
      }

      const localeKeys = new Set(catalog.keys);

      for (const key of referenceKeys) {
        if (!localeKeys.has(key) && !isException(namespace, key)) {
          const message = `[${namespace}] ${catalog.file}: missing key "${namespace}.${key}" for locale "${locale}"`;
          (critical ? errors : warnings).push(message);
        }
      }

      for (const key of localeKeys) {
        if (!referenceKeys.has(key) && !isException(namespace, key)) {
          const message = `[${namespace}] ${catalog.file}: extra key "${namespace}.${key}" for locale "${locale}"`;
          (critical ? errors : warnings).push(message);
        }
      }
    }
  }

  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`error: ${error}`);
    }
    console.error(`\nLocalization completeness gate failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  console.log('Localization completeness gate passed.');
}

main();
