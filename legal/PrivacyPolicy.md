# Privacy Policy

**Last Updated:** April 28, 2026

**Effective Date:** [Insert Date]

---

## 1. Introduction

PetChain ("we," "our," or "us") is committed to protecting your privacy and personal data. This Privacy Policy explains how we collect, use, store, and share information when you use the PetChain mobile application ("App") and associated services.

By using PetChain, you consent to the practices described in this policy. If you do not agree, please do not use the App.

## 2. Information We Collect

### 2.1 Information You Provide Directly

We collect information you voluntarily enter into the App:

**Pet Profile Data:**
- Pet name, species, breed, date of birth, weight
- Medical history (vaccinations, illnesses, surgeries, allergies)
- Current and past medications
- Veterinary clinic information
- Emergency contact details

**Medical Records:**
- Clinical notes from veterinarians
- Lab results, test results, imaging data
- Prescription information
- Appointment history and notes

**Medication & Appointment Data:**
- Medication names, dosages, schedules
- Reminder preferences and notification settings
- Appointment dates, times, and locations

**Account Information:**
- Email address, name
- Profile photos (optional)
- Authentication credentials (securely hashed)

**Emergency Contacts:**
- Contact names and phone numbers
- Relationship to pet owner

**Community Features (if enabled):**
- Posts, comments, and likes
- Profile information shared publicly

### 2.2 Automatically Collected Information

When you use the App, we automatically collect:

**Technical Data:**
- Device type, operating system version
- App version and build number
- Crash reports and error logs (via Sentry)
- IP address and approximate location (for API routing only)
- Network connectivity status
- Push notification token (for reminders)

**Usage Analytics:**
- Feature usage patterns (which screens you visit)
- Time spent in the App
- Interactions with notifications
- Offline/online status changes

**Performance Data:**
- App launch times
- API response latency
- Database operation metrics

### 2.3 Third-Party Data

We may receive limited information from third-party authentication services if you choose to sign up with Google, Apple, or Facebook:
- Name and email address (from OAuth provider)
- Profile picture (if available and you consent)
- User ID (hashed, for authentication only)

We do not access your social media friends, contacts, or posts.

## 3. How We Use Your Information

We use the collected information for the following purposes:

### 3.1 Core App Functionality

- **Store and organize pet medical records** securely in one place
- **Provide medication reminders** based on your configured schedules
- **Send appointment notifications** before upcoming vet visits
- **Enable QR code identification** for quick pet profile sharing
- **Synchronize data** across your devices via encrypted cloud storage
- **Generate health metrics and dashboards** to track pet wellbeing
- **Facilitate emergency SOS alerts** to pre-configured contacts
- **Allow record export** as PDF for vet visits or insurance claims

### 3.2 Blockchain Verification

PetChain uses the **Stellar blockchain network** to create tamper-evident records of medical event hashes. **Important:** Only cryptographic hashes (not personally identifiable information) are written to the blockchain. This enables:
- Immutable audit trail of medical record modifications
- Verification that records have not been altered
- Timestamped proof of record existence

Your actual pet data remains encrypted and stored privately.

### 3.3 Analytics & Improvement

- **Crash reporting** (Sentry): We collect stack traces and device state when the App crashes to fix bugs
- **Performance monitoring:** Anonymous metrics to improve App speed and reliability
- **Feature usage analysis:** Understand which features are most valuable to prioritize development

### 3.4 Customer Support

- Respond to your questions or issues
- Investigate bugs or technical problems
- Provide account recovery assistance

### 3.5 Legal & Security

- Comply with legal obligations
- Enforce our Terms of Service
- Detect and prevent fraud or abuse
- Protect the rights, property, or safety of PetChain, our users, or the public

## 4. Data Storage & Security

### 4.1 Local Storage

All pet data is initially stored **locally on your device** using:
- **SQLite database** (encrypted with AES-256)
- **Secure store** for authentication tokens (iOS Keychain / Android Keystore)
- **AsyncStorage** for non-sensitive preferences

**Offline-First:** The App works completely offline. Data syncs to the cloud when an internet connection is available.

### 4.2 Cloud Storage

When you create an account, your data is encrypted and synced to our backend servers:
- **Encryption**: End-to-end encryption using industry-standard algorithms (AES-256-GCM)
- **Key Management**: Encryption keys stored in device secure storage, never transmitted to our servers in plaintext
- **Data Centers**: Hosted on secure cloud infrastructure (AWS/Google Cloud) with SOC 2 compliance
- **Backups**: Encrypted daily backups retained for 30 days

