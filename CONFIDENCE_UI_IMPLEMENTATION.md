# PDF Import Confidence UI Implementation

## Summary
Implemented per-field confidence scoring and visual indicators for the PDF import feature in `ImportRecordScreen.tsx`.

## Changes Made

### Backend (`backend/services/pdfParserService.ts`)

1. **Added `FieldConfidence` type**:
   - `value`: 0-1 confidence score
   - `source`: 'extracted' | 'inferred' | 'empty'

2. **Updated `ExtractedVetRecord` interface**:
   - Added `fieldConfidence` object with confidence scores for all fields

3. **Enhanced extraction functions** to return both data and confidence:
   - `extractVetInfo()`: Returns confidence based on presence of titles (Dr., DVM), keywords, and format validity
   - `extractDates()`: Higher confidence for explicitly labeled dates vs inferred dates
   - `extractDiagnoses()`: Confidence based on explicit matches vs keyword matches
   - `extractTreatments()`: Confidence based on extraction success
   - `extractPrescriptions()`: Confidence based on structured vs keyword matches
   - `extractVaccinations()`: Confidence based on explicit vs keyword matches

### Frontend (`src/screens/ImportRecordScreen.tsx`)

1. **Added helper functions**:
   - `getFieldBorderStyle()`: Returns border styling based on confidence
     - Red border (confidence < 0.4)
     - Yellow border (0.4 ≤ confidence < 0.7)
     - No special styling (confidence ≥ 0.7)
   
   - `getFieldWarningLabel()`: Returns appropriate warning message
     - "⚠ Could not extract — enter manually" (confidence < 0.4)
     - "⚠ Low confidence — please verify" (0.4 ≤ confidence < 0.7)
   
   - `countFieldsNeedingReview()`: Counts fields with confidence < 0.7
   
   - `canAcceptAll()`: Checks if all fields have confidence ≥ 0.7

2. **UI Enhancements**:
   - Added summary bar at top showing "X of Y fields need review"
   - Applied conditional styling to all input fields based on confidence
   - Added warning labels above low-confidence fields
   - Added "Accept All" button (only visible when all fields ≥ 0.7 confidence)
   - Styled low-confidence fields with colored borders and background

3. **Styling**:
   - `summaryBar`: Yellow warning bar with count of fields needing review
   - `fieldWarning`: Warning text above low-confidence fields
   - `acceptAllButton`: Green button for quick acceptance

## Confidence Thresholds

- **< 0.4**: Critical - Field left blank or very unreliable
  - Red border (#f44336)
  - Red background (#ffebee)
  - Message: "Could not extract — enter manually"

- **0.4 - 0.69**: Medium - Field needs verification
  - Yellow border (#ffc107)
  - Yellow background (#fff8e1)
  - Message: "Low confidence — please verify"

- **≥ 0.7**: Good - Field is reliable
  - No special styling
  - "Accept All" button becomes available

## Testing

To test this implementation:

1. Import a PDF with varying quality data
2. Verify that:
   - Fields with low confidence show yellow/red borders
   - Warning messages appear above problematic fields
   - Summary bar shows correct count
   - "Accept All" only appears when all fields ≥ 0.7
   - Users can still manually edit any field regardless of confidence

## Future Enhancements

- Add tooltips explaining confidence scores
- Allow users to override confidence warnings
- Track which fields users modify to improve extraction algorithms
- Add confidence indicators to array items (diagnoses, prescriptions, etc.)
