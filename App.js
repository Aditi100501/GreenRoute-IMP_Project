import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  useFocusEffect,
  useIsFocused,
  createNavigationContainerRef,
} from '@react-navigation/native';

const navigationRef = createNavigationContainerRef();

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const Tab = createBottomTabNavigator();
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ==========================================
// PUNE METRO NETWORK & CARBON ENGINE
// ==========================================
const AQUA_LINE_KM = {
  'Vanaz': 0.0,
  'Anand Nagar': 1.1,
  'Ideal Colony': 2.0,
  'Nal Stop': 3.1,
  'Garware College': 4.2,
  'Deccan Gymkhana': 5.0,
  'Chhatrapati Sambhaji Udyan': 5.8,
  'PMC': 6.6,
  'District Court': 7.5,
  'Mangalwar Peth': 8.4,
  'Pune Railway Station': 9.2,
  'Ruby Hall Clinic': 10.0,
  'Bund Garden': 11.0,
  'Yerawada': 12.1,
  'Kalyani Nagar': 13.4,
  'Ramwadi': 14.7,
};

const PURPLE_LINE_KM = {
  'PCMC': 0.0,
  'Sant Tukaram Nagar': 1.3,
  'Bhosari': 2.7,
  'Kasarwadi': 4.2,
  'Phugewadi': 5.6,
  'Dapodi': 7.0,
  'Bopodi': 8.3,
  'Khadki': 9.6,
  'Range Hill': 10.9,
  'Shivaji Nagar': 12.1,
  'District Court': 13.3,
  'Kasba Peth': 14.4,
  'Mandai': 15.5,
  'Swargate': 16.6,
};

const ALL_STATIONS = [
  ...Object.keys(AQUA_LINE_KM),
  ...Object.keys(PURPLE_LINE_KM).filter((s) => s !== 'District Court'),
];

const VEHICLE_SAVINGS_PER_KM = {
  mix: { label: 'Pune Avg Mix', factor: 55.0 },
  car: { label: 'Petrol Car', factor: 102.5 },
  bike: { label: 'Two-Wheeler', factor: 42.5 },
  auto: { label: 'CNG Auto', factor: 26.5 },
};

const BASE_POINTS = 5;
const POINT_VALUE_INR = 0.02;

function getMetroDistanceKm(fromStation, toStation) {
  if (!fromStation || !toStation || fromStation === toStation) return 1.1;

  if (fromStation in AQUA_LINE_KM && toStation in AQUA_LINE_KM) {
    return Math.max(1.0, Number(Math.abs(AQUA_LINE_KM[fromStation] - AQUA_LINE_KM[toStation]).toFixed(1)));
  }
  if (fromStation in PURPLE_LINE_KM && toStation in PURPLE_LINE_KM) {
    return Math.max(1.0, Number(Math.abs(PURPLE_LINE_KM[fromStation] - PURPLE_LINE_KM[toStation]).toFixed(1)));
  }
  const leg1 = fromStation in AQUA_LINE_KM
    ? Math.abs(AQUA_LINE_KM[fromStation] - AQUA_LINE_KM['District Court'])
    : Math.abs(PURPLE_LINE_KM[fromStation] - PURPLE_LINE_KM['District Court']);
  const leg2 = toStation in AQUA_LINE_KM
    ? Math.abs(AQUA_LINE_KM[toStation] - AQUA_LINE_KM['District Court'])
    : Math.abs(PURPLE_LINE_KM[toStation] - PURPLE_LINE_KM['District Court']);
  return Math.max(1.0, Number((leg1 + leg2).toFixed(1)));
}

function estimateMetroFare(distanceKm) {
  if (distanceKm <= 2) return 10;
  if (distanceKm <= 4) return 15;
  if (distanceKm <= 6) return 20;
  if (distanceKm <= 10) return 25;
  if (distanceKm <= 14) return 30;
  return 35;
}

// Verified Pune Metro Ticket Registry (Simulates Maha Metro AFC Backend)
const VERIFIED_TICKET_DB = {
  '09231217T155200004': { from: 'Vanaz', to: 'Anand Nagar' },
  'GR-VANAZ-ANAND': { from: 'Vanaz', to: 'Anand Nagar' },
  'GR-RUBY-VANAZ': { from: 'Ruby Hall Clinic', to: 'Vanaz' },
  'GR-PCMC-SWARGATE': { from: 'PCMC', to: 'Swargate' },
};

function calculateTripImpact(rawPayload, vehicleKey = 'mix') {
  const cleanTicketNo = rawPayload.replace(/\s+/g, '').toUpperCase();
  const displayId = cleanTicketNo.length > 22 ? cleanTicketNo.slice(0, 18) : cleanTicketNo;

  // 1. Check exact match in Verified Ticket Registry
  let fromStation = 'Vanaz';
  let toStation = 'Anand Nagar';

  if (VERIFIED_TICKET_DB[cleanTicketNo]) {
    fromStation = VERIFIED_TICKET_DB[cleanTicketNo].from;
    toStation = VERIFIED_TICKET_DB[cleanTicketNo].to;
  } else {
    // 2. Check if station names are embedded in QR string (e.g. GR|VANAZ|RAMWADI|123)
    const foundStations = ALL_STATIONS.filter((st) =>
      cleanTicketNo.includes(st.toUpperCase())
    );
    if (foundStations.length >= 2) {
      fromStation = foundStations[0];
      toStation = foundStations[1];
    }
  }

  const distance = getMetroDistanceKm(fromStation, toStation);
  const savingFactor = VEHICLE_SAVINGS_PER_KM[vehicleKey]?.factor || 55.0;
  const co2Grams = Math.round(savingFactor * distance);
  const carbonPoints = Math.round(co2Grams / 10);
  const subtotal = BASE_POINTS + carbonPoints;
  const streakBonus = Math.round(subtotal * 0.1);
  const totalPoints = subtotal + streakBonus;
  const fare = estimateMetroFare(distance);
  const maxCap = fare * 0.1;
  const discountRupees = Number(Math.min(totalPoints * POINT_VALUE_INR, maxCap).toFixed(2));

  return {
    ticket_no: displayId,
    route: `${fromStation} → ${toStation}`,
    distance_km: distance,
    co2_grams: co2Grams,
    points: totalPoints,
    discount_rupees: discountRupees,
  };
}

