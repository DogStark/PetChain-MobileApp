package app.petchain.mobile.widget;

import android.content.Context;
import android.content.SharedPreferences;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

import org.json.JSONObject;

/**
 * Native module bridge for React Native to update Android App Widgets
 */
public class PetChainWidgetModule extends ReactContextBaseJavaModule {

    private static final String MODULE_NAME = "PetChainWidgetModule";
    private static final String PREFS_NAME = "PetChainWidgetPrefs";
    private static final String WIDGET_DATA_KEY = "petchain_widget_data";

    public PetChainWidgetModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }

    /**
     * Update widget with new data from React Native
     */
    @ReactMethod
    public void updateWidget(ReadableMap data, Promise promise) {
        try {
            Context context = getReactApplicationContext();
            
            // Convert ReadableMap to JSON string
            JSONObject jsonData = convertMapToJson(data);
            String dataStr = jsonData.toString();
            
            // Save to SharedPreferences
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(WIDGET_DATA_KEY, dataStr).apply();
            
            // Update widget display
            PetChainWidgetProvider.updateWidgetData(context, dataStr);
            
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("E_UPDATE_FAILED", "Failed to update widget", e);
        }
    }

    /**
     * Get current widget data
     */
    @ReactMethod
    public void getWidgetData(Promise promise) {
        try {
            Context context = getReactApplicationContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            
            String data = prefs.getString(WIDGET_DATA_KEY, null);
            if (data != null) {
                JSONObject json = new JSONObject(data);
                promise.resolve(convertJsonToReadable(json));
            } else {
                promise.resolve(null);
            }
        } catch (Exception e) {
            promise.reject("E_READ_FAILED", "Failed to read widget data", e);
        }
    }

    /**
     * Check if widget is available
     */
    @ReactMethod
    public void isWidgetAvailable(Promise promise) {
        promise.resolve(true);
    }

    /**
     * Clear widget data
     */
    @ReactMethod
    public void clearWidgetData(Promise promise) {
        try {
            Context context = getReactApplicationContext();
            PetChainWidgetProvider.clearWidgetData(context);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("E_CLEAR_FAILED", "Failed to clear widget data", e);
        }
    }

    /**
     * Convert ReadableMap to JSONObject
     */
    private JSONObject convertMapToJson(ReadableMap map) throws Exception {
        JSONObject json = new JSONObject();
        
        for (String key : map.keySetIterator()) {
            Object value = map.getDynamic(key);
            
            if (value == null) {
                json.put(key, JSONObject.NULL);
            } else if (value instanceof ReadableMap) {
                json.put(key, convertMapToJson((ReadableMap) value));
            } else if (value instanceof com.facebook.react.bridge.ReadableArray) {
                json.put(key, convertArrayToJson((com.facebook.react.bridge.ReadableArray) value));
            } else if (value instanceof Boolean) {
                json.put(key, value);
            } else if (value instanceof Number) {
                json.put(key, value);
            } else {
                json.put(key, value.toString());
            }
        }
        
        return json;
    }

    /**
     * Convert ReadableArray to JSONArray
     */
    private org.json.JSONArray convertArrayToJson(com.facebook.react.bridge.ReadableArray array) throws Exception {
        org.json.JSONArray json = new org.json.JSONArray();
        
        for (int i = 0; i < array.size(); i++) {
            Object value = array.getDynamic(i);
            
            if (value == null) {
                json.put(org.json.JSONObject.NULL);
            } else if (value instanceof ReadableMap) {
                json.put(convertMapToJson((ReadableMap) value));
            } else if (value instanceof com.facebook.react.bridge.ReadableArray) {
                json.put(convertArrayToJson((com.facebook.react.bridge.ReadableArray) value));
            } else if (value instanceof Boolean) {
                json.put(value);
            } else if (value instanceof Number) {
                json.put(value);
            } else {
                json.put(value.toString());
            }
        }
        
        return json;
    }

    /**
     * Convert JSONObject to ReadableMap (for reference, not used here)
     */
    private Object convertJsonToReadable(JSONObject json) throws Exception {
        return json.toString();
    }
}
