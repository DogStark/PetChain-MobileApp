# Dosage Approval Feature - Testing Guide

## Automated Tests

### Frontend Tests
Location: `src/services/__tests__/dosageApprovalService.test.ts`

**Test Coverage:**
- ✅ Request vet approval with valid data
- ✅ Send formatted message to vet with all details
- ✅ Include warnings in message when present
- ✅ Create medication in paused status
- ✅ Handle missing optional medication data
- ✅ Error handling for failed vet messages
- ✅ Approve dosage without modifications
- ✅ Approve with dose modifications
- ✅ Activate approved medication
- ✅ Handle medication not found errors

### Backend API Tests
Location: `backend/server/routes/__tests__/medications.dosage-approvals.test.ts`

**Test Coverage:**
- ✅ Create dosage approval request with valid data
- ✅ Validation for required fields
- ✅ Generate unique IDs for each request
- ✅ Set default values for optional fields
- ✅ Retrieve approval request by ID
- ✅ Authorization checks (owner/vet access control)
- ✅ Approve dosage without modifications
- ✅ Approve with dose modification
- ✅ Reject dosage with reason
- ✅ Prevent duplicate approvals/rejections
- ✅ Role-based access control (VET/ADMIN only)

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test dosageApprovalService.test.ts

# Run with coverage
npm test -- --coverage

# Run backend tests only
npm test -- backend/server/routes/__tests__/medications.dosage-approvals.test.ts
```

## Manual Testing Guide

### Prerequisites
1. Start the backend server: `npm run server`
2. Start the mobile app: `npm start`
3. Have test accounts:
   - Pet Owner account
   - Veterinarian account
4. Test pet in database
5. Test vet ID

### Test Case 1: Create Dosage Approval Request

**Steps:**
1. Open Dosage Calculator screen
2. Select species: Dog
3. Select medication: Carprofen
4. Enter weight: 10.5 kg
5. Enter dose: 5 mg/kg
6. Click "Calculate Dose"
7. Verify calculated dose displays
8. Click "📋 Request Vet Approval"
9. Fill in form:
   - Pet ID: `pet_test_123`
   - Pet Name: `Buddy`
   - Veterinarian ID: `vet_test_456`
   - Frequency: `12` hours
   - Instructions: `Give with food`
10. Click "Send Request"

**Expected Result:**
- ✅ Success alert: "Approval Request Sent"
- ✅ Pending approval badge appears
- ✅ Request ID displayed
- ✅ Message sent to vet
- ✅ Clinical note created in system

**Verification:**
```bash
# Check medication was created with paused status
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/medications?petId=pet_test_123

# Should return medication with status: "paused"
```

### Test Case 2: View Approval Request (Owner)

**Steps:**
1. Navigate to Medications screen
2. Find medication with "⏳ Pending vet review" badge

**Expected Result:**
- ✅ Medication card shows pending badge
- ✅ Orange styling indicates pending status
- ✅ Medication status is "paused"
- ✅ Cannot log doses while pending

### Test Case 3: Vet Reviews Request (via API)

**Approve without modification:**
```bash
curl -X POST \
  -H "Authorization: Bearer <vet_token>" \
  -H "Content-Type: application/json" \
  -d '{"vetNotes": "Dosage is appropriate"}' \
  http://localhost:3000/api/medications/dosage-approvals/<request_id>/approve
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "id": "approval_...",
    "status": "approved",
    "vetNotes": "Dosage is appropriate",
    "approvedAt": "2026-06-25T..."
  }
}
```

### Test Case 4: Vet Modifies Dosage

**Approve with modification:**
```bash
curl -X POST \
  -H "Authorization: Bearer <vet_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "approvedDose": "75",
    "approvedDoseUnit": "mg",
    "vetNotes": "Increased dose for better efficacy"
  }' \
  http://localhost:3000/api/medications/dosage-approvals/<request_id>/approve
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "id": "approval_...",
    "status": "modified",
    "approvedDose": "75",
    "approvedDoseUnit": "mg",
    "vetNotes": "Increased dose for better efficacy",
    "approvedAt": "2026-06-25T..."
  }
}
```

### Test Case 5: Vet Rejects Dosage

**Reject request:**
```bash
curl -X POST \
  -H "Authorization: Bearer <vet_token>" \
  -H "Content-Type: application/json" \
  -d '{"vetNotes": "Dose too high for pet weight"}' \
  http://localhost:3000/api/medications/dosage-approvals/<request_id>/reject
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "id": "approval_...",
    "status": "rejected",
    "vetNotes": "Dose too high for pet weight",
    "approvedAt": "2026-06-25T..."
  }
}
```

### Test Case 6: Activate Approved Medication

**Steps:**
1. After vet approval, call activation:
```bash
# In app code or via service
await activateApprovedMedication('med_test_789', '75 mg');
```

**Expected Result:**
- ✅ Medication status changes to "active"
- ✅ Pending badge removed from card
- ✅ Dosage updated to approved amount
- ✅ Can now log doses
- ✅ Notes updated: "Approved by veterinarian"

### Test Case 7: Authorization Tests

**Test unauthorized access:**
```bash
# Owner tries to approve own request (should fail)
curl -X POST \
  -H "Authorization: Bearer <owner_token>" \
  http://localhost:3000/api/medications/dosage-approvals/<request_id>/approve