### 4.3 Blockchain Storage

On the Stellar blockchain, we store only:
- SHA-256 hash of each medical record
- Timestamp of record creation/modification
- Record type identifier (vaccination, medication, appointment, etc.)

**No PII on-chain:** Pet names, owner names, phone numbers, or any personally identifiable information are **never** written to the public blockchain.

### 4.4 Security Measures

We implement robust security controls:
- **Transport Layer Security (TLS 1.3)** for all API communications
- **Certificate pinning** to prevent man-in-the-middle attacks
- **Biometric authentication** support (Face ID / Touch ID / fingerprint)
- **Automatic logout** after period of inactivity
- **Screenshot detection** on rooted/jailbroken devices (optional)
- **Regular security audits** and penetration testing
- **GDPR & HIPAA-compliant** data handling procedures

However, no method of transmission or electronic storage is 100% secure. We cannot guarantee absolute security but strive to protect your data using industry best practices.

## 5. Data Sharing & disclosure

### 5.1 With Your Consent

We share data only when you explicitly choose to:

- **Vet/Clinic Sharing:** You can generate a QR code or shareable link to grant temporary access to your pet's medical records for a specific veterinarian. Access expires after 24 hours or can be revoked anytime.

- **Emergency SOS:** When you tap the SOS button, we send your pet's profile, your location, and emergency contact information to the designated emergency contacts via SMS or email.

- **Community Posts:** If you post in the community feed, that data is visible to other PetChain users based on your privacy settings.

- **Data Export:** When you export records as PDF or JSON, that file is saved to your device and can be shared via any method you choose.

### 5.2 Service Providers

We engage trusted third-party service providers to operate the App:

- **Sentry.io** (San Francisco, CA, USA): Error logging and crash reporting. Privacy Policy: https://sentry.io/privacy/
- **Push Notification Services:** Apple Push Notification service (APNs) and Firebase Cloud Messaging (FCM) to deliver reminders
- **Cloud Infrastructure:** AWS or Google Cloud Platform (region depends on deployment)
- **Email Service:** Transactional emails (password reset, notifications) via SendGrid or similar
- **Analytics:** Optional analytics services (Mixpanel, Amplitude) — disabled by default

These providers are contractually obligated to use your data only to provide the services we request and to implement appropriate security measures.

### 5.3 Legal & Safety Disclosures

We may disclose your information if required by law or to protect rights or safety:

- **Comply with legal process:** Respond to subpoenas, court orders, or legal requests
- **Enforce agreements:** Our Terms of Service and other agreements
- **Protect safety:** Prevent imminent physical harm to any person (including you or your pet)
- **Emergency services:** In rare cases, we may contact emergency services if we believe a user is in life-threatening danger and cannot call for help themselves

### 5.4 Business Transfers

If PetChain undergoes a merger, acquisition, or asset sale, your data may be transferred as part of that transaction. We will notify you via email and in-App notification before such a transfer, and the new entity will honor this Privacy Policy.

**We do NOT:**
- Sell your personal data to advertisers or data brokers
- Trade or rent your information to third parties for marketing purposes
- Use your pet's medical data for research without explicit opt-in consent

## 6. Your Rights & Choices

### 6.1 Access & Portability

You have the right to:
- **View all your data** in the App's Profile → Data Export section
- **Export your data** in JSON or PDF format (includes all pets, records, medications, appointments)
- **Receive a copy** of your data in a machine-readable format

### 6.2 Rectification & Deletion

- **Edit or delete** any pet profile, medical record, or medication entry at any time
- **Delete your entire account** via Settings → Delete Account
  - This initiates a 30-day grace period (during which you can cancel deletion)
  - After 30 days, all your data is permanently deleted from our servers
  - Note: Blockchain hashes cannot be deleted from the Stellar ledger (permanent by design), but they contain only cryptographic hashes, not your raw data
- **Request correction** of inaccurate data by contacting support@petchain.app

### 6.3 Privacy Controls

- **Opt out of analytics** in Settings → Privacy (disables usage analytics, not crash reporting)
- **Disable notifications** per reminder type (but we recommend keeping them for medication safety)
- **Turn off community features** entirely if you prefer private-only use
- **Revoke social media linking** (Google/Apple/Facebook sign-in) at any time

### 6.4 Data Retention

