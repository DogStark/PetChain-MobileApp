import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import React from 'react';
import { StatusBar, Text } from 'react-native';

import { useNavigationTheme } from '../theme';
import type { RootStackParamList, MainTabParamList, PetStackParamList } from './types';
import { DEEP_LINK_PREFIX } from './types';
import { useNotificationBadge } from '../hooks/useNotificationBadge';
import type { Pet } from '../models/Pet';
import AdoptionScreen from '../screens/AdoptionScreen';
import AppointmentScreen from '../screens/AppointmentScreen';
import AuditHistoryScreen from '../screens/AuditHistoryScreen';
import AuthNavigator from '../screens/AuthNavigator';
import ClinicalNotesScreen from '../screens/ClinicalNotesScreen';
import CommunityScreen from '../screens/CommunityScreen';
import DeleteAccountScreen from '../screens/DeleteAccountScreen';
import EmergencyContactsScreen from '../screens/EmergencyContactsScreen';
import FiatOnRampScreen from '../screens/FiatOnRampScreen';
import ForumScreen from '../screens/ForumScreen';
import HealthAlertsScreen from '../screens/HealthAlertsScreen';
import LostFoundScreen from '../screens/LostFoundScreen';
import ManualEntryScreen from '../screens/ManualEntryScreen';
import MedicalRecordSearchScreen from '../screens/MedicalRecordSearchScreen';
import MedicalRecordViewerScreen from '../screens/MedicalRecordViewerScreen';
import MedicationScreen from '../screens/MedicationScreen';
import NearbyVetScreen from '../screens/NearbyVetScreen';
import NotificationCenterScreen from '../screens/NotificationCenterScreen';
import NotificationPreferencesScreen from '../screens/NotificationPreferencesScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import PaymentScreen from '../screens/PaymentScreen';
import PetDetailScreen from '../screens/PetDetailScreen';
import PetFormScreen from '../screens/PetFormScreen';
import PetHealthDashboardScreen from '../screens/PetHealthDashboardScreen';
import PetHealthMetricsScreen from '../screens/PetHealthMetricsScreen';
import PetListScreen from '../screens/PetListScreen';
import PetProfileScreen from '../screens/PetProfileScreen';
import PetShareScreen from '../screens/PetShareScreen';
import PrivacyDashboardScreen from '../screens/PrivacyDashboardScreen';
import ProfileScreen from '../screens/ProfileScreen';
import QRScannerScreen from '../screens/QRScannerScreen';
import ReconciliationScreen from '../screens/ReconciliationScreen';
import ReferralScreen from '../screens/ReferralScreen';
import TelemedicineScreen from '../screens/TelemedicineScreen';
import TravelCertificateScreen from '../screens/TravelCertificateScreen';
import TrustlineScreen from '../screens/TrustlineScreen';
import VaccinationScreen from '../screens/VaccinationScreen';
import { extractDeepLinkParams } from '../services/notificationService';
import performance from '../utils/performance';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const PetStack = createNativeStackNavigator<PetStackParamList>();