# Expected: 403 Forbidden

# Non-assigned vet tries to view request (should fail)
curl -H "Authorization: Bearer <different_vet_token>" \
  http://localhost:3000/api/medications/dosage-approvals/<request_id>

# Expected: 403 Forbidden
```

### Test Case 8: Dosage with Warnings

**Steps:**
1. Open Dosage Calculator
2. Enter dangerous dosage:
   - Weight: 5 kg
   - Dose: 30 mg/kg (way too high)
3. Click Calculate
4. Verify warnings appear
5. Click "Request Vet Approval"
6. Submit request

**Expected Result:**
- ✅ Red safety badge: "CRITICAL — Severe toxicity risk"
- ✅ Warnings listed in result
- ✅ Vet message includes all warnings
- ✅ Clinical note documents warnings

### Test Case 9: Audit Trail Verification

**Check audit logs:**
```bash
# View audit logs for approval request
curl -H "Authorization: Bearer <admin_token>" \
  http://localhost:3000/api/audit-logs?entityType=dosage_approval

# Should show:
# - CREATE action when request submitted
# - APPROVE/REJECT action when vet responds
```

**Check clinical notes:**
```bash
# View clinical notes for pet
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/notes?petId=pet_test_123

# Should contain:
# - Subjective: "Dosage calculation approval requested"
# - Objective: Pet weight, calculated dose, safety level
# - Assessment: Safety evaluation
# - Plan: Pending review status with request ID
```

## Edge Cases to Test

### 1. Duplicate Approval Attempt
- ✅ Try to approve already approved request
- Expected: 400 "Request has already been processed"

### 2. Missing Required Fields
- ✅ Submit request without petId
- Expected: 400 "Validation error"

### 3. Invalid Vet ID
- ✅ Submit with non-existent vet
- Expected: Message still sent (vet may not receive)

### 4. Network Failure
- ✅ Disconnect network during request
- Expected: Error message, medication not created

### 5. Concurrent Approvals
- ✅ Two vets try to approve simultaneously
- Expected: First one succeeds, second gets "already processed"

## Performance Tests

### Load Testing
```bash
# Create 100 approval requests
for i in {1..100}; do
  curl -X POST \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{
      "petId": "pet_'$i'",
      "petName": "Pet '$i'",
      "drugName": "Carprofen",
      "calculatedDose": "50",
      "vetId": "vet_456"
    }' \
    http://localhost:3000/api/medications/dosage-approvals
done

# Verify all created successfully
# Check response times < 200ms
```

## Accessibility Testing

1. **Screen Reader:** Test with TalkBack/VoiceOver
   - Approval button announced correctly
   - Form fields have proper labels
   - Status badges readable

2. **Keyboard Navigation:** Tab through form fields
   - All interactive elements reachable
   - Focus indicators visible

3. **Color Contrast:** Check WCAG compliance
   - Pending badge (orange on light background)
   - Button text legible

## Security Testing

1. **SQL Injection:** Try malicious inputs
   ```bash
   curl -X POST -d '{"petName": "'; DROP TABLE medications;--"}' ...
   ```

2. **XSS Attempts:** Try script injection
   ```bash
   curl -X POST -d '{"vetNotes": "<script>alert(1)</script>"}' ...
   ```

3. **Authorization Bypass:** Try accessing with wrong roles

## Test Results Template

```markdown
## Test Run: [Date]

| Test Case | Status | Notes |
|-----------|--------|-------|
| Create Request | ✅ Pass | - |
| View Request (Owner) | ✅ Pass | - |
| Approve (Vet) | ✅ Pass | - |
| Modify Dose | ✅ Pass | - |
| Reject | ✅ Pass | - |
| Activate Medication | ✅ Pass | - |
| Authorization | ✅ Pass | - |
| Warnings | ✅ Pass | - |
| Audit Trail | ✅ Pass | - |
| Edge Cases | ✅ Pass | - |

**Overall: PASS**
```

## Known Issues / Limitations

1. Approval requests stored in-memory (backend)
   - Solution: Migrate to database in production

2. No push notification for vet
   - Solution: Implement in Phase 2

3. No request expiration
   - Solution: Add TTL in future update

4. No batch approval UI
   - Solution: Build vet dashboard later
