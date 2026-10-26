package com.taheito26sys.corerefactorinitiative;

import android.Manifest;
import android.database.Cursor;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;

@CapacitorPlugin(
    name = "SmsBalance",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }, alias = "sms")
    }
)
public class SmsBalancePlugin extends Plugin {
    private static final int DEFAULT_LIMIT = 300;
    private static final int MAX_LIMIT = 1000;

    private static SmsBalancePlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /** Called by SmsReceiver so a running web layer refreshes immediately. */
    static void notifyIncoming() {
        SmsBalancePlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners("smsReceived", new JSObject(), true);
    }

    private boolean hasSmsPermission() {
        return getPermissionState("sms") == PermissionState.GRANTED;
    }

    /** Balance-looking messages from the inbox newer than `sinceMs`, oldest first. */
    @PluginMethod
    public void readInbox(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("SMS permission not granted");
            return;
        }
        long since = call.getLong("sinceMs", 0L);
        int limit = Math.min(Math.max(call.getInt("limit", DEFAULT_LIMIT), 1), MAX_LIMIT);

        JSArray messages = new JSArray();
        String[] projection = { "address", "body", "date" };
        try (Cursor cursor = getContext().getContentResolver().query(
            Uri.parse("content://sms/inbox"),
            projection,
            "date > ?",
            new String[] { String.valueOf(since) },
            "date DESC"
        )) {
            if (cursor != null) {
                int taken = 0;
                while (cursor.moveToNext() && taken < limit) {
                    String body = cursor.getString(1);
                    if (!SmsBalanceStore.looksLikeBalanceNotice(body)) continue;
                    JSObject item = new JSObject();
                    item.put("address", cursor.getString(0) == null ? "" : cursor.getString(0));
                    item.put("body", body);
                    item.put("date", cursor.getLong(2));
                    messages.put(item);
                    taken++;
                }
            }
        } catch (RuntimeException e) {
            call.reject("Could not read SMS inbox", e);
            return;
        }

        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }

    /** Messages queued by SmsReceiver while the web layer was not running. */
    @PluginMethod
    public void drainPending(PluginCall call) {
        JSObject result = new JSObject();
        try {
            result.put("messages", new JSArray(SmsBalanceStore.drain(getContext()).toString()));
        } catch (JSONException e) {
            result.put("messages", new JSArray());
        }
        call.resolve(result);
    }
}