// ─── Pet Stack ────────────────────────────────────────────────────────────────
function PetNavigator() {
  return (
    <PetStack.Navigator>
      <PetStack.Screen name="PetListScreen" options={{ title: 'My Pets' }}>
        {({ navigation }) => (
          <PetListScreen
            onSelectPet={(pet) => navigation.navigate('PetDetail', { petId: pet.id })}
            onAddPet={() => navigation.navigate('PetForm', {})}
            onAdoptPet={() => navigation.navigate('Adoption')}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="Adoption" options={{ title: 'Adopt a Pet' }}>
        {() => <AdoptionScreen />}
      </PetStack.Screen>
      <PetStack.Screen name="PetDetail" options={{ title: 'Pet Details' }}>
        {({ route, navigation }) => (
          <PetDetailScreen
            petId={route.params.petId}
            onBack={() => navigation.goBack()}
            onEdit={(pet: Pet) => navigation.navigate('PetForm', { pet })}
            onHealthDashboard={(petId, petName) =>
              navigation.navigate('PetHealthDashboard', { petId, petName })
            }
            onShare={(petId, petName) => navigation.navigate('PetShare', { petId, petName })}
            onAuditHistory={(petId, petName) =>
              navigation.navigate('AuditHistory', {
                entityType: 'pet',
                entityId: petId,
                title: `${petName} • Audit`,
              })
            }
            onViewProfile={(petId) => navigation.navigate('PetProfile', { petId })}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="AuditHistory" options={{ title: 'Audit History' }}>
        {({ route, navigation }) => (
          <AuditHistoryScreen
            entityType={route.params.entityType}
            entityId={route.params.entityId}
            title={route.params.title}
            onBack={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetProfile" options={{ title: 'Pet Profile' }}>
        {({ route, navigation }) => (
          <PetProfileScreen petId={route.params.petId} onBack={() => navigation.goBack()} />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetHealthDashboard" options={{ title: 'Health Dashboard' }}>
        {({ route, navigation }) => (
          <PetHealthDashboardScreen
            petId={route.params.petId}
            petName={route.params.petName ?? 'Pet'}
            onBack={() => navigation.goBack()}
            onOpenMetrics={() =>
              navigation.navigate('PetHealthMetrics', {
                petId: route.params.petId,
                petName: route.params.petName,
              })
            }
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetHealthMetrics" options={{ title: 'Health metrics' }}>
        {({ route, navigation }) => (
          <PetHealthMetricsScreen
            petId={route.params.petId}
            petName={route.params.petName ?? 'Pet'}
            onBack={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetForm" options={{ title: 'Pet Form' }}>
        {({ route, navigation }) => (
          <PetFormScreen
            pet={route.params?.pet}
            ownerId={route.params?.ownerId}
            onBack={() => navigation.goBack()}
            onSaved={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="MedicalRecordSearch" options={{ title: 'Search Records' }}>
        {({ route, navigation }) => (
          <MedicalRecordSearchScreen
            petId={route.params.petId}
            onBack={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="MedicalRecordViewer" options={{ title: 'Medical Records' }}>
        {({ route, navigation }) => (
          <MedicalRecordViewerScreen
            petId={route.params.petId}
            petName={route.params.petName}
            onBack={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetShare" options={{ title: 'Share Pet Profile' }}>
        {({ route, navigation }) => (
          <PetShareScreen
            petId={route.params.petId}
            petName={route.params.petName}
            onBack={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="TravelCertificate" options={{ title: 'Travel Health Certificate' }}>
        {({ route, navigation }) => (
          <TravelCertificateScreen
            petId={route.params.petId}
            petName={route.params.petName}
            onBack={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="NearbyVet" options={{ title: 'Nearby Vet Clinics' }}>
        {({ navigation }) => <NearbyVetScreen onBack={() => navigation.goBack()} />}
      </PetStack.Screen>
      <PetStack.Screen name="ReconciliationReport" options={{ title: 'Record Reconciliation' }}>
        {({ navigation }) => <ReconciliationScreen onBack={() => navigation.goBack()} />}
      </PetStack.Screen>
      <PetStack.Screen name="TrustlineManager" options={{ title: 'Stellar Trustlines' }}>
        {({ navigation }) => <TrustlineScreen onBack={() => navigation.goBack()} />}
      </PetStack.Screen>
      <PetStack.Screen
        name="NotificationPreferences"
        options={{ title: 'Notification Preferences' }}
      >
        {({ navigation }) => <NotificationPreferencesScreen onBack={() => navigation.goBack()} />}
      </PetStack.Screen>
      <PetStack.Screen name="PrivacyDashboard" options={{ title: 'Privacy Dashboard' }}>
        {({ navigation }) => (
          <PrivacyDashboardScreen onDeleteAccount={() => navigation.navigate('DeleteAccount')} />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="DeleteAccount" options={{ title: 'Delete Account' }}>
        {({ navigation }) => (
          <DeleteAccountScreen
            onBack={() => navigation.goBack()}
            onDeleted={() =>
              navigation
                .getParent()
                ?.getParent()
                ?.reset({ index: 0, routes: [{ name: 'Auth' }] })
            }
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="ClinicalNotes" options={{ headerShown: false }}>
        {({ route, navigation }) => (
          <ClinicalNotesScreen
            petId={route.params.petId}
            vetId={route.params.vetId}
            onBack={() => navigation.goBack()}
          />
        )}
      </PetStack.Screen>
    </PetStack.Navigator>
  );
}

// ─── Main Tabs ────────────────────────────────────────────────────────────────
function MainTabs() {
  const { count: badgeCount, refresh: refreshBadge } = useNotificationBadge();

  return (
    <Tab.Navigator
      screenListeners={{
        tabPress: () => {
          // Refresh badge whenever any tab is pressed (covers returning from Notifications)
          refreshBadge();
        },
      }}
    >
      <Tab.Screen
        name="PetList"
        component={PetNavigator}
        options={{ title: 'Pets', headerShown: false }}
      />
      <Tab.Screen
        name="Medications"
        component={MedicationScreen}
        options={{ title: 'Medications' }}
      />
      <Tab.Screen
        name="Appointments"
        component={AppointmentScreen}
        options={{ title: 'Appointments' }}
      />
      <Tab.Screen
        name="Vaccinations"
        component={VaccinationScreen}
        options={{ title: 'Vaccinations' }}
      />
      <Tab.Screen
        name="HealthAlerts"
        component={HealthAlertsScreen}
        options={{ title: 'Alerts' }}
      />
      <Tab.Screen
        name="Telemedicine"
        component={TelemedicineScreen}
        options={{ title: 'Telemedicine' }}
      />
      <Tab.Screen name="Community" component={CommunityScreen} options={{ title: 'Community' }} />
      <Tab.Screen name="Referrals" component={ReferralScreen} options={{ title: 'Referrals' }} />
      <Tab.Screen
        name="Emergency"
        component={EmergencyContactsScreen}
        options={{ title: 'Emergency' }}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationCenterScreen}
        options={{
          title: 'Notifications',
          tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
          tabBarBadgeStyle: { backgroundColor: '#EF4444' },
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Text style={{ fontSize: size, color }}>🔔</Text>
          ),
        }}
        listeners={{
          tabPress: () => {
            // Refresh badge when navigating away from Notifications tab
            refreshBadge();
          },
        }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

// ─── Deep linking ─────────────────────────────────────────────────────────────
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: DEEP_LINK_PREFIX,
  config: {
    screens: {
      Onboarding: 'onboarding',
      Auth: 'auth',
      Main: {
        screens: {
          PetList: {
            screens: {
              PetListScreen: 'pets',
              PetDetail: 'pets/:petId',
              PetProfile: 'pets/:petId/profile',
              PetHealthDashboard: 'pets/:petId/dashboard',
              PetHealthMetrics: 'pets/:petId/health',
              PetForm: 'pets/form/:petId?',
              PetShare: 'pets/:petId/share',
              NearbyVet: 'nearby-vets',
            },
          },
          Medications: 'medications/:medicationId?',
          Appointments: 'appointments/:appointmentId?',
          Vaccinations: 'vaccinations/:vaccinationId?',
          HealthAlerts: 'health-alerts',
          Community: 'community',
          Referrals: 'referrals',
          Emergency: 'emergency/:sosId?',
          Notifications: 'notifications',
          Profile: 'profile',
        },
      },
      QRScanner: 'scan',
      ManualEntry: 'manual-entry',
      Payment: 'payment',
    },
  },
};

// ─── Root Navigator ───────────────────────────────────────────────────────────
export const navigationRef = React.createRef<
  Parameters<typeof NavigationContainer>[0]['ref'] & {
    getCurrentRoute?: () => { name?: string } | undefined;
  }
>();

/**
 * Handle notification deep linking
 * Navigates to the appropriate screen based on notification data
 */
export const handleNotificationDeepLink = (data: Record<string, unknown>): void => {
  if (!navigationRef.current) return;

  const deepLink = extractDeepLinkParams(data);
  if (!deepLink) return;

  // Get the current state to know if we're in the Main tab
  const nav = navigationRef.current;

  // Navigate to the appropriate tab/screen
  const state = (nav as any)?.getRootState?.();
  const isMainScreen = state?.routes?.[0]?.name === 'Main';

  if (isMainScreen) {
    // We're in Main, navigate within tabs
    const mainState = state?.routes?.[0]?.state;
    (nav as any)?.navigate?.('Main', {
      screen: deepLink.route,
      params: deepLink.params,
    });
  } else {
    // App might be in cold start, navigate to Main first
    (nav as any)?.navigate?.('Main', {
      screen: deepLink.route,
      params: deepLink.params,
    });
  }
};

// ─── Root Navigator ───────────────────────────────────────────────────────────
export default function AppNavigator() {
  const navRef = React.useRef<
    Parameters<typeof NavigationContainer>[0] & {
      getCurrentRoute?: () => { name?: string } | undefined;
    }
  >(null);

  // Set the ref for external use (e.g., from App.tsx)
  React.useEffect(() => {
    if (navRef.current) {
      Object.assign(navigationRef, navRef);
    }
  }, []);

  const navTheme = useNavigationTheme();
  const currentScreenSpan = React.useRef<ReturnType<typeof performance.startSpan> | undefined>(
    undefined,
  );

  // Listen for notification responses (taps) with deep linking
  React.useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      handleNotificationDeepLink(data);
    });

    return () => subscription.remove();
  }, []);

  return (
    <>
      <StatusBar
        barStyle={navTheme.dark ? 'light-content' : 'dark-content'}
        backgroundColor={navTheme.colors.card}
      />
      <NavigationContainer
        ref={navRef as React.Ref<never>}
        theme={navTheme}
        linking={linking}
        onStateChange={() => {
          const route = (
            navRef.current as { getCurrentRoute?: () => { name?: string } | undefined } | null
          )?.getCurrentRoute?.();
          const name = route?.name;
          // finish previous span
          try {
            performance.finishSpan(currentScreenSpan.current);
          } catch (e) {
            // ignore
          }

          if (name) {
            analyticsService.screenView(name);
            // start new screen span
            currentScreenSpan.current = performance.startSpan(`screen:${name}`);
            performance.recordMetric('screen.render_start', Date.now(), { screen: name });
          }
        }}
      >
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="Onboarding">
            {({ navigation }) => (
              <OnboardingScreen
                onComplete={() => navigation.replace('Auth')}
                onSkip={() => navigation.replace('Auth')}
              />
            )}
          </RootStack.Screen>

          <RootStack.Screen name="Auth">
            {({ navigation }) => (
              <AuthNavigator onAuthenticated={() => navigation.replace('Main')} />
            )}
          </RootStack.Screen>

          <RootStack.Screen name="Main" component={MainTabs} />
          <RootStack.Screen
            name="Forum"
            component={ForumScreen}
            options={{ headerShown: true, title: 'Forum' }}
          />
          <RootStack.Screen
            name="LostFound"
            component={LostFoundScreen}
            options={{ headerShown: true, title: 'Lost & Found' }}
          />

          {/* Modals */}
          <RootStack.Group screenOptions={{ presentation: 'modal' }}>
            <RootStack.Screen name="QRScanner">
              {({ route, navigation }) => (
                <QRScannerScreen
                  onScanSuccess={(data) => {
                    if (route.params?.onScanSuccess) {
                      route.params.onScanSuccess(data);
                    }
                    navigation.goBack();
                  }}
                  onClose={() => navigation.goBack()}
                  onManualEntry={() => navigation.replace('ManualEntry')}
                />
              )}
            </RootStack.Screen>
            <RootStack.Screen name="ManualEntry">
              {({ navigation }) => (
                <ManualEntryScreen
                  onSubmit={() => navigation.goBack()}
                  onClose={() => navigation.goBack()}
                />
              )}
            </RootStack.Screen>
            <RootStack.Screen
              name="Payment"
              component={PaymentScreen}
              options={{ headerShown: true, title: 'Premium Plans' }}
            />
            <RootStack.Screen
              name="FiatOnRamp"
              component={FiatOnRampScreen}
              options={{ headerShown: true, title: 'Fund Your Wallet' }}
            />
          </RootStack.Group>
        </RootStack.Navigator>
      </NavigationContainer>
    </>
  );
}
