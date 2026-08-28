# Requirements Document

## Introduction

Add a gamification layer to PetChain's medication adherence workflow. Pet owners earn streaks and badges for consistently administering medications on time, can optionally join a community leaderboard, and see their progress at a glance on the home screen widget. Missed doses reset the active streak but a recovery mechanic lets owners rebuild momentum without losing their all-time best.

---

## Requirements

### 1. Streak Tracking

**1.1** The system MUST track a **current streak** (consecutive days with all scheduled doses administered on time) per pet per medication.

**1.2** A day counts as "on time" when every scheduled dose for that day is logged (via `logDose`) within a configurable grace period (default: ±2 hours of the scheduled time).

**1.3** The system MUST track a **longest streak** (all-time best) per pet per medication, which is never reset.

**1.4** When a dose is logged on time and extends the current streak, the streak counter MUST increment by 1 for that day (multiple doses in one day do not increment the counter more than once per day).

**1.5** The system MUST persist streak data locally using AsyncStorage under the key `@streaks`, following the existing `storageService` pattern.

**1.6** Streak data MUST be structured as:
```
{
  petId: string,
  medicationId: string,
  currentStreak: number,
  longestStreak: number,
  lastOnTimeDayISO: string | null,   // date-only ISO (YYYY-MM-DD)
  recoveryStreakActive: boolean
}
```

---

### 2. Streak Reset and Recovery Mechanic

**2.1** If a full calendar day passes with at least one scheduled dose **not** logged (missed or skipped), the current streak MUST be reset to 0.

**2.2** After a reset, the system MUST activate a **recovery streak** — a secondary counter that tracks consecutive on-time days since the miss.

**2.3** When the recovery streak reaches **3 consecutive on-time days**, the system MUST:
- Promote the recovery streak value to the current streak.
- Deactivate the recovery streak flag.
- Display a "Back on Track" notification to the user.

**2.4** The longest streak MUST NOT be affected by resets or recovery.

---

### 3. Badge Awards

**3.1** The system MUST award badges automatically when streak milestones are reached. Required milestones:

| Badge ID | Name | Trigger |
|---|---|---|
| `streak_7` | Week Warrior | 7-day streak |
| `streak_30` | Monthly Champion | 30-day streak |
| `streak_90` | Iron Paw | 90-day streak |
| `first_dose` | First Step | First dose ever logged for a pet |
| `recovery` | Comeback Kid | Recovery streak successfully promoted |

**3.2** Each badge MUST be awarded only once per pet per badge type (no duplicates).

**3.3** Badge data MUST be persisted locally under the key `@badges`:
```
{
  id: string,           // uuid
  petId: string,
  medicationId: string,
  badgeType: BadgeType,
  earnedAt: string,     // ISO timestamp
  displayed: boolean    // false until user views it
}
```

**3.4** When a new badge is earned, the system MUST trigger a local push notification (using `expo-notifications`) congratulating the user.

**3.5** Newly earned (undisplayed) badges MUST show a visual indicator (badge count / dot) on the Achievements screen tab/button.

---

### 4. Achievements Screen

**4.1** A new `AchievementsScreen` MUST be accessible from the main navigation (same callback-prop pattern used by `AuthNavigator`).

**4.2** The screen MUST display three tabs: **Streaks**, **Badges**, **Leaderboard**.

**4.3** The **Streaks tab** MUST show, for each active medication per pet:
- Current streak (days)
- Longest streak (days)
- Recovery streak status (if active)
- A visual progress bar toward the next milestone badge

**4.4** The **Badges tab** MUST show all earned badges as cards with badge icon, name, description, date earned, and the pet name it was earned for. Unearned milestone badges MUST be shown as locked/greyed out.

**4.5** The screen MUST follow existing UI conventions: green `#4CAF50` primary, white cards with `borderRadius: 10`, `elevation: 2`, tab underline pattern.

---

### 5. Opt-In Community Leaderboard

**5.1** The leaderboard MUST be **opt-in only**. Users are NOT enrolled by default.

**5.2** The `User` model MUST be extended with a `gamificationPreferences` field:
```
{
  leaderboardOptIn: boolean,       // default: false
  leaderboardDisplayName?: string  // defaults to first name if not set
}
```

**5.3** The **Leaderboard tab** in `AchievementsScreen` MUST:
- Show an opt-in prompt if the user has not enrolled.
- Show the top-N (default: 20) users ranked by their highest current streak across all pets.
- Highlight the current user's own row.
- Display: rank, display name (never real name unless user sets it), streak count, badge count.

