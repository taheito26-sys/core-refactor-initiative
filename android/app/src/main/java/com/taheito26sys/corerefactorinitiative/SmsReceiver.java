package com.taheito26sys.corerefactorinitiative;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;

        // A long SMS arrives as several parts from the same sender; join them.
        Map<String, StringBuilder> bySender = new LinkedHashMap<>();
        long date = System.currentTimeMillis();
        for (SmsMessage part : parts) {
            if (part == null) continue;
            String from = part.getOriginatingAddress() == null ? "" : part.getOriginatingAddress();
            StringBuilder sb = bySender.get(from);
            if (sb == null) {
                sb = new StringBuilder();
                bySender.put(from, sb);
            }
            sb.append(part.getMessageBody());
        }

        for (Map.Entry<String, StringBuilder> entry : bySender.entrySet()) {
            String body = entry.getValue().toString();
            if (!SmsBalanceStore.looksLikeBalanceNotice(body)) continue;
            SmsBalanceStore.enqueue(context, entry.getKey(), body, date);
            SmsBalancePlugin.notifyIncoming();
        }
    }
}
