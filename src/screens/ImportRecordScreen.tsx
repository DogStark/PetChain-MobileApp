import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type {
  Diagnosis,
  Prescription,
  Treatment,
  VaccinationRecord,
} from '../models/MedicalRecord';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldConfidence {
  value: number;
  source: 'extracted' | 'inferred' | 'empty';
}

interface ExtractedRecord {
  vetName?: string;
  vetClinic?: string;
  vetPhone?: string;
  vetEmail?: string;
  visitDate?: string;
  nextVisitDate?: string;
  diagnoses: Diagnosis[];
  treatments: Treatment[];
  prescriptions: Prescription[];
  vaccinations: VaccinationRecord[];
  notes?: string;
  confidence: number;
  warnings: string[];
  extractionDetails?: {
    pageCount: number;
    isScanned: boolean;
    extractionError?: string;
  };
  fieldConfidence?: {
    vetName?: FieldConfidence;
    vetClinic?: FieldConfidence;
    vetPhone?: FieldConfidence;
    vetEmail?: FieldConfidence;
    visitDate?: FieldConfidence;
    nextVisitDate?: FieldConfidence;
    diagnoses?: FieldConfidence;
    treatments?: FieldConfidence;
    prescriptions?: FieldConfidence;
    vaccinations?: FieldConfidence;
    notes?: FieldConfidence;
  };
}

interface ImportStep {
  step: 'select' | 'upload' | 'review' | 'confirm';
}

interface Props {
  petId: string;
  petName?: string;
  onBack: () => void;
  onImported: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const ImportRecordScreen: React.FC<Props> = ({ petId, petName, onBack, onImported }) => {
  const [currentStep, setCurrentStep] = useState<ImportStep['step']>('select');
  const [pdfBase64, setPdfBase64] = useState<string>('');
  const [extracted, setExtracted] = useState<ExtractedRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [enableOcr, setEnableOcr] = useState(false);

  // Editable fields
  const [editedRecord, setEditedRecord] = useState<ExtractedRecord | null>(null);

  // ── Step 1: Select Import Method ───────────────────────────────────────────

  const handleSelectPdf = () => {
    // In a real app, use react-native-document-picker or expo-document-picker
    // For now, prompt for base64 input
    Alert.prompt(
      'Import PDF',
      'Paste the base64-encoded PDF content:',
      (base64) => {
        if (base64?.trim()) {
          setPdfBase64(base64.trim());
          setCurrentStep('upload');
        }
      },
      'plain-text',
      '',
      'secure-text',
    );
  };

  // ── Step 2: Upload and Parse PDF ───────────────────────────────────────────

  const handleParsePdf = useCallback(async () => {
    if (!pdfBase64) {
      Alert.alert('Error', 'No PDF provided');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/import/medical-records/parse-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getAuthToken()}`,
        },
        body: JSON.stringify({
          pdfBase64,
          petId,
          enableOcr,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        Alert.alert('Error', error.error?.message || 'Failed to parse PDF');
        return;
      }

      const result = await response.json();
      if (result.data.success === false) {
        Alert.alert('Error', result.data.error || 'Failed to extract PDF text');
        return;
      }

      setExtracted(result.data);
      setEditedRecord(result.data);
      setCurrentStep('review');
    } catch (error) {
      Alert.alert(
        'Error',
        `Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setLoading(false);
    }
  }, [pdfBase64, petId, enableOcr]);

  // ── Step 3: Review and Edit ────────────────────────────────────────────────

  const handleEditField = (field: keyof ExtractedRecord, value: unknown) => {
    if (editedRecord) {
      setEditedRecord({
        ...editedRecord,
        [field]: value,
      });
    }
  };

  const handleAddDiagnosis = () => {
    if (editedRecord) {
      setEditedRecord({
        ...editedRecord,
        diagnoses: [...editedRecord.diagnoses, { diagnosisText: '', severity: 'unknown' }],
      });
    }
  };

  const handleRemoveDiagnosis = (index: number) => {
    if (editedRecord) {
      setEditedRecord({
        ...editedRecord,
        diagnoses: editedRecord.diagnoses.filter((_, i) => i !== index),
      });
    }
  };

