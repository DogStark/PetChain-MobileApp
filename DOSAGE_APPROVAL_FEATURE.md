# Dosage Approval Feature

## Overview
This feature adds a vet approval mechanism for dosage calculations to ensure medication safety. Calculated dosages are no longer applied directly to medication schedules without veterinary review.

## Implementation

### Frontend Components

#### 1. **Dosage Approval Service** (`src/services/dosageApprovalService.ts`)
- `requestVetApproval()` - Sends dosage calculation to vet via message
- `approveDosage()` - Handles vet approval/modification
- `activateApprovedMedication()` - Activates medication after approval

#### 2. **Updated Medication Model** (`src/models/Medication.ts`)
Added fields:
- `pendingApproval?: boolean` - Indicates pending vet approval
- `approvalRequestId?: string` - Links to approval request
- `reviewingVetId?: string` - Vet assigned to review

#### 3. **Dosage Calculator Screen** (`src/screens/DosageCalculatorScreen.tsx`)
New features:
- **"Request Vet Approval" button** - Opens modal to send approval request
- **Approval request modal** - Collects pet info, vet ID, and medication details
- **Pending approval badge** - Shows when request is sent
- **Audit trail** - Creates clinical note via `noteService`

#### 4. **Medication Screen** (`src/screens/MedicationScreen.tsx`)
- **"Pending vet review" badge** - Displayed on medication cards awaiting approval
- Visual indicator with ⏳ icon and orange styling

### Backend API

#### New Routes (`backend/server/routes/medications.ts`)

**POST /api/medications/dosage-approvals**
- Creates new dosage approval request
- Requires: petId, petName, drugName, calculatedDose, vetId
- Returns: Approval request object

**GET /api/medications/dosage-approvals/:id**
- Retrieves approval request details
- Authorization: Owner (own requests) or assigned vet

**POST /api/medications/dosage-approvals/:id/approve**
- Vet approves or modifies dosage
- Authorization: VET or ADMIN roles
- Body: `{ approvedDose?, approvedDoseUnit?, vetNotes? }`

**POST /api/medications/dosage-approvals/:id/reject**
- Vet rejects dosage calculation
- Authorization: VET or ADMIN roles
- Body: `{ vetNotes? }`

## User Flow

### Pet Owner Workflow
1. Navigate to Dosage Calculator
2. Select pet species and medication
3. Enter weight and dosage parameters
4. Click "Calculate Dose"
5. Review calculated dosage and safety warnings
6. Click "📋 Request Vet Approval"
7. Fill in pet details and vet ID
8. Submit request
9. Medication saved with `status: 'paused'` and "Pending vet review" badge
10. Wait for vet notification

### Veterinarian Workflow
1. Receive message with dosage calculation details
2. Review:
   - Pet weight
   - Calculated dose and safety level
   - Warnings (if any)
   - Request ID
3. Make decision:
   - **Approve**: Send POST to `/dosage-approvals/:id/approve`
   - **Modify**: Include `approvedDose` and `approvedDoseUnit` in approval
   - **Reject**: Send POST to `/dosage-approvals/:id/reject` with reason
4. System updates medication status to `active` upon approval

## Safety Features

### Audit Trail
Every dosage approval request creates a clinical note with:
- **Subjective**: Request description
- **Objective**: Pet weight, calculated dose, safety level
- **Assessment**: Safety evaluation and warnings
- **Plan**: Pending review status with request ID
- **Access Controls**: Owner (read), Vet (edit)

### Message Notification
Vet receives formatted message containing:
- 🔔 Icon for visibility
- Pet details (name, weight)
- Medication name
- Calculated dose with unit and total mg
- Safety level
- Warnings list
- Unique request ID for tracking

### Pending State Management
Medications pending approval:
- Status set to `paused` (cannot be administered)
- Special notes field indicates pending status
- Visual badge on medication card
- Cannot be activated until vet approves

## Data Structures

### DosageApprovalRequest
```typescript
{
  id: string;
  medicationId: string;
  petId: string;
  petName: string;
  petWeight: number;
  drugName: string;
  calculatedDose: string;
  calculatedDoseUnit: string;
  totalDoseMg: number;
  safetyLevel: string;
  requestedAt: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'modified' | 'rejected';
  vetId?: string;
  approvedDose?: string;
  approvedDoseUnit?: string;
  vetNotes?: string;
  approvedAt?: string;
}
```

## Testing Checklist

- [ ] Request vet approval with valid data
- [ ] Verify message sent to vet
- [ ] Check pending badge appears on medication card
- [ ] Verify clinical note created with correct data
- [ ] Test vet approval endpoint
- [ ] Test vet modification endpoint
- [ ] Test vet rejection endpoint
- [ ] Verify medication activates after approval
- [ ] Test authorization (owner cannot approve own request)
- [ ] Test audit trail logging for all actions

## Future Enhancements

1. **Push Notifications**: Notify vet immediately when approval requested
2. **In-App Approval UI**: Dedicated vet dashboard for approval queue
3. **Bulk Approval**: Approve multiple requests at once
4. **Approval History**: Track all approvals per medication
5. **Auto-Expiry**: Requests expire after 48 hours
6. **Dosage Templates**: Pre-approved dosages for common cases
