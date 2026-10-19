/**
 * HouseholdInvitationScreen — accepts a household (family group) invitation and
 * handles its recovery states with actionable steps.
 *
 * Recovery states are server-confirmed (never guessed client-side). No pet data
 * is ever shown on this screen — household invitations only reveal membership,
 * keeping sensitive pet information private by default.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  acceptHouseholdInvitation,
  HouseholdInvitationError,
  type HouseholdInvitationRecoveryState,
} from '../services/familySharingService';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  token: string;
  onBack: () => void;
  onJoined: (familyGroupId: string) => void;
}

// ─── Recovery step content ────────────────────────────────────────────────────

interface RecoveryContent {
  title: string;
  message: string;
  steps: string[];
}

const RECOVERY_CONTENT: Record<
  Exclude<HouseholdInvitationRecoveryState, 'network' | 'unknown'>,
  RecoveryContent
> = {
  not_found: {
    title: 'Invitation not found',
    message: 'We could not find this household invitation.',
    steps: [
      'Check that you opened the latest invitation link.',
      'Ask the household owner to resend the invitation.',
    ],
  },
  expired: {
    title: 'Invitation expired',
    message: 'This household invitation is no longer valid.',
    steps: ['Ask the household owner to send you a new invitation.'],
  },
  already_used: {
    title: 'Invitation already used',
    message: 'This household invitation has already been used.',
    steps: [
      'You may already be a member of this household.',
      'Check your household list, or contact the household owner.',
    ],
  },
  revoked: {
    title: 'Invitation revoked',
    message: 'The household owner revoked this invitation.',
    steps: ['Ask the household owner to send you a new invitation.'],
  },
  wrong_account: {
    title: 'Wrong account',
    message:
      'You are signed in with a different account than the one this invitation was sent to.',
    steps: [
      'Sign out and sign in with the account the invitation was addressed to.',
      'Then open the invitation link again.',
    ],
  },
};

// ─── Screen ───────────────────────────────────────────────────────────────────

type ScreenState =
  | { status: 'loading' }
  | { status: 'success'; familyGroupId: string }
  | { status: 'recovery'; recovery: HouseholdInvitationRecoveryState; message: string };

const HouseholdInvitationScreen: React.FC<Props> = ({ token, onBack, onJoined }) => {
  const [state, setState] = useState<ScreenState>({ status: 'loading' });

  const accept = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const result = await acceptHouseholdInvitation(token);
      setState({ status: 'success', familyGroupId: result.familyGroupId });
    } catch (error) {
      const recovery =
        error instanceof HouseholdInvitationError
          ? error.recoveryState
          : 'unknown';
      setState({
        status: 'recovery',
        recovery,
        message: error instanceof Error ? error.message : 'Unable to accept the invitation.',
      });
    }
  }, [token]);

  useEffect(() => {
    void accept();
  }, [accept]);

  if (state.status === 'loading') {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color="#4CAF50" accessibilityLabel="Joining household" />
        <Text style={styles.loadingText}>Joining household…</Text>
      </View>
    );
  }

  if (state.status === 'success') {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <Text accessibilityRole="header" style={styles.title}>
          Welcome to the household!
        </Text>
        <Text style={styles.body}>You have joined the household.</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="View household"
          style={styles.button}
          onPress={() => onJoined(state.familyGroupId)}
        >
          <Text style={styles.buttonText}>View Household</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const retriable = state.recovery === 'network' || state.recovery === 'unknown';
  const content =
    state.recovery === 'network'
      ? {
          title: 'Unable to connect',
          message: 'You appear to be offline. Your invitation has not been accepted yet.',
          steps: ['Check your connection and try again.'],
        }
      : RECOVERY_CONTENT[
          state.recovery as Exclude<HouseholdInvitationRecoveryState, 'network' | 'unknown'>
        ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.recoveryContainer}
      accessibilityLiveRegion="polite"
    >
      <Text accessibilityRole="header" style={styles.title}>
        {content.title}
      </Text>
      <Text style={styles.body}>{content.message}</Text>
      {content.steps.map((step, index) => (
        <Text key={step} style={styles.step}>
          {index + 1}. {step}
        </Text>
      ))}

      {retriable ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Try accepting the invitation again"
          style={styles.button}
          onPress={() => void accept()}
        >
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.buttonSecondary}
          onPress={onBack}
        >
          <Text style={styles.buttonSecondaryText}>Back</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  recoveryContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#444',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#222',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#444',
    textAlign: 'center',
    marginBottom: 16,
  },
  step: {
    fontSize: 15,
    lineHeight: 22,
    color: '#333',
    marginBottom: 8,
  },
  button: {
    marginTop: 20,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondary: {
    marginTop: 20,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  buttonSecondaryText: {
    color: '#444',
    fontSize: 16,
  },
});

export default HouseholdInvitationScreen;