  const handleAddPrescription = () => {
    if (editedRecord) {
      setEditedRecord({
        ...editedRecord,
        prescriptions: [
          ...editedRecord.prescriptions,
          { medicationName: '', dosage: '', frequency: '' },
        ],
      });
    }
  };

  const handleRemovePrescription = (index: number) => {
    if (editedRecord) {
      setEditedRecord({
        ...editedRecord,
        prescriptions: editedRecord.prescriptions.filter((_, i) => i !== index),
      });
    }
  };

  // ── Step 4: Confirm and Save ───────────────────────────────────────────────

  const handleConfirmImport = useCallback(async () => {
    if (!editedRecord || !editedRecord.visitDate) {
      Alert.alert('Error', 'Visit date is required');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/import/medical-records/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getAuthToken()}`,
        },
        body: JSON.stringify({
          petId,
          type: 'checkup',
          visitDate: editedRecord.visitDate,
          nextVisitDate: editedRecord.nextVisitDate,
          diagnoses: editedRecord.diagnoses,
          treatments: editedRecord.treatments,
          prescriptions: editedRecord.prescriptions,
          vaccinations: editedRecord.vaccinations,
          notes: editedRecord.notes,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        Alert.alert('Error', error.error?.message || 'Failed to save medical record');
        return;
      }

      Alert.alert('Success', 'Medical record imported successfully', [
        {
          text: 'OK',
          onPress: () => {
            onImported();
            onBack();
          },
        },
      ]);
    } catch (error) {
      Alert.alert(
        'Error',
        `Failed to save record: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setLoading(false);
    }
  }, [editedRecord, petId, onImported, onBack]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Import Vet Record</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Step 1: Select */}
      {currentStep === 'select' && (
        <ScrollView style={styles.content}>
          <Text style={styles.sectionTitle}>Import Medical Record</Text>
          <Text style={styles.description}>
            Upload a PDF of a vet record for {petName || 'your pet'}. We'll extract the medical
            information and present it for your review.
          </Text>

          <TouchableOpacity style={styles.button} onPress={handleSelectPdf}>
            <Text style={styles.buttonText}>📄 Select PDF File</Text>
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Supported Formats</Text>
            <Text style={styles.infoText}>• PDF files (text-based or scanned)</Text>
            <Text style={styles.infoText}>• Maximum 10MB file size</Text>
            <Text style={styles.infoText}>• Up to 20 pages</Text>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>What We Extract</Text>
            <Text style={styles.infoText}>• Veterinarian name and clinic</Text>
            <Text style={styles.infoText}>• Visit date and next visit date</Text>
            <Text style={styles.infoText}>• Diagnoses and treatments</Text>
            <Text style={styles.infoText}>• Medications and prescriptions</Text>
            <Text style={styles.infoText}>• Vaccinations</Text>
          </View>
        </ScrollView>
      )}

      {/* Step 2: Upload */}
      {currentStep === 'upload' && (
        <ScrollView style={styles.content}>
          <Text style={styles.sectionTitle}>Processing PDF</Text>

          <View style={styles.uploadBox}>
            <Text style={styles.uploadText}>PDF loaded ({pdfBase64.length} bytes)</Text>
          </View>

          <View style={styles.optionsBox}>
            <Text style={styles.optionLabel}>Enable OCR for scanned documents</Text>
            <TouchableOpacity
              style={[styles.checkbox, enableOcr && styles.checkboxChecked]}
              onPress={() => setEnableOcr(!enableOcr)}
            >
              <Text style={styles.checkboxText}>{enableOcr ? '✓' : ''}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleParsePdf}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>🔍 Parse PDF</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={() => setCurrentStep('select')}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Step 3: Review */}
      {currentStep === 'review' && editedRecord && (
        <ScrollView style={styles.content}>
          <Text style={styles.sectionTitle}>Review Extracted Data</Text>

          {/* Summary Bar */}
          {(() => {
            const { needsReview, total } = countFieldsNeedingReview(extracted);
            return needsReview > 0 ? (
              <View style={styles.summaryBar}>
                <Text style={styles.summaryText}>
                  ⚠️ {needsReview} of {total} fields need review
                </Text>
              </View>
            ) : null;
          })()}

          {extracted?.warnings && extracted.warnings.length > 0 && (
            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>⚠️ Warnings</Text>
              {extracted.warnings.map((warning, idx) => (
                <Text key={idx} style={styles.warningText}>
                  • {warning}
                </Text>
              ))}
            </View>
          )}

          {/* Confidence Score */}
          <View style={styles.confidenceBox}>
            <Text style={styles.confidenceLabel}>Extraction Confidence</Text>
            <View style={styles.confidenceBar}>
              <View
                style={[styles.confidenceFill, { width: `${(extracted?.confidence || 0) * 100}%` }]}
              />
            </View>
            <Text style={styles.confidenceText}>
              {Math.round((extracted?.confidence || 0) * 100)}%
            </Text>
          </View>

          {/* Vet Information */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Veterinarian Information</Text>
            
            <View>
              {getFieldWarningLabel(extracted?.fieldConfidence?.vetName?.value) && (
                <Text style={styles.fieldWarning}>
                  {getFieldWarningLabel(extracted?.fieldConfidence?.vetName?.value)}
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  getFieldBorderStyle(extracted?.fieldConfidence?.vetName?.value),
                ]}
                placeholder="Vet Name"
                value={editedRecord.vetName || ''}
                onChangeText={(text) => handleEditField('vetName', text)}
              />
            </View>

            <View>
              {getFieldWarningLabel(extracted?.fieldConfidence?.vetClinic?.value) && (
                <Text style={styles.fieldWarning}>
                  {getFieldWarningLabel(extracted?.fieldConfidence?.vetClinic?.value)}
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  getFieldBorderStyle(extracted?.fieldConfidence?.vetClinic?.value),
                ]}
                placeholder="Clinic Name"
                value={editedRecord.vetClinic || ''}
                onChangeText={(text) => handleEditField('vetClinic', text)}
              />
            </View>

            <View>
              {getFieldWarningLabel(extracted?.fieldConfidence?.vetPhone?.value) && (
                <Text style={styles.fieldWarning}>
                  {getFieldWarningLabel(extracted?.fieldConfidence?.vetPhone?.value)}
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  getFieldBorderStyle(extracted?.fieldConfidence?.vetPhone?.value),
                ]}
                placeholder="Phone"
                value={editedRecord.vetPhone || ''}
                onChangeText={(text) => handleEditField('vetPhone', text)}
              />
            </View>

            <View>
              {getFieldWarningLabel(extracted?.fieldConfidence?.vetEmail?.value) && (
                <Text style={styles.fieldWarning}>
                  {getFieldWarningLabel(extracted?.fieldConfidence?.vetEmail?.value)}
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  getFieldBorderStyle(extracted?.fieldConfidence?.vetEmail?.value),
                ]}
                placeholder="Email"
                value={editedRecord.vetEmail || ''}
                onChangeText={(text) => handleEditField('vetEmail', text)}
              />
            </View>
          </View>

          {/* Visit Dates */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Visit Dates</Text>
            
            <View>
              {getFieldWarningLabel(extracted?.fieldConfidence?.visitDate?.value) && (
                <Text style={styles.fieldWarning}>
                  {getFieldWarningLabel(extracted?.fieldConfidence?.visitDate?.value)}
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  getFieldBorderStyle(extracted?.fieldConfidence?.visitDate?.value),
                ]}
                placeholder="Visit Date (YYYY-MM-DD)"
                value={editedRecord.visitDate || ''}
                onChangeText={(text) => handleEditField('visitDate', text)}
              />
            </View>

            <View>
              {getFieldWarningLabel(extracted?.fieldConfidence?.nextVisitDate?.value) && (
                <Text style={styles.fieldWarning}>
                  {getFieldWarningLabel(extracted?.fieldConfidence?.nextVisitDate?.value)}
                </Text>
              )}
              <TextInput
                style={[
                  styles.input,
                  getFieldBorderStyle(extracted?.fieldConfidence?.nextVisitDate?.value),
                ]}
                placeholder="Next Visit Date (YYYY-MM-DD)"
                value={editedRecord.nextVisitDate || ''}
                onChangeText={(text) => handleEditField('nextVisitDate', text)}
              />
            </View>
          </View>

          {/* Diagnoses */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>Diagnoses ({editedRecord.diagnoses.length})</Text>
              <TouchableOpacity onPress={handleAddDiagnosis}>
                <Text style={styles.addButton}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {getFieldWarningLabel(extracted?.fieldConfidence?.diagnoses?.value) && (
              <Text style={styles.fieldWarning}>
                {getFieldWarningLabel(extracted?.fieldConfidence?.diagnoses?.value)}
              </Text>
            )}
            {editedRecord.diagnoses.map((diagnosis, idx) => (
              <View key={idx} style={styles.itemBox}>
                <TextInput
                  style={styles.input}
                  placeholder="Diagnosis"
                  value={diagnosis.diagnosisText}
                  onChangeText={(text) => {
                    const updated = [...editedRecord.diagnoses];
                    updated[idx] = { ...diagnosis, diagnosisText: text };
                    handleEditField('diagnoses', updated);
                  }}
                />
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemoveDiagnosis(idx)}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* Treatments */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Treatments ({editedRecord.treatments.length})</Text>
            {getFieldWarningLabel(extracted?.fieldConfidence?.treatments?.value) && (
              <Text style={styles.fieldWarning}>
                {getFieldWarningLabel(extracted?.fieldConfidence?.treatments?.value)}
              </Text>
            )}
            {editedRecord.treatments.map((treatment, idx) => (
              <View key={idx} style={styles.itemBox}>
                <Text style={styles.itemText}>{treatment.treatmentText}</Text>
              </View>
            ))}
          </View>

          {/* Prescriptions */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>
                Prescriptions ({editedRecord.prescriptions.length})
              </Text>
              <TouchableOpacity onPress={handleAddPrescription}>
                <Text style={styles.addButton}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {getFieldWarningLabel(extracted?.fieldConfidence?.prescriptions?.value) && (
              <Text style={styles.fieldWarning}>
                {getFieldWarningLabel(extracted?.fieldConfidence?.prescriptions?.value)}
              </Text>
            )}
            {editedRecord.prescriptions.map((prescription, idx) => (
              <View key={idx} style={styles.itemBox}>
                <TextInput
                  style={styles.input}
                  placeholder="Medication Name"
                  value={prescription.medicationName}
                  onChangeText={(text) => {
                    const updated = [...editedRecord.prescriptions];
                    updated[idx] = { ...prescription, medicationName: text };
                    handleEditField('prescriptions', updated);
                  }}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Dosage"
                  value={prescription.dosage || ''}
                  onChangeText={(text) => {
                    const updated = [...editedRecord.prescriptions];
                    updated[idx] = { ...prescription, dosage: text };
                    handleEditField('prescriptions', updated);
                  }}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Frequency"
                  value={prescription.frequency || ''}
                  onChangeText={(text) => {
                    const updated = [...editedRecord.prescriptions];
                    updated[idx] = { ...prescription, frequency: text };
                    handleEditField('prescriptions', updated);
                  }}
                />
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemovePrescription(idx)}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* Vaccinations */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Vaccinations ({editedRecord.vaccinations.length})
            </Text>
            {getFieldWarningLabel(extracted?.fieldConfidence?.vaccinations?.value) && (
              <Text style={styles.fieldWarning}>
                {getFieldWarningLabel(extracted?.fieldConfidence?.vaccinations?.value)}
              </Text>
            )}
            {editedRecord.vaccinations.map((vaccination, idx) => (
              <View key={idx} style={styles.itemBox}>
                <Text style={styles.itemText}>{vaccination.vaccineName}</Text>
              </View>
            ))}
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Additional notes"
              value={editedRecord.notes || ''}
              onChangeText={(text) => handleEditField('notes', text)}
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Action Buttons */}
          {canAcceptAll(extracted) && (
            <TouchableOpacity
              style={[styles.button, styles.acceptAllButton, loading && styles.buttonDisabled]}
              onPress={handleConfirmImport}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>✓ Accept All</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleConfirmImport}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>✓ Confirm & Save</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={() => setCurrentStep('upload')}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    fontSize: 16,
    color: '#007AFF',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    color: '#000',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#e0e0e0',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    backgroundColor: '#f0f8ff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: '#333',
    marginBottom: 4,
  },
  uploadBox: {
    backgroundColor: '#f0f0f0',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  uploadText: {
    fontSize: 14,
    color: '#666',
  },
  optionsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  optionLabel: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#007AFF',
  },
  checkboxText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  warningBox: {
    backgroundColor: '#fff3cd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
    marginBottom: 8,
  },
  warningText: {
    fontSize: 13,
    color: '#856404',
    marginBottom: 4,
  },
  confidenceBox: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  confidenceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  confidenceBar: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  confidenceFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
  },
  confidenceText: {
    fontSize: 12,
    color: '#666',
  },
  section: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  addButton: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    fontSize: 14,
    color: '#333',
  },
  textArea: {
    textAlignVertical: 'top',
    minHeight: 80,
  },
  itemBox: {
    backgroundColor: '#f9f9f9',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  itemText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
  },
  removeButton: {
    backgroundColor: '#ffebee',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 4,
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#d32f2f',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryBar: {
    backgroundColor: '#fff3cd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#ffc107',
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
  },
  fieldWarning: {
    fontSize: 12,
    color: '#856404',
    marginBottom: 4,
    fontWeight: '500',
  },
  acceptAllButton: {
    backgroundColor: '#4CAF50',
  },
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  // In a real app, retrieve from secure storage
  return 'mock-token';
}

/**
 * Get the border style for a field based on its confidence score
 */
function getFieldBorderStyle(confidence?: number) {
  if (!confidence) return {};
  
  if (confidence < 0.4) {
    return {
      borderColor: '#f44336',
      borderWidth: 2,
      backgroundColor: '#ffebee',
    };
  }
  
  if (confidence < 0.7) {
    return {
      borderColor: '#ffc107',
      borderWidth: 2,
      backgroundColor: '#fff8e1',
    };
  }
  
  return {};
}

/**
 * Get the warning label for a field based on its confidence score
 */
function getFieldWarningLabel(confidence?: number): string | null {
  if (!confidence) return null;
  
  if (confidence < 0.4) {
    return '⚠ Could not extract — enter manually';
  }
  
  if (confidence < 0.7) {
    return '⚠ Low confidence — please verify';
  }
  
  return null;
}

/**
 * Count fields that need review
 */
function countFieldsNeedingReview(record: ExtractedRecord | null): { needsReview: number; total: number } {
  if (!record || !record.fieldConfidence) {
    return { needsReview: 0, total: 0 };
  }
  
  const fields = [
    record.fieldConfidence.vetName,
    record.fieldConfidence.vetClinic,
    record.fieldConfidence.vetPhone,
    record.fieldConfidence.vetEmail,
    record.fieldConfidence.visitDate,
    record.fieldConfidence.nextVisitDate,
    record.fieldConfidence.diagnoses,
    record.fieldConfidence.treatments,
    record.fieldConfidence.prescriptions,
    record.fieldConfidence.vaccinations,
  ].filter(Boolean);
  
  const needsReview = fields.filter(f => f && f.value < 0.7).length;
  
  return { needsReview, total: fields.length };
}

/**
 * Check if all fields have acceptable confidence (>= 0.7)
 */
function canAcceptAll(record: ExtractedRecord | null): boolean {
  if (!record || !record.fieldConfidence) return false;
  
  const fields = [
    record.fieldConfidence.vetName,
    record.fieldConfidence.vetClinic,
    record.fieldConfidence.vetPhone,
    record.fieldConfidence.vetEmail,
    record.fieldConfidence.visitDate,
    record.fieldConfidence.nextVisitDate,
    record.fieldConfidence.diagnoses,
    record.fieldConfidence.treatments,
    record.fieldConfidence.prescriptions,
    record.fieldConfidence.vaccinations,
  ].filter(Boolean);
  
  return fields.every(f => f && f.value >= 0.7);
}

export default ImportRecordScreen;