**5.4** Leaderboard data MUST be fetched from the backend API (`GET /api/gamification/leaderboard`) and cached locally for offline viewing.

**5.5** Opting out MUST immediately remove the user's entry from the leaderboard and clear their display name from the server.

---

### 6. Home Screen Streak Widget

**6.1** A `StreakDisplay` component MUST be created and rendered on the home/pet-list screen.

**6.2** The widget MUST show, for the pet with the highest current streak:
- Pet name and avatar
- Current streak count with a flame/fire icon
- A compact progress bar toward the next badge milestone

**6.3** If no streaks exist yet, the widget MUST show an encouraging empty state ("Start your first streak today!").

**6.4** Tapping the widget MUST navigate to the Achievements screen.

---

### 7. Gamification Service

**7.1** A `gamificationService.ts` MUST be created at `backend/services/gamificationService.ts` (backend API calls) and `src/services/gamificationService.ts` (local streak/badge logic).

**7.2** The local service MUST expose:
- `updateStreak(petId, medicationId, doseLog)` — called after every `logDose`; returns updated streak and any newly earned badges.
- `getStreaks(petId?)` — returns all streak records, optionally filtered by pet.
- `getBadges(petId?)` — returns all earned badges.
- `markBadgesDisplayed(badgeIds)` — marks badges as seen.
- `calculateStreakForDate(petId, medicationId, date)` — pure function for testing.
- `resetStreak(petId, medicationId)` — explicit reset (e.g. when a medication is discontinued).

**7.3** The backend service MUST expose:
- `submitStreakUpdate(payload)` — syncs local streak state to the server.
- `fetchLeaderboard(limit?)` — fetches ranked leaderboard entries.
- `updateLeaderboardPreferences(prefs)` — opt-in/out and display name update.

---

### 8. Data Migrations / Storage Initialization

**8.1** On first launch after the feature is deployed, the system MUST initialize empty streak and badge stores if they do not exist (no crash on missing keys).

**8.2** Existing `DoseLog` history MUST be replayed to seed initial streak values on first initialization (backfill).

**8.3** The sync service (`syncService.ts`) `SyncEntityType` MUST be extended to include `'streak'` and `'badge'` so gamification data participates in the existing offline sync queue.

---

### 9. Tests

**9.1** Unit tests MUST be written for:
- `calculateStreakForDate` — on-time, late, missed, boundary cases
- `updateStreak` — streak increment, reset on miss, recovery promotion
- Badge award logic — correct milestone triggers, no duplicate awards
- `getScheduleForRange` integration — verifying dose windows align with streak calculation

**9.2** Tests MUST live in `src/services/__tests__/gamificationService.test.ts` and follow the existing Jest + ts-jest setup.

**9.3** Tests MUST mock AsyncStorage (following the existing mock pattern in `src/__mocks__/`).

---

### 10. Non-Functional Requirements

**10.1** Streak calculation MUST be deterministic and timezone-aware (use local device timezone for day boundaries).

**10.2** All gamification storage operations MUST be non-blocking and MUST NOT delay the `logDose` call that triggers them.

**10.3** Leaderboard display names MUST never expose a user's real name or email without explicit consent.

**10.4** The feature MUST degrade gracefully offline — streaks and badges work fully offline; leaderboard shows cached data with a "last updated" timestamp.

---

## Glossary

| Term | Definition |
|---|---|
| **Streak** | A count of consecutive calendar days on which all scheduled medication doses were administered on time for a given pet/medication pair. |
| **Current Streak** | The active, running streak count. Resets to 0 on a missed day. |
| **Longest Streak** | The all-time best streak for a pet/medication pair. Never decremented. |
| **Recovery Streak** | A secondary counter that activates after a reset. Reaching 3 consecutive on-time days promotes it back to the current streak. |
| **On Time** | A dose logged within ±2 hours (configurable grace period) of its scheduled time. |
| **Missed Dose** | A scheduled dose that was not logged by end of the grace window for that day. |
| **Badge** | A one-time achievement awarded when a streak milestone or special event is reached. |
| **Leaderboard** | An opt-in ranked list of users sorted by their highest current streak across all pets. |
| **DoseLog** | The existing data record created when a user marks a medication dose as administered (`src/services/medicationService.ts`). |
| **Grace Period** | The configurable time window (default ±2 hours) around a scheduled dose time within which a logged dose is considered on time. |