// Smooth Screen Entrance Wrapper
function FadeSlideView({ children, style }) {
  const isFocused = useIsFocused();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    if (isFocused) {
      fadeAnim.setValue(0);
      slideAnim.setValue(14);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 65,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isFocused]);

  return (
    <Animated.View
      style={[
        { flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ==========================================
// 0. ANIMATED SPLASH SCREEN
// ==========================================
function SplashScreen({ onFinish }) {
  const scaleAnim = useRef(new Animated.Value(0.75)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 50,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(onFinish, 1900);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.splashContainer}>
      <Animated.View
        style={[
          styles.splashContent,
          { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
        ]}
      >
        <View style={styles.splashIconCircle}>
          <Ionicons name="leaf" size={54} color="#a3f69c" />
        </View>
        <Text style={styles.splashTitle}>GreenRoute</Text>
        <Text style={styles.splashTagline}>
          Pune Metro Carbon Reward Framework
        </Text>
      </Animated.View>
      <View style={styles.splashFooter}>
        <Ionicons name="shield-checkmark" size={16} color="#cbffc2" />
        <Text style={styles.splashFooterText}>
          Powered by Pune Metro Sustainability Initiative
        </Text>
      </View>
    </View>
  );
}

// ==========================================
// 1. 3-STEP ONBOARDING CAROUSEL (FROM WELCOME HTMLs)
// ==========================================
const ONBOARDING_SLIDES = [
  {
    icon: 'train',
    title: 'Earn Rewards for Choosing Metro',
    desc: 'Join thousands of commuters in Pune making a greener choice. Track your trips and unlock exclusive sustainability perks.',
  },
  {
    icon: 'trophy',
    title: 'Earn Green Points',
    desc: 'Every time you choose Pune Metro, you take a step towards a cleaner environment. Earn green points and enjoy exciting rewards.',
  },
  {
    icon: 'earth',
    title: 'Track Your Impact',
    desc: 'See how your metro journeys help the planet. Track your carbon savings, monitor your progress and celebrate every sustainable trip.',
  },
];

function OnboardingScreen({ onDone }) {
  const [step, setStep] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  function goToStep(next) {
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0.25,
        duration: 130,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
    setStep(next);
  }

  const current = ONBOARDING_SLIDES[step];

  return (
    <SafeAreaView style={styles.onboardContainer}>
      <View style={styles.onboardHeader}>
        <View style={styles.topBarLeft}>
          <View style={styles.miniBrandIcon}>
            <Ionicons name="leaf" size={18} color="#cbffc2" />
          </View>
          <Text style={styles.topBarTitle}>GreenRoute</Text>
        </View>
        <TouchableOpacity onPress={() => onDone('login')}>
          <Text style={styles.linkText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <Animated.View style={[styles.onboardBody, { opacity: fadeAnim }]}>
        <View style={styles.onboardIllustration}>
          <Ionicons name={current.icon} size={76} color="#0d631b" />
        </View>
        <Text style={styles.onboardTitle}>{current.title}</Text>
        <Text style={styles.onboardDesc}>{current.desc}</Text>

        {/* Pagination Dots */}
        <View style={styles.dotsRow}>
          {ONBOARDING_SLIDES.map((_, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => goToStep(i)}
              style={[styles.dot, step === i && styles.dotActive]}
            />
          ))}
        </View>
      </Animated.View>

      <View style={styles.onboardFooter}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => {
            if (step < ONBOARDING_SLIDES.length - 1) {
              goToStep(step + 1);
            } else {
              onDone('signup');
            }
          }}
        >
          <Text style={styles.primaryBtnText}>
            {step === ONBOARDING_SLIDES.length - 1 ? 'Get Started →' : 'Next →'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => {
            if (step > 0) {
              goToStep(step - 1);
            } else {
              onDone('login');
            }
          }}
        >
          <Text style={styles.secondaryBtnText}>
            {step > 0 ? 'Back' : 'Login'}
          </Text>
        </TouchableOpacity>

        <View style={styles.verifiedRow}>
          <Ionicons name="checkmark-circle" size={15} color="#556158" />
          <Text style={styles.mutedSmall}>
            Powered by Pune Metro Sustainability Initiative
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ==========================================
// 2. SIGN UP & LOGIN SCREEN (FROM LOGIN & SIGNUP HTMLs)
// ==========================================
function AuthScreen({ initialMode = 'login', onShowWelcome }) {
  const [isSignUp, setIsSignUp] = useState(initialMode === 'signup');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAuth() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    if (isSignUp) {
      if (!fullName.trim()) {
        Alert.alert('Missing Name', 'Please enter your full name.');
        return;
      }
      if (password.length < 6) {
        Alert.alert('Weak Password', 'Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert(
          'Password Mismatch',
          'Passwords do not match. Please try again.'
        );
        return;
      }
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: { full_name: fullName.trim(), phone: phone.trim() },
          },
        });
        if (error) throw error;

        if (data?.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            full_name: fullName.trim(),
            email: email.trim().toLowerCase(),
          });
        }
        Alert.alert(
          'Account Created!',
          `Welcome to GreenRoute, ${fullName.trim()}!`
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
      }
    } catch (err) {
      Alert.alert('Authentication Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.authContainer}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.authInner}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoBox}>
            <Ionicons name="leaf" size={36} color="#fff" />
          </View>
          <Text style={styles.brandTitle}>GreenRoute</Text>
          <Text style={styles.brandSubtitle}>
            Sustainable transit for a cleaner Pune
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardHeading}>
              {isSignUp ? 'Join GreenRoute' : 'Welcome Back'}
            </Text>

            {isSignUp && (
              <TextInput
                style={styles.input}
                placeholder="Full Name"
                placeholderTextColor="#707a6c"
                value={fullName}
                onChangeText={setFullName}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Email Address"
              placeholderTextColor="#707a6c"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />

            {isSignUp && (
              <TextInput
                style={styles.input}
                placeholder="Phone Number"
                placeholderTextColor="#707a6c"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            )}

            <TextInput
              style={styles.input}
              placeholder={
                isSignUp ? 'Create Password (min 6 chars)' : 'Password'
              }
              placeholderTextColor="#707a6c"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            {isSignUp && (
              <TextInput
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor="#707a6c"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleAuth}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {isSignUp ? 'Create Account →' : 'Login →'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.switchAuthBtn}
              onPress={() => setIsSignUp(!isSignUp)}
            >
              <Text style={styles.switchAuthText}>
                {isSignUp
                  ? 'Already have an account? Login'
                  : "Don't have an account? Sign Up"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={{ marginTop: 18 }}
            onPress={onShowWelcome}
          >
            <Text style={styles.mutedSmall}>← Back to Welcome Tour</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ==========================================
// UNIFIED PROFILE & AVATAR CUSTOMIZER DRAWER
// ==========================================
function ProfileDrawerModal({
  visible,
  onClose,
  user,
  profile,
  trips,
  redemptions,
  avatar,
  onSaveAvatar,
  dailyRoute,
  onSaveRoute,
  onProfileUpdated,
  onShowWelcome,
  navigation,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.full_name || '');
  const [editingRoute, setEditingRoute] = useState(false);
  const [fromStation, setFromStation] = useState('Ruby Hall Clinic');
  const [toStation, setToStation] = useState('Vanaz');

  useEffect(() => {
    setNameInput(
      profile?.full_name || user?.user_metadata?.full_name || 'Commuter'
    );
  }, [profile, user]);

  useEffect(() => {
    if (dailyRoute && dailyRoute.includes('↔')) {
      const [a, b] = dailyRoute.split('↔');
      setFromStation(a.trim());
      setToStation(b.trim());
    }
  }, [dailyRoute]);

  const earnedPoints = trips.reduce((s, t) => s + t.points, 0);
  const spentPoints = redemptions.reduce((s, r) => s + r.points_spent, 0);
  const availablePoints = Math.max(0, earnedPoints - spentPoints);
  const totalCo2 = trips.reduce((s, t) => s + t.co2_grams, 0);
  const formattedCo2 =
    totalCo2 >= 1000 ? `${(totalCo2 / 1000).toFixed(2)} kg` : `${totalCo2} g`;

  const displayName =
    profile?.full_name || user?.user_metadata?.full_name || 'Commuter';
  const initials = displayName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  let tierLabel = 'Bronze Tier';
  if (earnedPoints >= 4840) tierLabel = 'Gold Tier';
  else if (earnedPoints >= 1606) tierLabel = 'Silver Tier';

  async function saveNewName() {
    if (!nameInput.trim()) return;
    await supabase
      .from('profiles')
      .update({ full_name: nameInput.trim() })
      .eq('id', user.id);
    setEditingName(false);
    onProfileUpdated();
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.drawerBackdrop}>
        <View style={styles.drawerPanel}>
          <ScrollView>
            <View style={styles.drawerHeader}>
              <TouchableOpacity
                onPress={onClose}
                style={styles.drawerCloseBtn}
              >
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>

              <View style={styles.drawerProfileRow}>
                <View style={styles.drawerAvatarCircle}>
                  <Text style={styles.drawerAvatarText}>
                    {avatar && avatar !== 'INITIALS' ? avatar : initials}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.drawerName}>{displayName}</Text>
                    <TouchableOpacity
                      onPress={() => setEditingName(!editingName)}
                    >
                      <Ionicons name="pencil" size={14} color="#a3f69c" />
                    </TouchableOpacity>
                  </View>
                  {editingName && (
                    <View style={styles.inlineEditRow}>
                      <TextInput
                        style={styles.inlineInput}
                        value={nameInput}
                        onChangeText={setNameInput}
                        placeholder="Your name"
                      />
                      <TouchableOpacity
                        style={styles.inlineSaveBtn}
                        onPress={saveNewName}
                      >
                        <Text style={styles.inlineSaveText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <Text style={styles.drawerRole}>Daily Pune Metro Rider</Text>
                  <View style={styles.tierPill}>
                    <Ionicons name="ribbon" size={12} color="#fff" />
                    <Text style={styles.tierPillText}>{tierLabel}</Text>
                  </View>
                </View>
              </View>

              {/* Avatar Picker */}
              <Text style={styles.avatarPickerLabel}>CHOOSE AVATAR</Text>
              <View style={styles.avatarRow}>
                {['🌿', '🚇', '👩🏽‍🎓', '🧑🏽‍💼', '🚴🏽‍♀️', 'INITIALS'].map((item) => (
                  <TouchableOpacity
                    key={item}
                    onPress={() => onSaveAvatar(item)}
                    style={[
                      styles.avatarChoice,
                      avatar === item && styles.avatarChoiceActive,
                    ]}
                  >
                    <Text style={styles.avatarChoiceText}>
                      {item === 'INITIALS' ? initials : item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Mini Profile Stats */}
              <View style={styles.drawerStatsRow}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.drawerStatNum}>{availablePoints}</Text>
                  <Text style={styles.drawerStatLbl}>POINTS</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.drawerStatNum}>{trips.length}</Text>
                  <Text style={styles.drawerStatLbl}>TRIPS</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.drawerStatNum}>{formattedCo2}</Text>
                  <Text style={styles.drawerStatLbl}>CO₂ SAVED</Text>
                </View>
              </View>
            </View>

            {/* Saved Daily Metro Route */}
            <View style={{ padding: 14, gap: 10 }}>
              <View style={styles.routeCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.routeLabel}>MY DAILY METRO ROUTE</Text>
                  <TouchableOpacity
                    onPress={() => setEditingRoute(!editingRoute)}
                  >
                    <Text style={styles.linkText}>Edit</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.routeValue}>{dailyRoute}</Text>
                <Text style={styles.mutedSmall}>
                  Pune Metro • One Pune Card Linked
                </Text>

                {editingRoute && (
                  <View style={{ marginTop: 8, gap: 8 }}>
                    <TextInput
                      style={styles.input}
                      value={fromStation}
                      onChangeText={setFromStation}
                      placeholder="Origin Station"
                    />
                    <TextInput
                      style={styles.input}
                      value={toStation}
                      onChangeText={setToStation}
                      placeholder="Destination Station"
                    />
                    <TouchableOpacity
                      style={styles.primaryBtn}
                      onPress={() => {
                        onSaveRoute(
                          `${fromStation.trim() || 'Ruby Hall Clinic'} ↔ ${
                            toStation.trim() || 'Vanaz'
                          }`
                        );
                        setEditingRoute(false);
                      }}
                    >
                      <Text style={styles.primaryBtnText}>Save Route</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Drawer Nav Links */}
              {[
                { label: 'Home Dashboard', icon: 'home', tab: 'Home' },
                { label: 'Scan Metro Ticket', icon: 'qr-code', tab: 'Scan' },
                { label: 'Rewards & Cashback', icon: 'ribbon', tab: 'Rewards' },
                { label: 'Sustainability Impact', icon: 'leaf', tab: 'Impact' },
              ].map((navItem) => (
                <TouchableOpacity
                  key={navItem.tab}
                  style={styles.drawerNavItem}
                  onPress={() => {
                    onClose();
                    navigation.navigate(navItem.tab);
                  }}
                >
                  <Ionicons name={navItem.icon} size={20} color="#0d631b" />
                  <Text style={styles.drawerNavText}>{navItem.label}</Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.drawerNavItem}
                onPress={() => {
                  onClose();
                  onShowWelcome();
                }}
              >
                <Ionicons name="hand-left-outline" size={20} color="#556158" />
                <Text style={styles.drawerNavText}>Welcome Tour</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.drawerNavItem, { marginTop: 4 }]}
                onPress={() => {
                  onClose();
                  supabase.auth.signOut();
                }}
              >
                <Ionicons name="log-out-outline" size={20} color="#ba1a1a" />
                <Text style={[styles.drawerNavText, { color: '#ba1a1a' }]}>
                  Sign Out
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
      </View>
    </Modal>
  );
}

// Reusable Top Bar with Menu & Avatar
function AppTopBar({ title, onOpenDrawer, displayName, avatar }) {
  const initials = (displayName || 'GR')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.topBar}>
      <View style={styles.topBarLeft}>
        <TouchableOpacity onPress={onOpenDrawer} style={{ padding: 4 }}>
          <Ionicons name="menu" size={24} color="#0d631b" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{title}</Text>
      </View>
      <TouchableOpacity onPress={onOpenDrawer} style={styles.topAvatarBtn}>
        <Text style={styles.topAvatarText}>
          {avatar && avatar !== 'INITIALS' ? avatar : initials}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ==========================================
// 3. HOME DASHBOARD SCREEN
// ==========================================
function HomeScreen({
  navigation,
  user,
  profile,
  trips,
  redemptions,
  onRefresh,
  onOpenDrawer,
  avatar,
}) {
  const [refreshing, setRefreshing] = useState(false);

  const earnedPoints = trips.reduce((sum, t) => sum + t.points, 0);
  const spentPoints = redemptions.reduce((sum, r) => sum + r.points_spent, 0);
  const availablePoints = Math.max(0, earnedPoints - spentPoints);
  const totalCo2 = trips.reduce((sum, t) => sum + t.co2_grams, 0);
  const formattedCo2 =
    totalCo2 >= 1000 ? `${(totalCo2 / 1000).toFixed(2)} kg` : `${totalCo2} g`;

  const silverGoal = 1606;
  const progressPct = Math.min(100, Math.round((earnedPoints / silverGoal) * 100));
  const rawName =
    profile?.full_name || user?.user_metadata?.full_name || 'Commuter';
  const firstName = rawName.split(' ')[0];

  const handlePullRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppTopBar
        title="GreenRoute"
        onOpenDrawer={onOpenDrawer}
        displayName={rawName}
        avatar={avatar}
      />

      <FadeSlideView>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handlePullRefresh}
            />
          }
        >
          <Text style={styles.greeting}>Hello, {firstName}!</Text>
          <Text style={styles.subGreeting}>
            Every Pune Metro ride earns Green Points & reduces city emissions.
          </Text>

          {/* Stats Grid */}
          <View style={styles.statsRow}>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => navigation.navigate('Rewards')}
            >
              <Ionicons name="leaf" size={26} color="#0d631b" />
              <Text style={styles.statLabel}>Current Green Points</Text>
              <Text style={styles.statValueGreen}>{availablePoints}</Text>
              <Text style={styles.statHint}>
                = ₹{(availablePoints * POINT_VALUE_INR).toFixed(2)} Fare Discount
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCard}
              onPress={() => navigation.navigate('Impact')}
            >
              <Ionicons name="cloud-done" size={26} color="#7a2faa" />
              <Text style={styles.statLabel}>CO₂ Saved</Text>
              <Text style={styles.statValuePurple}>{formattedCo2}</Text>
              <Text style={styles.statHint}>Pune Metro Eco Offset</Text>
            </TouchableOpacity>
          </View>

          {/* Scan CTA */}
          <TouchableOpacity
            style={styles.scanCta}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Scan')}
          >
            <View style={styles.scanCtaIcon}>
              <Ionicons name="qr-code-outline" size={28} color="#fff" />
            </View>
            <Text style={styles.scanCtaText}>Scan Pune Metro Ticket</Text>
          </TouchableOpacity>

          {/* Silver Tier Progress */}
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.88}
            onPress={() => navigation.navigate('Rewards')}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Silver Tier Progress</Text>
              <Text style={styles.boldGreen}>{progressPct}%</Text>
            </View>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedSmall}>
                1,606 pts = Silver Tier • ₹0.02/pt value
              </Text>
              <Text style={styles.linkText}>Redeem →</Text>
            </View>
          </TouchableOpacity>

          {/* Recent Journeys */}
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Recent Journeys</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Impact')}>
              <Text style={styles.linkText}>Full Breakdown</Text>
            </TouchableOpacity>
          </View>

          {trips.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No metro trips scanned yet</Text>
              <Text style={styles.emptySub}>
                Tap "Scan Pune Metro Ticket" above to scan your first QR code!
              </Text>
            </View>
          ) : (
            trips.slice(0, 6).map((trip) => (
              <TouchableOpacity
                key={trip.id}
                style={styles.tripItem}
                onPress={() => navigation.navigate('Impact')}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripRoute}>
                    {trip.route} ({trip.distance_km} km)
                  </Text>
                  <Text style={styles.tripMeta}>
                    Saved {trip.co2_grams} g CO₂ • Ticket {trip.ticket_no}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.tripPts}>+{trip.points} pts</Text>
                  <Text style={styles.tripRs}>
                    ₹{trip.discount_rupees} discount
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </FadeSlideView>
    </SafeAreaView>
  );
}

// ==========================================
// 4. NATIVE BACK-CAMERA QR SCANNER SCREEN
// ==========================================
function ScanScreen({
  navigation,
  user,
  profile,
  onTripAdded,
  onOpenDrawer,
  avatar,
}) {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState('back');
  const [scanned, setScanned] = useState(false);
  const [torch, setTorch] = useState(false);
  const [camError, setCamError] = useState('');

  // Manual code modal
  const [manualVisible, setManualVisible] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // Journey confirmation & dismissible result modals
  const [pendingTicket, setPendingTicket] = useState(null);
  const [fromStation, setFromStation] = useState('Vanaz');
  const [toStation, setToStation] = useState('Anand Nagar');
  const [vehicleMode, setVehicleMode] = useState('mix');
  const [pickingStationFor, setPickingStationFor] = useState(null); // 'from' | 'to' | null
  const [verifiedSummary, setVerifiedSummary] = useState(null);
  const [saving, setSaving] = useState(false);

  const scanLineAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setScanned(false);
      setCamError('');
      if (!permission?.granted) requestPermission();
    }, [permission?.granted])
  );

  function openJourneyConfirm(rawCode, method) {
    if (scanned) return;
    setScanned(true);

    // Auto-detect stations if encoded in QR text, otherwise keep Vanaz -> Anand Nagar
    const upper = rawCode.toUpperCase();
    const foundStations = ALL_STATIONS.filter((st) => upper.includes(st.toUpperCase()));
    if (foundStations.length >= 2) {
      setFromStation(foundStations[0]);
      setToStation(foundStations[1]);
    }
    setPendingTicket({ rawCode, method });
  }

