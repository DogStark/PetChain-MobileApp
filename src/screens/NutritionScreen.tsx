import React, { useCallback, useEffect, useState } from 'react';
import {
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

import {
  EMPTY_LOG_FORM,
  FOOD_UNITS,
  MEAL_TYPES,
  type DailyNutritionSummary,
  type FoodItem,
  type NutritionGoal,
  type NutritionLog,
  type NutritionLogFormData,
  type WeeklyNutritionReport,
} from '../models/NutritionLog';
import {
  calculateCaloriesFromFood,
  calculateRecommendedCalories,
  deleteNutritionLog,
  getDailySummary,
  getDietaryRecommendations,
  getNutritionGoalByPet,
  getNutritionLogsByPet,
  getWeeklyReport,
  saveNutritionGoal,
  saveNutritionLog,
  searchFoodDatabase,
} from '../services/nutritionService';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'daily' | 'weekly' | 'goals';

interface Props {
  petId: string;
  petName?: string;
  petSpecies?: string;
  petBreed?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function statusColor(status: 'under' | 'on_track' | 'over'): string {
  if (status === 'on_track') return '#4CAF50';
  if (status === 'over') return '#e53935';
  return '#FF9800';
}

function statusLabel(status: 'under' | 'on_track' | 'over'): string {
  if (status === 'on_track') return '✓ On Track';
  if (status === 'over') return '⚠ Overfed';
  return '⚠ Underfed';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Component ────────────────────────────────────────────────────────────────

const NutritionScreen: React.FC<Props> = ({
  petId,
  petName = 'Your Pet',
  petSpecies = 'dog',
  petBreed = '',
}) => {
  const [tab, setTab] = useState<Tab>('daily');
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [weekStart, setWeekStart] = useState<string>(getMondayOfWeek(new Date()));

  // Data state
  const [logs, setLogs] = useState<NutritionLog[]>([]);
  const [dailySummary, setDailySummary] = useState<DailyNutritionSummary | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyNutritionReport | null>(null);
  const [goal, setGoal] = useState<NutritionGoal | null>(null);
  const [recommendations, setRecommendations] = useState<string[]>([]);

  // Modal state
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [foodSearchVisible, setFoodSearchVisible] = useState(false);
  const [editingLog, setEditingLog] = useState<NutritionLog | null>(null);

  // Form state
  const [form, setForm] = useState<NutritionLogFormData>({ ...EMPTY_LOG_FORM, petId });
  const [goalForm, setGoalForm] = useState({
    dailyCalories: '',
    weightKg: '',
    activityLevel: 'moderate' as 'low' | 'moderate' | 'high',
    healthConditions: '',
    notes: '',
  });

  // Food search state
  const [foodQuery, setFoodQuery] = useState('');
  const [foodResults, setFoodResults] = useState<FoodItem[]>([]);
  const [foodSearching, setFoodSearching] = useState(false);

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadDailyData = useCallback(async () => {
    try {
      const [summary, petGoal] = await Promise.all([
        getDailySummary(petId, selectedDate),
        getNutritionGoalByPet(petId),
      ]);
      setDailySummary(summary);
      setGoal(petGoal);
      setLogs(summary.logs);
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to load nutrition data.',
      );
    }
  }, [petId, selectedDate]);

  const loadWeeklyData = useCallback(async () => {
    try {
      const report = await getWeeklyReport(petId, weekStart);
      setWeeklyReport(report);
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to load weekly report.',
      );
    }
  }, [petId, weekStart]);

  const loadGoalData = useCallback(async () => {
    try {
      const [petGoal, allLogs] = await Promise.all([
        getNutritionGoalByPet(petId),
        getNutritionLogsByPet(petId),
      ]);
      setGoal(petGoal);
      setLogs(allLogs);
      const tips = getDietaryRecommendations(petSpecies, petBreed, petGoal?.healthConditions ?? []);
      setRecommendations(tips);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to load goal data.');
    }
  }, [petId, petSpecies, petBreed]);

  useEffect(() => {
    if (tab === 'daily') void loadDailyData();
    else if (tab === 'weekly') void loadWeeklyData();
    else void loadGoalData();
  }, [tab, loadDailyData, loadWeeklyData, loadGoalData]);

  // ── Log modal helpers ──────────────────────────────────────────────────────

  const openAddLog = () => {
    setEditingLog(null);
    setForm({ ...EMPTY_LOG_FORM, petId, date: selectedDate });
    setLogModalVisible(true);
  };

  const openEditLog = (log: NutritionLog) => {
    setEditingLog(log);
    setForm({
      petId: log.petId,
      date: log.date,
      mealType: log.mealType,
      foodName: log.foodName,
      brand: log.brand ?? '',
      amount: String(log.amount),
      unit: log.unit,
      calories: String(log.calories),
      protein: String(log.protein ?? ''),
      fat: String(log.fat ?? ''),
      carbs: String(log.carbs ?? ''),
      notes: log.notes ?? '',
    });
    setLogModalVisible(true);
  };

  const closeLogModal = () => {
    setLogModalVisible(false);
    setEditingLog(null);
  };

  // ── Save log ───────────────────────────────────────────────────────────────

  const handleSaveLog = async () => {
    if (!form.foodName.trim()) {
      Alert.alert('Validation', 'Food name is required.');
      return;
    }
    const amount = parseFloat(form.amount);
    const calories = parseFloat(form.calories);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Validation', 'Amount must be a positive number.');
      return;
    }
    if (isNaN(calories) || calories < 0) {
      Alert.alert('Validation', 'Calories must be 0 or more.');
      return;
    }

    const now = new Date().toISOString();
    const log: NutritionLog = {
      id: editingLog?.id ?? `log_${Date.now()}`,
      petId,
      date: form.date,
      mealType: form.mealType,
      foodName: form.foodName.trim(),
      brand: form.brand.trim() || undefined,
      amount,
      unit: form.unit,
      calories,
      protein: form.protein ? parseFloat(form.protein) : undefined,
      fat: form.fat ? parseFloat(form.fat) : undefined,
      carbs: form.carbs ? parseFloat(form.carbs) : undefined,
      notes: form.notes.trim() || undefined,
      createdAt: editingLog?.createdAt ?? now,
      updatedAt: now,
    };

    try {
      await saveNutritionLog(log);

      // Alert on overfeeding/underfeeding after save
      const updatedSummary = await getDailySummary(petId, form.date);
      if (goal && updatedSummary.status === 'over') {
        Alert.alert(
          '⚠ Overfeeding Alert',
          `${petName} has consumed ${updatedSummary.totalCalories} kcal today, which exceeds the daily goal of ${goal.dailyCalories} kcal.`,
        );
      } else if (goal && form.date === todayISO() && updatedSummary.status === 'under') {
        // Only alert underfeeding at end of day (after 8pm)
        const hour = new Date().getHours();
        if (hour >= 20) {
          Alert.alert(
            '⚠ Underfeeding Alert',
            `${petName} has only consumed ${updatedSummary.totalCalories} kcal today. The daily goal is ${goal.dailyCalories} kcal.`,
          );
        }
      }

      closeLogModal();
      void loadDailyData();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to save log.');
    }
  };

  // ── Delete log ─────────────────────────────────────────────────────────────

  const handleDeleteLog = (id: string) => {
    Alert.alert('Delete', 'Remove this feeding log?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNutritionLog(id);
            void loadDailyData();
          } catch (error) {
            Alert.alert('Error', error instanceof Error ? error.message : 'Failed to delete.');
          }
        },
      },
    ]);
  };

  // ── Save goal ──────────────────────────────────────────────────────────────

  const handleSaveGoal = async () => {
    const calories = parseFloat(goalForm.dailyCalories);
    if (isNaN(calories) || calories <= 0) {
      Alert.alert('Validation', 'Daily calories must be a positive number.');
      return;
    }

    const conditions = goalForm.healthConditions
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const updatedGoal: NutritionGoal = {
      id: goal?.id ?? `goal_${Date.now()}`,
      petId,
      dailyCalories: calories,
      weightKg: goalForm.weightKg ? parseFloat(goalForm.weightKg) : undefined,
      activityLevel: goalForm.activityLevel,
      healthConditions: conditions,
      notes: goalForm.notes.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveNutritionGoal(updatedGoal);
      setGoal(updatedGoal);
      setGoalModalVisible(false);
      const tips = getDietaryRecommendations(petSpecies, petBreed, conditions);
      setRecommendations(tips);
      Alert.alert('Saved', 'Nutrition goal updated.');
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to save goal.');
    }
  };

  const openGoalModal = () => {
    setGoalForm({
      dailyCalories: goal ? String(goal.dailyCalories) : '',
      weightKg: goal?.weightKg ? String(goal.weightKg) : '',
      activityLevel: goal?.activityLevel ?? 'moderate',
      healthConditions: goal?.healthConditions?.join(', ') ?? '',
      notes: goal?.notes ?? '',
    });
    setGoalModalVisible(true);
  };

  const handleAutoCalculate = () => {
    const weight = parseFloat(goalForm.weightKg);
    if (isNaN(weight) || weight <= 0) {
      Alert.alert('Validation', 'Enter a valid weight (kg) to auto-calculate.');
      return;
    }
    const recommended = calculateRecommendedCalories(
      weight,
      petSpecies,
      goalForm.activityLevel,
      goalForm.healthConditions
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    );
    setGoalForm((f) => ({ ...f, dailyCalories: String(recommended) }));
  };

  // ── Food search ────────────────────────────────────────────────────────────

  const handleFoodSearch = async () => {
    setFoodSearching(true);
    try {
      const results = await searchFoodDatabase(foodQuery);
      setFoodResults(results);
    } catch {
      setFoodResults([]);
    } finally {
      setFoodSearching(false);
    }
  };

  const handleSelectFood = (food: FoodItem) => {
    const amount = parseFloat(form.amount) || 100;
    const calories = calculateCaloriesFromFood(food, amount, form.unit);
    setForm((f) => ({
      ...f,
      foodName: food.name,
      brand: food.brand ?? '',
      calories: String(calories),
      protein: food.proteinPer100g
        ? String(Math.round(((food.proteinPer100g * amount) / 100) * 10) / 10)
        : '',
      fat: food.fatPer100g ? String(Math.round(((food.fatPer100g * amount) / 100) * 10) / 10) : '',
      carbs: food.carbsPer100g
        ? String(Math.round(((food.carbsPer100g * amount) / 100) * 10) / 10)
        : '',
    }));
    setFoodSearchVisible(false);
    setFoodQuery('');
    setFoodResults([]);
  };

  // ─── Render: Daily Tab ─────────────────────────────────────────────────────

  const renderDailyTab = () => {
    const summary = dailySummary;
    const goalCals = goal?.dailyCalories ?? 0;
    const progress = goalCals > 0 ? Math.min((summary?.totalCalories ?? 0) / goalCals, 1) : 0;
    const progressColor = summary ? statusColor(summary.status) : '#4CAF50';

    return (
      <ScrollView style={styles.tabContent}>
        {/* Date selector */}
        <View style={styles.dateRow}>
          <TouchableOpacity
            style={styles.dateArrow}
            onPress={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().slice(0, 10));
            }}
          >
            <Text style={styles.dateArrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.dateLabel}>
            {selectedDate === todayISO() ? 'Today' : formatDate(selectedDate)}
          </Text>
          <TouchableOpacity
            style={styles.dateArrow}
            onPress={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              const next = d.toISOString().slice(0, 10);
              if (next <= todayISO()) setSelectedDate(next);
            }}
          >
            <Text style={styles.dateArrowText}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Calorie summary card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{summary?.totalCalories ?? 0}</Text>
              <Text style={styles.summaryLabel}>Consumed (kcal)</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{goalCals > 0 ? goalCals : '—'}</Text>
              <Text style={styles.summaryLabel}>Goal (kcal)</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: progressColor }]}>
                {goalCals > 0 ? `${Math.round(progress * 100)}%` : '—'}
              </Text>
              <Text style={styles.summaryLabel}>Progress</Text>
            </View>
          </View>

          {/* Progress bar */}
          {goalCals > 0 && (
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${progress * 100}%`, backgroundColor: progressColor },
                ]}
              />
            </View>
          )}

          {/* Status badge */}
          {summary && goalCals > 0 && (
            <View style={[styles.statusBadge, { backgroundColor: progressColor + '22' }]}>
              <Text style={[styles.statusBadgeText, { color: progressColor }]}>
                {statusLabel(summary.status)}
              </Text>
            </View>
          )}

          {/* Macros row */}
          {summary &&
            (summary.totalProteinG > 0 || summary.totalFatG > 0 || summary.totalCarbsG > 0) && (
              <View style={styles.macrosRow}>
                <Text style={styles.macroItem}>Protein: {summary.totalProteinG.toFixed(1)}g</Text>
                <Text style={styles.macroItem}>Fat: {summary.totalFatG.toFixed(1)}g</Text>
                <Text style={styles.macroItem}>Carbs: {summary.totalCarbsG.toFixed(1)}g</Text>
              </View>
            )}
        </View>

        {/* Meal logs */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Meals ({logs.length})</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAddLog}>
            <Text style={styles.addBtnText}>+ Log Meal</Text>
          </TouchableOpacity>
        </View>

        {logs.length === 0 ? (
          <Text style={styles.emptyText}>No meals logged for this day.</Text>
        ) : (
          logs.map((log) => (
            <View key={log.id} style={styles.logCard}>
              <View style={styles.logCardHeader}>
                <View>
                  <Text style={styles.logFoodName}>{log.foodName}</Text>
                  {log.brand ? <Text style={styles.logBrand}>{log.brand}</Text> : null}
                </View>
                <View style={styles.logCardActions}>
                  <TouchableOpacity onPress={() => openEditLog(log)} style={styles.actionBtn}>
                    <Text style={styles.actionBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeleteLog(log.id)}
                    style={[styles.actionBtn, styles.deleteBtn]}
                  >
                    <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.logMeta}>
                <Text style={styles.logMetaText}>{capitalize(log.mealType)}</Text>
                <Text style={styles.logMetaDot}>·</Text>
                <Text style={styles.logMetaText}>
                  {log.amount}
                  {log.unit}
                </Text>
                <Text style={styles.logMetaDot}>·</Text>
                <Text style={[styles.logMetaText, styles.logCalories]}>{log.calories} kcal</Text>
              </View>
              {log.protein || log.fat || log.carbs ? (
                <Text style={styles.logMacros}>
                  {log.protein ? `P: ${log.protein}g  ` : ''}
                  {log.fat ? `F: ${log.fat}g  ` : ''}
                  {log.carbs ? `C: ${log.carbs}g` : ''}
                </Text>
              ) : null}
              {log.notes ? <Text style={styles.logNotes}>{log.notes}</Text> : null}
            </View>
          ))
        )}
      </ScrollView>
    );
  };

  // ─── Render: Weekly Tab ────────────────────────────────────────────────────

  const renderWeeklyTab = () => {
    const report = weeklyReport;

    return (
      <ScrollView style={styles.tabContent}>
        {/* Week selector */}
        <View style={styles.dateRow}>
          <TouchableOpacity
            style={styles.dateArrow}
            onPress={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() - 7);
              setWeekStart(d.toISOString().slice(0, 10));
            }}
          >
            <Text style={styles.dateArrowText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.dateLabel}>Week of {formatDate(weekStart)}</Text>
          <TouchableOpacity
            style={styles.dateArrow}
            onPress={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + 7);
              const next = d.toISOString().slice(0, 10);
              if (next <= getMondayOfWeek(new Date())) setWeekStart(next);
            }}
          >
            <Text style={styles.dateArrowText}>›</Text>
          </TouchableOpacity>
        </View>

        {!report ? (
          <Text style={styles.emptyText}>No data for this week.</Text>
        ) : (
          <>
            {/* Weekly summary card */}
            <View style={styles.summaryCard}>
              <Text style={styles.reportTitle}>Weekly Summary</Text>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{report.avgDailyCalories}</Text>
                  <Text style={styles.summaryLabel}>Avg kcal/day</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: '#4CAF50' }]}>
                    {report.daysOnTrack}
                  </Text>
                  <Text style={styles.summaryLabel}>On Track</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: '#e53935' }]}>{report.daysOver}</Text>
                  <Text style={styles.summaryLabel}>Overfed</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: '#FF9800' }]}>
                    {report.daysUnder}
                  </Text>
                  <Text style={styles.summaryLabel}>Underfed</Text>
                </View>
              </View>
              <View style={styles.macrosRow}>
                <Text style={styles.macroItem}>Avg Protein: {report.avgDailyProteinG}g</Text>
                <Text style={styles.macroItem}>Avg Fat: {report.avgDailyFatG}g</Text>
                <Text style={styles.macroItem}>Avg Carbs: {report.avgDailyCarbsG}g</Text>
              </View>
            </View>

            {/* Recommendation */}
            <View style={styles.recommendationCard}>
              <Text style={styles.recommendationTitle}>💡 Weekly Recommendation</Text>
              <Text style={styles.recommendationText}>{report.recommendation}</Text>
            </View>

            {/* Daily breakdown */}
            <Text style={styles.sectionTitle}>Daily Breakdown</Text>
            {report.dailySummaries.map((day) => {
              const color = statusColor(day.status);
              return (
                <View key={day.date} style={styles.dayRow}>
                  <View style={[styles.dayStatusBar, { backgroundColor: color }]} />
                  <View style={styles.dayInfo}>
                    <Text style={styles.dayDate}>{formatDate(day.date)}</Text>
                    <Text style={styles.dayMeals}>
                      {day.mealCount} meal{day.mealCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={styles.dayCalories}>
                    <Text style={[styles.dayCaloriesValue, { color }]}>{day.totalCalories}</Text>
                    <Text style={styles.dayCaloriesLabel}>kcal</Text>
                  </View>
                  <View style={[styles.dayStatusPill, { backgroundColor: color + '22' }]}>
                    <Text style={[styles.dayStatusText, { color }]}>{statusLabel(day.status)}</Text>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    );
  };

  // ─── Render: Goals Tab ─────────────────────────────────────────────────────

  const renderGoalsTab = () => (
    <ScrollView style={styles.tabContent}>
      {/* Current goal card */}
      <View style={styles.summaryCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Daily Nutrition Goal</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openGoalModal}>
            <Text style={styles.addBtnText}>{goal ? 'Edit' : 'Set Goal'}</Text>
          </TouchableOpacity>
        </View>

        {!goal ? (
          <Text style={styles.emptyText}>No goal set. Tap "Set Goal" to get started.</Text>
        ) : (
          <>
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Daily Calories</Text>
              <Text style={styles.goalValue}>{goal.dailyCalories} kcal</Text>
            </View>
            {goal.weightKg && (
              <View style={styles.goalRow}>
                <Text style={styles.goalLabel}>Weight</Text>
                <Text style={styles.goalValue}>{goal.weightKg} kg</Text>
              </View>
            )}
            <View style={styles.goalRow}>
              <Text style={styles.goalLabel}>Activity Level</Text>
              <Text style={styles.goalValue}>{capitalize(goal.activityLevel)}</Text>
            </View>
            {goal.healthConditions && goal.healthConditions.length > 0 && (
              <View style={styles.goalRow}>
                <Text style={styles.goalLabel}>Health Conditions</Text>
                <Text style={styles.goalValue}>{goal.healthConditions.join(', ')}</Text>
              </View>
            )}
            {goal.notes ? (
              <View style={styles.goalRow}>
                <Text style={styles.goalLabel}>Notes</Text>
                <Text style={styles.goalValue}>{goal.notes}</Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Dietary recommendations */}
      {recommendations.length > 0 && (
        <View style={styles.recommendationCard}>
          <Text style={styles.recommendationTitle}>🐾 Dietary Recommendations</Text>
          {recommendations.map((tip, i) => (
            <View key={i} style={styles.tipRow}>
              <Text style={styles.tipBullet}>•</Text>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Quick stats */}
      {logs.length > 0 && (
        <View style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>All-Time Stats</Text>
          <View style={styles.goalRow}>
            <Text style={styles.goalLabel}>Total Feedings Logged</Text>
            <Text style={styles.goalValue}>{logs.length}</Text>
          </View>
          <View style={styles.goalRow}>
            <Text style={styles.goalLabel}>Total Calories Logged</Text>
            <Text style={styles.goalValue}>
              {logs.reduce((s, l) => s + l.calories, 0).toLocaleString()} kcal
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );

  // ─── Render: Log Modal ─────────────────────────────────────────────────────

  const renderLogModal = () => (
    <Modal
      visible={logModalVisible}
      animationType="slide"
      transparent
      onRequestClose={closeLogModal}
    >
      <View style={styles.modalOverlay}>
        <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>{editingLog ? 'Edit Meal' : 'Log Meal'}</Text>

          {/* Meal type selector */}
          <Text style={styles.fieldLabel}>Meal Type</Text>
          <View style={styles.chipRow}>
            {MEAL_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.chip, form.mealType === type && styles.chipActive]}
                onPress={() => setForm((f) => ({ ...f, mealType: type }))}
              >
                <Text style={[styles.chipText, form.mealType === type && styles.chipTextActive]}>
                  {capitalize(type)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Food name with search */}
          <View style={styles.foodNameRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Food name *"
              value={form.foodName}
              onChangeText={(v) => setForm((f) => ({ ...f, foodName: v }))}
            />
            <TouchableOpacity style={styles.searchBtn} onPress={() => setFoodSearchVisible(true)}>
              <Text style={styles.searchBtnText}>🔍</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Brand (optional)"
            value={form.brand}
            onChangeText={(v) => setForm((f) => ({ ...f, brand: v }))}
          />

          {/* Amount + unit */}
          <View style={styles.amountRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginRight: 8, marginBottom: 0 }]}
              placeholder="Amount *"
              keyboardType="decimal-pad"
              value={form.amount}
              onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))}
            />
            <View style={styles.unitPicker}>
              {FOOD_UNITS.map((unit) => (
                <TouchableOpacity
                  key={unit}
                  style={[styles.unitChip, form.unit === unit && styles.unitChipActive]}
                  onPress={() => setForm((f) => ({ ...f, unit }))}
                >
                  <Text
                    style={[styles.unitChipText, form.unit === unit && styles.unitChipTextActive]}
                  >
                    {unit}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            placeholder="Calories (kcal) *"
            keyboardType="decimal-pad"
            value={form.calories}
            onChangeText={(v) => setForm((f) => ({ ...f, calories: v }))}
          />

          <Text style={styles.fieldLabel}>Macros (optional)</Text>
          <View style={styles.macroInputRow}>
            <TextInput
              style={[styles.input, styles.macroInput]}
              placeholder="Protein (g)"
              keyboardType="decimal-pad"
              value={form.protein}
              onChangeText={(v) => setForm((f) => ({ ...f, protein: v }))}
            />
            <TextInput
              style={[styles.input, styles.macroInput]}
              placeholder="Fat (g)"
              keyboardType="decimal-pad"
              value={form.fat}
              onChangeText={(v) => setForm((f) => ({ ...f, fat: v }))}
            />
            <TextInput
              style={[styles.input, styles.macroInput]}
              placeholder="Carbs (g)"
              keyboardType="decimal-pad"
              value={form.carbs}
              onChangeText={(f) => setForm((f2) => ({ ...f2, carbs: f }))}
            />
          </View>

          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Notes (optional)"
            multiline
            value={form.notes}
            onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={closeLogModal}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => void handleSaveLog()}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  // ─── Render: Goal Modal ────────────────────────────────────────────────────

  const renderGoalModal = () => (
    <Modal
      visible={goalModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setGoalModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.modalTitle}>Nutrition Goal</Text>

          <TextInput
            style={styles.input}
            placeholder="Pet weight (kg)"
            keyboardType="decimal-pad"
            value={goalForm.weightKg}
            onChangeText={(v) => setGoalForm((f) => ({ ...f, weightKg: v }))}
          />

          <Text style={styles.fieldLabel}>Activity Level</Text>
          <View style={styles.chipRow}>
            {(['low', 'moderate', 'high'] as const).map((level) => (
              <TouchableOpacity
                key={level}
                style={[styles.chip, goalForm.activityLevel === level && styles.chipActive]}
                onPress={() => setGoalForm((f) => ({ ...f, activityLevel: level }))}
              >
                <Text
                  style={[
                    styles.chipText,
                    goalForm.activityLevel === level && styles.chipTextActive,
                  ]}
                >
                  {capitalize(level)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Health conditions (comma-separated)"
            value={goalForm.healthConditions}
            onChangeText={(v) => setGoalForm((f) => ({ ...f, healthConditions: v }))}
          />
          <Text style={styles.hintText}>
            e.g. obesity, diabetes, kidney_disease, allergies, arthritis, heart_disease
          </Text>

          <TouchableOpacity style={styles.calcBtn} onPress={handleAutoCalculate}>
            <Text style={styles.calcBtnText}>⚡ Auto-Calculate Calories</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder="Daily calories (kcal) *"
            keyboardType="decimal-pad"
            value={goalForm.dailyCalories}
            onChangeText={(v) => setGoalForm((f) => ({ ...f, dailyCalories: v }))}
          />

          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Notes (optional)"
            multiline
            value={goalForm.notes}
            onChangeText={(v) => setGoalForm((f) => ({ ...f, notes: v }))}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setGoalModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => void handleSaveGoal()}>
              <Text style={styles.saveBtnText}>Save Goal</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  // ─── Render: Food Search Modal ─────────────────────────────────────────────

  const renderFoodSearchModal = () => (
    <Modal
      visible={foodSearchVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setFoodSearchVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Search Food Database</Text>
          <View style={styles.foodNameRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Search food name or brand..."
              value={foodQuery}
              onChangeText={setFoodQuery}
              onSubmitEditing={() => void handleFoodSearch()}
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={() => void handleFoodSearch()}>
              <Text style={styles.searchBtnText}>Go</Text>
            </TouchableOpacity>
          </View>

          {foodSearching ? (
            <Text style={styles.emptyText}>Searching...</Text>
          ) : (
            <FlatList
              data={foodResults}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 320, marginTop: 10 }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {foodQuery ? 'No results found.' : 'Type to search the food database.'}
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.foodResultItem}
                  onPress={() => handleSelectFood(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.foodResultName}>{item.name}</Text>
                    {item.brand ? <Text style={styles.foodResultBrand}>{item.brand}</Text> : null}
                    <Text style={styles.foodResultMeta}>
                      {item.caloriesPer100g} kcal/100g · {item.category}
                    </Text>
                  </View>
                  <Text style={styles.foodResultArrow}>›</Text>
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            style={[styles.cancelBtn, { marginTop: 12 }]}
            onPress={() => setFoodSearchVisible(false)}
          >
            <Text style={styles.cancelBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ─── Main render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🍽 Nutrition</Text>
        <Text style={styles.headerSubtitle}>{petName}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['daily', 'weekly', 'goals'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.activeTab]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.activeTabText]}>{capitalize(t)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      {tab === 'daily' && renderDailyTab()}
      {tab === 'weekly' && renderWeeklyTab()}
      {tab === 'goals' && renderGoalsTab()}

      {/* Modals */}
      {renderLogModal()}
      {renderGoalModal()}
      {renderFoodSearchModal()}
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  headerSubtitle: { fontSize: 14, color: '#666' },

  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#4CAF50' },
  tabText: { color: '#666', fontSize: 14 },
  activeTabText: { color: '#4CAF50', fontWeight: '600' },

  tabContent: { flex: 1, padding: 12 },

  // Date row
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  dateArrow: { padding: 8 },
  dateArrowText: { fontSize: 24, color: '#4CAF50', fontWeight: '600' },
  dateLabel: { fontSize: 15, fontWeight: '600', color: '#333', marginHorizontal: 16 },

  // Summary card
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  summaryItem: { alignItems: 'center', flex: 1 },
  summaryValue: { fontSize: 22, fontWeight: '700', color: '#1a1a1a' },
  summaryLabel: { fontSize: 11, color: '#888', marginTop: 2, textAlign: 'center' },
  summaryDivider: { width: 1, backgroundColor: '#eee', marginVertical: 4 },

  progressBarBg: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressBarFill: { height: 8, borderRadius: 4 },

  statusBadge: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  statusBadgeText: { fontSize: 13, fontWeight: '600' },

  macrosRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  macroItem: { fontSize: 12, color: '#666' },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333' },
  addBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  // Log card
  logCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  logCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  logFoodName: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  logBrand: { fontSize: 12, color: '#888', marginTop: 1 },
  logCardActions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#e8f5e9',
  },
  actionBtnText: { fontSize: 12, color: '#4CAF50', fontWeight: '600' },
  deleteBtn: { backgroundColor: '#fdecea' },
  deleteBtnText: { color: '#e53935' },
  logMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  logMetaText: { fontSize: 13, color: '#555' },
  logMetaDot: { fontSize: 13, color: '#bbb', marginHorizontal: 4 },
  logCalories: { fontWeight: '600', color: '#4CAF50' },
  logMacros: { fontSize: 12, color: '#888', marginTop: 3 },
  logNotes: { fontSize: 12, color: '#999', marginTop: 3, fontStyle: 'italic' },

  emptyText: { textAlign: 'center', color: '#999', marginTop: 20, fontSize: 14 },

  // Weekly report
  reportTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 10 },
  recommendationCard: {
    backgroundColor: '#e8f5e9',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  recommendationTitle: { fontSize: 14, fontWeight: '700', color: '#2e7d32', marginBottom: 6 },
  recommendationText: { fontSize: 13, color: '#388e3c', lineHeight: 20 },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  dayStatusBar: { width: 4, height: 36, borderRadius: 2, marginRight: 10 },
  dayInfo: { flex: 1 },
  dayDate: { fontSize: 13, fontWeight: '600', color: '#333' },
  dayMeals: { fontSize: 12, color: '#888', marginTop: 1 },
  dayCalories: { alignItems: 'center', marginRight: 10 },
  dayCaloriesValue: { fontSize: 16, fontWeight: '700' },
  dayCaloriesLabel: { fontSize: 11, color: '#888' },
  dayStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  dayStatusText: { fontSize: 11, fontWeight: '600' },

  // Goals tab
  goalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  goalLabel: { fontSize: 13, color: '#666' },
  goalValue: { fontSize: 13, fontWeight: '600', color: '#333', flex: 1, textAlign: 'right' },
  tipRow: { flexDirection: 'row', marginBottom: 6 },
  tipBullet: { fontSize: 14, color: '#4CAF50', marginRight: 6, marginTop: 1 },
  tipText: { fontSize: 13, color: '#388e3c', flex: 1, lineHeight: 20 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '92%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 14, color: '#1a1a1a' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 4 },
  hintText: { fontSize: 11, color: '#aaa', marginBottom: 10, marginTop: -6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
    backgroundColor: '#fafafa',
  },
  textArea: { height: 70, textAlignVertical: 'top' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  chipActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  foodNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  searchBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  searchBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  amountRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 0 },
  unitPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  unitChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  unitChipActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  unitChipText: { fontSize: 12, color: '#555' },
  unitChipTextActive: { color: '#fff', fontWeight: '600' },

  macroInputRow: { flexDirection: 'row', gap: 6 },
  macroInput: { flex: 1, marginBottom: 10 },

  calcBtn: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  calcBtnText: { color: '#4CAF50', fontWeight: '600', fontSize: 14 },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 20 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#666', fontWeight: '600' },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '600' },

  // Food search results
  foodResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  foodResultName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  foodResultBrand: { fontSize: 12, color: '#888', marginTop: 1 },
  foodResultMeta: { fontSize: 12, color: '#4CAF50', marginTop: 2 },
  foodResultArrow: { fontSize: 20, color: '#bbb', marginLeft: 8 },
});

export default NutritionScreen;
