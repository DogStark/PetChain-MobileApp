import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import React, { Suspense } from 'react';
import { ActivityIndicator, StatusBar, Text, View } from 'react-native';

import { useNavigationTheme } from '../theme';
import type { RootStackParamList, MainTabParamList, PetStackParamList } from './types';
import { DEEP_LINK_PREFIX } from './types';
import LazyScreen from '../components/LazyScreen';
import { useNotificationBadge } from '../hooks/useNotificationBadge';
import type { Pet } from '../models/Pet';
// ── Critical screens (eagerly loaded) ────────────────────────────────────────
import AuthNavigator from '../screens/AuthNavigator';
import OnboardingScreen from '../screens/OnboardingScreen';
import PetHealthDashboardScreen from '../screens/PetHealthDashboardScreen';
import PetListScreen from '../screens/PetListScreen';
// ── Non-critical screens (lazy loaded) ───────────────────────────────────────
const AdoptionScreen = React.lazy(() => import('../screens/AdoptionScreen'));
const AppointmentScreen = React.lazy(() => import('../screens/AppointmentScreen'));
const AuditHistoryScreen = React.lazy(() => import('../screens/AuditHistoryScreen'));
const ClinicalNotesScreen = React.lazy(() => import('../screens/ClinicalNotesScreen'));
const CommunityScreen = React.lazy(() => import('../screens/CommunityScreen'));
const DeleteAccountScreen = React.lazy(() => import('../screens/DeleteAccountScreen'));
const EmergencyContactsScreen = React.lazy(() => import('../screens/EmergencyContactsScreen'));
const FiatOnRampScreen = React.lazy(() => import('../screens/FiatOnRampScreen'));
const ForumScreen = React.lazy(() => import('../screens/ForumScreen'));
const HealthAlertsScreen = React.lazy(() => import('../screens/HealthAlertsScreen'));
const LostFoundScreen = React.lazy(() => import('../screens/LostFoundScreen'));
const ManualEntryScreen = React.lazy(() => import('../screens/ManualEntryScreen'));
const MedicalRecordSearchScreen = React.lazy(() => import('../screens/MedicalRecordSearchScreen'));
const MedicalRecordViewerScreen = React.lazy(() => import('../screens/MedicalRecordViewerScreen'));
const MedicationScreen = React.lazy(() => import('../screens/MedicationScreen'));
const NearbyVetScreen = React.lazy(() => import('../screens/NearbyVetScreen'));
const NotificationCenterScreen = React.lazy(() => import('../screens/NotificationCenterScreen'));
const NotificationPreferencesScreen = React.lazy(
  () => import('../screens/NotificationPreferencesScreen'),
);
const PaymentScreen = React.lazy(() => import('../screens/PaymentScreen'));
const PetDetailScreen = React.lazy(() => import('../screens/PetDetailScreen'));
const PetFormScreen = React.lazy(() => import('../screens/PetFormScreen'));
const PetHealthMetricsScreen = React.lazy(() => import('../screens/PetHealthMetricsScreen'));
const PetProfileScreen = React.lazy(() => import('../screens/PetProfileScreen'));
const PetShareScreen = React.lazy(() => import('../screens/PetShareScreen'));
const PrivacyDashboardScreen = React.lazy(() => import('../screens/PrivacyDashboardScreen'));
const ProfileScreen = React.lazy(() => import('../screens/ProfileScreen'));
const QRScannerScreen = React.lazy(() => import('../screens/QRScannerScreen'));
const ReconciliationScreen = React.lazy(() => import('../screens/ReconciliationScreen'));
const ReferralScreen = React.lazy(() => import('../screens/ReferralScreen'));
const TelemedicineScreen = React.lazy(() => import('../screens/TelemedicineScreen'));
const TravelCertificateScreen = React.lazy(() => import('../screens/TravelCertificateScreen'));
const TrustlineScreen = React.lazy(() => import('../screens/TrustlineScreen'));
const VaccinationScreen = React.lazy(() => import('../screens/VaccinationScreen'));
const VetMapScreen = React.lazy(() => import('../screens/VetMapScreen'));
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
        {() => (
          <LazyScreen screenName="Adoption">
            <AdoptionScreen />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetDetail" options={{ title: 'Pet Details' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="PetDetail">
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
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="AuditHistory" options={{ title: 'Audit History' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="AuditHistory">
            <AuditHistoryScreen
              entityType={route.params.entityType}
              entityId={route.params.entityId}
              title={route.params.title}
              onBack={() => navigation.goBack()}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetProfile" options={{ title: 'Pet Profile' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="PetProfile">
            <PetProfileScreen petId={route.params.petId} onBack={() => navigation.goBack()} />
          </LazyScreen>
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
          <LazyScreen screenName="PetHealthMetrics">
            <PetHealthMetricsScreen
              petId={route.params.petId}
              petName={route.params.petName ?? 'Pet'}
              onBack={() => navigation.goBack()}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetForm" options={{ title: 'Pet Form' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="PetForm">
            <PetFormScreen
              pet={route.params?.pet}
              ownerId={route.params?.ownerId}
              onBack={() => navigation.goBack()}
              onSaved={() => navigation.goBack()}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="MedicalRecordSearch" options={{ title: 'Search Records' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="MedicalRecordSearch">
            <MedicalRecordSearchScreen
              petId={route.params.petId}
              onBack={() => navigation.goBack()}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="MedicalRecordViewer" options={{ title: 'Medical Records' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="MedicalRecordViewer">
            <MedicalRecordViewerScreen
              petId={route.params.petId}
              petName={route.params.petName}
              onBack={() => navigation.goBack()}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PetShare" options={{ title: 'Share Pet Profile' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="PetShare">
            <PetShareScreen
              petId={route.params.petId}
              petName={route.params.petName}
              onBack={() => navigation.goBack()}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="TravelCertificate" options={{ title: 'Travel Health Certificate' }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="TravelCertificate">
            <TravelCertificateScreen
              petId={route.params.petId}
              petName={route.params.petName}
              onBack={() => navigation.goBack()}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="NearbyVet" options={{ title: 'Nearby Vet Clinics' }}>
        {({ navigation }) => (
          <LazyScreen screenName="NearbyVet">
            <NearbyVetScreen onBack={() => navigation.goBack()} />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="VetMap" options={{ title: 'Vet Map' }}>
        {({ navigation }) => (
          <LazyScreen screenName="VetMap">
            <VetMapScreen
              onBookAppointment={(vetName, date, time) => {
                navigation.getParent()?.navigate('Appointments', {
                  initialVetName: vetName,
                  initialDate: date,
                  initialTime: time,
                  openBooking: true,
                });
              }}
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="VetMap" options={{ title: 'Vet Map' }}>
        {({ navigation }) => (
          <VetMapScreen
            onBookAppointment={(vetName, date, time) => {
              navigation.getParent()?.navigate('Appointments', {
                initialVetName: vetName,
                initialDate: date,
                initialTime: time,
                openBooking: true,
              });
            }}
          />
        )}
      </PetStack.Screen>
      <PetStack.Screen name="ReconciliationReport" options={{ title: 'Record Reconciliation' }}>
        {({ navigation }) => (
          <LazyScreen screenName="ReconciliationReport">
            <ReconciliationScreen onBack={() => navigation.goBack()} />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="TrustlineManager" options={{ title: 'Stellar Trustlines' }}>
        {({ navigation }) => (
          <LazyScreen screenName="TrustlineManager">
            <TrustlineScreen onBack={() => navigation.goBack()} />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen
        name="NotificationPreferences"
        options={{ title: 'Notification Preferences' }}
      >
        {({ navigation }) => (
          <LazyScreen screenName="NotificationPreferences">
            <NotificationPreferencesScreen onBack={() => navigation.goBack()} />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="PrivacyDashboard" options={{ title: 'Privacy Dashboard' }}>
        {({ navigation }) => (
          <LazyScreen screenName="PrivacyDashboard">
            <PrivacyDashboardScreen onDeleteAccount={() => navigation.navigate('DeleteAccount')} />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="DeleteAccount" options={{ title: 'Delete Account' }}>
        {({ navigation }) => (
          <LazyScreen screenName="DeleteAccount">
            <DeleteAccountScreen
              onBack={() => navigation.goBack()}
              onDeleted={() =>
                navigation
                  .getParent()
                  ?.getParent()
                  ?.reset({ index: 0, routes: [{ name: 'Auth' }] })
              }
            />
          </LazyScreen>
        )}
      </PetStack.Screen>
      <PetStack.Screen name="ClinicalNotes" options={{ headerShown: false }}>
        {({ route, navigation }) => (
          <LazyScreen screenName="ClinicalNotes">
            <ClinicalNotesScreen
              petId={route.params.petId}
              vetId={route.params.vetId}
              onBack={() => navigation.goBack()}
            />
          </LazyScreen>
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
      <Tab.Screen name="Medications" options={{ title: 'Medications' }}>
        {() => (
          <LazyScreen screenName="Medications">
            <MedicationScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="Appointments" options={{ title: 'Appointments' }}>
        {() => (
          <LazyScreen screenName="Appointments">
            <AppointmentScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="Vaccinations" options={{ title: 'Vaccinations' }}>
        {() => (
          <LazyScreen screenName="Vaccinations">
            <VaccinationScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="HealthAlerts" options={{ title: 'Alerts' }}>
        {() => (
          <LazyScreen screenName="HealthAlerts">
            <HealthAlertsScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="Telemedicine" options={{ title: 'Telemedicine' }}>
        {() => (
          <LazyScreen screenName="Telemedicine">
            <TelemedicineScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="Community" options={{ title: 'Community' }}>
        {() => (
          <LazyScreen screenName="Community">
            <CommunityScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="Referrals" options={{ title: 'Referrals' }}>
        {() => (
          <LazyScreen screenName="Referrals">
            <ReferralScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="Emergency" options={{ title: 'Emergency' }}>
        {() => (
          <LazyScreen screenName="Emergency">
            <EmergencyContactsScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen
        name="Notifications"
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
            refreshBadge();
          },
        }}
      >
        {() => (
          <LazyScreen screenName="Notifications">
            <NotificationCenterScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
      <Tab.Screen name="Profile" options={{ title: 'Profile' }}>
        {() => (
          <LazyScreen screenName="Profile">
            <ProfileScreen />
          </LazyScreen>
        )}
      </Tab.Screen>
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
      <Suspense
        fallback={
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" />
          </View>
        }
      >
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
            <RootStack.Screen name="Forum" options={{ headerShown: true, title: 'Forum' }}>
              {() => (
                <LazyScreen screenName="Forum">
                  <ForumScreen />
                </LazyScreen>
              )}
            </RootStack.Screen>
            <RootStack.Screen
              name="LostFound"
              options={{ headerShown: true, title: 'Lost & Found' }}
            >
              {() => (
                <LazyScreen screenName="LostFound">
                  <LostFoundScreen />
                </LazyScreen>
              )}
            </RootStack.Screen>

            {/* Modals */}
            <RootStack.Group screenOptions={{ presentation: 'modal' }}>
              <RootStack.Screen name="QRScanner">
                {({ route, navigation }) => (
                  <LazyScreen screenName="QRScanner">
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
                  </LazyScreen>
                )}
              </RootStack.Screen>
              <RootStack.Screen name="ManualEntry">
                {({ navigation }) => (
                  <LazyScreen screenName="ManualEntry">
                    <ManualEntryScreen
                      onSubmit={() => navigation.goBack()}
                      onClose={() => navigation.goBack()}
                    />
                  </LazyScreen>
                )}
              </RootStack.Screen>
              <RootStack.Screen
                name="Payment"
                options={{ headerShown: true, title: 'Premium Plans' }}
              >
                {() => (
                  <LazyScreen screenName="Payment">
                    <PaymentScreen />
                  </LazyScreen>
                )}
              </RootStack.Screen>
              <RootStack.Screen
                name="FiatOnRamp"
                options={{ headerShown: true, title: 'Fund Your Wallet' }}
              >
                {() => (
                  <LazyScreen screenName="FiatOnRamp">
                    <FiatOnRampScreen />
                  </LazyScreen>
                )}
              </RootStack.Screen>
            </RootStack.Group>
          </RootStack.Navigator>
        </NavigationContainer>
      </Suspense>
    </>
  );
}