- **Local device data:** Retained until you uninstall the App or clear app data
- **Cloud data:** Retained until you delete your account
- **Backups:** Encrypted backups retained for 30 days for disaster recovery
- **Blockchain hashes:** Permanent (cannot be removed from Stellar ledger)
- **Analytics data:** Aggregated and anonymized after 12 months

### 6.5 Children's Privacy

The App is **not directed at children under 13** (or the age of digital consent in your jurisdiction). We do not knowingly collect data from children. If we learn we have collected data from a child, we will delete it promptly. Parents who believe their child has provided data should contact us at support@petchain.app.

## 7. International Data Transfers

PetChain operates globally with cloud infrastructure in multiple regions. Your data may be stored and processed in the United States or other countries where our service providers operate. We ensure appropriate safeguards (Standard Contractual Clauses, GDPR-compliant agreements) are in place for cross-border data transfers.

If you are in the European Economic Area (EEA), United Kingdom, or Switzerland, you have additional rights under GDPR:
- Lodge a complaint with your supervisory authority
- Object to certain processing activities
- Request restriction of processing
- Data portability to another service

## 8. Third-Party Links

The App may contain links to external websites (e.g., your veterinary clinic's website). We are not responsible for the privacy practices of those third parties. Please review their privacy policies separately.

## 9. Updates to This Policy

We may update this Privacy Policy periodically to reflect changes in our practices or legal requirements. The "Last Updated" date will be modified accordingly.

**Material changes** (e.g., new data categories, different sharing practices) will be communicated via:
- In-App notification banner (for 7 days after update)
- Email to your registered address (if we have it)
- Updated policy published at https://petchain.app/privacy

Your continued use after changes constitutes acceptance of the revised policy.

## 10. Contact Us

If you have questions, requests, or concerns about this Privacy Policy or our data practices, please contact:

**Email:** privacy@petchain.app  
**Postal Mail:** PetChain Legal Department, [Insert Physical Address]  
**Data Protection Officer:** dpo@petchain.app

We will respond within 30 days of receiving your request.

For GDPR-related requests, you may also contact our EU representative if applicable.

---

## Appendix A: Data Inventory

| Data Category | Collected? | Stored Locally | Stored Cloud | On Blockchain | Purpose |
|--------------|-----------|----------------|--------------|---------------|---------|
| Pet name & species | ✓ | ✓ (encrypted) | ✓ (encrypted) | ✗ | Profile identification |
| Medical records | ✓ | ✓ | ✓ | Hash only | Health tracking & vet access |
| Medication schedules | ✓ | ✓ | ✓ | ✗ | Reminder notifications |
| Appointment data | ✓ | ✓ | ✓ | ✗ | Scheduling & reminders |
| Emergency contacts | ✓ | ✓ | ✓ | ✗ | SOS functionality |
| Location data | ✗ (optional) | — | — | — | Not collected (except SOS) |
| Photos of pets | ✓ (optional) | ✓ | ✓ (encrypted) | ✗ | Visual identification |
| Analytics events | ✓ (opt-out) | ✓ (temp) | ✓ (anonymous) | ✗ | App improvement |
| Crash logs | ✓ | ✓ (temp) | ✓ (Sentry) | ✗ | Bug fixing |

## Appendix B: Permissions Explanation

| Permission (iOS/Android) | Usage | Required? |
|--------------------------|-------|-----------|
| Camera | Scan QR codes for pet identification | Yes (core feature) |
| Photo Library | Upload pet photos | No (optional) |
| Notifications | Medication and appointment reminders | Yes (core feature — can be disabled system-wide) |
| Face ID / Touch ID | Biometric authentication | No (optional) |
| Location (Background) | Emergency SOS location sharing | Yes (emergency feature only) |
| Contacts | Import emergency contacts | No (manual entry available) |

## Appendix C: Third-Party Service Providers

| Provider | Service | Data Shared | Privacy Policy |
|----------|---------|-------------|----------------|
| Sentry | Error logging | Stack traces, device info, anonymized user ID | https://sentry.io/privacy/ |
| Apple / Google | Push notifications | Device token, notification payload | Apple: https://www.apple.com/legal/privacy/ |
| Stellar Network | Blockchain verification | Cryptographic hash only (no PII) | https://stellar.org/privacy-policy |
| Cloud Provider (AWS/GCP) | Hosting & storage | All user data (encrypted) | AWS: https://aws.amazon.com/privacy/ |

---

**Thank you for trusting PetChain with your pet's health information.**