async function confirmAndSaveTrip() {
    if (!pendingTicket || saving) return;
    setSaving(true);

    try {
      const calc = calculateTripImpact(pendingTicket.rawCode, vehicleMode);

      // 1. Anti-Fraud Check: Block if this ticket ID was already redeemed
      const { data: existingTicket } = await supabase
        .from('trips')
        .select('id')
        .eq('ticket_no', calc.ticket_no)
        .maybeSingle();

      if (existingTicket) {
        setPendingTicket(null);
        setScanned(false);
        Alert.alert(
          'Ticket Already Redeemed',
          `Ticket ${calc.ticket_no} has already been used to claim Green Points.`
        );
        return;
      }

      // 2. Save AFC-verified trip
      const { error } = await supabase.from('trips').insert({
        user_id: user.id,
        ticket_no: calc.ticket_no,
        route: calc.route,
        distance_km: calc.distance_km,
        co2_grams: calc.co2_grams,
        points: calc.points,
        discount_rupees: calc.discount_rupees,
        scan_method: pendingTicket.method,
      });

      if (error) throw error;
      await onTripAdded();

      setPendingTicket(null);
      setVerifiedSummary(calc);
    } catch (err) {
      Alert.alert('Error', err.message);
      setScanned(false);
    } finally {
      setSaving(false);
    }
  }

  function closeAllPopups() {
    setPendingTicket(null);
    setPickingStationFor(null);
    setVerifiedSummary(null);
    setScanned(false);
  }

  const handleBarCodeScanned = ({ data }) => {
    if (scanned || !data) return;
    openJourneyConfirm(data, 'QR Scan');
  };

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 238],
  });

  const rawName = profile?.full_name || user?.user_metadata?.full_name || 'Commuter';
  const previewCalc = pendingTicket
    ? calculateTripImpact(pendingTicket.rawCode, vehicleMode)
    : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppTopBar
        title="GreenRoute"
        onOpenDrawer={onOpenDrawer}
        displayName={rawName}
        avatar={avatar}
      />

      <FadeSlideView>
        <View style={styles.scanContainer}>
          <View style={styles.scannerPill}>
            <Text style={styles.scannerPillText}>PUNE METRO TICKET SCANNER</Text>
          </View>
          <Text style={styles.scanHeader}>Scan Ticket QR</Text>
          <Text style={styles.scanSub}>
            Auto-calculates distance, CO₂ saved & Green Points
          </Text>

          <View style={styles.cameraFrame}>
            {!permission ? (
              <ActivityIndicator size="large" color="#a3f69c" />
            ) : !permission.granted ? (
              <View style={styles.permBox}>
                <Ionicons name="camera-outline" size={36} color="#a3f69c" />
                <Text style={styles.permText}>
                  Tap below to allow camera access for scanning QR tickets.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
                  <Text style={styles.primaryBtnText}>Enable Camera</Text>
                </TouchableOpacity>
              </View>
            ) : camError ? (
              <View style={styles.permBox}>
                <Text style={styles.permText}>{camError}</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setCamError('')}>
                  <Text style={styles.primaryBtnText}>Retry Camera</Text>
                </TouchableOpacity>
              </View>
            ) : isFocused ? (
              <CameraView
                key={`cam-${facing}`}
                style={{ width: '100%', height: '100%' }}
                facing={facing}
                enableTorch={torch}
                barcodeScannerSettings={{ barcodeTypes: ['qr', 'aztec', 'datamatrix'] }}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                onMountError={(e) =>
                  setCamError(e.nativeEvent?.message || 'Could not start rear camera.')
                }
              />
            ) : null}

            <View style={styles.viewfinderBox} pointerEvents="none" />
            <Animated.View
              pointerEvents="none"
              style={[styles.scanLaser, { transform: [{ translateY: scanLineTranslate }] }]}
            />
          </View>

          <View style={styles.scanActionsRow}>
            <TouchableOpacity
              style={styles.actionCircleBtn}
              onPress={() => setFacing((prev) => (prev === 'back' ? 'front' : 'back'))}
            >
              <View style={styles.circleIconBg}>
                <Ionicons name="camera-reverse-outline" size={22} color="#0d631b" />
              </View>
              <Text style={styles.actionCircleLabel}>Flip Cam</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCircleBtn}
              onPress={() => setTorch((prev) => !prev)}
            >
              <View style={styles.circleIconBg}>
                <Ionicons name={torch ? 'flash' : 'flash-outline'} size={22} color="#0d631b" />
              </View>
              <Text style={styles.actionCircleLabel}>{torch ? 'Flash On' : 'Flash'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCircleBtn}
              onPress={() => setManualVisible(true)}
            >
              <View style={[styles.circleIconBg, { backgroundColor: '#0d631b' }]}>
                <Ionicons name="keypad-outline" size={22} color="#fff" />
              </View>
              <Text style={styles.actionCircleLabel}>Ticket NO</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionCircleBtn}
              onPress={() => openJourneyConfirm('09231217T155200004', 'Demo Ticket')}
            >
              <View style={styles.circleIconBg}>
                <Ionicons name="sparkles-outline" size={22} color="#0d631b" />
              </View>
              <Text style={styles.actionCircleLabel}>Demo Scan</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoBanner}>
            <Ionicons name="information-circle" size={18} color="#0d631b" />
            <Text style={styles.infoBannerText}>
              Supports QR scans & 18-digit Maha Metro Ticket NOs (e.g. 09231217T155200004).
            </Text>
          </View>
        </View>
      </FadeSlideView>

      {/* 1. Manual 18-Character Ticket NO Modal */}
      <Modal visible={manualVisible} transparent animationType="fade" onRequestClose={() => setManualVisible(false)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setManualVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardHeading}>Enter Ticket NO</Text>
              <TouchableOpacity onPress={() => setManualVisible(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color="#556158" />
              </TouchableOpacity>
            </View>
            <Text style={[styles.mutedSmall, { marginTop: 4 }]}>
              Enter the 18-character Ticket NO printed below your QR code.
            </Text>
            <TextInput
              style={[styles.input, { marginTop: 12, fontWeight: '700', letterSpacing: 1 }]}
              placeholder="09231217T155200004"
              autoCapitalize="characters"
              maxLength={24}
              value={manualCode}
              onChangeText={(txt) => setManualCode(txt.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
            />
            <View style={[styles.rowBetween, { marginTop: 6 }]}>
              <Text style={styles.mutedSmall}>Format: YYYYMMDD + T + HHMM + Seq</Text>
              <Text style={styles.boldGreen}>{manualCode.length} / 18</Text>
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={() => {
                if (manualCode.trim().length < 8) {
                  Alert.alert('Invalid Ticket NO', 'Please enter at least 8 characters.');
                  return;
                }
                const code = manualCode.trim();
                setManualVisible(false);
                setManualCode('');
                openJourneyConfirm(code, 'Manual Ticket NO');
              }}
            >
              <Text style={styles.primaryBtnText}>Next: Confirm Stations</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 2. Read-Only AFC Verified Ticket Modal */}
      <Modal visible={!!pendingTicket} transparent animationType="fade" onRequestClose={closeAllPopups}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeAllPopups}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardHeading}>AFC Ticket Verified</Text>
              <TouchableOpacity onPress={closeAllPopups} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color="#556158" />
              </TouchableOpacity>
            </View>

            {previewCalc && (
              <View style={{ backgroundColor: '#f1f8f2', borderRadius: 12, padding: 12, marginTop: 10, marginBottom: 12, borderWidth: 1, borderColor: '#d9e6da' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <Ionicons name="lock-closed" size={13} color="#0d631b" />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#0d631b' }}>
                    LOCKED PUNE METRO ROUTE • ID {previewCalc.ticket_no}
                  </Text>
                </View>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#1a1c1c' }}>
                  {previewCalc.route} ({previewCalc.distance_km} km)
                </Text>
              </View>
            )}

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#556158', marginBottom: 6 }}>
              WHICH VEHICLE DID YOU REPLACE?
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {Object.entries(VEHICLE_SAVINGS_PER_KM).map(([key, item]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setVehicleMode(key)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 16,
                    backgroundColor: vehicleMode === key ? '#0d631b' : '#eeeeee',
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: vehicleMode === key ? '#fff' : '#40493d' }}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {previewCalc && (
              <View style={{ backgroundColor: '#e8f5e9', borderRadius: 12, padding: 10, marginBottom: 12 }}>
                <Text style={styles.boldGreen}>
                  Saves {previewCalc.co2_grams} g CO₂ • +{previewCalc.points} Green Points
                </Text>
              </View>
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={confirmAndSaveTrip} disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Claim Green Points</Text>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 3. Dismissible Ticket Verified Result Card (Closes on X, Tap Outside, or Scan Another) */}
      <Modal visible={!!verifiedSummary} transparent animationType="fade" onRequestClose={closeAllPopups}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeAllPopups}>
          <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
            <View style={{ alignItems: 'flex-end' }}>
              <TouchableOpacity onPress={closeAllPopups} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color="#556158" />
              </TouchableOpacity>
            </View>

            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <View style={styles.heroCheckCircle}>
                <Ionicons name="checkmark-circle" size={44} color="#fff" />
              </View>
              <Text style={styles.cardHeading}>Ticket Verified!</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#1a1c1c', marginTop: 4 }}>
                {verifiedSummary?.route} ({verifiedSummary?.distance_km} km)
              </Text>
              <Text style={[styles.mutedSmall, { marginTop: 4 }]}>
                Saved {verifiedSummary?.co2_grams} g CO₂
              </Text>
              <Text style={[styles.boldGreen, { fontSize: 16, marginTop: 4 }]}>
                +{verifiedSummary?.points} Green Points Added!
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={() => {
                  closeAllPopups();
                  navigation.navigate('Impact');
                }}
              >
                <Text style={styles.secondaryBtnText}>View Impact</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]}
                onPress={() => {
                  closeAllPopups();
                  navigation.navigate('Home');
                }}
              >
                <Text style={styles.primaryBtnText}>Dashboard</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={{ alignItems: 'center', marginTop: 12 }} onPress={closeAllPopups}>
              <Text style={styles.linkText}>Scan Another Ticket</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ==========================================
// 5. REWARDS & CASHBACK SCREEN (FROM REWARDS HTML)
// ==========================================
function RewardsScreen({
  user,
  profile,
  trips,
  redemptions,
  onRefresh,
  onOpenDrawer,
  avatar,
}) {
  const [channel, setChannel] = useState('upi');
  const [upiId, setUpiId] = useState(profile?.upi_id || '');
  const [cardNo, setCardNo] = useState(profile?.smart_card || '');

  useEffect(() => {
    if (profile?.upi_id) setUpiId(profile.upi_id);
    if (profile?.smart_card) setCardNo(profile.smart_card);
  }, [profile]);

  const earnedPoints = trips.reduce((sum, t) => sum + t.points, 0);
  const spentPoints = redemptions.reduce((sum, r) => sum + r.points_spent, 0);
  const availablePoints = Math.max(0, earnedPoints - spentPoints);
  const totalCo2 = trips.reduce((sum, t) => sum + t.co2_grams, 0);
  const formattedCo2 =
    totalCo2 >= 1000 ? `${(totalCo2 / 1000).toFixed(2)} kg` : `${totalCo2} g`;

  // Dynamic Commuter Rank Progression (from rewards/code.html)
  let rankTitle = 'Eco Starter';
  let rankLevel = 'Level 1';
  let nextGoalGrams = 1000;
  let nextRankLabel = 'Next Rank: Sustainable Commuter (1.0 kg CO₂)';

  if (totalCo2 >= 15000) {
    rankTitle = 'Climate Guardian';
    rankLevel = 'Level 4 • Max';
    nextGoalGrams = 15000;
    nextRankLabel = 'Highest Eco Rank Unlocked!';
  } else if (totalCo2 >= 5000) {
    rankTitle = 'Pune Green Champion';
    rankLevel = 'Level 3';
    nextGoalGrams = 15000;
    nextRankLabel = 'Next Rank: Climate Guardian (15.0 kg CO₂)';
  } else if (totalCo2 >= 1000) {
    rankTitle = 'Sustainable Commuter';
    rankLevel = 'Level 2';
    nextGoalGrams = 5000;
    nextRankLabel = 'Next Rank: Pune Green Champion (5.0 kg CO₂)';
  }
  const rankPct = Math.min(100, Math.round((totalCo2 / nextGoalGrams) * 100));

  const TIERS = [
    { title: '₹2 Fare Cashback', cost: 100, rupees: 2 },
    { title: '₹5 Fare Cashback', cost: 250, rupees: 5 },
    { title: '₹10 Commuter Bonus', cost: 500, rupees: 10 },
    { title: 'Free Ride Reimbursement (₹30)', cost: 1500, rupees: 30 },
  ];

  async function savePayoutDetails() {
    await supabase
      .from('profiles')
      .update({ upi_id: upiId.trim(), smart_card: cardNo.trim() })
      .eq('id', user.id);
    Alert.alert('Saved', 'Your payout details have been updated.');
    onRefresh();
  }

  async function redeemTier(tier) {
    if (availablePoints < tier.cost) return;
    const dest =
      channel === 'upi'
        ? upiId.trim() || 'commuter@okaxis'
        : `Card •••• ${cardNo.replace(/\s+/g, '').slice(-4) || '3104'}`;
    const refNo = 'GR' + Math.floor(100000 + Math.random() * 900000);

    const { error } = await supabase.from('redemptions').insert({
      user_id: user.id,
      title: tier.title,
      points_spent: tier.cost,
      rupees: tier.rupees,
      channel,
      destination: dest,
      ref_no: refNo,
    });

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    Alert.alert(
      'Reward Redeemed!',
      `₹${tier.rupees} sent via ${channel.toUpperCase()} (${dest}).\nRef #${refNo}`
    );
    onRefresh();
  }

  const rawName =
    profile?.full_name || user?.user_metadata?.full_name || 'Commuter';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppTopBar
        title="Rewards & Cashback"
        onOpenDrawer={onOpenDrawer}
        displayName={rawName}
        avatar={avatar}
      />

      <FadeSlideView>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.card, { alignItems: 'center' }]}>
            <Text style={styles.statLabel}>AVAILABLE GREEN BALANCE</Text>
            <Text style={styles.balanceBig}>{availablePoints} pts</Text>
            <Text style={styles.boldGreen}>
              = ₹{(availablePoints * POINT_VALUE_INR).toFixed(2)} Cashback Value
              (₹0.02/pt)
            </Text>
          </View>

          {/* Payout Method */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>How Do You Want Your Reward?</Text>
              <Text style={styles.mutedSmall}>In-App Payout</Text>
            </View>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggleBtn, channel === 'upi' && styles.toggleActive]}
                onPress={() => setChannel('upi')}
              >
                <Text
                  style={[
                    styles.toggleText,
                    channel === 'upi' && styles.toggleTextActive,
                  ]}
                >
                  Direct UPI Cashback
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  channel === 'smartcard' && styles.toggleActive,
                ]}
                onPress={() => setChannel('smartcard')}
              >
                <Text
                  style={[
                    styles.toggleText,
                    channel === 'smartcard' && styles.toggleTextActive,
                  ]}
                >
                  Smart Card Top-Up
                </Text>
              </TouchableOpacity>
            </View>

            {channel === 'upi' ? (
              <TextInput
                style={styles.input}
                placeholder="Enter UPI ID (e.g. name@okaxis)"
                value={upiId}
                onChangeText={setUpiId}
              />
            ) : (
              <TextInput
                style={styles.input}
                placeholder="16-digit One Pune Card No."
                keyboardType="numeric"
                value={cardNo}
                onChangeText={setCardNo}
              />
            )}
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={savePayoutDetails}
            >
              <Text style={styles.secondaryBtnText}>Save Payout Details</Text>
            </TouchableOpacity>
          </View>

          {/* Completed Receipts */}
          {redemptions.map((r) => (
            <View key={r.id} style={styles.receiptCard}>
              <Text style={styles.boldGreen}>
                {r.title} • ₹{r.rupees} Sent
              </Text>
              <Text style={styles.mutedSmall}>
                {r.destination} • Ref #{r.ref_no}
              </Text>
            </View>
          ))}

          {/* Redemption Tiers */}
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Redeem Your Points</Text>
            <Text style={styles.boldGreen}>₹0.02 / pt rate</Text>
          </View>

          {TIERS.map((tier) => {
            const unlocked = availablePoints >= tier.cost;
            return (
              <View key={tier.title} style={styles.tripItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripRoute}>{tier.title}</Text>
                  <Text style={styles.tripMeta}>
                    {tier.cost} pts •{' '}
                    {channel === 'upi'
                      ? 'Instant UPI Payout'
                      : 'Smart Card Top-Up'}
                  </Text>
                </View>
                <TouchableOpacity
                  disabled={!unlocked}
                  onPress={() => redeemTier(tier)}
                  style={[
                    styles.redeemPill,
                    !unlocked && { backgroundColor: '#e2e2e2' },
                  ]}
                >
                  <Text
                    style={[
                      styles.redeemPillText,
                      !unlocked && { color: '#707a6c' },
                    ]}
                  >
                    {unlocked ? 'Redeem' : `${tier.cost - availablePoints} more`}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {/* Dynamic Commuter Rank Progression Card */}
          <View style={[styles.card, { backgroundColor: '#f1f8f2' }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>{rankTitle}</Text>
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeText}>{rankLevel}</Text>
              </View>
            </View>
            <Text style={styles.mutedSmall}>
              Your Pune Metro rides have saved {formattedCo2} of CO₂.
            </Text>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedSmall}>{nextRankLabel}</Text>
              <Text style={styles.boldGreen}>{rankPct}%</Text>
            </View>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${rankPct}%` }]} />
            </View>
          </View>
        </ScrollView>
      </FadeSlideView>
    </SafeAreaView>
  );
}

// ==========================================
// 6. SUSTAINABILITY IMPACT SCREEN (12-BADGE CAROUSEL)
// ==========================================
function ImpactScreen({ user, profile, trips, onOpenDrawer, avatar }) {
  const [badgePage, setBadgePage] = useState(0);

  const totalPoints = trips.reduce((sum, t) => sum + t.points, 0);
  const totalCo2 = trips.reduce((sum, t) => sum + t.co2_grams, 0);
  const totalDist = trips.reduce((sum, t) => sum + Number(t.distance_km), 0);
  const totalTrips = trips.length;

  const formattedCo2 =
    totalCo2 >= 1000 ? `${(totalCo2 / 1000).toFixed(2)} kg` : `${totalCo2} g`;

  // All 12 Eco Badges from your_impact_with_trip_summary/code.html
  const ALL_BADGES = [
    { name: 'First Ride', sub: '1 Metro Trip', unlocked: totalTrips >= 1, icon: 'leaf' },
    { name: '1 kg Club', sub: 'Save 1 kg CO₂', unlocked: totalCo2 >= 1000, icon: 'earth' },
    { name: 'City Explorer', sub: 'Ride 25 km', unlocked: totalDist >= 25, icon: 'compass' },
    { name: 'Metro Regular', sub: '5 Metro Trips', unlocked: totalTrips >= 5, icon: 'train' },
    { name: 'Green Streak', sub: '10 Metro Trips', unlocked: totalTrips >= 10, icon: 'flame' },
    { name: '5 kg Hero', sub: 'Save 5 kg CO₂', unlocked: totalCo2 >= 5000, icon: 'tree' },
    { name: '50 km Pro', sub: 'Ride 50 km', unlocked: totalDist >= 50, icon: 'navigate' },
    { name: 'Silver Tier', sub: '1,606 Points', unlocked: totalPoints >= 1606, icon: 'ribbon' },
    { name: '100 km Ace', sub: 'Ride 100 km', unlocked: totalDist >= 100, icon: 'speedometer' },
    { name: 'Eco Guardian', sub: 'Save 15 kg CO₂', unlocked: totalCo2 >= 15000, icon: 'globe' },
    { name: '25-Trip Vet', sub: '25 Metro Trips', unlocked: totalTrips >= 25, icon: 'shield-checkmark' },
    { name: 'Gold Tier', sub: '4,840 Points', unlocked: totalPoints >= 4840, icon: 'medal' },
  ];

  const unlockedCount = ALL_BADGES.filter((b) => b.unlocked).length;
  const badgePages = [
    ALL_BADGES.slice(0, 4),
    ALL_BADGES.slice(4, 8),
    ALL_BADGES.slice(8, 12),
  ];

  const weeklyGoalPct = Math.min(100, Math.round((totalTrips / 10) * 100));
  const tripsLeft = Math.max(0, 10 - totalTrips);
  const latestTrip = trips[0];
  const rawName =
    profile?.full_name || user?.user_metadata?.full_name || 'Commuter';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppTopBar
        title="Sustainability Impact"
        onOpenDrawer={onOpenDrawer}
        displayName={rawName}
        avatar={avatar}
      />

      <FadeSlideView>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Hero Checkmark Summary */}
          <View style={styles.impactHero}>
            <View style={styles.heroCheckCircle}>
              <Ionicons name="checkmark-circle" size={46} color="#fff" />
            </View>
            <Text style={styles.heroPointsTitle}>
              {latestTrip
                ? `${latestTrip.points} Green Points Added`
                : `${totalPoints} Total Green Points`}
            </Text>
            <Text style={styles.heroSub}>
              {latestTrip
                ? `You saved ${latestTrip.co2_grams} g CO₂ on ${latestTrip.route}!`
                : 'Scan a Pune Metro ticket to start tracking your impact.'}
            </Text>
          </View>

          {/* Primary 3 Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.miniStat}>
              <Text style={styles.statValueGreen}>{formattedCo2}</Text>
              <Text style={styles.statLabel}>CO₂ SAVED</Text>
            </View>
            <View style={styles.miniStat}>
              <Text style={styles.statValueGreen}>
                {totalDist.toFixed(1)} km
              </Text>
              <Text style={styles.statLabel}>DISTANCE</Text>
            </View>
            <View style={styles.miniStat}>
              <Text style={styles.statValueGreen}>{totalTrips}</Text>
              <Text style={styles.statLabel}>METRO TRIPS</Text>
            </View>
          </View>

          {/* Swipeable 12-Badge Carousel (3 Pages × 4 Badges) */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.sectionTitle}>Your Eco Badges</Text>
                <Text style={styles.mutedSmall}>
                  Swipe horizontally for all 12 milestones
                </Text>
              </View>
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeText}>
                  {unlockedCount} / 12 Unlocked
                </Text>
              </View>
            </View>

            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                const page = Math.round(
                  e.nativeEvent.contentOffset.x / (SCREEN_WIDTH - 64)
                );
                setBadgePage(Math.max(0, Math.min(2, page)));
              }}
            >
              {badgePages.map((group, idx) => (
                <View
                  key={idx}
                  style={{
                    width: SCREEN_WIDTH - 64,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  {group.map((b) => (
                    <View
                      key={b.name}
                      style={[
                        styles.badgeBox,
                        b.unlocked && styles.badgeBoxUnlocked,
                      ]}
                    >
                      <Ionicons
                        name={b.icon}
                        size={22}
                        color={b.unlocked ? '#0d631b' : '#707a6c'}
                      />
                      <Text style={styles.badgeTitle}>{b.name}</Text>
                      <Text style={styles.badgeSub}>
                        {b.unlocked ? 'Unlocked ✓' : b.sub}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>

            <View style={[styles.dotsRow, { marginTop: 4 }]}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={[styles.dot, badgePage === i && styles.dotActive]}
                />
              ))}
            </View>
          </View>

          {/* Weekly Commute Goal */}
          <View style={[styles.card, { backgroundColor: '#f1f8f2' }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Weekly Commute Goal</Text>
              <Text style={styles.boldGreen}>{weeklyGoalPct}% Reached</Text>
            </View>
            <View style={styles.progressBg}>
              <View
                style={[styles.progressFill, { width: `${weeklyGoalPct}%` }]}
              />
            </View>
            <Text style={styles.mutedSmall}>
              {tripsLeft > 0
                ? `${tripsLeft} more metro trips to unlock your Green Streak Badge.`
                : 'Weekly goal complete! You unlocked your Green Streak Badge!'}
            </Text>
          </View>

          {/* Trip Carbon Breakdown */}
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Trip Carbon Breakdown</Text>
            <Text style={styles.boldGreen}>
              ₹{(totalPoints * POINT_VALUE_INR).toFixed(2)} Value
            </Text>
          </View>

          {trips.map((t) => (
            <View key={t.id} style={styles.tripItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tripRoute}>
                  {t.route} ({t.distance_km} km)
                </Text>
                <Text style={styles.tripMeta}>
                  {t.co2_grams} g CO₂ saved • {t.scan_method}
                </Text>
              </View>
              <Text style={styles.tripPts}>+{t.points} pts</Text>
            </View>
          ))}
        </ScrollView>
      </FadeSlideView>
    </SafeAreaView>
  );
}

// ==========================================
// MAIN APP ROOT WITH SPLASH, ONBOARDING & TABS
// ==========================================
export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [profile, setProfile] = useState(null);
  const [trips, setTrips] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatar, setAvatar] = useState('INITIALS');
  const [dailyRoute, setDailyRoute] = useState('Ruby Hall Clinic ↔ Vanaz');

  useEffect(() => {
    AsyncStorage.getItem('greenroute_seen_onboarding').then((val) => {
      if (!val) setShowOnboarding(true);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const fetchUserData = useCallback(async () => {
    if (!session?.user) return;
    const uid = session.user.id;

    const savedAvatar = await AsyncStorage.getItem(`avatar_${uid}`);
    if (savedAvatar) setAvatar(savedAvatar);

    const savedRoute = await AsyncStorage.getItem(`route_${uid}`);
    if (savedRoute) setDailyRoute(savedRoute);

    let { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single();

    if (!prof) {
      const fallbackName =
        session.user.user_metadata?.full_name ||
        session.user.email.split('@')[0];
      const { data: created } = await supabase
        .from('profiles')
        .upsert({ id: uid, full_name: fallbackName, email: session.user.email })
        .select()
        .single();
      prof = created;
    }

    const { data: tripRows } = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    const { data: redRows } = await supabase
      .from('redemptions')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    setProfile(prof);
    setTrips(tripRows || []);
    setRedemptions(redRows || []);
  }, [session]);

  useEffect(() => {
    fetchUserData();
  }, [fetchUserData]);

  async function handleSaveAvatar(newAvatar) {
    setAvatar(newAvatar);
    if (session?.user) {
      await AsyncStorage.setItem(`avatar_${session.user.id}`, newAvatar);
    }
  }

  async function handleSaveRoute(newRoute) {
    setDailyRoute(newRoute);
    if (session?.user) {
      await AsyncStorage.setItem(`route_${session.user.id}`, newRoute);
    }
  }

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (loadingSession) {
    return (
      <View
        style={[
          styles.screen,
          { justifyContent: 'center', alignItems: 'center' },
        ]}
      >
        <ActivityIndicator size="large" color="#0d631b" />
      </View>
    );
  }

  if (!session && showOnboarding) {
    return (
      <SafeAreaProvider>
        <OnboardingScreen
          onDone={async (targetMode) => {
            await AsyncStorage.setItem('greenroute_seen_onboarding', 'true');
            setAuthMode(targetMode);
            setShowOnboarding(false);
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <AuthScreen
          initialMode={authMode}
          onShowWelcome={() => setShowOnboarding(true)}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: '#0d631b',
            tabBarInactiveTintColor: '#5b675e',
            tabBarStyle: {
              backgroundColor: '#ffffff',
              borderTopColor: '#e2e2e2',
              height: Platform.OS === 'ios' ? 84 : 64,
              paddingBottom: Platform.OS === 'ios' ? 24 : 8,
              paddingTop: 6,
            },
            tabBarIcon: ({ focused, color, size }) => {
              const icons = {
                Home: focused ? 'home' : 'home-outline',
                Scan: focused ? 'qr-code' : 'qr-code-outline',
                Rewards: focused ? 'ribbon' : 'ribbon-outline',
                Impact: focused ? 'leaf' : 'leaf-outline',
              };
              return (
                <Ionicons name={icons[route.name]} size={size} color={color} />
              );
            },
          })}
        >
          <Tab.Screen name="Home">
            {(props) => (
              <HomeScreen
                {...props}
                user={session.user}
                profile={profile}
                trips={trips}
                redemptions={redemptions}
                onRefresh={fetchUserData}
                onOpenDrawer={() => setDrawerOpen(true)}
                avatar={avatar}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Scan">
            {(props) => (
              <ScanScreen
                {...props}
                user={session.user}
                profile={profile}
                onTripAdded={fetchUserData}
                onOpenDrawer={() => setDrawerOpen(true)}
                avatar={avatar}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Rewards">
            {(props) => (
              <RewardsScreen
                {...props}
                user={session.user}
                profile={profile}
                trips={trips}
                redemptions={redemptions}
                onRefresh={fetchUserData}
                onOpenDrawer={() => setDrawerOpen(true)}
                avatar={avatar}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Impact">
            {(props) => (
              <ImpactScreen
                {...props}
                user={session.user}
                profile={profile}
                trips={trips}
                onOpenDrawer={() => setDrawerOpen(true)}
                avatar={avatar}
              />
            )}
          </Tab.Screen>
        </Tab.Navigator>

        <ProfileDrawerModal
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          user={session.user}
          profile={profile}
          trips={trips}
          redemptions={redemptions}
          avatar={avatar}
          onSaveAvatar={handleSaveAvatar}
          dailyRoute={dailyRoute}
          onSaveRoute={handleSaveRoute}
          onProfileUpdated={fetchUserData}
          onShowWelcome={() => {
            supabase.auth.signOut();
            setShowOnboarding(true);
          }}
          navigation={{
            navigate: (screenName) => {
              if (navigationRef.isReady()) {
                navigationRef.navigate(screenName);
              }
            },
          }}
        />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

// ==========================================
// STYLES (ECO-TECH MODERNISM DESIGN SYSTEM)
// ==========================================
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f9f9f9' },
  // Splash
  splashContainer: {
    flex: 1,
    backgroundColor: '#0d631b',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 56,
  },
  splashContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashIconCircle: {
    width: 104,
    height: 104,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  splashTitle: {
    fontSize: 38,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  splashTagline: {
    fontSize: 14,
    color: '#cbffc2',
    marginTop: 6,
  },
  splashFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  splashFooterText: { color: '#cbffc2', fontSize: 12 },
  // Onboarding
  onboardContainer: {
    flex: 1,
    backgroundColor: '#f5f8f2',
    justifyContent: 'space-between',
    padding: 22,
  },
  onboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  miniBrandIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#2e7d32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardBody: {
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  onboardIllustration: {
    width: 156,
    height: 156,
    borderRadius: 36,
    backgroundColor: '#d9e6da',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  onboardTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#002204',
    textAlign: 'center',
    marginBottom: 12,
  },
  onboardDesc: {
    fontSize: 15,
    color: '#40493d',
    textAlign: 'center',
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 26,
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#bfcaba',
  },
  dotActive: {
    width: 24,
    backgroundColor: '#0d631b',
  },
  onboardFooter: { gap: 10 },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
  },
  // Auth
  authContainer: { flex: 1, backgroundColor: '#f2f8f3' },
  authInner: { padding: 22, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  logoBox: {
    width: 66,
    height: 66,
    borderRadius: 18,
    backgroundColor: '#2e7d32',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  brandTitle: { fontSize: 30, fontWeight: '800', color: '#0d631b' },
  brandSubtitle: { fontSize: 13, color: '#40493d', marginBottom: 20, textAlign: 'center' },
  // Top Bar
  topBar: {
    height: 56,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#eeeeee',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topBarTitle: { fontSize: 20, fontWeight: '700', color: '#0d631b' },
  topAvatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#d9e6da',
    borderWidth: 1.5,
    borderColor: '#0d631b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topAvatarText: { fontSize: 14, fontWeight: '700', color: '#0d631b' },
  // Drawer
  drawerBackdrop: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  drawerPanel: {
    width: '82%',
    maxWidth: 330,
    backgroundColor: '#ffffff',
    height: '100%',
  },
  drawerHeader: {
    backgroundColor: '#0d631b',
    paddingTop: 52,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  drawerCloseBtn: { position: 'absolute', top: 46, right: 14, padding: 4 },
  drawerProfileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  drawerAvatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 2,
    borderColor: '#a3f69c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerAvatarText: { fontSize: 24, fontWeight: '700', color: '#ffffff' },
  drawerName: { fontSize: 19, fontWeight: '700', color: '#ffffff' },
  drawerRole: { fontSize: 12, color: '#cbffc2', marginTop: 2 },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  tierPillText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  inlineEditRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  inlineInput: {
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 8,
    height: 30,
    flex: 1,
    fontSize: 12,
  },
  inlineSaveBtn: {
    backgroundColor: '#a3f69c',
    borderRadius: 6,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  inlineSaveText: { fontSize: 11, fontWeight: '700', color: '#002204' },
  avatarPickerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#a3f69c',
    marginTop: 14,
    marginBottom: 6,
  },
  avatarRow: { flexDirection: 'row', justifyContent: 'space-between' },
  avatarChoice: {
    width: 40,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarChoiceActive: {
    borderWidth: 2,
    borderColor: '#a3f69c',
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  avatarChoiceText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  drawerStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  drawerStatNum: { fontSize: 16, fontWeight: '700', color: '#a3f69c' },
  drawerStatLbl: { fontSize: 10, color: '#ffffff', marginTop: 2 },
  routeCard: {
    backgroundColor: '#f1f8f2',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#d9e6da',
  },
  routeLabel: { fontSize: 10, fontWeight: '700', color: '#0d631b' },
  routeValue: { fontSize: 14, fontWeight: '700', color: '#1a1c1c', marginTop: 2 },
  drawerNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  drawerNavText: { fontSize: 15, fontWeight: '600', color: '#1a1c1c' },
  // Content
  scrollContent: { padding: 16, gap: 14, paddingBottom: 28 },
  greeting: { fontSize: 26, fontWeight: '700', color: '#1a1c1c' },
  subGreeting: { fontSize: 13, color: '#40493d', marginTop: -8 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  miniStat: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  statLabel: { fontSize: 11, color: '#556158', marginTop: 4, fontWeight: '600' },
  statValueGreen: { fontSize: 22, fontWeight: '700', color: '#0d631b', marginTop: 2 },
  statValuePurple: { fontSize: 22, fontWeight: '700', color: '#7a2faa', marginTop: 2 },
  statHint: { fontSize: 11, color: '#2e7d32', marginTop: 2, fontWeight: '600' },
  scanCta: {
    backgroundColor: '#0d631b',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanCtaIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCtaText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  card: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    gap: 10,
  },
  cardHeading: { fontSize: 18, fontWeight: '700', color: '#1a1c1c' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1a1c1c' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  boldGreen: { color: '#0d631b', fontWeight: '700', fontSize: 13 },
  linkText: { color: '#0d631b', fontWeight: '600', fontSize: 13 },
  mutedSmall: { fontSize: 12, color: '#556158' },
  progressBg: { height: 10, backgroundColor: '#d9e6da', borderRadius: 6, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#0d631b', borderRadius: 6 },
  input: {
    width: '100%',
    height: 48,
    borderWidth: 1,
    borderColor: '#bfcaba',
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f9f9f9',
    color: '#1a1c1c',
  },
  primaryBtn: {
    width: '100%',
    height: 48,
    backgroundColor: '#0d631b',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0d631b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#0d631b', fontWeight: '700', fontSize: 14 },
  switchAuthBtn: { alignItems: 'center', paddingTop: 6 },
  switchAuthText: { color: '#0d631b', fontWeight: '600', fontSize: 13 },
  tripItem: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#0d631b',
    borderWidth: 1,
    borderColor: '#eeeeee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripRoute: { fontSize: 14, fontWeight: '700', color: '#1a1c1c' },
  tripMeta: { fontSize: 12, color: '#556158', marginTop: 2 },
  tripPts: { fontSize: 15, fontWeight: '700', color: '#0d631b' },
  tripRs: { fontSize: 11, color: '#556158' },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#1a1c1c' },
  emptySub: { fontSize: 12, color: '#556158', textAlign: 'center', marginTop: 4 },
  // Scanner
  scanContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  scannerPill: {
    backgroundColor: '#d9e6da',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 6,
  },
  scannerPillText: { fontSize: 11, fontWeight: '700', color: '#0d631b' },
  scanHeader: { fontSize: 22, fontWeight: '700', color: '#1a1c1c' },
  scanSub: { fontSize: 13, color: '#556158', marginTop: 2, marginBottom: 14 },
  cameraFrame: {
    width: 268,
    height: 268,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#111814',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0d631b',
  },
  viewfinderBox: {
    position: 'absolute',
    width: 196,
    height: 196,
    borderWidth: 3,
    borderColor: '#a3f69c',
    borderRadius: 18,
  },
  scanLaser: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 2.5,
    backgroundColor: '#a3f69c',
  },
  permBox: { padding: 16, alignItems: 'center', gap: 10 },
  permText: { color: '#fff', textAlign: 'center', fontSize: 13 },
  scanActionsRow: { flexDirection: 'row', gap: 18, marginTop: 18 },
  actionCircleBtn: { alignItems: 'center', gap: 5 },
  circleIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f3f3f3',
    borderWidth: 1,
    borderColor: '#bfcaba',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircleLabel: { fontSize: 11, fontWeight: '700', color: '#0d631b' },
  infoBanner: {
    marginTop: 16,
    backgroundColor: '#d9e6da',
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  infoBannerText: { flex: 1, fontSize: 11, color: '#1a1c1c' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20 },
  // Rewards
  balanceBig: { fontSize: 38, fontWeight: '800', color: '#0d631b' },
  toggleRow: { flexDirection: 'row', backgroundColor: '#eeeeee', borderRadius: 10, padding: 4 },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  toggleActive: { backgroundColor: '#0d631b' },
  toggleText: { fontSize: 12, fontWeight: '700', color: '#556158' },
  toggleTextActive: { color: '#ffffff' },
  redeemPill: {
    backgroundColor: '#0d631b',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  redeemPillText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  receiptCard: {
    backgroundColor: '#e8f5e9',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#a5d6a7',
  },
  levelBadge: {
    backgroundColor: '#d9e6da',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  levelBadgeText: { fontSize: 11, fontWeight: '700', color: '#0d631b' },
  // Impact
  impactHero: { alignItems: 'center', paddingVertical: 6 },
  heroCheckCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0d631b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroPointsTitle: { fontSize: 24, fontWeight: '800', color: '#0d631b', textAlign: 'center' },
  heroSub: { fontSize: 13, color: '#40493d', textAlign: 'center', marginTop: 4 },
  badgeBox: {
    flex: 1,
    backgroundColor: '#f3f3f3',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    opacity: 0.6,
  },
  badgeBoxUnlocked: {
    backgroundColor: '#e8f5e9',
    borderWidth: 1,
    borderColor: '#0d631b',
    opacity: 1,
  },
  badgeTitle: { fontSize: 10, fontWeight: '700', color: '#1a1c1c', marginTop: 4, textAlign: 'center' },
  badgeSub: { fontSize: 9, color: '#0d631b', fontWeight: '600', marginTop: 2, textAlign: 'center' },
});