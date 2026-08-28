package app.petchain.mobile.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * PetChain App Widget Provider
 * 
 * Shows today's medication schedule, upcoming appointments, and pet health scores
 * on Android home screen in small, medium, and large widget sizes.
 */
public class PetChainWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "PetChainWidgetPrefs";
    private static final String WIDGET_DATA_KEY = "petchain_widget_data";
    private static final String ACTION_UPDATE_WIDGET = "app.petchain.mobile.UPDATE_WIDGET";

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        
        if (ACTION_UPDATE_WIDGET.equals(intent.getAction())) {
            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
            int[] appWidgetIds = appWidgetManager.getAppWidgetIds(
                    new android.content.ComponentName(context, PetChainWidgetProvider.class)
            );
            
            if (appWidgetIds.length > 0) {
                onUpdate(context, appWidgetManager, appWidgetIds);
            }
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        try {
            // Get widget data from SharedPreferences
            String widgetDataJson = getWidgetData(context);
            
            if (widgetDataJson != null && !widgetDataJson.isEmpty()) {
                JSONObject widgetData = new JSONObject(widgetDataJson);
                
                // Create RemoteViews based on widget size
                int layoutId = getWidgetLayoutId(context, appWidgetManager, appWidgetId);
                RemoteViews views = createRemoteViews(context, layoutId, widgetData);
                
                appWidgetManager.updateAppWidget(appWidgetId, views);
            } else {
                // Show placeholder if no data
                RemoteViews views = new RemoteViews(context.getPackageName(), 
                        android.R.layout.simple_list_item_1);
                appWidgetManager.updateAppWidget(appWidgetId, views);
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }

    private static RemoteViews createRemoteViews(Context context, int layoutId, JSONObject widgetData) 
            throws JSONException {
        RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);
        
        // Parse widget data
        JSONArray medications = widgetData.optJSONArray("medications");
        JSONArray appointments = widgetData.optJSONArray("appointments");
        JSONArray healthScores = widgetData.optJSONArray("healthScores");
        
        // Update based on layout (small, medium, large)
        if (layoutId == android.R.layout.simple_list_item_1) {
            updateSmallWidget(views, context, medications, appointments, healthScores);
        } else {
            updateMediumLargeWidget(views, context, medications, appointments, healthScores);
        }
        
        // Set click intent to open app
        setClickIntent(context, views);
        
        return views;
    }

    private static void updateSmallWidget(RemoteViews views, Context context,
            JSONArray medications, JSONArray appointments, JSONArray healthScores) 
            throws JSONException {
        
        // Show next medication
        if (medications != null && medications.length() > 0) {
            JSONObject nextMed = medications.getJSONObject(0);
            String medName = nextMed.optString("medicationName", "Medication");
            views.setTextViewText(android.R.id.text1, "💊 " + medName);
        }
        
        // Show next appointment
        if (appointments != null && appointments.length() > 0) {
            JSONObject nextApt = appointments.getJSONObject(0);
            String aptTitle = nextApt.optString("title", "Appointment");
            views.setTextViewText(android.R.id.text2, "📅 " + aptTitle);
        }
        
        // Show health score
        if (healthScores != null && healthScores.length() > 0) {
            JSONObject score = healthScores.getJSONObject(0);
            int health = score.optInt("healthScore", 75);
            views.setTextViewText(android.R.id.text3, "❤️ Health: " + health + "%");
        }
    }

    private static void updateMediumLargeWidget(RemoteViews views, Context context,
            JSONArray medications, JSONArray appointments, JSONArray healthScores) 
            throws JSONException {
        
        // Update medications section
        if (medications != null && medications.length() > 0) {
            StringBuilder medText = new StringBuilder("💊 Today's Medications:\n");
            for (int i = 0; i < Math.min(3, medications.length()); i++) {
                JSONObject med = medications.getJSONObject(i);
                String name = med.optString("medicationName", "");
                String petName = med.optString("petName", "");
                boolean taken = med.optBoolean("taken", false);
                String status = taken ? "✓" : "○";
                medText.append(status).append(" ").append(name).append(" (").append(petName).append(")\n");
            }
            views.setTextViewText(android.R.id.text1, medText.toString().trim());
        }
        
        // Update appointments section
        if (appointments != null && appointments.length() > 0) {
            StringBuilder aptText = new StringBuilder("📅 Appointments:\n");
            for (int i = 0; i < Math.min(2, appointments.length()); i++) {
                JSONObject apt = appointments.getJSONObject(i);
                String title = apt.optString("title", "");
                String date = apt.optString("date", "");
                aptText.append("• ").append(title).append(" on ").append(date).append("\n");
            }
            views.setTextViewText(android.R.id.text2, aptText.toString().trim());
        }
        
        // Update health scores section
        if (healthScores != null && healthScores.length() > 0) {
            StringBuilder healthText = new StringBuilder("❤️ Pet Health:\n");
            for (int i = 0; i < Math.min(3, healthScores.length()); i++) {
                JSONObject score = healthScores.getJSONObject(i);
                String petName = score.optString("petName", "");
                int health = score.optInt("healthScore", 75);
                healthText.append(petName).append(": ").append(health).append("%\n");
            }
            views.setTextViewText(android.R.id.text3, healthText.toString().trim());
        }
    }

    private static int getWidgetLayoutId(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        // Get widget size (small, medium, large)
        // For now, return default list layout
        return android.R.layout.simple_list_item_1;
    }

    private static void setClickIntent(Context context, RemoteViews views) {
        Intent intent = new Intent(context, PetChainWidgetProvider.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, 0, intent, 
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        
        // Set click listener to open app
        views.setOnClickPendingIntent(android.R.id.background, pendingIntent);
    }

    /**
     * Get widget data from SharedPreferences
     */
    private static String getWidgetData(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(WIDGET_DATA_KEY, null);
    }

    /**
     * Update widget data from React Native app
     */
    public static void updateWidgetData(Context context, String jsonData) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(WIDGET_DATA_KEY, jsonData).apply();
        
        // Trigger widget update
        Intent intent = new Intent(context, PetChainWidgetProvider.class);
        intent.setAction(ACTION_UPDATE_WIDGET);
        context.sendBroadcast(intent);
    }

    /**
     * Clear widget data
     */
    public static void clearWidgetData(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(WIDGET_DATA_KEY).apply();
        
        // Trigger widget update
        Intent intent = new Intent(context, PetChainWidgetProvider.class);
        intent.setAction(ACTION_UPDATE_WIDGET);
        context.sendBroadcast(intent);
    }
}
