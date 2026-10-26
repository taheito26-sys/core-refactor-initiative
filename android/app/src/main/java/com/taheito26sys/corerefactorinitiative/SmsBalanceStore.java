package com.taheito26sys.corerefactorinitiative;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Holds bank SMS that arrived while the web layer was not running. The web layer
 * drains the queue, parses the balance and updates its cache. Only messages that
 * look like a balance notice are kept, so unrelated personal SMS never leave the
 * telephony database.
 */
final class SmsBalanceStore {
    private static final String PREFS = "sms_balance_pending";
    private static final String KEY = "queue";
    private static final int MAX_QUEUE = 200;

    private SmsBalanceStore() {}

    static boolean looksLikeBalanceNotice(String body) {
        if (body == null) return false;
        String lower = body.toLowerCase(Locale.ROOT);
        return lower.contains("bal") || body.contains("رصيد");
    }

    static synchronized void enqueue(Context context, String address, String body, long date) {
        if (!looksLikeBalanceNotice(body)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray queue = new JSONArray(prefs.getString(KEY, "[]"));
            JSONObject item = new JSONObject();
            item.put("address", address == null ? "" : address);
            item.put("body", body);
            item.put("date", date);
            queue.put(item);
            JSONArray trimmed = new JSONArray();
            for (int i = Math.max(0, queue.length() - MAX_QUEUE); i < queue.length(); i++) {
                trimmed.put(queue.get(i));
            }
            prefs.edit().putString(KEY, trimmed.toString()).apply();
        } catch (JSONException ignored) {
            // A corrupt queue is dropped rather than blocking later messages.
            prefs.edit().remove(KEY).apply();
        }
    }

    static synchronized JSONArray drain(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray queue = new JSONArray(prefs.getString(KEY, "[]"));
            prefs.edit().remove(KEY).apply();
            return queue;
        } catch (JSONException e) {
            prefs.edit().remove(KEY).apply();
            return new JSONArray();
        }
    }
}
